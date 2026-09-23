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
check("liste partielle → titre + « Partiel » + marge réelle + note 30 jours",
  React.createElement(ProductCostList, { products: [{ product_id: "p1", title: "T-shirt bleu", status: { key: "partial", label: "Partiel : 1 variante sur 2" }, marginPct: 18, variantRows: [] }], onToggle() {} }),
  (h) => /T-shirt bleu/.test(h) && /Partiel : 1 variante sur 2/.test(h) && /18/.test(h) && /Statut des coûts/.test(h) && /sans vente sur la période/.test(h));
check("liste : produit sans vente (marge « — ») → tooltip explicatif présent",
  React.createElement(ProductCostList, { products: [{ product_id: "p1", title: "Mug licorne", status: { key: "todo", label: "À compléter" }, marginPct: null, variantRows: [] }], onToggle() {} }),
  (h) => /Aucune vente de ce produit dans les commandes analysées/.test(h) && /30 derniers jours/.test(h));

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

// ════════════════════════════════════════════════════════════════════════════════
//  F4-A — Tableau de bord : composants Polaris WC RÉELS rendus sous I18nProvider (en puis fr), sur
//  données chargées, nœuds null (coûts manquants), insuffisant, état vide, trous, boutique de dev.
//  Les custom elements sortent en balises `s-*` avec leurs attributs camelCase (React 18, SSR).
// ════════════════════════════════════════════════════════════════════════════════
const { I18nProvider } = await vite.ssrLoadModule("/app/lib/i18n/context.jsx");
const { CATALOGS } = await vite.ssrLoadModule("/app/locales/index.js");
const { KpiTile } = await vite.ssrLoadModule("/app/components/dashboard/KpiTile.jsx");
const { KpiGrid } = await vite.ssrLoadModule("/app/components/dashboard/KpiGrid.jsx");
const { DataGapsBanner, DashboardNotes } = await vite.ssrLoadModule("/app/components/dashboard/DataGapsBanner.jsx");
const { PeriodSelector } = await vite.ssrLoadModule("/app/components/dashboard/PeriodSelector.jsx");
const { DashboardEmptyState } = await vite.ssrLoadModule("/app/components/dashboard/DashboardEmptyState.jsx");
const { DevShopBanner } = await vite.ssrLoadModule("/app/components/dashboard/DevShopBanner.jsx");
const { buildKpis, buildGaps, buildNotes, dashboardWindows } = await vite.ssrLoadModule("/app/lib/dashboard.js");
const { aggregate } = await vite.ssrLoadModule("/app/lib/econ/aggregate.js");
const { lineFromOrderMarginsRow } = await vite.ssrLoadModule("/app/lib/econ/adapters.js");

