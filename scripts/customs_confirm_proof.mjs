// OUTIL DE PREUVE E2E (dev store) — fiabilité perçue des taux de douane. RÉVERSIBLE, CIBLÉ.
// Appelle les VRAIES fonctions serveur de l'action (confirmCustomsCategory / applyCustomsInvalidation)
// + le recalcul existant — pas une réplique.
//
// Scénario 2 (Supabase seul, toujours exécutable) : confirmation → invalidation par un AUTRE chemin
//   (édition/import) → flag repassé à false → l'indicateur réapparaît. Catégorie identique → préservé.
// Scénario 1 (recalcul réel, token offline requis) : catégories DIVERGENTES → confirmation (fan-out +
//   flag) → rateChanged=true → recalcul → lignes estimated/missing recalculées au NOUVEAU taux + statut
//   figé confirmé ; lignes confirmed intactes ; product_profitability_state INCHANGÉ par la confirmation.
//
//   node --env-file=.env scripts/customs_confirm_proof.mjs               # scénario 2 (invalidation)
//   node --env-file=.env scripts/customs_confirm_proof.mjs --scenario1   # scénario 1 (confirm → recalcul)
//   node --env-file=.env scripts/customs_confirm_proof.mjs --restore     # restaure le pristine
import fs from "node:fs";
import { supabase } from "../app/supabase.server.js";
import { offlineAdmin, probeToken } from "./_offline_admin.mjs";
import { confirmCustomsCategory, applyCustomsInvalidation } from "../app/lib/customsClassification.server.js";
import { recalcEstimatedMargins } from "../app/lib/recalcEstimatedMargins.server.js";
import { customsRateForCategory } from "../app/lib/customsClassification.js";

const SHOP = process.argv.find((a) => a.endsWith(".myshopify.com")) ?? "true-cost-dev.myshopify.com";
const MODE = process.argv.includes("--scenario1") ? "s1" : process.argv.includes("--restore") ? "restore" : "s2";
const BACKUP = new URL("./.customs_proof_backup.json", import.meta.url);
let ok = 0, ko = 0;
const check = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); c ? ok++ : ko++; };
const inWindow = (ts, now) => ts != null && new Date(ts).getTime() >= now.getTime() - 30 * 86_400_000;

async function saveBackup(obj) { fs.writeFileSync(BACKUP, JSON.stringify(obj, null, 2)); }
async function restore() {
  if (!fs.existsSync(BACKUP)) { console.log("Aucun backup à restaurer."); process.exit(0); }
  const b = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
  for (const vc of b.variant_costs ?? []) await supabase.from("variant_costs").upsert([vc], { onConflict: "shop_domain,variant_id" });
  for (const om of b.order_margins ?? []) await supabase.from("order_margins").upsert([om], { onConflict: "shop_domain,order_id,line_item_id" });
  if (b.pps) await supabase.from("product_profitability_state").upsert([b.pps], { onConflict: "shop_domain,product_id" });
  // Lignes synthétiques (variante de test divergente) : elles n'existaient pas → à SUPPRIMER, pas restaurer.
  for (const vid of b.synthetic ?? []) await supabase.from("variant_costs").delete().eq("shop_domain", b.shop).eq("variant_id", vid);
  fs.rmSync(BACKUP);
  console.log(`✅ Pristine restauré pour ${b.shop}.`);
  process.exit(0);
}

