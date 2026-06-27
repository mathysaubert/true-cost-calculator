// ── Sync commandes 30 j → order_margins — module SERVEUR réutilisable ────────
// Extraction LITTÉRALE de l'action backfill_orders (app/routes/app._index.jsx) pour que
// le bouton manuel (session online) ET le cron quotidien (token offline via
// unauthenticated.admin) appellent EXACTEMENT le même chemin. Zéro changement de logique :
// bulk launch/poll/download + refunds paginés stitchés + upsert order_margins idempotent.
// engine.js n'est jamais touché ; le mapping + computeMargin + l'agrégation vivent dans
// lib/orderIngest.js (pur). Ici : I/O Shopify/Supabase uniquement.
//
// Entrées : { admin } (client Admin GraphQL, online OU offline), supabase (service role),
//            shop (shop_domain). Sortie : { success, ingested?, orders?, message?, error? }.
import { parseBulkJsonl, buildOrderHistoryRows } from "./orderIngest.js";

export async function syncShopOrders({ admin, supabase, shop }) {
  // Fenêtre J-30 en UTC, ISO 8601 explicite (filtre Shopify created_at en UTC).
  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Réglages boutique (D2 fees + shopTaxesIncluded).
  const { data: plan } = await supabase.from("shop_plans")
    .select("shopify_fee_pct, processor_fee_pct, processor_fixed_fee")
    .eq("shop_domain", shop).maybeSingle();
  let shopTaxesIncluded = true;
  try {
    const sr = await admin.graphql(`{ shop { taxesIncluded } }`);
    const sj = await sr.json();
    if (typeof sj.data?.shop?.taxesIncluded === "boolean") shopTaxesIncluded = sj.data.shop.taxesIncluded;
  } catch (e) { console.error("[Backfill] shop query:", e?.message); }
  const shopSettings = {
    shopTaxesIncluded,
    shopifyFee:        plan?.shopify_fee_pct     ?? 2.0,
    stripeFee:         plan?.processor_fee_pct   ?? 1.5,
    processorFixedFee: plan?.processor_fixed_fee ?? 0.25,
  };

  // Une seule bulk op QUERY par boutique à la fois : ne pas lancer en double.
  try {
    const cr = await admin.graphql(`{ currentBulkOperation(type: QUERY) { id status } }`);
    const cj = await cr.json();
    const cur = cj.data?.currentBulkOperation;
    if (cur && (cur.status === "RUNNING" || cur.status === "CREATED")) {
      return { success: false, error: "Une synchronisation est déjà en cours. Réessayez dans un instant." };
    }
  } catch (e) { console.error("[Backfill] currentBulkOperation:", e?.message); }

  // Connexions SANS first: (le bulk paginera) ; __typename pour le re-stitch.
  // Bulk = orders + lineItems UNIQUEMENT. refunds est une LISTE contenant des
  // connexions (refundLineItems/transactions) → interdit en bulk (« connection field
  // within a list field »). Les refunds sont récupérés à part par requête paginée
  // normale (où les connexions sous liste sont autorisées) puis rattachés par order id.
  const bulkQuery = `{
    orders(query: "created_at:>=${windowStart}") {
      edges { node {
        __typename id createdAt currencyCode
        lineItems { edges { node {
          __typename id quantity
          variant { id } product { id }
          originalUnitPriceSet { shopMoney { amount } }
          discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
          discountAllocations { allocatedAmountSet { shopMoney { amount } } }
        } } }
      } }
    }
  }`;
  const runResp = await admin.graphql(
    `mutation Run($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id status } userErrors { field message } } }`,
    { variables: { q: bulkQuery } }
  );
  const runJson = await runResp.json();
  const userErrors = runJson.data?.bulkOperationRunQuery?.userErrors ?? [];
  if (userErrors.length) {
    await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: "failed", window_start: windowStart, last_backfill_at: new Date().toISOString() }, { onConflict: "shop_domain" });
    return { success: false, error: "Requête bulk refusée : " + userErrors.map(e => e.message).join(" ; ") };
  }
  const bulkId = runJson.data?.bulkOperationRunQuery?.bulkOperation?.id ?? null;
  await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: "running", window_start: windowStart, bulk_operation_id: bulkId }, { onConflict: "shop_domain" });

  // Poll jusqu'à COMPLETED (budget temps ; en local/dev pas de timeout serverless).
  let op = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 25000) {
    await new Promise(r => setTimeout(r, 2000));
    const pr = await admin.graphql(`{ currentBulkOperation(type: QUERY) { id status errorCode url objectCount } }`);
    op = (await pr.json()).data?.currentBulkOperation;
    if (!op) break;
    if (op.status === "COMPLETED") break;
    if (["FAILED", "CANCELED", "EXPIRED"].includes(op.status)) break;
  }
  if (!op || op.status !== "COMPLETED") {
    const st = op?.status === "RUNNING" || op?.status === "CREATED" ? "running" : "failed";
    await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: st, bulk_operation_id: bulkId, last_backfill_at: new Date().toISOString() }, { onConflict: "shop_domain" });
    return { success: false, error: st === "running" ? "Synchronisation en cours, relancez dans un instant." : `Bulk échoué (${op?.status ?? "?"} ${op?.errorCode ?? ""}).` };
  }
  if (!op.url) { // COMPLETED sans url = zéro résultat
    await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: "completed", window_start: windowStart, last_backfill_at: new Date().toISOString() }, { onConflict: "shop_domain" });
    return { success: true, ingested: 0, orders: 0, message: "Aucune commande sur les 30 derniers jours." };
  }

  // Download JSONL + re-stitch (module pur). orders ont lineItems ; refunds vide.
  const text = await (await fetch(op.url)).text();
  const orders = parseBulkJsonl(text);

  // Refunds : requête paginée NORMALE (connexions sous liste autorisées hors bulk),
  // filtrée aux commandes remboursées. Un-edge en tableaux → forme attendue par
  // effectiveRefundedQty (refund.refundLineItems[].lineItem.id/quantity, transactions[].kind/status).
  const refundsByOrder = new Map();
  try {
    const refundsQ = `created_at:>=${windowStart} AND (financial_status:refunded OR financial_status:partially_refunded)`;
    let rCursor = null, rHasNext = true, rPages = 0;
    while (rHasNext && rPages < 20) {
      rPages++;
      const rr = await admin.graphql(
        `query Refunds($q: String!, $cursor: String) {
          orders(first: 100, query: $q, after: $cursor) {
            edges { node {
              id
              refunds {
                id
                refundLineItems(first: 100) { edges { node { quantity lineItem { id } } } }
                transactions(first: 50) { edges { node { kind status } } }
              }
            } }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { variables: { q: refundsQ, cursor: rCursor } }
      );
      const rj = await rr.json();
      const conn = rj.data?.orders;
      if (!conn) break;
      for (const { node } of conn.edges) {
        const refunds = (node.refunds ?? []).map((rf) => ({
          id: rf.id,
          refundLineItems: (rf.refundLineItems?.edges ?? []).map((e) => e.node),
          transactions:    (rf.transactions?.edges ?? []).map((e) => e.node),
        }));
        refundsByOrder.set(node.id, refunds);
      }
      rHasNext = conn.pageInfo.hasNextPage;
      rCursor = conn.pageInfo.endCursor;
    }
  } catch (e) { console.error("[Backfill] refunds query:", e?.message); }

  // Rattache les refunds aux orders re-stitchés (par id).
  for (const order of orders) {
    order.refunds = refundsByOrder.get(order.id) ?? [];
  }

  // Snapshot des coûts au moment de l'ingestion.
  const { data: costsRows } = await supabase.from("variant_costs").select("*").eq("shop_domain", shop);
  const costMap = new Map((costsRows ?? []).map(c => [c.variant_id, c]));
  const lookup = (vid) => costMap.get(vid) ?? null;

  const now = new Date().toISOString();
  const allRows = [];
  for (const order of orders) {
    for (const r of buildOrderHistoryRows(order, lookup, shopSettings)) {
      allRows.push({ shop_domain: shop, ...r, computed_at: now });
    }
  }

  let ingested = 0;
  if (allRows.length) {
    // ignoreDuplicates : ré-ingestion ne duplique pas et ne mute jamais un snapshot figé.
    const { error } = await supabase.from("order_margins").upsert(allRows, { onConflict: "shop_domain,order_id,line_item_id", ignoreDuplicates: true });
    if (error) {
      await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: "failed", last_backfill_at: now }, { onConflict: "shop_domain" });
      return { success: false, error: error.message };
    }
    ingested = allRows.length;
  }
  await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: "completed", window_start: windowStart, bulk_operation_id: bulkId, last_backfill_at: now }, { onConflict: "shop_domain" });
  return { success: true, ingested, orders: orders.length };
}
