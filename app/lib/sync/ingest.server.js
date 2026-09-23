// ── Sync v2 (F2) — ÉCRITURES Supabase (service role) depuis les formes pures de normalize.js ──
// Contrats :
//   • orders : upsert complet (le dernier événement est la vérité) ;
//   • order_margins : INSERT … ON CONFLICT DO NOTHING (ignoreDuplicates) → snapshot jamais réécrit ;
//     seules ORDER_MARGINS_MUTABLE_COLUMNS (quantités remboursées) sont mises à jour ensuite ;
//   • refunds / returns / fulfillments / order_fees / inventory_daily / customers_agg : upsert par
//     identifiant Shopify (le dernier écrit gagne, B11) ;
//   • jamais d'échec sur un champ vide (client invité, champ non approuvé niveau 1).
import { countDistinctOrders } from "../orderIngest.js";
import { ORDER_MARGINS_MUTABLE_COLUMNS } from "../schema.js";
import {
  normalizeOrder, refundedQuantities, refundFromGraphql, returnFromGraphql, promisedAt, dayLocal, gid, nodes,
  customersAggFromOrders,
} from "./normalize.js";
import { chunk, journeyRepullCandidates } from "./windows.js";
import { SHOP_QUERY, VARIANTS_QUERY, FEES_QUERY, JOURNEY_QUERY, REFUNDS_QUERY, RETURNS_QUERY, refundsFilter, returnsFilter } from "./queries.js";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };
const MAX_PAGES = 40;

// Lecture paginée (PostgREST plafonne à 1 000 lignes par requête).
export async function selectAll(builderFactory, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await builderFactory().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}
const must = ({ error }, label) => { if (error) throw new Error(`${label} : ${error.message}`); };

// ── Contexte boutique : réglages (fuseau, devise, pays remplis à la première sync) + coûts ─────
export async function loadShopContext({ admin = null, supabase, shop, now = new Date() }) {
  let { data: settings } = await supabase.from("shop_settings").select("*").eq("shop_domain", shop).maybeSingle();
  const incomplete = !settings || !settings.shop_timezone || !settings.shop_currency || !settings.shop_country_code;
  if (incomplete && admin) {
    try {
      const j = await (await admin.graphql(SHOP_QUERY)).json();
      const s = j.data?.shop;
      if (s) {
        const patch = {
          shop_domain: shop,
          shop_timezone: settings?.shop_timezone ?? s.ianaTimezone ?? null,
          shop_currency: settings?.shop_currency ?? s.currencyCode ?? null,
          shop_country_code: settings?.shop_country_code ?? s.shopAddress?.countryCodeV2 ?? null,
          updated_at: now.toISOString(),
        };
        const { data } = await supabase.from("shop_settings").upsert(patch, { onConflict: "shop_domain" }).select("*").maybeSingle();
        if (data) settings = data;
      }
    } catch (e) { console.error(`[Sync] shop query ${shop} :`, e?.message); }
  }
  settings ??= { shop_domain: shop };
  const costs = await selectAll(() => supabase.from("variant_costs").select("*").eq("shop_domain", shop));
  const costMap = new Map(costs.map((c) => [c.variant_id, c]));
  return { settings, costMap, costLookup: (vid) => costMap.get(vid) ?? null, timeZone: settings.shop_timezone || "UTC" };
}

