// ── Vue d'ensemble, Indicateurs, Fiabilité — lectures Supabase → moteur → briefing (I0-B) ────
// Aucun calcul ici : on lit les faits F1/F2 sur la période courante ET les 4 précédentes (D1),
// on les adapte (econ/adapters.js), on appelle aggregate() par période, puis confidence.js et
// insights/buildBriefing. Admin GraphQL : shop.plan.partnerDevelopment (C6, mémorisé),
// shop { name shopOwnerName } (salutation) et les titres des produits cités par les insights.
import { aggregate } from "./econ/aggregate.js";
import { linesFromOrderMarginsRows, ordersForEngine, applyOrderDiscounts } from "./econ/adapters.js";
import { overviewWindows, buildKpis, buildNotes, buildGaps, buildChartSeries, OVERVIEW_LINES_CAP } from "./overview.js";
import { dataConfidence } from "./confidence.js";
import { buildBriefing } from "./insights/index.js";
import { REFERENCE_PERIODS } from "./insights/config.js";

const DEV_SHOP_QUERY = `{ shop { plan { partnerDevelopment } } }`;
const SHOP_NAME_QUERY = `{ shop { name shopOwnerName } }`;
const PRODUCT_TITLES_QUERY = `query Titles($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title } } }`;
const DAY_MS = 86_400_000;
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const rows = ({ data, error }, label) => { if (error) throw new Error(`overview (${label}) : ${error.message}`); return data ?? []; };
const shiftDay = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);

// Réglages boutique + détection « boutique de développement » (lue une fois, mémorisée si la
// colonne existe ; sinon la valeur reste en mémoire pour cette requête).
export async function loadOverviewSettings({ supabase, shop, admin = null }) {
  const { data } = await supabase.from("shop_settings").select("*").eq("shop_domain", shop).maybeSingle();
  const settings = data ?? { shop_domain: shop };
  let isDevShop = settings.is_dev_shop ?? null;
  let devShopSource = isDevShop == null ? "unknown" : "stored";
  if (isDevShop == null && admin) {
    try {
      const j = await (await admin.graphql(DEV_SHOP_QUERY)).json();
      const v = j?.data?.shop?.plan?.partnerDevelopment;
      if (typeof v === "boolean") {
        isDevShop = v; devShopSource = "live";
        const { error } = await supabase.from("shop_settings").upsert({ shop_domain: shop, is_dev_shop: v }, { onConflict: "shop_domain" });
        if (error) console.warn(`[Overview] is_dev_shop non mémorisé (${error.message}) : migration F4-01 appliquée ?`);
      }
    } catch (e) { console.error(`[Overview] plan query ${shop} :`, e?.message); }
  }
  const includeTestOrders = isDevShop === true && settings.include_test_orders === true;
  return { settings, isDevShop, devShopSource, includeTestOrders };
}

// Bascule C6 : autorisée UNIQUEMENT si la boutique est une boutique de développement.
export async function setIncludeTestOrders({ supabase, shop, value }) {
  const { data } = await supabase.from("shop_settings").select("is_dev_shop").eq("shop_domain", shop).maybeSingle();
  if (data?.is_dev_shop !== true) return { ok: false, error: "not_dev_shop" };
  const { error } = await supabase.from("shop_settings").update({ include_test_orders: value === true, updated_at: new Date().toISOString() }).eq("shop_domain", shop);
  if (error) return { ok: false, error: error.message };
  return { ok: true, include_test_orders: value === true };
}

async function loadShopIdentity(admin) {
  if (!admin) return { shopName: null, firstName: null };
  try {
    const j = await (await admin.graphql(SHOP_NAME_QUERY)).json();
    const s = j?.data?.shop ?? {};
    const first = String(s.shopOwnerName ?? "").trim().split(/\s+/)[0] || null;
    return { shopName: s.name ?? null, firstName: first };
  } catch (e) { console.error("[Overview] shop identity :", e?.message); return { shopName: null, firstName: null }; }
}

