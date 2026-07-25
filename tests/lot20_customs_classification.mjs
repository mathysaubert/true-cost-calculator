// ════════════════════════════════════════════════════════════════════════════════
//  Fiabilité perçue des taux de douane — DÉCISIONS PURES (statut de classification)
//  Verrouille : (1) statut estimé/confirmé (défaut estimé, jamais optimiste) ;
//  (2) changement de TAUX (pas de libellé : Jouets 0%→Livres 0% = pas de changement) ;
//  (3) indicateur (confirmée → null) ; (4) INVALIDATION par chemin d'écriture de la catégorie ;
//  (5) statut FIGÉ d'une ligne + règle du pire cas. [VERROU rehydrate (6) retiré ère XV, cf. bas de fichier.]
//  engine.js intouché (CUSTOMS_RATES importé en lecture seule). node tests/lot20_customs_classification.mjs
// ════════════════════════════════════════════════════════════════════════════════

import {
  customsRateForCategory, classificationStatus, customsRateChanged, customsIndicator,
  resolveCustomsConfirmedOnWrite, frozenClassificationStatus,
  resolveAuditCategory, mergeCustomsFeedback,
} from "../app/lib/customsClassification.js";
import { selectDeletableLines } from "../app/lib/recalcMargins.js";
import { renderLossAlertEmail, computeProfitabilityChanges } from "../app/lib/profitabilityAlert.js";
import { confirmCustomsCategory, applyCustomsInvalidation } from "../app/lib/customsClassification.server.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

// ── classificationStatus : défaut estimé, jamais optimiste ──
console.log("\n── classificationStatus : true ⇔ confirmée, tout le reste ⇒ estimée ──");
{
  ok(classificationStatus(true)  === "confirmed", "true → confirmée");
  ok(classificationStatus(false) === "estimated", "false → estimée");
  ok(classificationStatus(null)  === "estimated", "null (miss de jointure) → estimée");
  ok(classificationStatus(undefined) === "estimated", "undefined (legacy) → estimée");
  ok(classificationStatus(1) === "estimated", "valeur non-booléenne 1 → estimée (pas de coercition)");
}

// ── customsRateForCategory : table du moteur + repli 0,03 ──
console.log("\n── customsRateForCategory : taux TARIC + repli ──");
{
  ok(customsRateForCategory("Textile") === 0.12, "Textile → 12 %");
  ok(customsRateForCategory("Sport")   === 0.05, "Sport → 5 %");
  ok(customsRateForCategory("Jouets")  === 0,    "Jouets → 0 %");
  ok(customsRateForCategory("Inconnu") === 0.03, "catégorie inconnue → repli 3 %");
  ok(customsRateForCategory(undefined) === 0.03, "undefined → repli 3 %");
}

// ── customsRateChanged : compare les TAUX, pas les libellés ──
console.log("\n── customsRateChanged : basé sur le taux ──");
{
  ok(customsRateChanged("Textile", "Sport") === true,  "Textile 12 % → Sport 5 % : changement");
  ok(customsRateChanged("Sport", "Sport")   === false, "Sport → Sport : identique, pas de changement");
  ok(customsRateChanged("Jouets", "Livres") === false, "Jouets 0 % → Livres 0 % : MÊME taux → PAS de changement (pas de recalcul à tort)");
  ok(customsRateChanged("Textile", "Jouets") === true, "Textile 12 % → Jouets 0 % : changement");
}

// ── customsIndicator : confirmée → null (aucun changement d'affichage) ──
console.log("\n── customsIndicator : confirmée ⇒ null ──");
{
  ok(customsIndicator("confirmed") === null, "confirmée → null (aucun indicateur)");
  const ind = customsIndicator("estimated");
  ok(ind && ind.label === "Taux estimé, à confirmer", "estimée → libellé « à confirmer »");
  ok(ind && /TARIC/.test(ind.ref), "adossé à la nomenclature TARIC (pas de chapitre inventé)");
}

