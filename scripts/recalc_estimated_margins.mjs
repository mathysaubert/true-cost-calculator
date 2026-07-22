// OUTIL DE TEST I/O (dev store) — prouve le CYCLE COMPLET du recalcul des marges (Brique 2)
// SANS envoyer d'email. Appelle la MÊME fonction serveur que l'action recalc_estimated_margins
// (app/lib/recalcEstimatedMargins.server.js) : capture → DELETE → sync → réconcilie-restaure →
// re-baseline MUET → résumé « passé à perte ».
//
// LECTURE SEULE par défaut. Exécute réellement (DELETE + re-sync Shopify) UNIQUEMENT avec --run <shop>.
//
//   node --env-file=.env scripts/recalc_estimated_margins.mjs
//     → PREVIEW : par boutique, combien de lignes SERAIENT recalculées (recalculables ∈ fenêtre 30j).
//
//   node --env-file=.env scripts/recalc_estimated_margins.mjs --run <shop_domain>
//     → EXÉCUTE le cycle sur CE shop, puis PROUVE qu'aucun email ne partira :
//       relit l'état stocké et vérifie que le prochain cron ne détecte AUCUN basculement.
//
// ⚠ Le sync a besoin d'un token offline VALIDE (Admin API). S'il a expiré (~quotidien), ouvre
//   d'abord l'app dans le dev store pour le rafraîchir, puis relance (sinon HTTP 401).
import { supabase } from "../app/supabase.server.js";
import { offlineAdmin, probeToken } from "./_offline_admin.mjs";
import { recalcEstimatedMargins } from "../app/lib/recalcEstimatedMargins.server.js";
import { aggregateOrderMargins } from "../app/lib/orderHistory.js";
import { computeProfitabilityChanges } from "../app/lib/profitabilityAlert.js";
import { isDeletableLine, touchedProductIds } from "../app/lib/recalcMargins.js";

const ORDER_MARGINS_CAP = 5000;
const readMargins = (shop) => supabase.from("order_margins").select("*")
  .eq("shop_domain", shop).order("order_created_at", { ascending: false }).limit(ORDER_MARGINS_CAP);

const args = process.argv.slice(2);
const ri = args.indexOf("--run");
const target = ri >= 0 ? args[ri + 1] : null;

// ── PREVIEW (lecture seule) : ce qui SERAIT recalculé, par boutique ──────────────────────────
async function preview() {
  const { data, error } = await supabase.from("order_margins").select("shop_domain").limit(ORDER_MARGINS_CAP);
  if (error) { console.error("❌ list order_margins:", error.message); process.exit(2); }
  const shops = [...new Set((data ?? []).map((r) => r.shop_domain))];
  console.log("\n=== PREVIEW (lecture seule) — lignes recalculables dans la fenêtre 30j ===");
  if (!shops.length) console.log("  (aucune ligne order_margins)");
  const now = new Date();
  for (const shop of shops) {
    const { data: rows } = await readMargins(shop);
    const deletable = (rows ?? []).filter((r) => isDeletableLine(r, now, { windowDays: 30 }));
    const touched = touchedProductIds(deletable);
    const byCost = deletable.reduce((m, r) => ((m[r.cost_source] = (m[r.cost_source] ?? 0) + 1), m), {});
    console.log(`  ${shop.padEnd(42)} recalculables=${String(deletable.length).padStart(5)}  (estimated=${byCost.estimated ?? 0}, missing=${byCost.missing ?? 0})  produits=${touched.size}`);
  }
  console.log("\nPour exécuter le cycle complet sur UNE boutique (DELETE + re-sync réels) :");
  console.log("  node --env-file=.env scripts/recalc_estimated_margins.mjs --run <shop_domain>\n");
  process.exit(0);
}