// ── SCÉNARIO 2 — invalidation par un autre chemin (Supabase seul) ─────────────────────────────
async function scenario2() {
  // Cible : un produit avec ≥1 variant_costs. On sauvegarde toutes ses lignes.
  const { data: vc } = await supabase.from("variant_costs").select("*").eq("shop_domain", SHOP).limit(1000);
  const withProduct = (vc ?? []).filter((r) => r.product_id);
  if (!withProduct.length) { console.error("❌ Aucune variant_costs avec product_id sur ce shop."); process.exit(5); }
  const pid = withProduct[0].product_id;
  const rows = withProduct.filter((r) => r.product_id === pid);
  await saveBackup({ shop: SHOP, variant_costs: rows });
  console.log(`\n══ SCÉNARIO 2 — invalidation — produit ${pid} (${rows.length} variante(s)) ══`);

  // 1. Confirmation (vraie fonction serveur) → catégorie Sport + flag true partout.
  const c1 = await confirmCustomsCategory({ supabase, shop: SHOP, productId: pid, categorie: "Sport" });
  check(c1.success && c1.updated === rows.length, `confirmCustomsCategory → ${c1.updated} variante(s), flag true (fan-out un seul UPDATE)`);
  const { data: afterConfirm } = await supabase.from("variant_costs").select("variant_id,categorie,customs_confirmed").eq("shop_domain", SHOP).eq("product_id", pid);
  check(afterConfirm.every((r) => r.customs_confirmed === true && r.categorie === "Sport"), "toutes les variantes : categorie=Sport, customs_confirmed=true");

  // 2. Un AUTRE chemin (édition/import) réécrit une catégorie DIFFÉRENTE → invalidation.
  const upserts = afterConfirm.map((r) => ({ shop_domain: SHOP, variant_id: r.variant_id, product_id: pid, categorie: "Textile", source: "imported", updated_at: new Date().toISOString() }));
  await applyCustomsInvalidation(supabase, SHOP, upserts);
  check(upserts.every((u) => u.customs_confirmed === false), "applyCustomsInvalidation (catégorie changée) → flag calculé false AVANT écriture");
  await supabase.from("variant_costs").upsert(upserts, { onConflict: "shop_domain,variant_id" });
  const { data: afterEdit } = await supabase.from("variant_costs").select("customs_confirmed,categorie").eq("shop_domain", SHOP).eq("product_id", pid);
  check(afterEdit.every((r) => r.customs_confirmed === false), "en base : customs_confirmed repassé à false → l'indicateur réapparaît");

  // 3. Même catégorie réécrite → flag PRÉSERVÉ (on reconfirme d'abord).
  await confirmCustomsCategory({ supabase, shop: SHOP, productId: pid, categorie: "Textile" });
  const upserts2 = afterEdit.map((r, i) => ({ shop_domain: SHOP, variant_id: afterConfirm[i].variant_id, product_id: pid, categorie: "Textile", source: "confirmed", updated_at: new Date().toISOString() }));
  await applyCustomsInvalidation(supabase, SHOP, upserts2);
  check(upserts2.every((u) => u.customs_confirmed === true), "réécrire la MÊME catégorie (Textile) → flag préservé (true)");

  console.log(`\n${ko === 0 ? "✅ SCÉNARIO 2 OK" : `❌ ${ko} échec(s)`} — restauration…`);
  await restore();
}

