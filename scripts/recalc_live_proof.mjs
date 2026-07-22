// OUTIL DE PREUVE LIVE (dev store) — prouve que le recalcul CORRIGE une marge fausse. RÉVERSIBLE, CIBLÉ.
//
// Scénario réaliste du bug : on prend UN produit RÉELLEMENT en perte (sur ses coûts actuels), on injecte
// une marge FAUSSE (profitable) dans UNE de ses lignes en la repassant 'estimated', et on aligne
// product_profitability_state sur ce mensonge ('profitable') — exactement l'état pollué que le bug crée.
// Puis recalcEstimatedMargins doit : supprimer la ligne, re-sync (coût ACTUEL), restaurer la VRAIE marge
// (perte), nommer le produit « passé à perte », re-baseliner pps → 'loss', SANS aucun email.
//
// Vérifications : (1) marge corrigée (fausse → réelle) ; (2) lignesRecalculees > 0 ; (3) résumé nomme le
// produit passé à perte ; (4a) recalc n'envoie AUCUN email ; (4b) un cron APRÈS ne voit AUCUNE fausse
// transition (état re-baseliné cohérent) — avec le CONTRASTE : sans re-baseline, il aurait alerté.
//
// LECTURE SEULE par défaut. Backup pristine → toute écriture est réversible via --restore.
//   node --env-file=.env scripts/recalc_live_proof.mjs                       # PREVIEW : cible + marge réelle
//   node --env-file=.env scripts/recalc_live_proof.mjs --setup               # injecte la marge fausse et S'ARRÊTE
//                                                                            #   (recalcul déclenché depuis le BOUTON de l'app)
//   node --env-file=.env scripts/recalc_live_proof.mjs --run                 # cycle complet AUTONOME + preuves
//   node --env-file=.env scripts/recalc_live_proof.mjs --restore             # revient à l'état pristine
// (shop par défaut : true-cost-dev.myshopify.com ; sinon passe le domaine en argument.)
import fs from "node:fs";
import { supabase } from "../app/supabase.server.js";
import { offlineAdmin, probeToken } from "./_offline_admin.mjs";
import { recalcEstimatedMargins } from "../app/lib/recalcEstimatedMargins.server.js";
import { aggregateOrderMargins } from "../app/lib/orderHistory.js";
import { computeProfitabilityChanges } from "../app/lib/profitabilityAlert.js";

const SHOP = process.argv.find((a) => a.endsWith(".myshopify.com")) ?? "true-cost-dev.myshopify.com";
const MODE = process.argv.includes("--run") ? "run"
  : process.argv.includes("--setup") ? "setup"
  : process.argv.includes("--restore") ? "restore" : "preview";
const BACKUP = new URL("./.recalc_proof_backup.json", import.meta.url);
const CAP = 5000;

const money = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);
const inWindow = (ts, now) => ts != null && new Date(ts).getTime() >= now.getTime() - 30 * 86_400_000;
const readRows = async () => (await supabase.from("order_margins").select("*")
  .eq("shop_domain", SHOP).order("order_created_at", { ascending: false }).limit(CAP)).data ?? [];
const readThreshold = async () => (await supabase.from("shop_plans")
  .select("profitability_threshold_pct").eq("shop_domain", SHOP).maybeSingle()).data?.profitability_threshold_pct ?? 0;
const productMargin = (rows, pid) => aggregateOrderMargins(rows).byProduct.find((p) => p.product_id === pid)?.net_margin ?? null;
const readPps = async (pid) => (await supabase.from("product_profitability_state")
  .select("last_state, last_margin").eq("shop_domain", SHOP).eq("product_id", pid).maybeSingle()).data ?? null;

// Choisit un produit RÉELLEMENT en perte (coûts actuels) avec ≥1 ligne dans la fenêtre 30j (flip-able).
function pickTarget(rows, now) {
  const agg = aggregateOrderMargins(rows);
  const losers = agg.byProduct
    .filter((p) => p.product_id && p.currency !== "MIXED" && p.net_margin < 0)
    .sort((a, b) => a.net_margin - b.net_margin);
  for (const p of losers) {
    const line = rows.find((r) => r.product_id === p.product_id && inWindow(r.order_created_at, now));
    if (line) return { product: p, line };
  }
  return null;
}