// ── resolveCustomsConfirmedOnWrite : INVALIDATION par chemin (cœur anti-pourrissement) ──
console.log("\n── resolveCustomsConfirmedOnWrite : catégorie changée ⇒ false, identique ⇒ préserve ──");
{
  ok(resolveCustomsConfirmedOnWrite("Textile", "Sport", true)  === false, "changée depuis un flag confirmé → false (le cas import CSV qui écrase)");
  ok(resolveCustomsConfirmedOnWrite("Textile", "Sport", false) === false, "changée depuis estimé → false");
  ok(resolveCustomsConfirmedOnWrite("Sport", "Sport", true)    === true,  "identique + confirmé → PRÉSERVE true (réécrire la même valeur n'invalide pas)");
  ok(resolveCustomsConfirmedOnWrite("Sport", "Sport", false)   === false, "identique + estimé → reste estimé");
  ok(resolveCustomsConfirmedOnWrite("Sport", "Sport", undefined) === false, "flag absent → estimé");
  // DURCISSEMENT : catégorie ABSENTE du payload (PostgREST ne l'écrase pas) → flag PRÉSERVÉ.
  ok(resolveCustomsConfirmedOnWrite("Sport", undefined, true)  === true,  "newCat undefined + confirmé → PRÉSERVE true (pas de dé-confirmation silencieuse)");
  ok(resolveCustomsConfirmedOnWrite("Sport", null, true)       === true,  "newCat null + confirmé → PRÉSERVE true");
  ok(resolveCustomsConfirmedOnWrite("Sport", undefined, false) === false, "newCat undefined + estimé → reste estimé");
}

// ── resolveAuditCategory : audit ADOPTE la catégorie confirmée (option b, périmètre serré) ──
console.log("\n── resolveAuditCategory : confirmé ⇒ catégorie adoptée + aucun indicateur ──");
{
  const conf = resolveAuditCategory({ categorie: "Sport", customs_confirmed: true }, "Textile");
  ok(conf.category === "Sport" && conf.estimated === false, "variante confirmée → ADOPTE 'Sport' (≠ mapping 'Textile'), aucun indicateur");
  const notConf = resolveAuditCategory({ categorie: "Sport", customs_confirmed: false }, "Textile");
  ok(notConf.category === "Textile" && notConf.estimated === true, "variante non confirmée → mapping 'Textile' + indicateur");
  const noRow = resolveAuditCategory(null, "Textile");
  ok(noRow.category === "Textile" && noRow.estimated === true, "variante SANS ligne (trou) → estimé (jamais d'optimisme)");
  const noRow2 = resolveAuditCategory(undefined, "Autre");
  ok(noRow2.estimated === true, "vc undefined → estimé");
  // Cohérence audit ≡ configuration : un produit confirmé montre la MÊME catégorie côté audit et côté saisie.
  const vc = { categorie: "Cosmétique", customs_confirmed: true };
  ok(resolveAuditCategory(vc, "Autre").category === vc.categorie, "produit confirmé : audit et tableau de coûts s'accordent sur la catégorie");
}

// ── Simulation des DEUX chemins d'écriture (costs_save & costs_import_csv) ──
console.log("\n── invalidation appliquée par chemin (costs_save / costs_import_csv) ──");
{
  // costs_save : le marchand édite la catégorie d'une ligne confirmée
  const saveChanged = resolveCustomsConfirmedOnWrite("Textile", "Sport", true);
  ok(saveChanged === false, "costs_save : catégorie éditée → classification repasse estimée");
  // costs_save : le marchand édite le prix mais pas la catégorie
  const saveSame = resolveCustomsConfirmedOnWrite("Textile", "Textile", true);
  ok(saveSame === true, "costs_save : catégorie inchangée → classification préservée");
  // costs_import_csv : le CSV réécrit la même catégorie
  const csvSame = resolveCustomsConfirmedOnWrite("Sport", "Sport", true);
  ok(csvSame === true, "costs_import_csv : même catégorie → préservée");
  // costs_import_csv : le CSV écrase par une autre catégorie
  const csvChanged = resolveCustomsConfirmedOnWrite("Sport", "Textile", true);
  ok(csvChanged === false, "costs_import_csv : catégorie écrasée → estimée");
}

// ── frozenClassificationStatus : statut FIGÉ d'une ligne de marge (snapshot) ──
console.log("\n── frozenClassificationStatus : lecture du champ figé ──");
{
  ok(frozenClassificationStatus({ customs_confirmed: true })  === "confirmed", "snapshot flag true → confirmée");
  ok(frozenClassificationStatus({ customs_confirmed: false }) === "estimated", "snapshot flag false → estimée");
  ok(frozenClassificationStatus({ categorie: "Sport" })      === "estimated", "champ absent (legacy) → estimée");
  ok(frozenClassificationStatus(null)                        === "estimated", "snapshot null (missing/legacy) → estimée");
}

