// OUTIL DE DÉMO (dev store) — bascule l'état d'UN SEUL produit à 'profitable' dans
// product_profitability_state, pour forcer une transition profitable→loss au run SUIVANT du cron
// profitability (donc un email d'alerte de perte). Cible en dur : true-cost-dev.myshopify.com + le
// "3p Fulfilled" (identifié par son coût 2750). Refuse d'écrire si la cible est ambiguë (jamais en masse).
// LECTURE SEULE par défaut ; écrit UNE ligne seulement avec --inject. Ne touche RIEN d'autre.
//
//   node --env-file=.env scripts/inject_profitable_state.mjs            → PREVIEW (cible + état actuel)
//   node --env-file=.env scripts/inject_profitable_state.mjs --inject   → last_state='profitable' (1 ligne)
import { createClient } from "@supabase/supabase-js";

const SHOP = "true-cost-dev.myshopify.com";   // dev store cible (en dur — outil de démo)
const TARGET_COST = 2750;                      // coût du "3p Fulfilled" → identifie sa variante de façon unique

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY manquants dans l'env."); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const doInject = process.argv.includes("--inject");

// 1. Variante du 3p Fulfilled = la SEULE au coût TARGET_COST dans variant_costs.
const { data: vc, error: e1 } = await supabase.from("variant_costs")
  .select("variant_id, prix_achat").eq("shop_domain", SHOP).eq("prix_achat", TARGET_COST);
if (e1) { console.error("❌ variant_costs:", e1.message); process.exit(2); }
if (!vc || vc.length !== 1) {
  console.error(`❌ Attendu 1 variante à prix_achat=${TARGET_COST}, trouvé ${vc?.length ?? 0}. Ambigu → j'arrête (jamais d'écriture en masse).`);
  process.exit(3);
}
const variantId = vc[0].variant_id;

// 2. product_id de cette variante via order_margins (doit être unique).
const { data: om, error: e2 } = await supabase.from("order_margins")
  .select("product_id").eq("shop_domain", SHOP).eq("variant_id", variantId);
if (e2) { console.error("❌ order_margins:", e2.message); process.exit(2); }
const pids = [...new Set((om ?? []).map(r => r.product_id).filter(Boolean))];
if (pids.length !== 1) {
  console.error(`❌ Attendu 1 product_id pour la variante, trouvé ${pids.length} → j'arrête. (Re-synchronise les commandes d'abord ?)`);
  process.exit(3);
}
const productId = pids[0];

// 3. État actuel dans product_profitability_state.
const { data: pps, error: e3 } = await supabase.from("product_profitability_state")
  .select("last_state, last_margin").eq("shop_domain", SHOP).eq("product_id", productId).maybeSingle();
if (e3) { console.error("❌ product_profitability_state:", e3.message); process.exit(2); }

console.log(`\n=== Cible (3p Fulfilled, coût ${TARGET_COST}) ===`);
console.log(`  shop_domain : ${SHOP}`);
console.log(`  variant_id  : ${variantId}`);
console.log(`  product_id  : ${productId}`);
console.log(`  état actuel : ${pps ? `${pps.last_state} (marge ${pps.last_margin})` : "AUCUNE ligne"}`);

if (!doInject) {
  console.log(`\nPour injecter 'profitable' (cette seule ligne) :`);
  console.log(`  node --env-file=.env scripts/inject_profitable_state.mjs --inject\n`);
  process.exit(0);
}
if (!pps) {
  console.error(`\n❌ Aucune ligne d'état pour ce produit → lance d'abord le curl de SEED (1er run du cron), puis réessaie.\n`);
  process.exit(4);
}
if (pps.last_state === "profitable") {
  console.log(`\nℹ️ Déjà 'profitable' — rien à faire (le prochain run ne verra pas de transition si l'état reste profitable).\n`);
  process.exit(0);
}

// 4. Écriture CIBLÉE : ce shop + ce product_id UNIQUEMENT, seul last_state modifié.
const { error: eU, count } = await supabase.from("product_profitability_state")
  .update({ last_state: "profitable" }, { count: "exact" })
  .eq("shop_domain", SHOP).eq("product_id", productId);
if (eU) { console.error("❌ update:", eU.message); process.exit(5); }
console.log(`\n✅ ${count ?? "?"} ligne mise à last_state='profitable' (${productId}).`);
console.log(`→ Relance le curl /api/cron/profitability : transition profitable→loss détectée → email d'alerte.\n`);
