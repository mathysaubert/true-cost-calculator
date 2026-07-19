// OUTIL DE DÉMO (dev store) — purge ciblée pour forcer une ré-ingestion avec les coûts corrigés.
// LECTURE SEULE par défaut. Ne touche JAMAIS variant_costs / usage / shop_plans / sessions.
//
//   node --env-file=.env scripts/purge_order_margins.mjs
//     → PREVIEW : liste les shop_domain présents + comptes (aucune suppression).
//
//   node --env-file=.env scripts/purge_order_margins.mjs --delete <shop_domain>
//     → SUPPRIME order_margins ET product_profitability_state pour CE shop_domain EXACT.
//       (order_margins : lignes historiques figées ; product_profitability_state : sinon le cron
//        ne verra pas de re-transition → pas d'alerte de perte à la re-sync.)
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY manquants dans l'env."); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const args = process.argv.slice(2);
const di = args.indexOf("--delete");
const target = di >= 0 ? args[di + 1] : null;

const TABLES = ["order_margins", "product_profitability_state"];
const KEEP = "variant_costs, usage, shop_plans, sessions (INTACTS)";

// Comptage EXACT par (table, shop) — head:true → aucune ligne rapatriée, juste le count.
async function count(table, shop) {
  const { count, error } = await supabase.from(table).select("shop_domain", { count: "exact", head: true }).eq("shop_domain", shop);
  if (error) { console.error(`❌ count ${table}:`, error.message); process.exit(2); }
  return count ?? 0;
}
// Enumère les shop_domain distincts présents (petit volume dev store).
async function shops() {
  const set = new Set();
  for (const t of TABLES) {
    const { data, error } = await supabase.from(t).select("shop_domain").limit(5000);
    if (error) { console.error(`❌ list ${t}:`, error.message); process.exit(2); }
    for (const r of data ?? []) set.add(r.shop_domain);
  }
  return [...set];
}

if (!target) {
  const list = await shops();
  console.log("\n=== PREVIEW (lecture seule) — order_margins & product_profitability_state par boutique ===");
  if (list.length === 0) console.log("  (aucune ligne)");
  for (const s of list) {
    const om = await count("order_margins", s);
    const pps = await count("product_profitability_state", s);
    console.log(`  ${s.padEnd(42)} order_margins=${String(om).padStart(6)}   product_profitability_state=${String(pps).padStart(4)}`);
  }
  console.log(`\nGarde : ${KEEP}`);
  console.log("Pour supprimer une boutique PRÉCISE :");
  console.log("  node --env-file=.env scripts/purge_order_margins.mjs --delete <shop_domain>\n");
  process.exit(0);
}

// ── Mode suppression : cible EXACTE obligatoire (jamais de wildcard, jamais 'toutes les boutiques') ──
if (typeof target !== "string" || !target.endsWith(".myshopify.com")) {
  console.error(`❌ shop_domain invalide/absent : « ${target} ». Fournis le domaine EXACT (ex : xxx.myshopify.com).`);
  process.exit(3);
}
const omN = await count("order_margins", target);
const ppsN = await count("product_profitability_state", target);
console.log(`\n⚠ SUPPRESSION pour : ${target}`);
console.log(`  order_margins               : ${omN} → supprimées`);
console.log(`  product_profitability_state : ${ppsN} → supprimées`);
console.log(`  Garde : ${KEEP}`);
if (omN === 0 && ppsN === 0) { console.log("\nRien à supprimer pour cette boutique — vérifie le domaine (preview sans argument).\n"); process.exit(0); }

const d1 = await supabase.from("order_margins").delete({ count: "exact" }).eq("shop_domain", target);
if (d1.error) { console.error("❌ delete order_margins:", d1.error.message); process.exit(4); }
const d2 = await supabase.from("product_profitability_state").delete({ count: "exact" }).eq("shop_domain", target);
if (d2.error) { console.error("❌ delete product_profitability_state:", d2.error.message); process.exit(4); }
console.log(`\n✅ Supprimé : ${d1.count ?? "?"} order_margins, ${d2.count ?? "?"} product_profitability_state pour ${target}.`);
console.log("→ Clique « Synchroniser les commandes » : les lignes seront ré-ingérées avec tes coûts actuels.\n");
