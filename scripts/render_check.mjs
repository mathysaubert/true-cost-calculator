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
    if (!ok && process.env.RC_FULL) console.log(`       FULL → ${html}`);
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
//  F4-A — Vue d'ensemble (Overview) : composants RÉELS rendus sous I18nProvider (en puis fr) :
//  tuile avec courbe, tuile sans courbe, chaque statut, thème sombre (wrapper data-theme),
//  emplacements réservés, nav avec « Bientôt », en-tête (salutation, sync, période partielle),
//  sélecteur segmenté (aria-current), état vide avec raison legacy, bandeaux, bandeau du moteur.
//  Les valeurs finales sont dans le HTML SSR (aucun décalage de mise en page) ; aucune couleur en dur.
// ════════════════════════════════════════════════════════════════════════════════
const { I18nProvider } = await vite.ssrLoadModule("/app/lib/i18n/context.jsx");
const { CATALOGS } = await vite.ssrLoadModule("/app/locales/index.js");
const { KpiTile } = await vite.ssrLoadModule("/app/components/overview/KpiTile.jsx");
const { KpiGrid } = await vite.ssrLoadModule("/app/components/overview/KpiGrid.jsx");
const { OverviewHeader, PeriodSelector } = await vite.ssrLoadModule("/app/components/overview/OverviewHeader.jsx");
const { SectionRail } = await vite.ssrLoadModule("/app/components/overview/SectionRail.jsx");
const { DataGapsBanner, OverviewNotes, DevShopBanner } = await vite.ssrLoadModule("/app/components/overview/Banners.jsx");
const { OverviewEmptyState, ReservedSlots, EngineBanner } = await vite.ssrLoadModule("/app/components/overview/Blocks.jsx");
const { buildKpis, buildGaps, buildNotes, overviewWindows } = await vite.ssrLoadModule("/app/lib/overview.js");
const { aggregate } = await vite.ssrLoadModule("/app/lib/econ/aggregate.js");
const { lineFromOrderMarginsRow, ordersForEngine } = await vite.ssrLoadModule("/app/lib/econ/adapters.js");

const wrap = (locale, element, theme = null) => React.createElement(I18nProvider, { locale, catalogs: { en: CATALOGS.en, [locale]: CATALOGS[locale] }, currency: "USD", timeZone: "America/New_York" },
  React.createElement("div", { className: "tcc", "data-theme": theme ?? undefined }, element));
const ovSettings = { shop_country_code: "US", shop_timezone: "UTC", return_window_days: 30, packaging_cost_per_order: 0, shipping_cost_rules: { default: 0, confirmed: true }, gateway_fee_rules: [{ gateway: "*", pct: 0, fixed: 0, confirmed: true }] };
const ovNow = new Date("2026-10-20T00:00:00Z");
const ovWin = { start: "2026-09-01", end: "2026-09-30" }, ovPrev = { start: "2026-08-02", end: "2026-08-31" };
const mkOrder = (id, day, extra = {}) => ({ order_id: id, day_local: day, created_at: `${day}T10:00:00Z`, excluded_reason: null, currency_code: "USD", discounts_amount: 0, shipping_charged: 0, customer_order_index: 1, ...extra });
const mkLine = (id, day, ht, cm1) => lineFromOrderMarginsRow({ order_id: id, line_item_id: `L${id}`, product_id: "P", variant_id: "V", quantity: 1, refunded_qty: 0, effective_qty: 1, unit_price_ht: ht, tax_lines: [], cm1_unit: cm1, cost_source: cm1 == null ? "missing" : "confirmed", breakdown_version: 2, currency_code: "USD", day_local: day });
const full = Array.from({ length: 12 }, (_, i) => mkOrder(`m${i}`, `2026-09-${String(10 + i).padStart(2, "0")}`));
const fullLines = full.map((o) => mkLine(o.order_id, o.day_local, 100, 60));
const prevO = full.slice(0, 10).map((o) => mkOrder(`p${o.order_id}`, o.day_local.replace("-09-", "-08-")));
const prevL = prevO.map((o) => mkLine(o.order_id, o.day_local, 80, 40));
const aggFull = aggregate({ orders: [...full, ...prevO], lines: [...fullLines, ...prevL], settings: ovSettings, window: ovWin, now: ovNow });
const aggPrev = aggregate({ orders: [...full, ...prevO], lines: [...fullLines, ...prevL], settings: ovSettings, window: ovPrev, now: ovNow });
const aggMissing = aggregate({ orders: [mkOrder("x1", "2026-09-10")], lines: [mkLine("x1", "2026-09-10", 600, null)], settings: ovSettings, window: ovWin, now: ovNow });
const aggEmpty = aggregate({ orders: [], lines: [], settings: ovSettings, window: ovWin, now: ovNow });
const kpisFull = buildKpis({ current: aggFull, previous: aggPrev, window: ovWin });
const kpisMissing = buildKpis({ current: aggMissing, previous: aggEmpty, window: ovWin });
const byId = (list, id) => list.find((k) => k.id === id);
const legacyExcl = ordersForEngine(Array.from({ length: 6 }, (_, i) => mkOrder(`j${i}`, "2026-09-05", { excluded_reason: "draft" })), { includeTestOrders: true, lines: [] }).excluded;

