// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Reprise bulk — fix du P0 d'audit « op COMPLETED jamais téléchargée ».
//  T1 : decideBulkResume (app/lib/bulkResume.js, PUR) — table complète de la Phase 0 :
//       RUNNING nôtre → poll (aucune création) ; COMPLETED nôtre non ingérée → ingest ;
//       COMPLETED déjà ingérée → create (jamais de double ingestion) ; FAILED/EXPIRED →
//       recréation propre ; op d'une AUTRE requête → jamais consommée ; statut INCONNU
//       (CANCELING, futurs) → busy (défaut sûr = inaction).
//  T2 : idempotence d'ingestion — même JSONL deux fois → clés (order_id, line_item_id)
//       identiques (le dédoublonnage Postgres repose dessus) + scan du source : l'upsert
//       porte onConflict shop_domain,order_id,line_item_id ET ignoreDuplicates:true
//       (contrat ON CONFLICT DO NOTHING = jamais de mutation d'un snapshot figé),
//       marqueurs de reconnaissance présents dans la requête bulk réelle, une SEULE création.
//  F2 : la sync vit dans app/lib/sync/ (bulk.server.js, ingest.server.js, queries.js) ;
//       orderSync.server.js n'est plus qu'un délégué. Le scan T2 suit les fichiers réels.
//  Pour lancer : node tests/lot22_bulk_resume.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { decideBulkResume, isOurSyncQuery, SYNC_QUERY_MARKERS } from "../app/lib/bulkResume.js";
import { parseBulkJsonl, buildOrderHistoryRows } from "../app/lib/orderIngest.js";
import { ordersBulkQuery } from "../app/lib/sync/queries.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

// Requête « nôtre » = la requête RÉELLE du générateur (porte les marqueurs, vérifié en T2).
const OUR_QUERY = ordersBulkQuery({ start: "2026-07-10T00:00:00.000Z", end: "2026-08-10T00:00:00.000Z" });
const LEGACY_QUERY = `{ orders(query: "created_at:>=2026-07-10T00:00:00.000Z") { edges { node { lineItems { edges { node { discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } } } } } } } } }`;
const OTHER_QUERY = `{ products { edges { node { id title } } } }`;
const OP_ID = "gid://shopify/BulkOperation/111";
const op = (status, extra = {}) => ({ id: OP_ID, status, query: OUR_QUERY, url: "https://x/y.jsonl", ...extra });

// ── T1 : isOurSyncQuery ──
console.log("\n── T1 : reconnaissance de notre requête ──");
{
  ok(isOurSyncQuery(OUR_QUERY) === true, "requête portant les deux marqueurs → nôtre");
  ok(isOurSyncQuery(OTHER_QUERY) === false, "requête d'une autre feature → pas la nôtre");
  ok(isOurSyncQuery(LEGACY_QUERY) === false, "ancienne requête 30 j (sans customerJourneySummary) → pas la nôtre : jamais consommée");
  ok(isOurSyncQuery(null) === false && isOurSyncQuery("") === false, "query null/vide → pas la nôtre (pas de crash)");
  ok(isOurSyncQuery(SYNC_QUERY_MARKERS[0]) === false, "UN seul marqueur ne suffit pas (les deux exigés)");
}

// ── T1 : machine à états — création ──
console.log("\n── T1 : aucune op → create ──");
{
  ok(decideBulkResume({ op: null }) === "create", "aucune op courante → create");
  ok(decideBulkResume({}) === "create", "argument vide → create (chemin actuel)");
  ok(decideBulkResume() === "create", "aucun argument → create (pas de crash)");
}

console.log("\n── T1 : RUNNING/CREATED → poll (nôtre) ou busy (autre), JAMAIS de création ──");
{
  ok(decideBulkResume({ op: op("RUNNING") }) === "poll", "RUNNING nôtre → poll (aucune création)");
  ok(decideBulkResume({ op: op("CREATED") }) === "poll", "CREATED nôtre → poll");
  ok(decideBulkResume({ op: op("RUNNING", { query: OTHER_QUERY }) }) === "busy", "RUNNING d'une autre requête → busy (message existant)");
}