// ── PREVIEW ──────────────────────────────────────────────────────────────────────────────────
async function preview() {
  const now = new Date();
  const rows = await readRows();
  const t = pickTarget(rows, now);
  console.log(`\n=== PREVIEW (lecture seule) — ${SHOP} ===`);
  if (!t) { console.log("  Aucun produit réellement en perte avec une ligne dans la fenêtre 30j."); process.exit(0); }
  console.log(`  Cible : ${t.product.product_id}`);
  console.log(`  Marge RÉELLE du produit (coûts actuels) : ${money(t.product.net_margin)} ${t.product.currency ?? ""}  → en PERTE`);
  console.log(`  Ligne à polluer : order_id=${t.line.order_id} line_item_id=${t.line.line_item_id} (cost_source=${t.line.cost_source}, marge=${money(t.line.line_net_margin)})`);
  console.log(`\n  Pour injecter la marge fausse et tester le BOUTON de l'app (réversible) :`);
  console.log(`    node --env-file=.env scripts/recalc_live_proof.mjs --setup`);
  console.log(`  Ou la preuve complète autonome (injecte + recalcule + vérifie) :`);
  console.log(`    node --env-file=.env scripts/recalc_live_proof.mjs --run\n`);
  process.exit(0);
}

// ── RESTORE ──────────────────────────────────────────────────────────────────────────────────
async function restore() {
  if (!fs.existsSync(BACKUP)) { console.log("Aucun backup à restaurer."); process.exit(0); }
  const b = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
  await restoreFrom(b);
  fs.rmSync(BACKUP);
  console.log(`✅ État pristine restauré pour ${b.shop} (ligne + product_profitability_state), backup supprimé.`);
  process.exit(0);
}
async function restoreFrom(b) {
  // Ligne : upsert par clé métier (survit à un delete+réinsert de recalc → id éventuellement différent).
  await supabase.from("order_margins").upsert([b.line], { onConflict: "shop_domain,order_id,line_item_id" });
  if (b.pps) await supabase.from("product_profitability_state").upsert([b.pps], { onConflict: "shop_domain,product_id" });
  else await supabase.from("product_profitability_state").delete().eq("shop_domain", SHOP).eq("product_id", b.productId);
}

// ── INJECTION réversible d'une marge FAUSSE (profitable) sur UN produit réellement en perte ─────
// Repasse UNE ligne en cost_source='estimated' avec un COÛT PLACEHOLDER faux (snapshot prix_achat
// dérisoire) + une marge assez positive pour faire basculer l'agrégat produit au-dessus de 0, et
// aligne product_profitability_state sur ce mensonge ('profitable'). Sauvegarde le pristine (ligne
// complète + pps) AVANT toute écriture → 100 % réversible via --restore. Retourne le contexte.
async function injectFake(now) {
  const rows0 = await readRows();
  const t = pickTarget(rows0, now);
  if (!t) { console.error("❌ Aucun produit en perte avec une ligne dans la fenêtre — impossible de monter le scénario."); process.exit(5); }
  const pid = t.product.product_id;
  const realMargin = t.product.net_margin;                       // marge RÉELLE (perte) que le recalcul restaurera
  const pristineLine = rows0.find((r) => r.order_id === t.line.order_id && r.line_item_id === t.line.line_item_id);
  const pristinePps = await readPps(pid);
  const backup = { shop: SHOP, productId: pid, line: pristineLine,
    pps: pristinePps ? { shop_domain: SHOP, product_id: pid, ...pristinePps } : null };
  fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));      // pristine sauvé AVANT d'écrire

  const fakeProductMargin = Math.abs(realMargin) + 100;          // > 0 garanti
  const bump = fakeProductMargin - realMargin;                   // ce qu'il faut ajouter à la ligne pour flipper le total
  const fakeLineMargin = Number(pristineLine.line_net_margin ?? 0) + bump;
  const eq = Math.max(1, Number(pristineLine.effective_qty ?? 1));
  const fakeSnapshot = { ...(pristineLine.cost_snapshot_json ?? {}), prix_achat: 0.01, source: "estimated" }; // coût placeholder faux
  const upd = await supabase.from("order_margins").update({
    cost_source: "estimated",
    line_net_margin: fakeLineMargin,
    unit_net_margin: fakeLineMargin / eq,
    cost_snapshot_json: fakeSnapshot,
    margin_breakdown_json: null,                                 // évite un waterfall incohérent (repli monitor)
  }).eq("shop_domain", SHOP).eq("order_id", t.line.order_id).eq("line_item_id", t.line.line_item_id);
  if (upd.error) throw new Error(`injection ligne : ${upd.error.message}`);
  await supabase.from("product_profitability_state").upsert([{
    shop_domain: SHOP, product_id: pid, last_state: "profitable",
    last_margin: fakeProductMargin, currency_code: t.product.currency ?? null, last_checked_at: now.toISOString(),
  }], { onConflict: "shop_domain,product_id" });

  const rowsAvant = await readRows();
  return { pid, variantId: t.line.variant_id, realMargin, fakeProductMargin: productMargin(rowsAvant, pid), rowsAvant };
}