// ── Instantané d'état (pour comparer avant/après) ─────────────────────────────────────────────
async function snapshot(shop, label) {
  const { data: rows } = await readMargins(shop);
  const bySrc = (rows ?? []).reduce((m, r) => ((m[r.cost_source] = (m[r.cost_source] ?? 0) + 1), m), {});
  const { count: ppsCount } = await supabase.from("product_profitability_state")
    .select("shop_domain", { count: "exact", head: true }).eq("shop_domain", shop);
  console.log(`\n── ${label} ──`);
  console.log(`  order_margins : total=${rows?.length ?? 0}  (estimated=${bySrc.estimated ?? 0}, missing=${bySrc.missing ?? 0}, confirmed=${bySrc.confirmed ?? 0}, imported=${bySrc.imported ?? 0})`);
  console.log(`  product_profitability_state : ${ppsCount ?? 0} ligne(s)`);
  return rows ?? [];
}

// ── PREUVE « aucun email » : le prochain cron ne verra AUCUN basculement (état stocké ≡ courant) ──
async function proveNoEmail(shop) {
  const { data: rows } = await readMargins(shop);
  const agg = aggregateOrderMargins(rows ?? []);
  const { data: prevRows } = await supabase.from("product_profitability_state")
    .select("product_id, last_state").eq("shop_domain", shop);
  const prevMap = new Map((prevRows ?? []).map((p) => [p.product_id, { last_state: p.last_state }]));
  const { data: planRow } = await supabase.from("shop_plans")
    .select("profitability_threshold_pct").eq("shop_domain", shop).maybeSingle();
  const thresholdPct = planRow?.profitability_threshold_pct ?? 0;
  const { basculements, seeds, majNormales } = computeProfitabilityChanges(agg.byProduct, prevMap, thresholdPct);
  console.log("\n── PREUVE « aucun email » (simulation du prochain cron) ──");
  console.log(`  seuil=${thresholdPct}%  seeds=${seeds.length}  majNormales=${majNormales.length}  basculements=${basculements.length}`);
  if (basculements.length === 0) {
    console.log("  ✅ AUCUN basculement → le prochain cron n'enverrait AUCUN email. Piège n°5 neutralisé.");
    return true;
  }
  console.log(`  ❌ ${basculements.length} basculement(s) détecté(s) — l'état re-baseliné DIVERGE de l'agrégat courant :`);
  for (const b of basculements) console.log(`     ${b.product_id} : ${b.from} → ${b.to} (marge ${b.margin})`);
  return false;
}

// ── RUN : cycle complet sur une boutique précise ─────────────────────────────────────────────
async function run(shop) {
  if (typeof shop !== "string" || !shop.endsWith(".myshopify.com")) {
    console.error(`❌ shop_domain invalide/absent : « ${shop} ». Fournis le domaine EXACT (ex : xxx.myshopify.com).`);
    process.exit(3);
  }
  console.log(`\n⚙ RECALCUL DES MARGES — cycle complet pour : ${shop}`);
  await snapshot(shop, "AVANT");

  let admin;
  try { ({ admin } = await offlineAdmin(shop)); }
  catch (e) { console.error(`\n❌ Admin offline KO (${e?.message}). Ouvre l'app dans le dev store pour rafraîchir le token, puis relance.\n`); process.exit(4); }
  const probe = await probeToken(admin);
  if (!probe.ok) { console.error(`\n❌ Token offline invalide (${probe.message}). Ouvre l'app dans le dev store pour le rafraîchir, puis relance.\n`); process.exit(4); }

  console.log("\n… recalcEstimatedMargins (capture → DELETE → sync → réconcilie-restaure → re-baseline MUET) …");
  const result = await recalcEstimatedMargins({ admin, supabase, shop });
  console.log("\n── RÉSULTAT ──");
  console.log(`  ${JSON.stringify(result, null, 2).replace(/\n/g, "\n  ")}`);
  if (!result.success) { console.error("\n❌ Cycle en échec (lignes restaurées, aucune perte). Voir l'erreur ci-dessus.\n"); process.exit(5); }

  await snapshot(shop, "APRÈS");
  const noEmail = await proveNoEmail(shop);

  console.log("\n" + "═".repeat(70));
  console.log(noEmail
    ? " ✅ CYCLE COMPLET PROUVÉ : marges recalculées, état re-baseliné, ZÉRO email."
    : " ❌ CYCLE INCOMPLET : divergence d'état — le re-baseline n'est pas neutre.");
  console.log("═".repeat(70) + "\n");
  process.exit(noEmail ? 0 : 6);
}

if (target) await run(target);
else await preview();