const wrap = (locale, element) => React.createElement(I18nProvider, { locale, catalogs: { en: CATALOGS.en, [locale]: CATALOGS[locale] }, currency: "USD", timeZone: "America/New_York" }, element);
const dashSettings = { shop_country_code: "US", shop_timezone: "UTC", return_window_days: 30, packaging_cost_per_order: 0, shipping_cost_rules: { default: 0, confirmed: true }, gateway_fee_rules: [{ gateway: "*", pct: 0, fixed: 0, confirmed: true }] };
const dashNow = new Date("2026-10-20T00:00:00Z");
const dashWin = { start: "2026-09-01", end: "2026-09-30" }, dashPrev = { start: "2026-08-02", end: "2026-08-31" };
const mkOrder = (id, day, extra = {}) => ({ order_id: id, day_local: day, created_at: `${day}T10:00:00Z`, excluded_reason: null, currency_code: "USD", discounts_amount: 0, shipping_charged: 0, customer_order_index: 1, ...extra });
const mkLine = (id, day, ht, cm1) => lineFromOrderMarginsRow({ order_id: id, line_item_id: `L${id}`, product_id: "P", variant_id: "V", quantity: 1, refunded_qty: 0, effective_qty: 1, unit_price_ht: ht, tax_lines: [], cm1_unit: cm1, cost_source: cm1 == null ? "missing" : "confirmed", breakdown_version: 2, currency_code: "USD", day_local: day });
const full = Array.from({ length: 12 }, (_, i) => mkOrder(`m${i}`, `2026-09-${String(10 + i).padStart(2, "0")}`));
const fullLines = full.map((o) => mkLine(o.order_id, o.day_local, 100, 60));
const prevO = full.slice(0, 10).map((o) => mkOrder(`p${o.order_id}`, o.day_local.replace("-09-", "-08-")));
const prevL = prevO.map((o) => mkLine(o.order_id, o.day_local, 80, 40));
const aggFull = aggregate({ orders: [...full, ...prevO], lines: [...fullLines, ...prevL], settings: dashSettings, window: dashWin, now: dashNow });
const aggPrev = aggregate({ orders: [...full, ...prevO], lines: [...fullLines, ...prevL], settings: dashSettings, window: dashPrev, now: dashNow });
const aggMissing = aggregate({ orders: [mkOrder("x1", "2026-09-10")], lines: [mkLine("x1", "2026-09-10", 600, null)], settings: dashSettings, window: dashWin, now: dashNow });
const aggEmpty = aggregate({ orders: [], lines: [], settings: dashSettings, window: dashWin, now: dashNow });
const kpisFull = buildKpis({ current: aggFull, previous: aggPrev });
const kpisMissing = buildKpis({ current: aggMissing, previous: aggEmpty });
const byId = (list, id) => list.find((k) => k.id === id);

console.log("\n=== RENDU RÉEL — KpiTile (Tableau de bord F4-A) ===");
check("ok + écart positif (en) → valeur $, badge arrow-up, « See the calculation », modale avec entrées",
  wrap("en", React.createElement(KpiTile, { kpi: byId(kpisFull, "ca_ht") })),
  (h) => /<s-box/.test(h) && /\$1,200\.00/.test(h) && /icon="arrow-up"/.test(h) && /tone="success"/.test(h) && /\+50\.0%/.test(h) && /See the calculation/.test(h) && /<s-modal/.test(h) && /Gross revenue/.test(h));
check("même KPI en fr → libellé et format français, mêmes chiffres",
  wrap("fr", React.createElement(KpiTile, { kpi: byId(kpisFull, "ca_ht") })),
  (h) => /CA net HT/.test(h) && /200,00/.test(h) && !/1,200\.00/.test(h) && /Voir le calcul/.test(h) && /vs période précédente/.test(h));
check("CM2 % en points : badge +10 pt, valeur 60.0%",
  wrap("en", React.createElement(KpiTile, { kpi: byId(kpisFull, "cm2_pct") })),
  (h) => /60\.0%/.test(h) && /\+10\.0 pt/.test(h));
check("nœud null (coût manquant) → « Unknown: 1 line without a product cost. », aucun chiffre 0",
  wrap("en", React.createElement(KpiTile, { kpi: byId(kpisMissing, "cm3") })),
  (h) => /Unknown: 1 line without a product cost/.test(h) && !/type="strong"/.test(h));
check("insuffisant → « Not enough data yet: 9 more orders. » (1 commande, minData 10)",
  wrap("en", React.createElement(KpiTile, { kpi: byId(kpisMissing, "aov") })),
  (h) => /Not enough data yet: 9 more orders\./.test(h));
check("insuffisant (fr) → « encore 9 commandes »",
  wrap("fr", React.createElement(KpiTile, { kpi: byId(kpisMissing, "aov") })),
  (h) => /encore 9 commandes/.test(h));
check("source non connectée → « Connect an advertising account »",
  wrap("en", React.createElement(KpiTile, { kpi: byId(kpisMissing, "cac_global") })),
  (h) => /Connect an advertising account/.test(h));
check("kpi=null (ÉTAT INITIAL) → null, ne crashe pas", wrap("en", React.createElement(KpiTile, { kpi: null })), (h) => h === "");

