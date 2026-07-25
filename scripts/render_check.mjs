// Harness de RENDU RÉEL (standard CLAUDE.md) : rend les composants UI RÉELS via Vite SSR + memory
// router (contexte useFetcher), sur données chargées ET état initial vide/null. Pas de déduction.
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { CustomsClassificationPanel: Panel, CustomsEstimatedTag: Tag, CustomsFeedbackBanner } = await vite.ssrLoadModule("/app/components/customsUi.jsx");
const { CostSummaryBanner, ReliabilityCounter, ProductCostList, ProductCostPanel } = await vite.ssrLoadModule("/app/components/costsUi.jsx");

let ko = 0;
function render(element) {
  const router = createMemoryRouter([{ path: "/", element }]);
  return renderToStaticMarkup(React.createElement(RouterProvider, { router }));
}
function check(label, element, expect) {
  try {
    const html = render(element);
    const ok = expect(html);
    if (!ok) ko++;
    console.log(`  ${ok ? "OK " : "ERR"} ${label}`);
    console.log(`       → ${html === "" ? "(vide — composant retourne null)" : html.replace(/\s+/g, " ").slice(0, 120) + (html.length > 120 ? "…" : "")}`);
  } catch (e) { ko++; console.log(`  ERR ${label} → THROW ${e.constructor.name}: ${e.message}`); }
}

console.log("=== RENDU RÉEL — CustomsClassificationPanel (Suivi des coûts) ===");
check("rows=null (ÉTAT INITIAL avant réponse listFetcher) — ne doit PLUS crasher", React.createElement(Panel, { rows: null, onConfirmed(){} }), () => true);
check("rows=[] (chargé, catalogue vide) → panneau masqué", React.createElement(Panel, { rows: [], onConfirmed(){} }), (h) => h === "");
check("rows=[1 produit estimé] → affiche « à confirmer »", React.createElement(Panel, { rows: [{ product_id: "p1", product_title: "Tapis", categorie: "Sport", customs_confirmed: false }], onConfirmed(){} }), (h) => /à confirmer/.test(h) && /Tapis/.test(h));
check("rows=[1 produit confirmé] → panneau masqué (null)", React.createElement(Panel, { rows: [{ product_id: "p1", product_title: "Tapis", categorie: "Sport", customs_confirmed: true }], onConfirmed(){} }), (h) => h === "");
check("rows=[2 variantes divergentes] → « catégories divergentes »", React.createElement(Panel, { rows: [{ product_id: "p1", product_title: "Tapis", categorie: "Sport", customs_confirmed: false }, { product_id: "p1", product_title: "Tapis", categorie: "Textile", customs_confirmed: false }], onConfirmed(){} }), (h) => /divergentes/.test(h));

console.log("\n=== RENDU RÉEL — CustomsEstimatedTag (Monitor / Audit) ===");
check("estimated=true → badge « Taux estimé »", React.createElement(Tag, { estimated: true }), (h) => /estimé/.test(h));
check("estimated=false → null (aucun affichage, par contrat)", React.createElement(Tag, { estimated: false }), (h) => h === "");
check("estimated=undefined (champ absent) → null", React.createElement(Tag, { estimated: undefined }), (h) => h === "");

const titleFor = (id) => ({ p4: "Gourde", p3: "Mug", p1: "Tee" }[id] ?? null);

console.log("\n=== RENDU RÉEL — CustomsFeedbackBanner (Suivi [4], règle d'or) ===");
check("feedback null → rien",
  React.createElement(CustomsFeedbackBanner, { feedback: null, onClose() {} }), (h) => h === "");
check("succès + rateChanged → « taux a changé », prochains calculs, pas de « vérités auditées »",
  React.createElement(CustomsFeedbackBanner, { feedback: { success: true, rateChanged: true }, onClose() {} }),
  (h) => /Catégorie confirmée/.test(h) && /taux de douane a changé/.test(h) && /prochains calculs utiliseront ce taux/.test(h) && !/vérités auditées/.test(h));
check("succès sans changement → « prochains calculs », message court",
  React.createElement(CustomsFeedbackBanner, { feedback: { success: true, rateChanged: false }, onClose() {} }),
  (h) => /Catégorie confirmée/.test(h) && /prochains calculs utiliseront ce taux/.test(h) && !/taux de douane a changé/.test(h));