console.log("\n── T1 : COMPLETED — reprise, jamais de double ingestion, jamais l'op d'un autre ──");
{
  ok(decideBulkResume({ op: op("COMPLETED"), state: null }) === "ingest", "COMPLETED nôtre, aucun état → ingest (défaut sûr : idempotent)");
  ok(decideBulkResume({ op: op("COMPLETED"), state: { bulk_operation_id: OP_ID, status: "running" } }) === "ingest",
    "COMPLETED nôtre, état 'running' (lancée mais jamais téléchargée) → ingest : LE cas P0");
  ok(decideBulkResume({ op: op("COMPLETED"), state: { bulk_operation_id: "gid://shopify/BulkOperation/999", status: "completed" } }) === "ingest",
    "COMPLETED nôtre, état d'une AUTRE op → ingest (celle-ci n'a pas été ingérée)");
  ok(decideBulkResume({ op: op("COMPLETED"), state: { bulk_operation_id: OP_ID, status: "completed" } }) === "create",
    "COMPLETED nôtre DÉJÀ ingérée (même id + status completed) → create, aucune double ingestion");
  ok(decideBulkResume({ op: op("COMPLETED", { query: OTHER_QUERY }), state: null }) === "create",
    "COMPLETED d'une AUTRE requête → jamais consommée → create");
}

console.log("\n── T1 : échecs → recréation propre ──");
{
  for (const st of ["FAILED", "CANCELED", "EXPIRED"]) {
    ok(decideBulkResume({ op: op(st) }) === "create", `${st} → create (recréation propre, comportement actuel)`);
  }
}

console.log("\n── T1 : statut inconnu → busy (défaut sûr = inaction) ──");
{
  ok(decideBulkResume({ op: op("CANCELING") }) === "busy", "CANCELING → busy (ni création ni download)");
  ok(decideBulkResume({ op: op("SOME_FUTURE_STATUS") }) === "busy", "statut futur inconnu → busy");
  ok(decideBulkResume({ op: { id: OP_ID, query: OUR_QUERY } }) === "busy", "op sans statut lisible → busy (l'inaction, jamais une création par-dessus)");
}

// ── T2 : idempotence — même JSONL deux fois → clés de dédoublonnage identiques ──
console.log("\n── T2 : idempotence d'ingestion (fixtures) ──");
{
  const jsonl = [
    JSON.stringify({ __typename: "Order", id: "gid://shopify/Order/1", createdAt: "2026-07-20T10:00:00Z", currencyCode: "EUR" }),
    JSON.stringify({ __typename: "LineItem", id: "gid://shopify/LineItem/11", __parentId: "gid://shopify/Order/1", quantity: 2, variant: { id: "gid://shopify/ProductVariant/v1" }, product: { id: "gid://shopify/Product/p1" }, originalUnitPriceSet: { shopMoney: { amount: "20.0" } }, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "18.0" } } }),
    JSON.stringify({ __typename: "LineItem", id: "gid://shopify/LineItem/12", __parentId: "gid://shopify/Order/1", quantity: 1, variant: { id: "gid://shopify/ProductVariant/v2" }, product: { id: "gid://shopify/Product/p2" }, originalUnitPriceSet: { shopMoney: { amount: "10.0" } }, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "10.0" } } }),
  ].join("\n");
  const costRow = { prix_achat: 5, port_entrant: 2, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Autre", source: "confirmed", customs_confirmed: true };
  const lookup = () => costRow;
  const settings = { shopTaxesIncluded: true, shopifyFee: 2, stripeFee: 1.5, processorFixedFee: 0.25 };

  const run = () => parseBulkJsonl(jsonl).flatMap((o) => { o.refunds ??= []; return buildOrderHistoryRows(o, lookup, settings); });
  const a = run(), b = run();
  const keys = (rows) => rows.map((r) => `${r.order_id}|${r.line_item_id}`).sort().join(";");
  ok(a.length === 2 && b.length === 2, "même JSONL → même nombre de lignes aux deux passes");
  ok(keys(a) === keys(b), "clés (order_id, line_item_id) IDENTIQUES aux deux passes → le dédoublonnage Postgres s'applique");
  ok(new Set(a.map((r) => `${r.order_id}|${r.line_item_id}`)).size === a.length, "aucune collision de clé au sein d'une passe");
  ok(a.every((r, i) => r.unit_net_margin === b[i].unit_net_margin), "marges identiques aux deux passes (déterminisme du moteur)");
}