// ── Commandes (+ lignes) ─────────────────────────────────────────────────────────────────────
export async function ingestOrders({ supabase, shop, ctx, factsList = [], now = new Date() }) {
  const nowIso = now.toISOString();
  const totals = { orders: 0, lines: 0, inserted: 0, insertedOrders: 0, excluded: 0 };
  for (const batch of chunk(factsList, 100)) {
    const ids = batch.map((f) => f.order_id).filter(Boolean);
    // Remboursements déjà connus (webhook arrivé avant la commande : B12a) → quantités dans le snapshot.
    const known = ids.length
      ? await selectAll(() => supabase.from("refunds").select("refund_id, order_id, line_items, settled").eq("shop_domain", shop).in("order_id", ids))
      : [];
    const refundsByOrder = new Map();
    for (const r of known) { const a = refundsByOrder.get(r.order_id) ?? []; a.push(r); refundsByOrder.set(r.order_id, a); }

    const orderRows = [], lineRows = [], detailedRefunds = [], fulfillments = [];
    for (const facts of batch) {
      if (!facts.order_id) continue;
      const { orderRow, lineRows: lr, exclusion } = normalizeOrder({ facts, settings: ctx.settings, costLookup: ctx.costLookup, refundRows: refundsByOrder.get(facts.order_id) ?? [], now });
      orderRows.push({ shop_domain: shop, ...orderRow });
      for (const r of lr) lineRows.push({ shop_domain: shop, ...r, computed_at: nowIso });
      for (const r of facts.refunds ?? []) if (r.detailed) detailedRefunds.push(r);
      for (const f of facts.fulfillments ?? []) fulfillments.push(f);
      if (exclusion) totals.excluded++;
    }
    if (orderRows.length) must(await supabase.from("orders").upsert(orderRows, { onConflict: "shop_domain,order_id" }), "orders");
    let inserted = [];
    if (lineRows.length) {
      const { data, error } = await supabase.from("order_margins")
        .upsert(lineRows, { onConflict: "shop_domain,order_id,line_item_id", ignoreDuplicates: true })
        .select("order_id");
      if (error) throw new Error(`order_margins : ${error.message}`);
      inserted = data ?? [];
    }
    totals.orders += orderRows.length; totals.lines += lineRows.length;
    totals.inserted += inserted.length; totals.insertedOrders += countDistinctOrders(inserted);
    if (detailedRefunds.length) await ingestRefunds({ supabase, shop, ctx, rows: detailedRefunds, now });
    if (fulfillments.length) await ingestFulfillments({ supabase, shop, ctx, rows: fulfillments, now });
  }
  // C4a — compteur mensuel de commandes DISTINCTES nouvelles (plafond d'alerting), non fatal.
  if (totals.insertedOrders > 0) {
    try {
      const { error } = await supabase.rpc("increment_usage_orders", { p_shop: shop, p_month: nowIso.slice(0, 7), p_delta: totals.insertedOrders });
      if (error) console.error("[Sync] compteur commandes :", error.message);
    } catch (e) { console.error("[Sync] compteur commandes :", e?.message); }
  }
  return totals;
}

// ── Remboursements : upsert + mise à jour des SEULES colonnes mutables des lignes ────────────
export async function ingestRefunds({ supabase, shop, ctx, rows = [], now = new Date() }) {
  const valid = rows.filter((r) => r.refund_id && r.order_id);
  if (!valid.length) return { refunds: 0, linesUpdated: 0 };
  const tz = ctx?.timeZone ?? "UTC";
  const toWrite = valid.map((r) => ({
    shop_domain: shop, refund_id: r.refund_id, order_id: r.order_id,
    created_at: r.created_at ?? now.toISOString(), day_local: r.day_local ?? dayLocal(r.created_at ?? now.toISOString(), tz),
    total_refunded: num(r.total_refunded), shipping_refunded: num(r.shipping_refunded),
    line_items: r.line_items ?? [], transactions: r.transactions ?? [], settled: r.settled === true,
  }));
  for (const b of chunk(toWrite, 200)) must(await supabase.from("refunds").upsert(b, { onConflict: "shop_domain,refund_id" }), "refunds");

  // Quantités par ligne, recalculées depuis TOUS les remboursements connus des commandes touchées.
  const orderIds = [...new Set(valid.map((r) => r.order_id))];
  let linesUpdated = 0;
  for (const ids of chunk(orderIds, 100)) {
    const all = await selectAll(() => supabase.from("refunds").select("refund_id, order_id, line_items, settled").eq("shop_domain", shop).in("order_id", ids));
    const lines = await selectAll(() => supabase.from("order_margins").select("order_id, line_item_id, quantity, refunded_qty").eq("shop_domain", shop).in("order_id", ids));
    if (!lines.length) continue; // commande pas encore en base (orpheline, B12a) : rattachée au backfill
    const byOrder = new Map();
    for (const r of all) { const a = byOrder.get(r.order_id) ?? []; a.push(r); byOrder.set(r.order_id, a); }
    for (const l of lines) {
      const q = refundedQuantities(byOrder.get(l.order_id) ?? []).get(l.line_item_id);
      const refunded = Math.min(num(l.quantity), q ? q.refunded_qty : 0);
      if (refunded === num(l.refunded_qty)) continue;
      const patch = { refunded_qty: refunded, effective_qty: Math.max(0, num(l.quantity) - refunded) };
      for (const k of Object.keys(patch)) if (!ORDER_MARGINS_MUTABLE_COLUMNS.includes(k)) delete patch[k];
      const { error } = await supabase.from("order_margins").update(patch)
        .eq("shop_domain", shop).eq("order_id", l.order_id).eq("line_item_id", l.line_item_id);
      if (error) console.error("[Sync] quantités remboursées :", error.message); else linesUpdated++;
    }
  }
  return { refunds: valid.length, linesUpdated };
}