console.log("\n=== RENDU RÉEL — KpiTile (Vue d'ensemble, direction B) ===");
check("ok + écart + mini-courbe (en) → $1,200.00, badge favorable ↑ +50.0%, svg .tcc-spark avec <title>, modale de calcul (5 lignes, « = » en gras)",
  wrap("en", React.createElement(KpiTile, { kpi: byId(kpisFull, "ca_ht") })),
  (h) => /class="tcc-tile is-ok is-hero"/.test(h) && /\$1,200\.00/.test(h) && /tcc-delta tcc-delta--good/.test(h) && /\+50\.0%/.test(h) && /vs previous period/.test(h) && /<svg class="tcc-spark"[^>]*><title>Net revenue \(excl\. tax\), daily trend over 30 days<\/title>/.test(h) && /<s-modal/.test(h) && (h.match(/class="tcc-calc__row(?: is-strong)?"/g) ?? []).length === 5 && /tcc-calc__row is-strong/.test(h) && /Gross revenue/.test(h));
check("même tuile en fr → « CA net HT », « 200,00 », « Voir le calcul », « vs période précédente »",
  wrap("fr", React.createElement(KpiTile, { kpi: byId(kpisFull, "ca_ht") })),
  (h) => /CA net HT/.test(h) && /200,00/.test(h) && !/1,200\.00/.test(h) && /Voir le calcul/.test(h) && /vs période précédente/.test(h));
check("CM2 % : écart en points +10.0 pt, valeur 60.0%, courbe (jours sans commande interrompus)",
  wrap("en", React.createElement(KpiTile, { kpi: byId(kpisFull, "cm2_pct") })),
  (h) => /60\.0%/.test(h) && /\+10\.0 pt/.test(h) && /tcc-spark/.test(h));
check("CAC non connecté → tuile is-unavailable, « Connect an advertising account », aucune courbe, aucune valeur",
  wrap("en", React.createElement(KpiTile, { kpi: byId(kpisFull, "cac_global") })),
  (h) => /is-unavailable/.test(h) && /Connect an advertising account/.test(h) && !/tcc-spark/.test(h) && !/tcc-tile__value/.test(h));
check("coût manquant → is-unknown (ambre), « Unknown: 1 line without a product cost. », aucune valeur",
  wrap("en", React.createElement(KpiTile, { kpi: byId(kpisMissing, "cm3") })),
  (h) => /is-unknown/.test(h) && /Unknown: 1 line without a product cost\./.test(h) && !/tcc-tile__value/.test(h));
check("insuffisant → is-insufficient, « Not enough data yet: 9 more orders. »",
  wrap("en", React.createElement(KpiTile, { kpi: byId(kpisMissing, "aov") })),
  (h) => /is-insufficient/.test(h) && /Not enough data yet: 9 more orders\./.test(h));