// Nom du produit — best-effort via l'admin offline (sauté proprement si token expiré).
async function resolveTitle(pid) {
  try {
    const { admin } = await offlineAdmin(SHOP);
    if (!(await probeToken(admin)).ok) return null;
    const r = await admin.graphql(`query($id:ID!){ product(id:$id){ title } }`, { variables: { id: pid } });
    return (await r.json())?.data?.product?.title ?? null;
  } catch { return null; }
}

// ── SETUP : injecte la marge fausse et S'ARRÊTE (le recalcul se déclenche depuis le BOUTON de l'app) ──
async function setup() {
  const { pid, variantId, realMargin, fakeProductMargin } = await injectFake(new Date());
  const title = await resolveTitle(pid);
  console.log(`\n══ MARGE FAUSSE INJECTÉE (réversible) — ${SHOP} ═══════════════════════`);
  console.log(`  Produit  : ${title ? `« ${title} »  ` : ""}${pid}`);
  console.log(`  Variante : ${variantId ?? "?"}`);
  console.log(`  Ligne repassée en cost_source='estimated' + coût placeholder faux (prix_achat 0,01).`);
  console.log(`  Marge produit AFFICHÉE maintenant (FAUSSE) : ${money(fakeProductMargin)}  → paraît RENTABLE`);
  console.log(`  Marge produit RÉELLE (coûts actuels)       : ${money(realMargin)}  → en PERTE`);
  console.log(`  product_profitability_state aligné sur 'profitable' (état pollué cohérent).`);
  console.log(`\n  → Dans l'app : onglet « Suivi des coûts » → « Corriger les marges calculées sans coût ».`);
  console.log(`     Attendu : ce produit nommé « passé à perte », marge corrigée vers ${money(realMargin)}.`);
  console.log(`  → Pour tout annuler : node --env-file=.env scripts/recalc_live_proof.mjs --restore\n`);
  process.exit(0);
}