// ── Retours : fusion avec l'existant (un webhook cancel/close/reopen n'a pas les lignes) ──────
export async function ingestReturns({ supabase, shop, ctx, rows = [], now = new Date() }) {
  const valid = rows.filter((r) => r.return_id && r.order_id);
  if (!valid.length) return { returns: 0 };
  const nowIso = now.toISOString();
  const ids = valid.map((r) => r.return_id);
  const existing = new Map((await selectAll(() => supabase.from("returns").select("*").eq("shop_domain", shop).in("return_id", ids))).map((r) => [r.return_id, r]));
  const toWrite = valid.map((r) => {
    const ex = existing.get(r.return_id) ?? null;
    const status = r.status ?? ex?.status ?? null;
    return {
      shop_domain: shop, return_id: r.return_id, order_id: r.order_id, status,
      requested_at: ex?.requested_at ?? r.requested_at ?? (status === "REQUESTED" ? nowIso : null),
      closed_at: r.closed_at ?? (status === "CLOSED" ? (ex?.closed_at ?? nowIso) : ex?.closed_at ?? null),
      day_local: ex?.day_local ?? r.day_local ?? dayLocal(nowIso, ctx?.timeZone ?? "UTC"),
      line_items: (r.line_items ?? []).length ? r.line_items : (ex?.line_items ?? []),
    };
  });
  for (const b of chunk(toWrite, 200)) must(await supabase.from("returns").upsert(b, { onConflict: "shop_domain,return_id" }), "returns");
  return { returns: toWrite.length };
}

// ── Expéditions : fusion (delivered_at jamais effacé par un événement ultérieur sans info) ─────
export async function ingestFulfillments({ supabase, shop, ctx, rows = [], now = new Date() }) {
  const valid = rows.filter((r) => r.fulfillment_id && r.order_id);
  if (!valid.length) return { fulfillments: 0 };
  const settings = ctx?.settings ?? {};
  const tz = ctx?.timeZone ?? "UTC";
  const orderIds = [...new Set(valid.map((r) => r.order_id))];
  const orders = new Map((await selectAll(() => supabase.from("orders").select("order_id, created_at, country_code").eq("shop_domain", shop).in("order_id", orderIds))).map((o) => [o.order_id, o]));
  const existing = new Map((await selectAll(() => supabase.from("fulfillments").select("*").eq("shop_domain", shop).in("fulfillment_id", valid.map((r) => r.fulfillment_id)))).map((f) => [f.fulfillment_id, f]));
  const toWrite = valid.map((r) => {
    const ex = existing.get(r.fulfillment_id) ?? null;
    const o = orders.get(r.order_id) ?? null;
    const created = r.created_at ?? ex?.created_at ?? now.toISOString();
    return {
      shop_domain: shop, fulfillment_id: r.fulfillment_id, order_id: r.order_id,
      created_at: created, status: r.status ?? ex?.status ?? null,
      tracking_company: r.tracking_company ?? ex?.tracking_company ?? null,
      tracking_numbers: (r.tracking_numbers ?? []).length ? r.tracking_numbers : (ex?.tracking_numbers ?? []),
      delivered_at: r.delivered_at ?? ex?.delivered_at ?? null,
      last_event_status: r.last_event_status ?? ex?.last_event_status ?? null,
      last_event_at: r.last_event_at ?? ex?.last_event_at ?? null,
      estimated_delivery_at: r.estimated_delivery_at ?? ex?.estimated_delivery_at ?? null,
      promised_at: ex?.promised_at ?? (o ? promisedAt(o.created_at, settings.delivery_promise_days, tz) : null),
      country_code: r.country_code ?? ex?.country_code ?? o?.country_code ?? null,
      day_local: ex?.day_local ?? r.day_local ?? dayLocal(created, tz),
    };
  });
  for (const b of chunk(toWrite, 200)) must(await supabase.from("fulfillments").upsert(b, { onConflict: "shop_domain,fulfillment_id" }), "fulfillments");
  return { fulfillments: toWrite.length };
}