// ── SCÉNARIO 1 — confirmation change le taux → recalcul (token requis) ─────────────────────────
async function scenario1() {
  let admin;
  try { ({ admin } = await offlineAdmin(SHOP)); } catch (e) { console.error(`❌ ${e?.message}`); process.exit(4); }
  if (!(await probeToken(admin)).ok) { console.error("❌ Token offline invalide — ouvre l'app pour le rafraîchir, puis relance --scenario1. Aucune écriture."); process.exit(4); }

  const now = new Date();
  const { data: rows } = await supabase.from("order_margins").select("*").eq("shop_domain", SHOP).order("order_created_at", { ascending: false }).limit(5000);
  const target = (rows ?? []).find((r) => r.variant_id && r.product_id && inWindow(r.order_created_at, now));
  if (!target) { console.error("❌ Aucune ligne order_margins dans la fenêtre."); process.exit(5); }
  const pid = target.product_id, vid = target.variant_id;
  const synthVid = vid + "__customs_divtest";
  const { data: vcRows } = await supabase.from("variant_costs").select("*").eq("shop_domain", SHOP).eq("product_id", pid);
  await saveBackup({ shop: SHOP, order_margins: (rows ?? []).filter((r) => r.product_id === pid), variant_costs: vcRows ?? [], synthetic: [synthVid] });
  console.log(`\n══ SCÉNARIO 1 — confirm → recalcul — produit ${pid} ══`);

  // Setup : la ligne cible devient ESTIMÉE au snapshot catégorie Textile (12 %) ; variant_costs Textile/estimated/non confirmé.
  const snap = { ...(target.cost_snapshot_json ?? {}), categorie: "Textile", source: "estimated", customs_confirmed: false };
  await supabase.from("order_margins").update({ cost_source: "estimated", cost_snapshot_json: snap })
    .eq("shop_domain", SHOP).eq("order_id", target.order_id).eq("line_item_id", target.line_item_id);
  await supabase.from("variant_costs").upsert([{ shop_domain: SHOP, variant_id: vid, product_id: pid, categorie: "Textile", source: "estimated", customs_confirmed: false, updated_at: now.toISOString() }], { onConflict: "shop_domain,variant_id" });
  // Variante synthétique DIVERGENTE (Électronique) sur le MÊME produit → catégories divergentes.
  await supabase.from("variant_costs").upsert([{ shop_domain: SHOP, variant_id: synthVid, product_id: pid, categorie: "Électronique", source: "estimated", customs_confirmed: false, updated_at: now.toISOString() }], { onConflict: "shop_domain,variant_id" });
  const { data: divCats } = await supabase.from("variant_costs").select("categorie").eq("shop_domain", SHOP).eq("product_id", pid);
  check(new Set((divCats ?? []).map((r) => r.categorie)).size >= 2, `état initial DIVERGENT : ${[...new Set((divCats ?? []).map((r) => r.categorie))].join(", ")}`);
  // Lignes CONFIRMED sœurs du produit (hors cible) : doivent rester INTACTES au centime après recalcul.
  const confirmedBefore = (rows ?? []).filter((r) => r.product_id === pid && r.cost_source === "confirmed"
    && !(r.order_id === target.order_id && r.line_item_id === target.line_item_id));
  const { data: ppsBefore } = await supabase.from("product_profitability_state").select("last_state").eq("shop_domain", SHOP).eq("product_id", pid).maybeSingle();

  // Confirmation → Sport (5 %). Fan-out : TOUTES les variantes → Sport + flag true. rateChanged attendu.
  const conf = await confirmCustomsCategory({ supabase, shop: SHOP, productId: pid, categorie: "Sport" });
  check(conf.success && conf.rateChanged === true, `confirmation Sport → rateChanged=true (Textile 12 %→Sport 5 %)`);
  const { data: aligned } = await supabase.from("variant_costs").select("categorie,customs_confirmed").eq("shop_domain", SHOP).eq("product_id", pid);
  check(aligned.every((r) => r.categorie === "Sport" && r.customs_confirmed === true), `divergent → toutes alignées sur Sport + flag true (${aligned.length} variantes, un seul UPDATE)`);
  const { data: ppsAfterConfirm } = await supabase.from("product_profitability_state").select("last_state").eq("shop_domain", SHOP).eq("product_id", pid).maybeSingle();
  check((ppsBefore?.last_state ?? null) === (ppsAfterConfirm?.last_state ?? null), "product_profitability_state INCHANGÉ par la confirmation (aucune écriture d'alerting)");

  // Recalcul existant (re-sync + re-baseline muet).
  console.log("  … recalcEstimatedMargins …");
  const res = await recalcEstimatedMargins({ admin, supabase, shop: SHOP });
  check(res.success, `recalcul réussi (lignesRecalculees=${res.lignesRecalculees})`);

  // Vérifs sur la ligne recalculée : nouveau taux + statut figé confirmé.
  const { data: after } = await supabase.from("order_margins").select("cost_source,margin_breakdown_json,cost_snapshot_json").eq("shop_domain", SHOP).eq("order_id", target.order_id).eq("line_item_id", target.line_item_id).maybeSingle();
  if (after) {
    const rate = after.margin_breakdown_json?.customsRate;
    check(Math.abs(Number(rate) - customsRateForCategory("Sport")) < 1e-9, `ligne recalculée : customsRate figé = ${rate} (Sport 5 %)`);
    check(after.cost_snapshot_json?.customs_confirmed === true, "ligne recalculée : statut de classification FIGÉ = confirmé");
  } else check(false, "ligne recalculée introuvable");

  // Intégrité des lignes CONFIRMED : recalcul ne les touche jamais (jamais les marges confirmées).
  const { data: confAfter } = await supabase.from("order_margins").select("order_id,line_item_id,line_net_margin,cost_source")
    .eq("shop_domain", SHOP).eq("product_id", pid).eq("cost_source", "confirmed");
  const afterMap = new Map((confAfter ?? []).map((r) => [`${r.order_id}|${r.line_item_id}`, Number(r.line_net_margin)]));
  const intact = confirmedBefore.every((r) => Math.abs((afterMap.get(`${r.order_id}|${r.line_item_id}`) ?? NaN) - Number(r.line_net_margin)) < 0.005);
  check(confirmedBefore.length > 0 && intact, `${confirmedBefore.length} ligne(s) confirmed INTACTES au centime (recalcul ne touche jamais les marges confirmées)`);

  console.log(`\n${ko === 0 ? "✅ SCÉNARIO 1 OK" : `❌ ${ko} échec(s)`} — restauration…`);
  await restore();
}

if (MODE === "restore") await restore();
else if (MODE === "s1") await scenario1();
else await scenario2();