// ── (obsolète — ère XV) VERROU rehydrate RETIRÉ, avec justification ──────────────────────────
// L'ancien verrou vérifiait que reconcileEstimatedCost préservait customs_confirmed lors de la
// réhydratation-écriture d'une ligne estimée dans costs_list. Ce chemin d'écriture N'EXISTE PLUS :
// costs_list est passé en LECTURE SEULE (« plus jamais de pré-rempli », intégrité ère XV), plus aucune
// réhydratation ne persiste. Le verrou n'a donc plus d'objet et est retiré (aucun assert affaibli : la
// behavior testée a été SUPPRIMÉE par conception). La protection de fond — une catégorie éditée invalide
// la classification — reste couverte par resolveCustomsConfirmedOnWrite via costs_save / costs_import_csv
// (sections « invalidation » ci-dessus, inchangées).

// ── COMPOSITION pure : correction de taux → le recalcul ne cible que estimated/missing ──
console.log("\n── composition : rateChanged ⇒ recalcul ne touche PAS les lignes confirmed ──");
{
  const now = new Date("2026-07-22T00:00:00Z");
  const iso = (d) => new Date(Date.UTC(2026, 6, 22) - d * 86_400_000).toISOString();
  const rows = [
    { order_id: "o1", line_item_id: "l1", cost_source: "estimated", order_created_at: iso(3) }, // recalculable
    { order_id: "o2", line_item_id: "l2", cost_source: "confirmed", order_created_at: iso(3) }, // IMMUABLE
    { order_id: "o3", line_item_id: "l3", cost_source: "missing",   order_created_at: iso(3) }, // recalculable
  ];
  ok(customsRateChanged("Textile", "Sport") === true, "prérequis : la correction change bien le taux");
  const del = selectDeletableLines(rows, now).map((r) => r.order_id);
  ok(del.join(",") === "o1,o3", "le recalcul ne supprimerait QUE o1 (estimated) + o3 (missing) — o2 confirmed intacte");
}

// ── Suffixe email « (taux de douane estimé) » — pire cas, douane dominante ──
console.log("\n── email : suffixe douane estimé (pire cas, parité texte/HTML) ──");
{
  const base = { product_id: "gid://p1", title: "Produit A", from: "profitable", to: "loss", margin: -50, currency: "EUR",
    topCost: { key: "douane", label: "la douane", amount: 30, achatPort: 10 } };
  const withEst = renderLossAlertEmail({ shop: "x.myshopify.com", basculements: [{ ...base, customsEstimated: true }] });
  ok(/taux de douane estimé/.test(withEst.text), "customsEstimated + douane dominante → suffixe présent (texte)");
  ok(/taux de douane estimé/.test(withEst.html), "… présent aussi en HTML (parité)");
  const noEst = renderLossAlertEmail({ shop: "x.myshopify.com", basculements: [{ ...base, customsEstimated: false }] });
  ok(!/taux de douane estimé/.test(noEst.text), "customsEstimated=false → aucun suffixe");
  const other = renderLossAlertEmail({ shop: "x.myshopify.com", basculements: [{ ...base, topCost: { key: "stripeCost", label: "les frais de paiement", amount: 30, achatPort: 10 }, customsEstimated: true }] });
  ok(!/taux de douane estimé/.test(other.text), "poste dominant ≠ douane → aucun suffixe (même si estimé)");
}

// ── Non-régression cron : customsEstimated N'ENTRE PAS dans la décision (fixture fixe) ──
console.log("\n── cron : décision de basculement inchangée par customsEstimated ──");
{
  const prevMap = new Map([["p1", { last_state: "profitable" }], ["p2", { last_state: "loss" }]]);
  const current = [
    { product_id: "p1", net_margin: -10, net_revenue: 100, marginPct: -10, currency: "EUR", customsEstimated: true },
    { product_id: "p2", net_margin: 5,   net_revenue: 100, marginPct: 5,   currency: "EUR", customsEstimated: true },
    { product_id: "p3", net_margin: -1,  net_revenue: 50,  marginPct: -2,  currency: "EUR", customsEstimated: false },
  ];
  const r1 = computeProfitabilityChanges(current, prevMap, 0);
  const currentNoFlag = current.map(({ customsEstimated, ...p }) => p); // retire le champ (rest sibling)
  const r2 = computeProfitabilityChanges(currentNoFlag, prevMap, 0);
  ok(JSON.stringify(r1.basculements) === JSON.stringify(r2.basculements), "basculements IDENTIQUES avec/sans customsEstimated (champ inerte)");
  ok(r1.basculements.map(b => `${b.product_id}:${b.from}->${b.to}`).join(",") === "p1:profitable->loss,p2:loss->profitable", "fixture golden : p1→loss, p2→profitable");
  ok(r1.seeds.length === 1 && r1.seeds[0].product_id === "p3", "p3 = seed (nouveau) — écriture d'état inchangée");
}