export async function applyFulfillmentEvent({ supabase, shop, patch, now = new Date() }) {
  if (!patch?.fulfillment_id) return { skipped: true };
  const { data: ex } = await supabase.from("fulfillments").select("fulfillment_id, delivered_at").eq("shop_domain", shop).eq("fulfillment_id", patch.fulfillment_id).maybeSingle();
  if (!ex) return { skipped: true, reason: "unknown_fulfillment" }; // la réconciliation (Order.fulfillments) la créera
  const upd = { last_event_status: patch.status, last_event_at: patch.happened_at ?? now.toISOString() };
  if (patch.estimated_delivery_at) upd.estimated_delivery_at = patch.estimated_delivery_at;
  if (patch.delivered) upd.delivered_at = patch.happened_at ?? now.toISOString();
  must(await supabase.from("fulfillments").update(upd).eq("shop_domain", shop).eq("fulfillment_id", patch.fulfillment_id), "fulfillments (événement)");
  return { updated: true };
}

// ── Sous-ressources d'une fenêtre (B4) : requêtes paginées ────────────────────────────────────
async function paginateOrders({ admin, query, q, onNode }) {
  let cursor = null, pages = 0, count = 0;
  while (pages < MAX_PAGES) {
    pages++;
    const j = await (await admin.graphql(query, { variables: { q, cursor } })).json();
    const conn = j.data?.orders;
    if (!conn) { if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join(" ; ")); break; }
    for (const { node } of conn.edges ?? []) { count++; onNode(node); }
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return { pages, count };
}
export async function pullRefundsForWindow({ admin, supabase, shop, ctx, window, now = new Date() }) {
  const rows = [];
  const p = await paginateOrders({ admin, query: REFUNDS_QUERY, q: refundsFilter(window), onNode: (n) => { for (const r of n.refunds ?? []) rows.push(refundFromGraphql(r, n.id, { timeZone: ctx.timeZone })); } });
  const r = await ingestRefunds({ supabase, shop, ctx, rows, now });
  return { ...p, ...r };
}
export async function pullReturnsForWindow({ admin, supabase, shop, ctx, window, now = new Date() }) {
  const rows = [];
  const p = await paginateOrders({ admin, query: RETURNS_QUERY, q: returnsFilter(window), onNode: (n) => { for (const r of nodes(n.returns)) rows.push(returnFromGraphql(r, n.id, { timeZone: ctx.timeZone })); } });
  const r = await ingestReturns({ supabase, shop, ctx, rows, now });
  return { ...p, ...r };
}

// ── Enrichissements différés (B9) ────────────────────────────────────────────────────────────
// Attribution : re-tirage des commandes non prêtes de moins de 30 jours (customerJourneySummary).
export async function repullJourneys({ admin, supabase, shop, now = new Date(), limit = 500 }) {
  const { data: cands, error } = await supabase.from("orders").select("order_id, created_at, attribution_ready")
    .eq("shop_domain", shop).eq("attribution_ready", false).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`orders (attribution) : ${error.message}`);
  const ids = journeyRepullCandidates(cands ?? [], now);
  let updated = 0, ready = 0;
  for (const batch of chunk(ids, 50)) {
    const j = await (await admin.graphql(JOURNEY_QUERY, { variables: { ids: batch } })).json();
    for (const n of j.data?.nodes ?? []) {
      const s = n?.customerJourneySummary; if (!n?.id || !s) continue;
      const v = s.lastVisit ?? null, u = v?.utmParameters ?? null;
      const patch = { customer_order_index: s.customerOrderIndex ?? null, attribution_ready: s.ready === true, updated_at: now.toISOString() };
      if (s.ready === true) {
        Object.assign(patch, {
          utm_source: u?.source ?? null, utm_medium: u?.medium ?? null, utm_campaign: u?.campaign ?? null, utm_content: u?.content ?? null, utm_term: u?.term ?? null,
          visit_source: v?.source ?? null, visit_source_type: v?.sourceType ?? null, landing_page: v?.landingPage ?? null,
        });
        ready++;
      }
      const { error: e } = await supabase.from("orders").update(patch).eq("shop_domain", shop).eq("order_id", n.id);
      if (e) console.error("[Sync] attribution :", e.message); else updated++;
    }
  }
  return { candidates: ids.length, updated, ready };
}