check("erreur → message d'erreur affiché",
  React.createElement(CustomsFeedbackBanner, { feedback: { success: false, error: "Aucune variante à confirmer." }, onClose() {} }),
  (h) => /Aucune variante à confirmer/.test(h));

console.log("\n=== RENDU RÉEL — CostSummaryBanner (Suivi [1], toujours visible) ===");
check("sans commande analysée → invite « synchronisez »",
  React.createElement(CostSummaryBanner, { validCount: 0, feesCurrency: "USD" }),
  (h) => /Pas encore de commandes analysées/.test(h) && /synchronisez/.test(h));
check("avec données → CA net, marge nette, commandes, pill à perte",
  React.createElement(CostSummaryBanner, { validCount: 5, totals: { net_revenue: 1000, net_margin: -50, orders: 5 }, unprofitableCount: 2, multiCurrency: false, feesCurrency: "USD" }),
  (h) => /CA net/.test(h) && /Marge nette/.test(h) && /Commandes/.test(h) && /produits à perte/.test(h));
check("multi-devises → renvoi au détail (pas de total agrégé faux)",
  React.createElement(CostSummaryBanner, { validCount: 3, multiCurrency: true, feesCurrency: "USD" }),
  (h) => /plusieurs devises/.test(h));

console.log("\n=== RENDU RÉEL — ReliabilityCounter (Suivi, point 4) ===");
check("aucune vente (hasSales false) → null (l'invite « synchronisez » vit ailleurs)",
  React.createElement(ReliabilityCounter, { reliability: { hasSales: false }, titleFor, onSelectProduct() {} }), (h) => h === "");
check("X % + missing + top-3 → « ventes analysées », ligne missing, produits cliquables",
  React.createElement(ReliabilityCounter, { reliability: { reliabilityPct: 50, missingProducts: [{ product_id: "p4", units: 9 }], missingCount: 1, topIncomplete: [{ product_id: "p4", units: 9, status: "missing" }, { product_id: "p3", units: 3, status: "estimated" }], hasSales: true }, titleFor, onSelectProduct() {} }),
  (h) => /ventes analysées/.test(h) && /sans coût renseigné/.test(h) && /marge inconnue/.test(h) && /Gourde/.test(h));
check("tout-missing (pct null) → invite « Renseignez vos coûts », pas de %",
  React.createElement(ReliabilityCounter, { reliability: { reliabilityPct: null, missingProducts: [{ product_id: "p1", units: 5 }], missingCount: 1, topIncomplete: [{ product_id: "p1", units: 5, status: "missing" }], hasSales: true }, titleFor, onSelectProduct() {} }),
  (h) => /Renseignez vos coûts/.test(h) && /sans coût renseigné/.test(h) && !/ventes analysées/.test(h));
check("borne 100 % → aucun produit à compléter, aucune ligne missing",
  React.createElement(ReliabilityCounter, { reliability: { reliabilityPct: 100, missingProducts: [], missingCount: 0, topIncomplete: [], hasSales: true }, titleFor, onSelectProduct() {} }),
  (h) => /100/.test(h) && /ventes analysées/.test(h) && !/sans coût renseigné/.test(h));
check("produit supprimé (titleFor null) → « (produit supprimé de la boutique) », lien inactif",
  React.createElement(ReliabilityCounter, { reliability: { reliabilityPct: 60, missingProducts: [{ product_id: null, units: 4 }], missingCount: 1, topIncomplete: [{ product_id: null, units: 4, status: "missing" }], hasSales: true }, titleFor: () => null, onSelectProduct() {} }),
  (h) => /produit supprimé de la boutique/.test(h) && /disabled/.test(h));

console.log("\n=== RENDU RÉEL — ProductCostList (Suivi) ===");
check("liste vide → « Aucun produit actif »",
  React.createElement(ProductCostList, { products: [], onToggle() {} }), (h) => /Aucun produit actif/.test(h));
check("liste partielle → titre + « Partiel » + marge réelle",
  React.createElement(ProductCostList, { products: [{ product_id: "p1", title: "T-shirt bleu", status: { key: "partial", label: "Partiel : 1 variante sur 2" }, marginPct: 18, variantRows: [] }], onToggle() {} }),
  (h) => /T-shirt bleu/.test(h) && /Partiel : 1 variante sur 2/.test(h) && /18/.test(h) && /Statut des coûts/.test(h));