console.log("\n=== RENDU RÉEL — KpiGrid (12 KPI, 3 sections, secondaires masquables) ===");
check("12 tuiles, 3 s-section, grille @container, 4 secondaires en .tcc-secondary, bouton « Show 4 more indicators »",
  wrap("en", React.createElement(KpiGrid, { kpis: kpisFull })),
  (h) => (h.match(/<s-modal/g) ?? []).length === 12 && (h.match(/<s-section/g) ?? []).length === 3 && /gridTemplateColumns="@container/.test(h) && (h.match(/class="tcc-secondary"/g) ?? []).length === 4 && /Show 4 more indicators/.test(h));
check("kpis=[] → aucune section, aucun bouton", wrap("en", React.createElement(KpiGrid, { kpis: [] })), (h) => !/<s-section/.test(h) && !/Show/.test(h));

console.log("\n=== RENDU RÉEL — DataGapsBanner / DashboardNotes ===");
check("trous → s-banner warning avec 1 ligne sans coût, 20 legacy, plafond, 2 exclues (raisons)",
  wrap("en", React.createElement(DataGapsBanner, { gaps: buildGaps({ agg: aggMissing, legacyLines: 20, capped: true, excluded: { draft: 1, cancelled: 1 } }) })),
  (h) => /tone="warning"/.test(h) && /1 order line has no product cost/.test(h) && /20 order lines were ingested before/.test(h) && /5,000/.test(h) && /2 orders are excluded from every figure: 1 draft, 1 cancelled/.test(h));
check("aucun trou → null", wrap("en", React.createElement(DataGapsBanner, { gaps: [] })), (h) => h === "");
check("notes → pub non connectée, coûts fixes absents",
  wrap("fr", React.createElement(DashboardNotes, { notes: buildNotes(aggFull) })),
  (h) => /Aucune source publicitaire connectée/.test(h) && /Aucun coût fixe saisi/.test(h));

console.log("\n=== RENDU RÉEL — PeriodSelector / EmptyState / DevShopBanner ===");
check("sélecteur 30 j actif (primary, disabled), liens ?days=, plage formatée",
  wrap("en", React.createElement(PeriodSelector, { days: 30, windows: dashboardWindows({ now: new Date("2026-09-23T12:00:00Z"), timeZone: "UTC", days: 30 }) })),
  (h) => /href="\?days=7"/.test(h) && /href="\?days=90"/.test(h) && /variant="primary" disabled/.test(h) && /Aug 24, 2026 to Sep 22, 2026/.test(h));
check("état vide avec 7 exclues → titre, raisons, lien /app",
  wrap("fr", React.createElement(DashboardEmptyState, { excluded: { draft: 7 } })),
  (h) => /Aucune commande à analyser/.test(h) && /7 commandes de la période sont exclues/.test(h) && /7 brouillon/.test(h) && /href="\/app"/.test(h));
check("état vide sans exclusion → pas de phrase d'exclusion", wrap("en", React.createElement(DashboardEmptyState, { excluded: {} })), (h) => /No order to analyze/.test(h) && !/excluded/.test(h));
check("boutique de dev, inclusion OFF → bandeau info + bouton « Include draft and test orders », form POST",
  wrap("en", React.createElement(DevShopBanner, { isDevShop: true, includeTestOrders: false })),
  (h) => /tone="info"/.test(h) && /Include draft and test orders/.test(h) && /method="post"/.test(h) && /value="1"/.test(h));
check("boutique de dev, inclusion ON → « Exclude… »", wrap("fr", React.createElement(DevShopBanner, { isDevShop: true, includeTestOrders: true })), (h) => /Exclure les commandes brouillon/.test(h));
check("boutique marchande (isDevShop=false) → null", wrap("en", React.createElement(DevShopBanner, { isDevShop: false, includeTestOrders: true })), (h) => h === "");
check("isDevShop=null (pas encore lu) → null", wrap("en", React.createElement(DevShopBanner, { isDevShop: null })), (h) => h === "");

console.log("\n" + (ko === 0 ? "✅ Tous les rendus réels OK" : `❌ ${ko} rendu(s) en échec`));
await vite.close();
process.exit(ko === 0 ? 0 : 1);