check("insuffisant (fr) → « encore 9 commandes »", wrap("fr", React.createElement(KpiTile, { kpi: byId(kpisMissing, "aov") })), (h) => /encore 9 commandes/.test(h));
check("tuile sans courbe (une seule journée) → aucun svg, valeur présente, aucune sous-ligne de remboursement", wrap("en", React.createElement(KpiTile, { kpi: byId(kpisMissing, "ca_ht") })), (h) => !/tcc-spark/.test(h) && /\$600\.00/.test(h) && !/tcc-tile__sub/.test(h));
const aggRefunded = aggregate({ orders: [mkOrder("r1", "2026-09-10")], lines: [lineFromOrderMarginsRow({ order_id: "r1", line_item_id: "Lr1", product_id: "P", variant_id: "V", quantity: 1, refunded_qty: 1, effective_qty: 0, unit_price_ht: 600, tax_lines: [], cm1_unit: null, cost_source: "missing", breakdown_version: 2, currency_code: "USD", day_local: "2026-09-10" })], settings: ovSettings, window: ovWin, now: ovNow });
const kpisRefunded = buildKpis({ current: aggRefunded, previous: aggEmpty, window: ovWin });
check("vrai zéro (option A, fr) : « 0,00 $ » + sous-ligne « 600,00 $ remboursés sur 600,00 $ vendus » en ambre (is-full), data-refunded=\"full\"",
  wrap("fr", React.createElement(KpiTile, { kpi: byId(kpisRefunded, "ca_ht") })),
  (h) => /data-refunded="full"/.test(h) && /tcc-tile__value">0,00/.test(h) && /class="tcc-tile__sub is-full">600,00.\$ remboursés sur 600,00.\$ vendus</.test(h));
check("vrai zéro (en) : « $600.00 refunded out of $600.00 sold »", wrap("en", React.createElement(KpiTile, { kpi: byId(kpisRefunded, "ca_ht") })), (h) => /\$600\.00 refunded out of \$600\.00 sold/.test(h));
check("thème sombre : wrapper data-theme=\"dark\" rendu (les jetons sombres sont vérifiés par le lot 26)",
  wrap("en", React.createElement(KpiTile, { kpi: byId(kpisFull, "ca_ht") }), "dark"),
  (h) => /class="tcc" data-theme="dark"/.test(h) && /\$1,200\.00/.test(h));
check("kpi=null (ÉTAT INITIAL) → null, ne crashe pas", wrap("en", React.createElement(KpiTile, { kpi: null })), (h) => /<div class="tcc"><\/div>/.test(h));
check("aucune couleur ni style inline dans le HTML des tuiles (jetons CSS seulement)",
  wrap("en", React.createElement(KpiGrid, { kpis: kpisFull })),
  (h) => !/#[0-9a-fA-F]{6}\b/.test(h) && !/ style="/.test(h));

console.log("\n=== RENDU RÉEL — KpiGrid (3 sections, grille app-owned, 4 secondaires, « Afficher 4 indicateurs de plus ») ===");
check("12 tuiles, 3 sections .tcc-group--{revenue,margins,acquisition}, .tcc-grid, 4 .is-secondary, bouton natif « Show 4 more indicators »",
  wrap("en", React.createElement(KpiGrid, { kpis: kpisFull })),
  (h) => (h.match(/<article class="tcc-tile/g) ?? []).length === 12 && /tcc-group tcc-group--revenue/.test(h) && /tcc-group--margins/.test(h) && /tcc-group--acquisition/.test(h) && (h.match(/class="tcc-grid"/g) ?? []).length === 3 && (h.match(/is-secondary/g) ?? []).length === 4 && /<button type="button" class="tcc-more">Show 4 more indicators<\/button>/.test(h) && !/<s-grid/.test(h));
check("kpis=[] → aucune section, aucun bouton", wrap("en", React.createElement(KpiGrid, { kpis: [] })), (h) => !/tcc-group tcc-group--/.test(h) && !/tcc-more/.test(h));

console.log("\n=== RENDU RÉEL — En-tête, sélecteur, rail ===");
const w30 = overviewWindows({ now: new Date("2026-09-23T12:00:00Z"), timeZone: "UTC", days: 30 });
check("en-tête : marque, « Hello Mathys 👋 », « Data synced », « Last update 2 hours ago », période partielle « to now (today is partial) »",
  wrap("en", React.createElement(OverviewHeader, { firstName: "Mathys", shopName: "Dev", lastSync: "2026-09-23T10:00:00Z", now: "2026-09-23T12:00:00Z", days: 30, windows: w30 })),
  (h) => /True Cost Calculator/.test(h) && /Hello Mathys/.test(h) && /Data synced/.test(h) && /Last update 2 hours ago/.test(h) && /Aug 25, 2026 to now \(today is partial\)/.test(h) && /previous 30 days/.test(h));
check("en-tête sans prénom ni sync → « Bonjour 👋 », « En attente de la première synchronisation »",
  wrap("fr", React.createElement(OverviewHeader, { firstName: null, shopName: null, lastSync: null, now: null, days: 7, windows: w30 })),
  (h) => /Bonjour 👋/.test(h) && /En attente de la première synchronisation/.test(h) && /is-idle/.test(h));
check("sélecteur segmenté : 3 liens ?days=, aria-current=\"page\" sur 30 seulement, aucun s-button-group",
  wrap("fr", React.createElement(PeriodSelector, { days: 30 })),
  (h) => /<nav class="tcc-seg" aria-label="Période">/.test(h) && (h.match(/href="\/?\?days=/g) ?? []).length === 3 && (h.match(/aria-current="page"/g) ?? []).length === 1 && /aria-current="page"[^>]*>30 jours/.test(h) && !/s-button-group/.test(h));
check("rail hybride : 3 groupes (Piloter / Explorer / Système), Aujourd'hui = lien aria-current, Indicateurs et Fiabilité = liens, 10 sections grisées « Bientôt », ni Trésorerie ni Expériences",
  wrap("fr", React.createElement(SectionRail, { current: "overview" })),
  (h) => (h.match(/class="tcc-rail__group"/g) ?? []).length === 3 && /<h4>Piloter<\/h4>/.test(h) && /<h4>Explorer<\/h4>/.test(h) && /<h4>Système<\/h4>/.test(h) && /aria-current="page"[^>]*>Aujourd(?:&#x27;|')hui</.test(h) && (h.match(/<a class="tcc-rail__item"/g) ?? []).length === 3 && /href="\/app\/metrics"/.test(h) && /href="\/app\/data-health"/.test(h) && (h.match(/is-soon/g) ?? []).length === 10 && (h.match(/Bientôt/g) ?? []).length === 10 && /aria-disabled="true"/.test(h) && /Demander/.test(h) && /Décisions/.test(h) && !/Trésorerie/.test(h) && !/Expériences/.test(h));

console.log("\n=== RENDU RÉEL — Bandeaux, état vide, emplacements réservés, moteur ===");
check("trous → s-banner warning : 6 commandes lues par l'ancienne version, 1 ligne sans coût, plafond, 2 exclues",
  wrap("en", React.createElement(DataGapsBanner, { gaps: buildGaps({ agg: aggMissing, capped: true, excluded: { ...legacyExcl, cancelled: 1, b2b: 1 } }) })),
  (h) => /tone="warning"/.test(h) && /6 orders were read by the previous version and are not counted/.test(h) && /1 order line has no product cost/.test(h) && /5,000/.test(h) && /2 orders are excluded from every figure: 1 cancelled, 1 B2B/.test(h));
check("aucun trou → null", wrap("en", React.createElement(DataGapsBanner, { gaps: [] })), (h) => /<div class="tcc"><\/div>/.test(h));
check("notes (fr) → pub non connectée, coûts fixes absents", wrap("fr", React.createElement(OverviewNotes, { notes: buildNotes(aggFull) })), (h) => /Aucune source publicitaire connectée/.test(h) && /Aucun coût fixe saisi/.test(h));
check("état vide avec 6 legacy → titre, « 6 commandes … (6 lues par l'ancienne version) », lien écran classique",
  wrap("fr", React.createElement(OverviewEmptyState, { excluded: legacyExcl })),
  (h) => /Aucune commande à analyser/.test(h) && /6 commandes de la période sont exclues/.test(h) && /6 lues par l(?:&#x27;|')ancienne version/.test(h) && /href="\/app"/.test(h) && /journée en cours comprise/.test(h));
check("boutique de dev OFF → bandeau info + « Include draft and test orders » (form POST) ; ON (fr) → « Exclure… » ; marchande → null",
  wrap("en", React.createElement("div", null, React.createElement(DevShopBanner, { isDevShop: true, includeTestOrders: false }), React.createElement(DevShopBanner, { isDevShop: false, includeTestOrders: true }))),
  (h) => /tone="info"/.test(h) && /Include draft and test orders/.test(h) && /method="post"/.test(h) && (h.match(/<s-banner/g) ?? []).length === 1);
check("emplacements réservés : 2 cartes .tcc-slot (courbe, cascade), jamais un chiffre, « Disponible à la prochaine version », badge Bientôt ; only=[chart] → 1",
  wrap("fr", React.createElement("div", null, React.createElement(ReservedSlots), React.createElement(ReservedSlots, { only: ["chart"] }))),
  (h) => (h.match(/class="tcc-slot tcc-slot--/g) ?? []).length === 3 && /Évolution de la contribution/.test(h) && /Cascade de profit/.test(h) && (h.match(/Disponible à la prochaine version/g) ?? []).length === 3 && !/Disponible avec/.test(h) && (h.match(/Bientôt/g) ?? []).length === 3 && !/\d+[,.]\d{2}/.test(h.replace(/<svg[\s\S]*?<\/svg>/g, "")));
check("bandeau du moteur : 5 étapes numérotées, 15 puces, titre et pied traduits (en)",
  wrap("en", React.createElement(EngineBanner)),
  (h) => /The economics engine behind every section/.test(h) && (h.match(/tcc-engine__step"/g) ?? []).length === 5 && (h.match(/<li>/g) ?? []).length === 15 && /One source of truth/.test(h));

// ════════════════════════════════════════════════════════════════════════════════
//  I0-B — Briefing : composant Analyse (3 niveaux), 3 résultats, situation, priorités (3, vide,
//  partiels), opportunité, cascade en tableau, indicateurs repliés, fiabilité (bloc et règles),
//  rail en 3 groupes, état vide actionnable, contenu pédagogique. Fixtures du lot 27.
// ════════════════════════════════════════════════════════════════════════════════
const { Analysis } = await vite.ssrLoadModule("/app/components/overview/Analysis.jsx");
const { Results, Situation, Priorities, Opportunity, WaterfallTable, AllIndicators, PartialConclusions, DecisionBanner } = await vite.ssrLoadModule("/app/components/overview/Briefing.jsx");
const { DataHealth, HealthRules } = await vite.ssrLoadModule("/app/components/overview/DataHealth.jsx");
const { MetricsLearn } = await vite.ssrLoadModule("/app/components/overview/MetricsLearn.jsx");
const { makeShop, WINDOWS } = await vite.ssrLoadModule("/tests/fixtures/i0_shops.mjs");
const { buildBriefing } = await vite.ssrLoadModule("/app/lib/insights/index.js");
const { dataConfidence } = await vite.ssrLoadModule("/app/lib/confidence.js");
const shopOf = (p) => makeShop(p);
const briefingOf = (shop) => {
  const sources = { ads: (shop.current.agg.shop.leaves.ad_spend ?? 0) > 0 };
  const confidence = dataConfidence({ agg: shop.current.agg, settings: shop.settings, sources, lines: shop.current.lines });
  return { confidence, briefing: buildBriefing({ current: shop.current.agg, previousPeriods: shop.previous.map((p) => p.agg), settings: shop.settings, window: WINDOWS[0], confidence }), kpis: buildKpis({ current: shop.current.agg, previous: shop.previous[0].agg, window: WINDOWS[0] }) };
};
const DEC = briefingOf(shopOf("declining")), HEA = briefingOf(shopOf("healthy")), MIS = briefingOf(shopOf("missing"));
const wrapEur = (locale, element) => React.createElement(I18nProvider, { locale, catalogs: { en: CATALOGS.en, [locale]: CATALOGS[locale] }, currency: "EUR", timeZone: "UTC" }, React.createElement("div", { className: "tcc" }, element));

console.log("\n=== RENDU RÉEL — Analyse (5 s / 30 s / complet) ===");
const drop = DEC.briefing.priorities.find((p) => p.id === "cm2_drop") ?? DEC.briefing.insights.find((i) => i.id === "cm2_drop");
check("cm2_drop (fr) : nom, observation « a baissé de … points », fourchette « Toutes choses égales par ailleurs », badge Confirmé, « Pourquoi cette conclusion ? », dépliage 30 s avec Question / Impact / Action et barres de cause (svg), modale avec preuves",
  wrapEur("fr", React.createElement(Analysis, { insight: drop, rank: 1 })),
  (h) => /class="tcc-analysis is-degradation"/.test(h) && /Marge de contribution en baisse/.test(h) && /a baissé de 1\d(?:,\d)? points\./.test(h) && !/pt points/.test(h) && /Toutes choses égales par ailleurs, environ/.test(h) && /tcc-confidence tcc-confidence--confirmed"[^>]*>Confirmé</.test(h) && /Pourquoi cette conclusion/.test(h) && /<details>/.test(h) && /Ce qui se passe/.test(h) && /contre 52,4.% vs vos 17 dernières semaines\./.test(h) && /<svg class="tcc-cause__bar"/.test(h) && /le taux de coût produit explique 79,5.% de la baisse ; le panier moyen en explique 20,5.%\. le volume de commandes en a compensé une partie \(253,58.€\)\./.test(h) && !/1\d\d,\d.%/.test(h) && /<s-modal/.test(h) && /Preuves du moteur/.test(h) && /Marge de contribution 2 \(%\) \(référence\)/.test(h) && !/cm2_pct_reference/.test(h) && /de l(?:&#x27;|')écart est expliqué/.test(h) && !/ style="/.test(h));
check("même insight en en : « fell by », « Very likely » ou « Confirmed », Read more", wrapEur("en", React.createElement(Analysis, { insight: drop })), (h) => /fell by/.test(h) && /(Confirmed|Very likely)/.test(h) && /Read more/.test(h));
const cc = MIS.briefing.insights.find((i) => i.id === "cost_coverage");
check("règle de données (cost_coverage) : is-data, CTA « Compléter les données » vers /app/data-health, « Pas encore de montant »",
  wrapEur("fr", React.createElement(Analysis, { insight: cc })),
  (h) => /is-data/.test(h) && /href="\/app\/data-health"[^>]*>Compléter les données</.test(h) && /Inconnu tant que les coûts ne sont pas saisis/.test(h) && /Aucune cause n(?:&#x27;|')est affirmée/.test(h) && /Lignes de commande sans coût produit/.test(h) && !/unknown_cost_lines/.test(h) && !/tcc-analysis__impact/.test(h));
check("insight=null → rien", wrapEur("en", React.createElement(Analysis, { insight: null })), (h) => /<div class="tcc"><\/div>/.test(h));

console.log("\n=== RENDU RÉEL — Trois résultats, situation ===");
check("saine : 3 résultats ok (CA net, Contribution avec %, Résultat estimé non estimé), « Voir le calcul » ×3",
  wrapEur("fr", React.createElement(Results, { results: HEA.briefing.results, kpis: HEA.kpis })),
  (h) => (h.match(/data-status="ok"/g) ?? []).length === 3 && /CA net/.test(h) && /du CA/.test(h) && /Résultat estimé/.test(h) && !/data-result="net_result"[^>]*>[\s\S]*?tcc-result__status/.test(h.split('data-result="net_result"')[1]?.split("</div>")[0] ?? "") && (h.match(/Voir le calcul/g) ?? []).length === 3 && (h.match(/<s-modal/g) ?? []).length === 3);
check("manquante : résultat « estimation · coûts fixes non renseignés » (D9a), contribution sur 50 % du CA à coût connu",
  wrapEur("fr", React.createElement(Results, { results: MIS.briefing.results, kpis: MIS.kpis })),
  (h) => /estimation · coûts fixes non renseignés/.test(h) && /sur 50.% du CA à coût connu/.test(h));
check("0 commande → « encore 1 commande » sur les trois, aucun montant",
  wrapEur("fr", React.createElement(Results, { results: { ca_ht: { status: "insufficient", missing: { orders: 1 } }, cm2: { status: "insufficient", missing: { orders: 1 } }, net_result: { status: "insufficient", missing: { orders: 1 } } }, kpis: [] })),
  (h) => (h.match(/encore 1 commande/g) ?? []).length === 3 && !/tcc-result__value/.test(h));
check("situation (fr, en baisse) : « perd/gagne de l'argent », « Le CA progresse plus vite que la contribution », facteur « le taux de coût produit », fiabilité élevée",
  wrapEur("fr", React.createElement(Situation, { slots: DEC.briefing.situation })),
  (h) => /Votre situation/.test(h) && /de l(?:&#x27;|')argent/.test(h) && /Le CA progresse plus vite que la contribution/.test(h) && /le taux de coût produit/.test(h) && /fiabilité des données est élevée/.test(h));
check("situation (en, manquante) : « estimated result » via result.positive, single period, reliability low",
  wrapEur("en", React.createElement(Situation, { slots: MIS.briefing.situation })),
  (h) => /Your store is (making|losing) money/.test(h) && /(One period only|Revenue and contribution)/.test(h) && /reliability is low/.test(h));

console.log("\n=== RENDU RÉEL — Priorités, opportunité, cascade, replié ===");
check("en baisse : 3 analyses classées 1-2-3, leviers distincts, aucune règle de données",
  wrapEur("fr", React.createElement(Priorities, { priorities: DEC.briefing.priorities, partials: [] })),
  (h) => (h.match(/<article class="tcc-analysis/g) ?? []).length === 3 && /tcc-analysis__rank" aria-hidden="true">1</.test(h) && /aria-hidden="true">3</.test(h) && !/is-data/.test(h));
check("aucune priorité + partiels → état vide actionnable « Aucune priorité à afficher » + « Signaux en attente de données » avec « Débloque : … »",
  wrapEur("fr", React.createElement(Priorities, { priorities: [], partials: [{ id: "product_loss", status: "partial", missing: { known_orders: 2 }, vars: { product: "gid://shopify/Product/1", units: 1 }, unlocks: ["cm2_pct"] }] })),
  (h) => /Aucune priorité à afficher/.test(h) && /Signaux en attente de données/.test(h) && /Produit vendu à perte/.test(h) && /Exige un coût connu et au moins 3 commandes/.test(h) && /Débloque : Marge de contribution 2\./.test(h));
check("opportunité (saine) : bloc, badge Simulation, « par mois », avant → après, hypothèses « commandes constantes avec un panier plus grand »",
  wrapEur("fr", React.createElement(Opportunity, { opportunity: HEA.briefing.opportunity })),
  (h) => /Opportunité principale/.test(h) && /tcc-confidence--simulation/.test(h) && /par mois/.test(h) && /→/.test(h) && /commandes constantes avec un panier plus grand/.test(h));
check("opportunité absente → rien", wrapEur("en", React.createElement(Opportunity, { opportunity: null })), (h) => /<div class="tcc"><\/div>/.test(h));
check("opportunité + empreinte (I0-C) : formulaire POST « Retenir ce scénario » avec intent=simulate, empreinte, jours ; sans empreinte → aucun formulaire",
  wrapEur("fr", React.createElement("div", null, React.createElement(Opportunity, { opportunity: HEA.briefing.opportunity, fingerprint: "aov_vs_main_price:opportunity:shop:2026-09-01:2026-09-30:120", days: 30 }), React.createElement(Opportunity, { opportunity: HEA.briefing.opportunity }))),
  (h) => (h.match(/<form method="post"[^>]*class="tcc-decision"/g) ?? []).length === 1 && /name="intent" value="simulate"/.test(h) && /name="fingerprint" value="aov_vs_main_price:opportunity:shop:2026-09-01:2026-09-30:120"/.test(h) && /name="days" value="30"/.test(h) && /<s-button type="submit" variant="secondary">Retenir ce scénario</.test(h) && /à rejouer dans le simulateur/.test(h));
check("bandeau de décision : succès → s-banner success « Scénario enregistré » ; périmé → warning « rechargez » ; échec → warning ; null / autre intent → rien",
  wrapEur("fr", React.createElement("div", null, React.createElement(DecisionBanner, { result: { intent: "simulate", ok: true, kind: "simulated" } }), React.createElement(DecisionBanner, { result: { intent: "simulate", ok: false, error: "stale" } }), React.createElement(DecisionBanner, { result: { intent: "simulate", ok: false, error: "boom" } }), React.createElement(DecisionBanner, { result: null }), React.createElement(DecisionBanner, { result: { ok: true } }))),
  (h) => (h.match(/<s-banner/g) ?? []).length === 3 && /tone="success">Scénario enregistré dans votre mémoire des décisions/.test(h) && /tone="warning">Ce scénario a changé depuis son affichage : rechargez la page\./.test(h) && /n(?:&#x27;|')a pas pu être enregistrée/.test(h));
check("cascade en tableau : 12 lignes, 3 totaux (=), CA net → … → Résultat net, note",
  wrapEur("fr", React.createElement(WaterfallTable, { leaves: DEC.briefing ? shopOf("declining").current.agg.shop.leaves : {}, nodes: shopOf("declining").current.agg.shop.nodes })),
  (h) => (h.match(/class="tcc-waterfall__row/g) ?? []).length === 12 && (h.match(/is-total/g) ?? []).length === 3 && /Où est passé votre argent/.test(h) && /Résultat net/.test(h) && /version graphique/.test(h));
check("indicateurs repliés : <details>, 3 lignes, lien /app/metrics",
  wrapEur("fr", React.createElement(AllIndicators, { kpis: HEA.kpis })),
  (h) => /<details class="tcc-fold">/.test(h) && (h.match(/tcc-fold__row/g) ?? []).length === 3 && /href="\/app\/metrics"/.test(h) && /Ouvrir tous les indicateurs/.test(h));

console.log("\n=== RENDU RÉEL — Fiabilité, rail, pédagogie ===");
check("fiabilité compacte (manquante, fr) : anneau 30, niveau faible, 3 manques avec « +N pt » et « Débloque … », lien vers la page",
  wrapEur("fr", React.createElement(DataHealth, { confidence: MIS.confidence, compact: true })),
  (h) => /tcc-ring is-low/.test(h) && /tcc-ring__value">30</.test(h) && /faible/.test(h) && (h.match(/tcc-health__gap"/g) ?? []).length === 3 && /\+20 pt/.test(h) && /Débloque/.test(h) && /href="\/app\/data-health"/.test(h));
check("fiabilité (saine, en) : anneau 100, « high », « Everything the engine needs is in place »",
  wrapEur("en", React.createElement(DataHealth, { confidence: HEA.confidence, compact: true })),
  (h) => /tcc-ring is-high/.test(h) && /tcc-ring__value">100</.test(h) && /Everything the engine needs is in place/.test(h));
check("règles (manquante) : 7 règles, points « x / y », jauge svg, « la fiabilité atteindrait … », aucune couleur en dur",
  wrapEur("fr", React.createElement(HealthRules, { confidence: MIS.confidence })),
  (h) => (h.match(/class="tcc-health-rule( is-na)?" data-rule=/g) ?? []).length === 7 && /15 \/ 30/.test(h) && /0 \/ 20/.test(h) && /<svg class="tcc-health-rule__meter"/.test(h) && /la fiabilité atteindrait/.test(h) && /ROAS de point mort/.test(h) && !/health\.unlock\./.test(h) && !/#[0-9a-fA-F]{6}\b/.test(h) && !/ style="/.test(h));
check("rail : 3 groupes titrés (Piloter, Explorer, Système), 3 liens (Aujourd'hui actif, Indicateurs, Fiabilité des données), 10 « Bientôt »",
  wrap("fr", React.createElement(SectionRail, { current: "overview" })),
  (h) => /Piloter/.test(h) && /Explorer/.test(h) && /Système/.test(h) && /aria-current="page"[^>]*>Aujourd(?:&#x27;|')hui</.test(h) && (h.match(/class="tcc-rail__item" /g) ?? []).length === 3 && (h.match(/is-soon/g) ?? []).length === 10 && /Fiabilité des données/.test(h) && /Demander/.test(h));
check("état vide actionnable (fr) : raisons + « Ce qui peut déjà être dit » avec un partiel",
  wrap("fr", React.createElement(OverviewEmptyState, { excluded: { legacy: 6 }, partials: [{ id: "cost_coverage", status: "partial", missing: { orders: 1 }, vars: { lines: 2 }, unlocks: ["cm2_pct"] }] })),
  (h) => /6 lues par l(?:&#x27;|')ancienne version/.test(h) && /Ce qui peut déjà être dit/.test(h) && /Coûts produits manquants/.test(h) && /Débloque/.test(h));
check("pédagogie : 12 dépliages, 4 champs chacun (Ce que c'est, Pourquoi, Comment, Surveiller)",
  wrap("fr", React.createElement(MetricsLearn)),
  (h) => (h.match(/<details class="tcc-fold" data-learn=/g) ?? []).length === 12 && (h.match(/Ce que c(?:&#x27;|')est/g) ?? []).length === 12 && /Comment c(?:&#x27;|')est calculé/.test(h));
check("réservé : seule la courbe est un emplacement (la cascade a son tableau)",
  wrap("fr", React.createElement(ReservedSlots, { only: ["chart"] })),
  (h) => (h.match(/class="tcc-slot tcc-slot--/g) ?? []).length === 1 && /Évolution de la contribution/.test(h));

console.log("\n" + (ko === 0 ? "✅ Tous les rendus réels OK" : `❌ ${ko} rendu(s) en échec`));
await vite.close();
process.exit(ko === 0 ? 0 : 1);