// Titres des produits cités (sujets d'insights) : une requête, jamais bloquante.
async function loadProductTitles(admin, ids = []) {
  const gids = [...new Set(ids.filter((id) => typeof id === "string" && id.startsWith("gid://shopify/Product/")))].slice(0, 20);
  if (!admin || !gids.length) return {};
  try {
    const j = await (await admin.graphql(PRODUCT_TITLES_QUERY, { variables: { ids: gids } })).json();
    return Object.fromEntries((j?.data?.nodes ?? []).filter(Boolean).map((n) => [n.id, n.title]));
  } catch (e) { console.error("[Overview] product titles :", e?.message); return {}; }
}

// Fenêtres précédentes contiguës (D1 : jusqu'à 4), de la plus récente à la plus ancienne.
export function previousWindows(win, count = REFERENCE_PERIODS) {
  const out = [];
  let end = shiftDay(win.current.start, -1);
  for (let i = 0; i < count; i++) { const start = shiftDay(end, -(win.days - 1)); out.push({ start, end }); end = shiftDay(start, -1); }
  return out;
}

// Lecture des faits sur [plus ancienne fenêtre de référence, aujourd'hui] puis agrégation par période.
export async function loadOverview({ supabase, shop, admin = null, days, now = new Date(), hasAllOrders = false, withBriefing = true }) {
  const { settings, isDevShop, devShopSource, includeTestOrders } = await loadOverviewSettings({ supabase, shop, admin });
  const timeZone = settings.shop_timezone || "UTC";
  const win = overviewWindows({ now, timeZone, days });
  const prevWins = previousWindows(win);
  const from = prevWins[prevWins.length - 1].start, to = win.current.end;

  const [identity, ordersRows, lineRows, refunds, returns, fulfillments, fixedCosts, codeRules, manualCommissions, variantCosts, adSpend, sessions, customers, lastJob, firstOrder, invLast] = await Promise.all([
    loadShopIdentity(admin),
    rows(await supabase.from("orders").select("*").eq("shop_domain", shop).gte("day_local", from).lte("day_local", to).order("day_local", { ascending: false }).limit(OVERVIEW_LINES_CAP + 1), "orders"),
    rows(await supabase.from("order_margins").select("order_id, line_item_id, product_id, variant_id, quantity, refunded_qty, effective_qty, unit_price_ht, tax_lines, is_gift_card, cm1_components, cm1_unit, cm2_alloc, breakdown_version, cost_source, currency_code, day_local")
      .eq("shop_domain", shop).not("breakdown_version", "is", null).gte("day_local", from).lte("day_local", to).order("day_local", { ascending: false }).limit(OVERVIEW_LINES_CAP + 1), "lines"),
    rows(await supabase.from("refunds").select("refund_id, order_id, shipping_refunded, settled, line_items").eq("shop_domain", shop).gte("day_local", from), "refunds"),
    rows(await supabase.from("returns").select("return_id, order_id, status, line_items").eq("shop_domain", shop).gte("day_local", from), "returns"),
    rows(await supabase.from("fulfillments").select("fulfillment_id, order_id, created_at, delivered_at, promised_at").eq("shop_domain", shop).gte("day_local", from), "fulfillments"),
    rows(await supabase.from("fixed_costs").select("amount_monthly, active_from, active_to").eq("shop_domain", shop), "fixed_costs"),
    rows(await supabase.from("promo_code_rules").select("code, partner_id, commission_pct, commission_base, active_from, active_to").eq("shop_domain", shop), "promo_code_rules"),
    rows(await supabase.from("manual_commissions").select("period_month, amount").eq("shop_domain", shop), "manual_commissions"),
    rows(await supabase.from("variant_costs").select("variant_id, supplier_lead_days, buffer_days, prix_achat").eq("shop_domain", shop), "variant_costs"),
    rows(await supabase.from("ad_spend").select("day_local, platform, spend, spend_shop_currency, platform_revenue, platform_orders").eq("shop_domain", shop).gte("day_local", from).lte("day_local", to), "ad_spend"),
    rows(await supabase.from("sessions_daily").select("day_local, source, device, sessions, atc_sessions, checkout_sessions, purchase_sessions").eq("shop_domain", shop).gte("day_local", from).lte("day_local", to), "sessions"),
    rows(await supabase.from("customers_agg").select("customer_id, cohort_month, first_order_at, second_order_at, orders_count, cm2_total").eq("shop_domain", shop).limit(OVERVIEW_LINES_CAP), "customers"),
    (async () => { const { data } = await supabase.from("sync_jobs").select("kind, finished_at, window_end").eq("shop_domain", shop).eq("status", "completed").order("finished_at", { ascending: false }).limit(1).maybeSingle(); return data ?? null; })(),
    (async () => { const { data } = await supabase.from("orders").select("day_local").eq("shop_domain", shop).order("day_local", { ascending: true }).limit(1).maybeSingle(); return data?.day_local ?? null; })(),
    (async () => { const { data } = await supabase.from("inventory_daily").select("day_local").eq("shop_domain", shop).order("day_local", { ascending: false }).limit(1).maybeSingle(); return data?.day_local ?? null; })(),
  ]);
  const inventory = invLast ? rows(await supabase.from("inventory_daily").select("variant_id, product_id, available, tracked, cost_per_unit, day_local").eq("shop_domain", shop).eq("day_local", invLast).limit(1000), "inventory") : [];

  const capped = lineRows.length > OVERVIEW_LINES_CAP || ordersRows.length > OVERVIEW_LINES_CAP;
  const lineSlice = lineRows.slice(0, OVERVIEW_LINES_CAP);
  const orderSlice = ordersRows.slice(0, OVERVIEW_LINES_CAP);
  const orderIds = orderSlice.map((o) => o.order_id);
  let fees = [];
  for (const ids of chunk(orderIds, 200)) fees.push(...rows(await supabase.from("order_fees").select("order_id, fee_amount, source, confirmed").eq("shop_domain", shop).in("order_id", ids), "order_fees"));

  const { lines } = linesFromOrderMarginsRows(lineSlice);
  const { orders, excluded, reincluded } = ordersForEngine(orderSlice, { refunds, includeTestOrders, lines });
  const vcMap = new Map(variantCosts.map((v) => [v.variant_id, v]));
  const base = { orders, lines, fees, returns, fulfillments, adSpend, codeRules, manualCommissions, fixedCosts, sessions, inventory, variantCosts: vcMap, customers, settings, now };
  const aggFor = (w) => applyOrderDiscounts(aggregate({ ...base, window: w }), orders, w);
  const current = aggFor(win.current);
  const previous = aggFor(win.previous);
  const previousPeriods = prevWins.map(aggFor);

  const inWin = (o) => o.day_local >= win.current.start && o.day_local <= win.current.end;
  const excludedCurrent = { test: 0, draft: 0, cancelled: 0, gift_card_only: 0, b2b: 0, legacy: 0 };
  for (const o of orders) if (o.excluded_reason && inWin(o)) excludedCurrent[o.excluded_reason] = (excludedCurrent[o.excluded_reason] ?? 0) + 1;

  const sources = { ads: (current.shop.leaves.ad_spend ?? 0) > 0 || (current.shop.leaves.commissions ?? 0) > 0, sessions: (current.counts?.sessions ?? 0) > 0, customers: (current.counts?.customers ?? 0) > 0 };
  const confidence = dataConfidence({ agg: current, settings, sources, lines });
  const briefing = withBriefing ? buildBriefing({ current, previousPeriods, settings, window: win.current, confidence, variantCosts: vcMap }) : null;
  const productIds = briefing ? [...briefing.priorities, ...briefing.insights].map((i) => i.subject?.kind === "product" ? i.subject.key : null).filter(Boolean) : [];
  const titles = await loadProductTitles(admin, productIds);

  return {
    days, windows: win, timeZone, now: now.toISOString(),
    currency: settings.shop_currency ?? current.currency ?? null,
    shopName: identity.shopName, firstName: identity.firstName,
    isDevShop, devShopSource, includeTestOrders, reincluded,
    kpis: buildKpis({ current, previous, window: win.current, previousWindow: win.previous }),
    notes: buildNotes(current),
    gaps: buildGaps({ agg: current, capped, excluded: excludedCurrent }),
    excluded, excludedCurrent,
    ordersInPeriod: current.shop.leaves.orders, mixedCurrency: current.currency === "MIXED",
    lastSync: lastJob?.finished_at ?? null, historySince: firstOrder, hasAllOrders,
    confidence, briefing, titles,
    waterfall: { leaves: current.shop.leaves, nodes: current.shop.nodes },
    chart: buildChartSeries({ current, previous, window: win.current, previousWindow: win.previous }),
  };
}