// Frais Shopify Payments réels (A2 fait, décision 16) : transactions d'équilibre depuis `since`.
export async function pullFees({ admin, supabase, shop, since }) {
  const rows = [];
  let cursor = null, pages = 0;
  while (pages < MAX_PAGES) {
    pages++;
    const j = await (await admin.graphql(FEES_QUERY, { variables: { cursor, q: `processed_at:>='${since}'` } })).json();
    const acct = j.data?.shopifyPaymentsAccount;
    if (!acct) { const msg = j.errors?.map((e) => e.message).join(" ; "); return { skipped: true, reason: msg || "no_shopify_payments", fees: 0 }; }
    const conn = acct.balanceTransactions;
    for (const { node } of conn?.edges ?? []) {
      if (!node?.associatedOrder?.id) continue;
      rows.push({
        shop_domain: shop, order_id: node.associatedOrder.id,
        order_transaction_id: node.sourceOrderTransactionId ? gid("OrderTransaction", node.sourceOrderTransactionId) : node.id,
        gateway: "shopify_payments",
        gross_amount: num(node.amount?.amount), fee_amount: num(node.fee?.amount), net_amount: num(node.net?.amount),
        currency_code: node.amount?.currencyCode ?? null, transaction_date: node.transactionDate ?? null,
        source: "shopify_payments", confirmed: true,
      });
    }
    if (!conn?.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  for (const b of chunk(rows, 200)) must(await supabase.from("order_fees").upsert(b, { onConflict: "shop_domain,order_id,order_transaction_id" }), "order_fees");
  return { fees: rows.length, pages };
}

// Instantané quotidien du stock (B10c) : toutes les variantes, quantité agrégée multi-emplacements.
export async function snapshotInventory({ admin, supabase, shop, ctx, now = new Date() }) {
  const day = dayLocal(now.toISOString(), ctx.timeZone);
  const rows = [];
  let cursor = null, pages = 0;
  while (pages < MAX_PAGES) {
    pages++;
    const j = await (await admin.graphql(VARIANTS_QUERY, { variables: { cursor } })).json();
    const conn = j.data?.productVariants;
    if (!conn) { if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join(" ; ")); break; }
    for (const { node } of conn.edges ?? []) {
      const available = node.inventoryQuantity == null ? null : Number(node.inventoryQuantity);
      rows.push({
        shop_domain: shop, day_local: day, variant_id: node.id, product_id: node.product?.id ?? null,
        available, tracked: node.inventoryItem?.tracked !== false,
        cost_per_unit: node.inventoryItem?.unitCost?.amount != null ? num(node.inventoryItem.unitCost.amount) : null,
        in_stock: available == null ? null : available > 0, captured_at: now.toISOString(),
      });
    }
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  for (const b of chunk(rows, 500)) must(await supabase.from("inventory_daily").upsert(b, { onConflict: "shop_domain,day_local,variant_id" }), "inventory_daily");
  return { variants: rows.length, day };
}

// customers_agg : recalcul borné aux clients dont une commande a changé depuis `since`
// (ou à `customerIds` explicites) — reconstructible, niveau 1.
export async function refreshCustomersAgg({ supabase, shop, since = null, customerIds = null, now = new Date() }) {
  let ids = customerIds;
  if (!ids) {
    let q = supabase.from("orders").select("customer_id").eq("shop_domain", shop).not("customer_id", "is", null);
    if (since) q = q.gte("updated_at", since);
    const { data, error } = await q.limit(5000);
    if (error) throw new Error(`orders (clients) : ${error.message}`);
    ids = [...new Set((data ?? []).map((o) => o.customer_id))];
  }
  ids = (ids ?? []).filter(Boolean);
  let written = 0;
  for (const batch of chunk(ids, 100)) {
    const orders = await selectAll(() => supabase.from("orders")
      .select("order_id, customer_id, created_at, day_local, ca_ht, visit_source, source_name, utm_source, excluded_reason")
      .eq("shop_domain", shop).in("customer_id", batch));
    const orderIds = orders.map((o) => o.order_id);
    const lines = [];
    for (const oids of chunk(orderIds, 100)) {
      lines.push(...await selectAll(() => supabase.from("order_margins")
        .select("order_id, quantity, effective_qty, cm1_unit, cm2_alloc, cost_source, is_gift_card")
        .eq("shop_domain", shop).in("order_id", oids)));
    }
    const rows = customersAggFromOrders({ orders, lines, now }).map((r) => ({ shop_domain: shop, ...r }));
    if (rows.length) must(await supabase.from("customers_agg").upsert(rows, { onConflict: "shop_domain,customer_id" }), "customers_agg");
    written += rows.length;
  }
  return { customers: written };
}