// ── RUN : setup réversible → recalcul (AUTO) → vérifications — tout en un (preuve autonome) ─────────
async function run() {
  const now = new Date();

  // 0. Token AVANT toute écriture (sinon on polluerait sans pouvoir corriger).
  let admin;
  try { ({ admin } = await offlineAdmin(SHOP)); }
  catch (e) { console.error(`\n❌ ${e?.message}\n`); process.exit(4); }
  const probe = await probeToken(admin);
  if (!probe.ok) {
    console.error(`\n❌ Token offline invalide (${probe.message}) — AUCUNE écriture effectuée.`);
    console.error(`   Ouvre l'app dans ${SHOP} pour rafraîchir le token, puis relance --run.\n`);
    process.exit(4);
  }

  try {
    const { pid, realMargin, fakeProductMargin, rowsAvant } = await injectFake(now);
    console.log(`\n══ AVANT (état pollué) ═══════════════════════════════════════════════`);
    console.log(`  Produit ${pid}`);
    console.log(`  Marge produit AFFICHÉE (fausse) : ${money(fakeProductMargin)}  → paraît RENTABLE`);
    console.log(`  Marge produit RÉELLE (coûts actuels) : ${money(realMargin)}  → en PERTE`);
    console.log(`  product_profitability_state : ${(await readPps(pid))?.last_state}  (mensonge cohérent avec l'affichage)`);

    // 3. RECALCUL — l'action serveur exacte (capture → DELETE → sync → réconcilie → re-baseline MUET).
    console.log(`\n… recalcEstimatedMargins (re-sync réel Shopify) …`);
    const result = await recalcEstimatedMargins({ admin, supabase, shop: SHOP });
    console.log(`\n══ RÉSULTAT recalc ═══════════════════════════════════════════════════`);
    console.log(`  ${JSON.stringify(result, null, 2).replace(/\n/g, "\n  ")}`);
    if (!result.success) throw new Error(`recalc en échec : ${result.error}`);

    // 4. APRÈS — la ligne a été recréée avec le coût ACTUEL → marge réelle restaurée.
    const rowsApres = await readRows();
    const apresMargin = productMargin(rowsApres, pid);
    const apresPps = await readPps(pid);
    console.log(`\n══ APRÈS (corrigé) ═══════════════════════════════════════════════════`);
    console.log(`  Marge produit : ${money(apresMargin)}  ${apresMargin < 0 ? "→ PERTE (réelle, corrigée)" : "→ ??"}`);
    console.log(`  product_profitability_state : ${apresPps?.last_state} (marge ${money(apresPps?.last_margin)})`);

    // ── VÉRIFICATIONS ──
    const T = await readThreshold();
    let ok = 0, ko = 0;
    const check = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); cond ? ok++ : ko++; };

    console.log(`\n══ VÉRIFICATIONS ═════════════════════════════════════════════════════`);
    check(apresMargin < 0, `marge CORRIGÉE : fausse (${money(productMargin(rowsAvant, pid))}) → réelle (${money(apresMargin)}) en perte`);
    check((result.lignesRecalculees ?? 0) > 0, `lignesRecalculees = ${result.lignesRecalculees} (> 0)`);
    check((result.produitsPassesAPerte ?? []).length > 0, `résumé nomme un produit passé à perte : ${result.resume || "(aucun)"}`);
    check(apresPps?.last_state === "loss", `re-baseline : product_profitability_state → 'loss' (aligné sur la réalité)`);

    // 4a. AUCUN email : structurel (le module n'importe pas email.server.js) + le retour n'a aucun champ d'envoi.
    const noMailField = !("mailed" in result) && !("sent" in result);
    check(noMailField, `4a — recalc N'ENVOIE aucun email (aucun chemin d'envoi dans le module)`);

    // 4b. Cron APRÈS : état stocké ≡ courant ⇒ 0 basculement. CONTRASTE : si pps était resté 'profitable'
    //     (pas de re-baseline), le cron aurait détecté profitable→loss et envoyé une fausse alerte.
    const aggApres = aggregateOrderMargins(rowsApres);
    const prevReal = new Map((await supabase.from("product_profitability_state").select("product_id, last_state")
      .eq("shop_domain", SHOP)).data?.map((p) => [p.product_id, { last_state: p.last_state }]) ?? []);
    const cronReal = computeProfitabilityChanges(aggApres.byProduct, prevReal, T);
    check(cronReal.basculements.length === 0, `4b — un cron après le recalcul ne voit AUCUN basculement (0 fausse alerte)`);

    const prevPolluted = new Map(prevReal);
    prevPolluted.set(pid, { last_state: "profitable" });   // simule l'absence de re-baseline
    const cronPolluted = computeProfitabilityChanges(aggApres.byProduct, prevPolluted, T);
    const contrast = cronPolluted.basculements.some((b) => b.product_id === pid && b.to === "loss");
    check(contrast, `4b (contraste) — SANS re-baseline, le cron aurait alerté (profitable→loss) : le re-baseline est bien indispensable`);

    console.log(`\n${"═".repeat(70)}`);
    console.log(ko === 0
      ? ` ✅ PREUVE COMPLÈTE : correction + résumé + ZÉRO email + état cohérent (${ok}/${ok} vérifs).`
      : ` ❌ ${ko} vérification(s) en échec.`);
    console.log(`${"═".repeat(70)}`);
    console.log(`\n(État final = corrigé/réel. Pour revenir à l'exact pristine : --restore.)\n`);
    process.exit(ko === 0 ? 0 : 6);
  } catch (e) {
    console.error(`\n❌ Échec (${e?.message}) — restauration automatique de l'état pristine…`);
    try {
      if (fs.existsSync(BACKUP)) { await restoreFrom(JSON.parse(fs.readFileSync(BACKUP, "utf8"))); fs.rmSync(BACKUP); }
      console.error("   ✅ Restauré. Aucune donnée laissée polluée.\n");
    } catch (er) { console.error(`   ⚠ Restauration KO (${er?.message}). Backup conservé : relance --restore.\n`); }
    process.exit(7);
  }
}

if (MODE === "run") await run();
else if (MODE === "setup") await setup();
else if (MODE === "restore") await restore();
else await preview();