// ── confirmCustomsCategory : validation APRÈS extraction — ZÉRO écriture sur entrée invalide ──
console.log("\n── confirmCustomsCategory : validation + aucune écriture si invalide ──");
{
  // Proxy qui LÈVE dès qu'on touche la base → prouve qu'aucun appel supabase n'a lieu sur entrée invalide.
  const noDb = new Proxy({}, { get() { throw new Error("DB touchée — écriture interdite sur entrée invalide"); } });
  const r1 = await confirmCustomsCategory({ supabase: noDb, shop: "x", productId: "gid://p", categorie: "PasUneCategorie" });
  ok(r1.success === false && /Catégorie invalide/.test(r1.error), "catégorie hors CATEGORIE_KEYS → error explicite, ZÉRO écriture (DB non touchée)");
  const r2 = await confirmCustomsCategory({ supabase: noDb, shop: "x", productId: null, categorie: "Sport" });
  ok(r2.success === false && /Produit/.test(r2.error), "productId absent → error, ZÉRO écriture");
  const r3 = await confirmCustomsCategory({ supabase: noDb, shop: "x", productId: "gid://p", categorie: "" });
  ok(r3.success === false, "catégorie vide → error, ZÉRO écriture");
}

// ── applyCustomsInvalidation : lookup CHUNKÉ (gros CSV) + correct à cheval sur deux chunks ──
console.log("\n── applyCustomsInvalidation : chunk 100 + invalidation à cheval ──");
{
  const calls = [];
  const store = [
    { variant_id: "v0",   categorie: "Sport",   customs_confirmed: true },   // chunk 1
    { variant_id: "v149", categorie: "Sport",   customs_confirmed: true },   // chunk 2
  ];
  const chain = { select() { return chain; }, eq() { return chain; },
    in(_c, ids) { calls.push(ids.length); return Promise.resolve({ data: store.filter((r) => ids.includes(r.variant_id)) }); } };
  const mock = { from() { return chain; } };
  const upserts = Array.from({ length: 150 }, (_, i) => ({ variant_id: `v${i}`, categorie: i === 149 ? "Textile" : "Sport" }));
  await applyCustomsInvalidation(mock, "x", upserts);
  ok(calls.join(",") === "100,50", `lookup chunké : ${calls.join("+")} (pas un seul .in() de 150 GIDs)`);
  ok(upserts[0].customs_confirmed === true,  "v0 (chunk 1) catégorie identique → flag PRÉSERVÉ true");
  ok(upserts[149].customs_confirmed === false, "v149 (chunk 2) catégorie changée → flag false (invalidation correcte à cheval)");
  ok(upserts[5].customs_confirmed === false, "v5 (chunk 1) sans ligne stockée → estimé (false)");
}

// ── mergeCustomsFeedback : rateChanged COLLANT jusqu'à fermeture ──
console.log("\n── mergeCustomsFeedback : nudge rateChanged collant ──");
{
  const A = { success: true, rateChanged: true };
  const B = { success: true, rateChanged: false };
  const E = { success: false, error: "boom" };
  ok(mergeCustomsFeedback(A, B).rateChanged === true, "succès(rc=true) puis succès(rc=false) → rc RESTE true (collant)");
  ok(mergeCustomsFeedback(E, B).rateChanged === false, "erreur puis succès(rc=false) → rc=false (l'erreur n'apportait pas de rc)");
  ok(mergeCustomsFeedback(A, E).success === false && /boom/.test(mergeCustomsFeedback(A, E).error), "succès(rc=true) puis erreur → erreur affichée (rc perdu, l'erreur prime)");
  ok(mergeCustomsFeedback(A, null) === A, "next absent → prev conservé");
  ok(mergeCustomsFeedback(A, B).success === true, "chaîne de succès reste un succès");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 20 (classification douanière) : ✓ Tous les tests passent"
  : ` BILAN LOT 20 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