console.log("\n=== RENDU RÉEL — ProductCostPanel (Suivi, champs vides + placeholders) ===");
{
  const product = { product_id: "p1", title: "Tee", variantRows: [
    { variant_id: "v1", variant_title: "M", source: "estimated", stored: false, prix_achat: 0, port_entrant: 8, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Autre" },
    { variant_id: "v2", variant_title: "L", source: "confirmed", stored: true, prix_achat: 9, port_entrant: 5, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Sport" },
  ] };
  check("panneau : bouton « Enregistrer ce produit », suggestion en placeholder (« ex : 8 »), ✓ sur variante confirmée, aide repli",
    React.createElement(ProductCostPanel, { product, draft: {}, onEdit() {}, onSave() {}, feesCurrency: "USD" }),
    (h) => /Enregistrer ce produit/.test(h) && /ex : 8/.test(h) && /✓/.test(h) && /Comment vous expédiez/.test(h) && /valeur suggérée affichée en exemple/.test(h));
  check("panneau : erreur de validation prix d'achat (≤ 0) affichée",
    React.createElement(ProductCostPanel, { product, draft: {}, onEdit() {}, onSave() {}, feesCurrency: "USD", errors: [{ variant_id: "v1", messages: ["Indiquez le prix d'achat fournisseur"] }] }),
    (h) => /Indiquez le prix d/.test(h) && /achat fournisseur/.test(h) && /non enregistrée/.test(h));
  check("panneau multi-variantes → en-tête « Variante » présent",
    React.createElement(ProductCostPanel, { product, draft: {}, onEdit() {}, onSave() {}, feesCurrency: "USD" }),
    (h) => />Variante</.test(h));

  // Point 10 : produit mono-variante → pas de colonne « Variante », champs directs.
  const mono = { product_id: "p2", title: "Gourde", variantRows: [{ variant_id: "v1", variant_title: "Default Title", source: "estimated", stored: false, prix_achat: 0, port_entrant: 8, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Autre" }] };
  check("panneau mono-variante → aucune colonne « Variante », ni « Variante unique »",
    React.createElement(ProductCostPanel, { product: mono, draft: {}, onEdit() {}, onSave() {}, feesCurrency: "USD" }),
    (h) => !/>Variante</.test(h) && !/Variante unique/.test(h) && /Prix d/.test(h));

  // Point 9 : boucle post-enregistrement, 3 états (saved=true).
  check("post-save : produit incomplet restant → « Continuez : {titre} » cliquable",
    React.createElement(ProductCostPanel, { product, draft: {}, onEdit() {}, onSave() {}, feesCurrency: "USD", saved: true, nextIncomplete: { product_id: "p9", title: "Mug licorne" }, hasAnalyzedOrders: true, onContinue() {} }),
    (h) => /Continuez :/.test(h) && /Mug licorne/.test(h));
  check("post-save : tout renseigné + aucune commande → invite synchroniser",
    React.createElement(ProductCostPanel, { product, draft: {}, onEdit() {}, onSave() {}, feesCurrency: "USD", saved: true, nextIncomplete: null, hasAnalyzedOrders: false, onContinue() {} }),
    (h) => /Tous vos produits sont renseignés/.test(h) && /Synchronisez vos commandes/.test(h));
  check("post-save : tout renseigné + commandes présentes → clôture « marges se calculent avec ces coûts »",
    React.createElement(ProductCostPanel, { product, draft: {}, onEdit() {}, onSave() {}, feesCurrency: "USD", saved: true, nextIncomplete: null, hasAnalyzedOrders: true, onContinue() {} }),
    (h) => /Tous vos produits sont renseignés : vos marges réelles se calculent/.test(h) && !/Synchronisez vos commandes/.test(h));
  check("panneau : intro « ces coûts servent à calculer votre vraie marge »",
    React.createElement(ProductCostPanel, { product, draft: {}, onEdit() {}, onSave() {}, feesCurrency: "USD" }),
    (h) => /Ces coûts servent à calculer votre vraie marge sur chaque commande/.test(h));
}

console.log("\n" + (ko === 0 ? "✅ Tous les rendus réels OK" : `❌ ${ko} rendu(s) en échec`));
await vite.close();
process.exit(ko === 0 ? 0 : 1);