// ── T2 : scan du source — le contrat d'idempotence et la reprise sont bien câblés ──
console.log("\n── T2 : contrat d'idempotence + câblage de la reprise (scan du source F2) ──");
{
  const strip = (s) => s.replace(/\/\/.*$/gm, "");
  const ingest = strip(readFileSync(new URL("../app/lib/sync/ingest.server.js", import.meta.url), "utf8"));
  const bulk = strip(readFileSync(new URL("../app/lib/sync/bulk.server.js", import.meta.url), "utf8"));
  const queries = readFileSync(new URL("../app/lib/sync/queries.js", import.meta.url), "utf8");
  const legacy = strip(readFileSync(new URL("../app/lib/orderSync.server.js", import.meta.url), "utf8"));
  ok(ingest.includes('.upsert(lineRows, { onConflict: "shop_domain,order_id,line_item_id", ignoreDuplicates: true })'),
    "upsert order_margins : onConflict (clé unique) + ignoreDuplicates:true → ON CONFLICT DO NOTHING (snapshots jamais mutés)");
  ok((bulk.match(/BULK_RUN_MUTATION/g) ?? []).length === 2 && (queries.match(/bulkOperationRunQuery\(/g) ?? []).length === 1,
    "une SEULE création d'op (un unique site d'appel de la mutation bulkOperationRunQuery)");
  ok(bulk.includes("decideBulkResume({ op, state: { bulk_operation_id: job.bulk_operation_id, status: job.status } })"),
    "la décision de reprise est appelée à l'ENTRÉE (op du job relue par son id), avant toute création");
  ok(bulk.includes("isOurSyncQuery(o.query)") && bulk.includes('return { op: ours, decision: "busy" }'),
    "une op de NOTRE sync déjà active → busy, jamais une création par-dessus (B3 : une à la fois)");
  ok(!bulk.includes("currentBulkOperation") && !ingest.includes("currentBulkOperation") && !queries.includes("currentBulkOperation"),
    "currentBulkOperation (déprécié) absent : bulkOperation(id:) et bulkOperations (API 2026-01, B2)");
  for (const m of SYNC_QUERY_MARKERS) {
    ok(queries.includes(m) && OUR_QUERY.includes(m), `marqueur « ${m.slice(0, 30)}… » présent dans la requête bulk réelle (la reconnaissance ne peut pas dériver en silence)`);
  }
  ok(legacy.includes("syncNow(") && legacy.includes("export async function syncShopOrders({ admin, supabase, shop })"),
    "orderSync.server.js : même signature legacy, délègue à syncNow (bouton = cron = recalcul)");
  // D2-3 : le bouton de synchronisation de l'écran classique a disparu ; les points d'entrée restants
  // (crons de synchronisation et de rentabilité) portent le maxDuration de 60 s.
  for (const [r, max] of [["api.cron.sync.jsx", 300], ["api.cron.profitability.jsx", 60]]) {
    const route = readFileSync(new URL(`../app/routes/${r}`, import.meta.url), "utf8");
    ok(route.includes(`export const config = { maxDuration: ${max} };`), `${r} : maxDuration ${max} exporté`);
  }
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 22 (reprise bulk) : ✓ Tous les tests passent"
  : ` BILAN LOT 22 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
