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
check("CA net (fr) avec période précédente alignée (B3) : fantôme pointillé + point final de 8 px dans la mini-courbe",
  wrap("fr", React.createElement(KpiTile, { kpi: byId(buildKpis({ current: aggFull, previous: aggPrev, window: ovWin, previousWindow: ovPrev }), "ca_ht") })),
  (h) => /class="tcc-spark__ghost" d="M[\d.]+,[\d.]+ L/.test(h) && /class="tcc-spark__dot" d="M[\d.]+,[\d.]+ h0\.01"[^>]*stroke-width="8"[^>]*stroke-linecap="round"[^>]*vector-effect="non-scaling-stroke"/.test(h));
check("CA net sans période précédente : aucun fantôme, point final présent",
  wrap("fr", React.createElement(KpiTile, { kpi: byId(kpisFull, "ca_ht") })),
  (h) => !/tcc-spark__ghost/.test(h) && /tcc-spark__dot/.test(h));
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
check("rail hybride : 3 groupes (Piloter / Explorer / Système), Aujourd'hui = lien aria-current, Simulateur, Indicateurs, Produits, Fiabilité et Réglages = liens, 7 sections grisées « Bientôt », ni Trésorerie ni Expériences",
  wrap("fr", React.createElement(SectionRail, { current: "overview" })),
  (h) => (h.match(/class="tcc-rail__group"/g) ?? []).length === 3 && /<h4>Piloter<\/h4>/.test(h) && /<h4>Explorer<\/h4>/.test(h) && /<h4>Système<\/h4>/.test(h) && /aria-current="page"[^>]*>Aujourd(?:&#x27;|')hui</.test(h) && (h.match(/<a class="tcc-rail__item"/g) ?? []).length === 6 && /href="\/app\/metrics"/.test(h) && /href="\/app\/products"/.test(h) && /href="\/app\/data-health"/.test(h) && /href="\/app\/settings"/.test(h) && /href="\/app\/simulator"/.test(h) && (h.match(/is-soon/g) ?? []).length === 7 && (h.match(/Bientôt/g) ?? []).length === 7 && /aria-disabled="true"/.test(h) && /Demander/.test(h) && /Décisions/.test(h) && !/Trésorerie/.test(h) && !/Expériences/.test(h));

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
check("emplacements réservés : plus aucun (courbe B1, cascade B2) → enveloppe vide ; only=[chart] → 0",
  wrap("fr", React.createElement("div", null, React.createElement(ReservedSlots), React.createElement(ReservedSlots, { only: ["chart"] }))),
  (h) => (h.match(/class="tcc-slot tcc-slot--/g) ?? []).length === 0 && !/Bientôt/.test(h));
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
  wrapEur("fr", React.createElement(Analysis, { insight: drop, rank: 1, days: 30 })),
  (h) => /class="tcc-analysis is-degradation"/.test(h) && /Marge de contribution en baisse/.test(h) && /a baissé de 1\d(?:,\d)? points\./.test(h) && !/pt points/.test(h) && /Toutes choses égales par ailleurs, entre 170,50.€ et 208,39.€ de contribution perdue/.test(h) && !/tcc-analysis__impact">[^<]*-\d/.test(h) && /Entre 170,50.€ et 208,39.€ de contribution perdue sur la période\./.test(h) && /Fourchette de ± 10.% autour de l(?:&#x27;|')estimation : ± 10.% pour un score de fiabilité de 100 sur 100, et ± 0.% pour le niveau « Confirmé »/.test(h) && /data-fallback="metrics" href="\/app\/metrics\?days=30"[^>]*>Voir les indicateurs</.test(h) && !/Ouvrir Profit/.test(h) && /tcc-confidence tcc-confidence--confirmed"[^>]*>Confirmé</.test(h) && /Pourquoi cette conclusion/.test(h) && /<details>/.test(h) && /Ce qui se passe/.test(h) && /contre 52,4.% vs vos 17 dernières semaines\./.test(h) && /<svg class="tcc-cause__bar"/.test(h) && /le taux de coût produit explique 79,5.% de la baisse ; le panier moyen en explique 20,5.%\. le volume de commandes en a compensé une partie \(253,58.€\)\./.test(h) && !/1\d\d,\d.%/.test(h) && /<s-modal/.test(h) && /Preuves du moteur/.test(h) && /Marge de contribution 2 \(%\) \(référence\)/.test(h) && !/cm2_pct_reference/.test(h) && /de l(?:&#x27;|')écart est expliqué/.test(h) && !/ style="/.test(h));
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
  (h) => (h.match(/<form method="post"[^>]*class="tcc-decision"/g) ?? []).length === 1 && /name="intent" value="simulate"/.test(h) && /href="\/app\/simulator\?days=30&amp;basket=[\d.]+&amp;rule=aov_vs_main_price"[^>]*>Ouvrir dans le simulateur</.test(h) && /name="fingerprint" value="aov_vs_main_price:opportunity:shop:2026-09-01:2026-09-30:120"/.test(h) && /name="days" value="30"/.test(h) && /<s-button type="submit" variant="secondary">Retenir ce scénario</.test(h) && /à rejouer dans le simulateur/.test(h));
check("bandeau de décision : succès → s-banner success « Scénario enregistré » ; périmé → warning « rechargez » ; échec → warning ; null / autre intent → rien",
  wrapEur("fr", React.createElement("div", null, React.createElement(DecisionBanner, { result: { intent: "simulate", ok: true, kind: "simulated" } }), React.createElement(DecisionBanner, { result: { intent: "simulate", ok: false, error: "stale" } }), React.createElement(DecisionBanner, { result: { intent: "simulate", ok: false, error: "boom" } }), React.createElement(DecisionBanner, { result: null }), React.createElement(DecisionBanner, { result: { ok: true } }))),
  (h) => (h.match(/<s-banner/g) ?? []).length === 3 && /tone="success">Scénario enregistré dans votre mémoire des décisions/.test(h) && /tone="warning">Ce scénario a changé depuis son affichage : rechargez la page\./.test(h) && /n(?:&#x27;|')a pas pu être enregistrée/.test(h));
check("cascade en tableau : 12 lignes, 3 totaux (=), CA net → … → Résultat net, note",
  wrapEur("fr", React.createElement(WaterfallTable, { leaves: DEC.briefing ? shopOf("declining").current.agg.shop.leaves : {}, nodes: shopOf("declining").current.agg.shop.nodes })),
  (h) => (h.match(/class="tcc-waterfall__row/g) ?? []).length === 12 && (h.match(/is-total/g) ?? []).length === 3 && /Où est passé votre argent/.test(h) && /Résultat net/.test(h) && /les totaux sont ancrés à zéro/.test(h));
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
check("rail : 3 groupes titrés (Piloter, Explorer, Système), 6 liens (Aujourd'hui actif, Simulateur, Indicateurs, Produits, Fiabilité des données, Réglages), 7 « Bientôt »",
  wrap("fr", React.createElement(SectionRail, { current: "overview" })),
  (h) => /Piloter/.test(h) && /Explorer/.test(h) && /Système/.test(h) && /aria-current="page"[^>]*>Aujourd(?:&#x27;|')hui</.test(h) && (h.match(/class="tcc-rail__item" /g) ?? []).length === 6 && (h.match(/is-soon/g) ?? []).length === 7 && /Fiabilité des données/.test(h) && /Demander/.test(h) && /Réglages/.test(h));
check("état vide actionnable (fr) : raisons + « Ce qui peut déjà être dit » avec un partiel",
  wrap("fr", React.createElement(OverviewEmptyState, { excluded: { legacy: 6 }, partials: [{ id: "cost_coverage", status: "partial", missing: { orders: 1 }, vars: { lines: 2 }, unlocks: ["cm2_pct"] }] })),
  (h) => /6 lues par l(?:&#x27;|')ancienne version/.test(h) && /Ce qui peut déjà être dit/.test(h) && /Coûts produits manquants/.test(h) && /Débloque/.test(h));
check("pédagogie : 12 dépliages, 4 champs chacun (Ce que c'est, Pourquoi, Comment, Surveiller)",
  wrap("fr", React.createElement(MetricsLearn)),
  (h) => (h.match(/<details class="tcc-fold" data-learn=/g) ?? []).length === 12 && (h.match(/Ce que c(?:&#x27;|')est/g) ?? []).length === 12 && /Comment c(?:&#x27;|')est calculé/.test(h));
check("réservé : aucun emplacement (courbe B1 et cascade B2 livrées)",
  wrap("fr", React.createElement(ReservedSlots)),
  (h) => (h.match(/class="tcc-slot tcc-slot--/g) ?? []).length === 0);

// ════════════════════════════════════════════════════════════════════════════════
//  R1 — Réglages : sous-nav, formulaires (vides et renseignés), passerelles, coûts fixes, objectifs,
//  état des réglages, bandeau. Aucun champ contrôlé ; valeurs courantes = placeholders (S6).
// ════════════════════════════════════════════════════════════════════════════════
const { SettingsNav } = await vite.ssrLoadModule("/app/components/settings/SettingsNav.jsx");
const { SettingsBanner } = await vite.ssrLoadModule("/app/components/settings/Fields.jsx");
const { OrderCostsForm, ShippingForm, GatewayRules, FixedCosts } = await vite.ssrLoadModule("/app/components/settings/CostsForms.jsx");
const { GoalsForm } = await vite.ssrLoadModule("/app/components/settings/GoalsForm.jsx");
const { SettingsIndex } = await vite.ssrLoadModule("/app/components/settings/SettingsIndex.jsx");
const { settingsStatus } = await vite.ssrLoadModule("/app/lib/settings.js");
const setFull = { packaging_cost_per_order: 0.35, return_cost_per_return: 4, return_window_days: 30, delivery_promise_days: 5, shipping_cost_rules: { default: 4.9, byCountry: { FR: 3, DE: 6 }, confirmed: true }, gateway_fee_rules: [{ gateway: "paypal", pct: 3.4, fixed: 0.35, confirmed: true }], profitability_threshold_pct: 45, target_margin_after_ads_pct: 15, main_product_price: 60 };
const gws = [{ gateway: "shopify_payments", orders: 12 }, { gateway: "paypal", orders: 3 }];
const fixedRows = [{ id: "a1", label: "Loyer", amount_monthly: 1200, active_from: "2026-01-01", active_to: null }, { id: "b2", label: "Ancien outil", amount_monthly: 49, active_from: null, active_to: "2026-06-30" }];

console.log("\n=== RENDU RÉEL — Réglages (R1) ===");
check("sous-nav : 8 liens (Vue d'ensemble active, Coûts, Coûts produits, Objectifs, Boutique, Marketing, Connexions, Offre), aucun « Bientôt »",
  wrap("fr", React.createElement(SettingsNav, { current: "index" })),
  (h) => (h.match(/<a class="tcc-subnav__item"/g) ?? []).length === 8 && /href="\/app\/settings\/products"/.test(h) && /href="\/app\/settings\/plan"/.test(h) && /aria-current="page"[^>]*>Vue d(?:&#x27;|')ensemble</.test(h) && /href="\/app\/settings\/costs"/.test(h) && /href="\/app\/settings\/connections"/.test(h) && !/is-soon/.test(h));
check("coûts de commande VIDES : 4 champs s-text-field name=…, value vide, aide, suffixe jours, aucun placeholder chiffré, bouton Enregistrer, intent",
  wrap("fr", React.createElement(OrderCostsForm, { settings: {} })),
  (h) => (h.match(/<s-text-field/g) ?? []).length === 4 && /name="packaging_cost_per_order"[^>]*value=""/.test(h) && /details="Cartons, calage/.test(h) && /suffix="jours"/.test(h) && !/placeholder="\d/.test(h) && /name="intent" value="save_order_costs"/.test(h) && /<s-button type="submit"[^>]*>Enregistrer</.test(h) && !/ style="/.test(h));
check("coûts de commande RENSEIGNÉS + erreur serveur : value=\"0.35\", erreur « Hors bornes. » sur le champ fautif",
  wrap("fr", React.createElement(OrderCostsForm, { settings: setFull, result: { intent: "save_order_costs", ok: false, errors: { return_window_days: "range" } } })),
  (h) => /name="packaging_cost_per_order"[^>]*value="0.35"/.test(h) && /name="return_window_days"[^>]*error="Hors bornes\."/.test(h) && !/name="packaging_cost_per_order"[^>]*error=/.test(h));
check("port par pays : badge « À confirmer » et défaut vide quand non confirmé ; renseigné → « Renseigné », FR=3, DE=6, 5 lignes, bouton Confirmer",
  wrap("fr", React.createElement("div", null, React.createElement(ShippingForm, { settings: { shipping_cost_rules: { default: 5, confirmed: false } } }), React.createElement(ShippingForm, { settings: setFull }))),
  (h) => /tcc-badge--warn">À confirmer</.test(h) && /name="shipping_default"[^>]*value=""/.test(h) && /tcc-badge--good">Renseigné</.test(h) && /name="shipping_default"[^>]*value="4.9"/.test(h) && /name="shipping_country_1"[^>]*value="FR"/.test(h) && /name="shipping_amount_2"[^>]*value="6"/.test(h) && (h.match(/name="shipping_country_\d"/g) ?? []).length === 10 && /Confirmer</.test(h));
check("passerelles : 2 formulaires (shopify_payments 12 commandes à confirmer avec placeholders 1.5 / 0.25 et phrase des valeurs usuelles ; paypal confirmé avec value 3.4) ; aucune → message",
  wrap("fr", React.createElement("div", null, React.createElement(GatewayRules, { settings: setFull, gateways: gws }), React.createElement(GatewayRules, { settings: {}, gateways: [] }))),
  (h) => (h.match(/data-gateway="/g) ?? []).length === 2 && /12 commandes/.test(h) && /name="pct"[^>]*value=""[^>]*placeholder="1.5"/.test(h) && /Valeurs usuelles : 1,5.% \+ 0,25 par transaction/.test(h) && /data-gateway="paypal"[\s\S]*?tcc-badge--good">Confirmé<[\s\S]*?name="pct"[^>]*value="3.4"/.test(h) && /Aucune passerelle vue/.test(h));
check("coûts fixes : 2 lignes (Loyer actif avec Terminer + Supprimer ; ancien outil terminé, Supprimer seul), total « 1 200,00 $ par mois » sur l'actif, formulaire d'ajout ; vide → message",
  wrap("fr", React.createElement("div", null, React.createElement(FixedCosts, { rows: fixedRows, today: "2026-09-24" }), React.createElement(FixedCosts, { rows: [], today: "2026-09-24" }))),
  (h) => (h.match(/data-fixed-cost="/g) ?? []).length === 2 && /data-fixed-cost="a1"[\s\S]*?Terminer aujourd(?:&#x27;|')hui/.test(h) && /class="tcc-table__row is-off" role="row" data-fixed-cost="b2"/.test(h) && /1.200,00.\$ par mois/.test(h) && (h.match(/name="intent" value="add_fixed_cost"/g) ?? []).length === 2 && /Aucun coût fixe pour le moment/.test(h));
check("objectifs : 3 champs avec suffixe % sur les taux, seuil 0 → vide, bande 40 % – 60 %, seuil d'alerte classique rappelé",
  wrap("fr", React.createElement(GoalsForm, { settings: { profitability_threshold_pct: 0, main_product_price: 60 }, alertThreshold: 25 })),
  (h) => (h.match(/<s-text-field/g) ?? []).length === 3 && /name="profitability_threshold_pct"[^>]*value=""[^>]*suffix="%"/.test(h) && /name="main_product_price"[^>]*value="60"/.test(h) && /entre 40.% et 60.% du CA/.test(h) && /alertes de calcul\) : 25.%/.test(h));
check("état des réglages : 13 lignes en 5 pages (Boutique, Marketing, Connexions, Coûts, Objectifs) avec badges Renseigné / À confirmer / Manquant et lien Ouvrir",
  wrap("fr", React.createElement(SettingsIndex, { items: settingsStatus({ settings: setFull, fixedCosts: fixedRows, gateways: gws, day: "2026-09-24" }) })),
  (h) => (h.match(/data-setting="/g) ?? []).length === 13 && (h.match(/<section class="tcc-block"/g) ?? []).length === 5 && /href="\/app\/settings\/shop"/.test(h) && /data-setting="gateway_fees" data-state="unconfirmed"/.test(h) && /data-setting="fixed_costs" data-state="set"/.test(h) && /href="\/app\/settings\/costs"[^>]*>Ouvrir</.test(h) && /tcc-badge--warn">À confirmer</.test(h));
check("bandeau : succès → « Enregistré » ; erreurs de champs → warning ; échec → critical ; null → rien",
  wrap("fr", React.createElement("div", null, React.createElement(SettingsBanner, { result: { intent: "save_goals", ok: true } }), React.createElement(SettingsBanner, { result: { intent: "save_goals", ok: false, errors: { a: "range" } } }), React.createElement(SettingsBanner, { result: { intent: "save_goals", ok: false } }), React.createElement(SettingsBanner, { result: null }))),
  (h) => (h.match(/<s-banner/g) ?? []).length === 3 && /tone="success">Enregistré\./.test(h) && /tone="warning">Certains champs/.test(h) && /tone="critical">La modification/.test(h));

// ════════════════════════════════════════════════════════════════════════════════
//  S1 — Simulateur : rendu initial depuis l'URL (SSR, useState initial), leviers natifs, table de
//  résultat, fourchette, hypothèses, « Retenir », mémoire ; levier indisponible ; scénario vide.
// ════════════════════════════════════════════════════════════════════════════════
const { Simulator } = await vite.ssrLoadModule("/app/components/simulator/Simulator.jsx");
const simLeaves = HEA.briefing ? shopOf("healthy").current.agg.shop.leaves : {};
const simMissing = shopOf("missing").current.agg.shop.leaves;

console.log("\n=== RENDU RÉEL — Simulateur (S1) ===");
check("scénario pré-chargé (panier +7 %, règle) : 8 leviers (range + number, hors le champ cible de l'objectif), valeur 7 sur le panier, « Pré-chargé depuis », 5 lignes de résultat avec avant / après / écart positif / fourchette, hypothèse « commandes constantes », formulaire Retenir avec champs cachés, aucun champ Polaris",
  wrapEur("fr", React.createElement(Simulator, { leaves: simLeaves, periodDays: 30, days: 30, initial: { basket: 7 }, rule: "aov_vs_main_price" })),
  (h) => (h.match(/<input type="range"/g) ?? []).length === 8 && (h.match(/<input type="number" inputMode="decimal" aria-labelledby=/g) ?? []).length === 8 && /id="lever-basket"[^>]*value="7"/.test(h) && /Pré-chargé depuis : Panier proche du prix du produit principal/.test(h) && (h.match(/data-node="/g) ?? []).length === 5 && /data-node="cm2"[\s\S]*?tcc-simtable__delta is-good" data-tone="good">\+/.test(h) && /data-node="be_roas"[\s\S]*?tcc-simtable__delta is-good" data-tone="good">-/.test(h) && /data-node="be_roas"/.test(h) && /commandes constantes avec un panier plus grand \(× 1\.07\)/.test(h) && /name="intent" value="keep"/.test(h) && /type="hidden" name="basket" value="7"/.test(h) && /Retenir ce scénario/.test(h) && !/<s-text-field|<s-select/.test(h) && !/ style="/.test(h));
check("scénario vide : « Déplacez un levier », écarts 0 sans signe, bouton Retenir désactivé, mémoire vide",
  wrapEur("fr", React.createElement(Simulator, { leaves: simLeaves, periodDays: 30, days: 30, initial: {}, memory: [] })),
  (h) => /Déplacez un levier pour voir l(?:&#x27;|')effet/.test(h) && !/tcc-simtable__delta is-good/.test(h) && !/tcc-simtable__delta is-bad/.test(h) && /<s-button type="submit" variant="secondary" disabled="true">Retenir/.test(h) && /Aucun scénario retenu/.test(h));
check("horizon mois + levier indisponible (pas de pub) : bouton « Par mois » pressé, budget pub et CAC grisés « Indisponible », mémoire avec un scénario rejouable",
  wrapEur("fr", React.createElement(Simulator, { leaves: simMissing, periodDays: 30, days: 7, initial: { cogs: -10 }, horizon: "month", memory: [{ id: "d1", decided_at: "2026-09-24", rule_id: "aov_vs_main_price", values: { basket: 7 }, days: 30, horizon: "period", expected_low: 80, expected_high: 120 }] })),
  (h) => /aria-pressed="true">Par mois \(30 jours\)</.test(h) && /aria-pressed="false">Période choisie \(7 jours\)</.test(h) && /data-lever="ad_budget" [^>]*class="tcc-lever is-off"|class="tcc-lever is-off" data-lever="ad_budget"/.test(h) && (h.match(/Indisponible : le moteur/g) ?? []).length === 2 && /Montants projetés sur un mois glissant/.test(h) && /data-decision="d1"/.test(h) && /href="\/app\/simulator\?days=30&amp;basket=7&amp;rule=aov_vs_main_price"[^>]*>Rejouer</.test(h) && /80,00.€ – 120,00.€/.test(h));
check("en : libellés anglais, colonnes Before / After / Change / Range, note scénario",
  wrapEur("en", React.createElement(Simulator, { leaves: simLeaves, periodDays: 30, days: 30, initial: { price: 5 } })),
  (h) => /Before<\/span>/.test(h) && /Change<\/span>/.test(h) && /Range<\/span>/.test(h) && /Average basket/.test(h) && /This is a scenario, not a forecast/.test(h) && /id="lever-price"[^>]*value="5"/.test(h));

// ════════════════════════════════════════════════════════════════════════════════
//  R2 — Réglages > Boutique, Marketing, Connexions (formulaires natifs, s-select non contrôlé).
// ════════════════════════════════════════════════════════════════════════════════
const { ShopForm } = await vite.ssrLoadModule("/app/components/settings/ShopForm.jsx");
const { Partners, PromoRules, ManualCommissions } = await vite.ssrLoadModule("/app/components/settings/MarketingForms.jsx");
const { ConnectionsList } = await vite.ssrLoadModule("/app/components/settings/ConnectionsList.jsx");
const { connectionsStatus } = await vite.ssrLoadModule("/app/lib/settings.js");
const partnersFx = [{ id: "p1", name: "Agence A", mode: "codes" }, { id: "p2", name: "Influ B", mode: "manual" }];

console.log("\n=== RENDU RÉEL — Réglages R2 (Boutique, Marketing, Connexions) ===");
check("Boutique VIDE : pays vide, devise n/a en lecture seule, TVA « Assujetti » sélectionnée, 2 listes de langues avec « Automatique », 3 listes de pays, aucune valeur inventée",
  wrap("fr", React.createElement(ShopForm, { settings: {} })),
  (h) => /name="shop_country_code"[^>]*value=""/.test(h) && /data-readonly="shop_currency"/.test(h) && !/name="shop_currency"/.test(h) && /<s-select name="vat_regime"[^>]*value="assujetti"/.test(h) && (h.match(/<s-select name="(locale_override|report_locale)"[^>]*value=""/g) ?? []).length === 2 && /Automatique \(langue de l(?:&#x27;|')admin Shopify\)/.test(h) && /français \(fr\)/.test(h) && (h.match(/name="(sales|shipping|supply)_countries"/g) ?? []).length === 3 && /name="history_months"[^>]*value=""[^>]*placeholder="24"/.test(h) && !/ style="/.test(h));
check("Boutique RENSEIGNÉE : FR, USD, franchise, étiquette, 12 mois, langues fr / en, pays « FR, DE » ; erreur sur un champ",
  wrap("fr", React.createElement(ShopForm, { settings: { shop_country_code: "FR", shop_currency: "USD", vat_regime: "franchise", b2b_tag: "pro", history_months: 12, locale_override: "fr", report_locale: "en", sales_countries: ["FR", "DE"] }, result: { intent: "save_shop", ok: false, errors: { supply_countries: "invalid" } } })),
  (h) => /name="shop_country_code"[^>]*value="FR"/.test(h) && />USD</.test(h) && /<s-select name="vat_regime"[^>]*value="franchise"/.test(h) && /name="b2b_tag"[^>]*value="pro"/.test(h) && /name="history_months"[^>]*value="12"/.test(h) && /<s-select name="report_locale"[^>]*value="en"/.test(h) && /name="sales_countries"[^>]*value="FR, DE"/.test(h) && /name="supply_countries"[^>]*error="Saisissez un nombre\."/.test(h));
check("Marketing : 2 partenaires (Supprimer), formulaire d'ajout avec mode ; règles : « Codes vus sans règle : WELCOME (3 commandes) », 1 règle TEST20 12,5 % HT après remise, formulaire (partenaire, base, dates) ; commissions manuelles : 1 ligne, formulaire limité au partenaire manuel",
  wrap("fr", React.createElement("div", null, React.createElement(Partners, { partners: partnersFx }), React.createElement(PromoRules, { rules: [{ code: "TEST20", partner_id: "p1", commission_pct: 12.5, commission_base: "ht_after_discount", active_from: null, active_to: null }], partners: partnersFx, codes: [{ code: "TEST20", orders: 2 }, { code: "WELCOME", orders: 3 }] }), React.createElement(ManualCommissions, { commissions: [{ id: "c1", partner_id: "p2", period_month: "2026-09", amount: 250, note: "post" }], partners: partnersFx }))),
  (h) => (h.match(/data-partner="/g) ?? []).length === 2 && /name="intent" value="add_partner"/.test(h) && /<s-select name="mode"/.test(h) && /Codes vus dans vos commandes sans règle : WELCOME \(3 commandes\)\./.test(h) && /data-code="TEST20"[\s\S]*?Agence A[\s\S]*?12,5.%[\s\S]*?HT, après remise/.test(h) && /<s-select name="partner_id"[^>]*value=""/.test(h) && /<s-option value="p1">Agence A</.test(h) && /data-commission="c1"[\s\S]*?Influ B[\s\S]*?2026-09 · post/.test(h) && /name="intent" value="add_manual_commission"[\s\S]*?<s-option value="p2">Influ B</.test(h) && !/<s-option value="p1">Agence A<\/s-option>[\s\S]*?name="period_month"/.test(h.split('value="add_manual_commission"')[1] ?? ""));
check("Marketing VIDE : trois messages, commission manuelle demande d'abord un partenaire manuel",
  wrap("fr", React.createElement("div", null, React.createElement(Partners, { partners: [] }), React.createElement(PromoRules, { rules: [], partners: [], codes: [] }), React.createElement(ManualCommissions, { commissions: [], partners: [{ id: "p1", name: "A", mode: "codes" }] }))),
  (h) => /Aucun partenaire pour le moment/.test(h) && /Aucune règle pour le moment/.test(h) && /Aucune commission manuelle/.test(h) && /Ajoutez d(?:&#x27;|')abord un partenaire payé manuellement/.test(h) && !/name="intent" value="add_manual_commission"/.test(h));
check("Connexions : Shopify synchronisé « il y a N heures » Connecté, Meta en erreur avec message, 3 autres « Non connecté · connecteur à venir »",
  wrap("fr", React.createElement(ConnectionsList, { items: connectionsStatus({ rows: [{ provider: "meta", status: "error", external_account_name: "Compte X", last_sync_at: "2026-09-23T10:00:00Z", last_error: "token expiré" }], lastSync: "2026-09-24T10:00:00Z", now: "2026-09-24T12:00:00Z" }) })),
  (h) => (h.match(/data-provider="/g) ?? []).length === 5 && /data-provider="shopify" data-status="connected"/.test(h) && /dernière synchronisation il y a \d+ heures?/.test(h) && /data-provider="meta" data-status="error"[\s\S]*?Compte X · [\s\S]*?erreur : token expiré[\s\S]*?tcc-badge--bad">Erreur</.test(h) && (h.match(/Non connecté · connecteur à venir/g) ?? []).length === 0 && (h.match(/connecteur à venir/g) ?? []).length === 3 && (h.match(/>Non connecté</g) ?? []).length === 3);

// ════════════════════════════════════════════════════════════════════════════════
//  F4-B (B1) — Courbe de contribution : rendu serveur (survol nul), séries courante + précédente,
//  légende, marqueurs de fin, axes HTML, état vide V8, anglais.
// ════════════════════════════════════════════════════════════════════════════════
const { ContributionChart } = await vite.ssrLoadModule("/app/components/charts/ContributionChart.jsx");
const { buildChartSeries } = await vite.ssrLoadModule("/app/lib/overview.js");
const chartHealthy = buildChartSeries({ current: shopOf("healthy").current.agg, previous: shopOf("healthy").previous[0].agg, window: WINDOWS[0], previousWindow: WINDOWS[1] });
const chartMissing = buildChartSeries({ current: shopOf("missing").current.agg, previous: shopOf("missing").previous[0].agg, window: WINDOWS[0], previousWindow: WINDOWS[1] });

console.log("\n=== RENDU RÉEL — Courbe de contribution (F4-B, B1) ===");
check("saine (fr) : titre, légende 3 entrées (CA net, CM2, Période précédente pointillée), 2 fantômes + 2 séries avec aire, base 0, graduations en euros, marqueurs de fin avec valeur, 7 étiquettes de jours au plus, aucune infobulle au rendu serveur, image nommée + curseur de jour natif, aucun texte dans le SVG",
  wrapEur("fr", React.createElement(ContributionChart, { chart: chartHealthy, days: 30 })),
  (h) => /Évolution de la contribution/.test(h) && (h.match(/tcc-legend__item/g) ?? []).length === 3 && /is-previous"><span class="tcc-legend__swatch is-dashed"/.test(h) && (h.match(/class="tcc-chart__ghost/g) ?? []).length === 2 && (h.match(/data-series="/g) ?? []).length === 2 && (h.match(/class="tcc-chart__area"/g) ?? []).length === 2 && /tcc-chart__baseline/.test(h) && /tcc-chart__ytick[^>]*>0.€</.test(h) && (h.match(/class="tcc-chart__marker/g) ?? []).length === 2 && (h.match(/tcc-chart__xtick/g) ?? []).length <= 7 && !/tcc-chart__tip/.test(h) && !/tcc-chart__cursor/.test(h) && /class="tcc-chart__plot" role="img" aria-label="CA net et contribution sur 30 jours, du/.test(h) && /<input type="range" class="tcc-chart__reader" min="0" max="29" step="1" aria-label="Curseur de jour" aria-valuetext="[^"]+" value="0"/.test(h) && /data-chart="line"/.test(h) && !/<text/.test(h) && !/#[0-9a-fA-F]{6}/.test(h.replace(/<path[^>]*>/g, "")));
check("manquante (fr) : la note « lignes à coût connu » s'ajoute ; les jours sans ligne connue coupent la CM2 (plusieurs segments M)",
  wrapEur("fr", React.createElement(ContributionChart, { chart: chartMissing, days: 30 })),
  (h) => /La contribution ne compte que les lignes à coût connu/.test(h) && ((h.match(/data-series="cm2"[\s\S]*?class="tcc-chart__line" d="([^"]*)"/)?.[1] ?? "").match(/M/g) ?? []).length >= 1);
check("pas assez de jours (V8) : carte « Pas encore assez de jours » de même hauteur, aucune courbe ; chart null → rien",
  wrapEur("fr", React.createElement("div", null, React.createElement(ContributionChart, { chart: { enough: false, days: [], series: {} }, days: 7 }), React.createElement(ContributionChart, { chart: null }))),
  (h) => /data-chart="empty"/.test(h) && /class="tcc-chart tcc-chart--empty tcc-card tcc-empty"/.test(h) && /Pas encore assez de jours/.test(h) && /sur les 7 derniers jours/.test(h) && !/tcc-chart__svg/.test(h) && (h.match(/<section/g) ?? []).length === 1);
check("en : Series, Previous period, aria-label anglais, hint",
  wrapEur("en", React.createElement(ContributionChart, { chart: chartHealthy, days: 30 })),
  (h) => /aria-label="Series"/.test(h) && /Previous period/.test(h) && /aria-label="Net revenue and contribution over 30 days, from/.test(h) && /Hover the curve or move the day cursor/.test(h));

// ════════════════════════════════════════════════════════════════════════════════
//  F4-B (B2) — Cascade horizontale : barres flottantes, totaux, coût manquant, tableau sous dépliage.
// ════════════════════════════════════════════════════════════════════════════════
const { WaterfallChart } = await vite.ssrLoadModule("/app/components/charts/WaterfallChart.jsx");
const wfShop = shopOf("declining").current.agg.shop, wfAgg = shopOf("missing").current.agg;

console.log("\n=== RENDU RÉEL — Cascade (F4-B, B2) ===");
check("en baisse (fr) : 12 barres (départ revenus, 8 coûts, 3 totaux dont résultat), zéro marqué, montants directs (coûts négatifs), image nommée « Cascade du CA net … au résultat net … », tableau sous « Voir le tableau », aucune couleur inline",
  wrapEur("fr", React.createElement(WaterfallChart, { leaves: wfShop.leaves, nodes: wfShop.nodes, gaps: shopOf("declining").current.agg.dataGaps, flags: { fixed_missing: false, packaging_missing: false, return_cost_missing: false, ads: true } })),
  (h) => (h.match(/data-bar="/g) ?? []).length === 12 && /data-bar="ca_ht"[^>]*class="tcc-wf__row is-start"|class="tcc-wf__row is-start" data-bar="ca_ht"/.test(h) && (h.match(/is-total/g) ?? []).length >= 3 && /is-total is-result/.test(h) && /style="--zero:/.test(h) && /style="--left:[^"]*--width:/.test(h) && /data-bar="cogs"[\s\S]*?tcc-wf__amount">-/.test(h) && /aria-label="Cascade du CA net [^"]+ au résultat net [^"]+"/.test(h) && /<details class="tcc-fold"><summary>Voir le tableau/.test(h) && (h.match(/class="tcc-waterfall__row/g) ?? []).length === 12 && !/#[0-9a-fA-F]{6}/.test(h) && !/<svg class="tcc-chart/.test(h));
const wfGap = { leaves: { ca_ht: 1000, cogs: 400, shipping_cost: null, packaging_cost: 50, payment_fees: 30, returns_cost: 0, ad_spend: 700, commissions: 0, fixed_costs: null }, nodes: { ca_ht: 1000, cm2: 520, cm3: -180, net_result: -180 } };
check("coûts manquants et résultat négatif : port et coûts fixes « non renseigné » sans barre (is-missing), retours à 0 affichés « 0,00 € » (jamais « -0,00 »), CM3 et résultat négatifs marqués is-negative",
  wrapEur("fr", React.createElement(WaterfallChart, { leaves: wfGap.leaves, nodes: wfGap.nodes })),
  (h) => { const row = (id) => h.split(`data-bar="${id}"`)[1]?.split("</div>")[0] ?? ""; return /is-missing/.test(h) && /non renseigné/.test(row("shipping_cost")) && !/tcc-wf__bar/.test(row("shipping_cost")) && /non renseigné/.test(row("fixed_costs")) && /tcc-wf__amount">0,00/.test(row("returns_cost")) && !/-0,00/.test(h) && /is-total is-result is-negative|is-total is-negative/.test(h) && (h.match(/is-negative/g) ?? []).length === 2; });
check("boutique manquante RÉELLE (fixture) : ligne « CA sans coût connu, hors marge » 372,00 €, emballage et coûts fixes « non renseigné », frais « à confirmer » avec badge, pub « non connecté », 13 lignes dans le tableau",
  wrapEur("fr", React.createElement(WaterfallChart, { leaves: wfAgg.shop.leaves, nodes: wfAgg.shop.nodes, gaps: wfAgg.dataGaps, flags: { fixed_missing: true, packaging_missing: true, return_cost_missing: true, ads: false } })),
  (h) => /data-bar="unknown_ca_ht"[\s\S]*?CA sans coût connu, hors marge[\s\S]*?tcc-wf__amount">-372,00/.test(h) && /data-bar="fixed_costs" data-status="missing"/.test(h) && /data-bar="packaging_cost" data-status="missing"/.test(h) && /data-bar="payment_fees" data-status="unconfirmed"[\s\S]*?tcc-badge tcc-badge--warn">à confirmer</.test(h) && /data-bar="ad_spend" data-status="unavailable"[\s\S]*?non connecté/.test(h) && (h.match(/class="tcc-waterfall__row/g) ?? []).length === 13 && /tcc-waterfall__row is-total" data-status="ok"/.test(h));
check("en : « See the table », « not set » quand un coût manque",
  wrapEur("en", React.createElement(WaterfallChart, { leaves: wfGap.leaves, nodes: wfGap.nodes })),
  (h) => /See the table/.test(h) && /not set/.test(h) && /aria-label="Waterfall from net revenue/.test(h));

// ════════════════════════════════════════════════════════════════════════════════
//  R3 — barre de sauvegarde (attribut), activation (3 jalons), manques reliés à Réglages, état vide.
// ════════════════════════════════════════════════════════════════════════════════
const { ActivationChecklist } = await vite.ssrLoadModule("/app/components/overview/Activation.jsx");
const { activationChecklist } = await vite.ssrLoadModule("/app/lib/activation.js");

console.log("\n=== RENDU RÉEL — R3 (save bar, activation, liens Réglages) ===");
check("formulaire Réglages : <form … data-save-bar> (App Bridge) ; formulaire à bouton seul sans l'attribut",
  wrap("fr", React.createElement(FixedCosts, { rows: fixedRows, today: "2026-09-24" })),
  (h) => /<form method="post" action="\/" data-save-bar=""[^>]*class="tcc-card tcc-form"/.test(h) && !/<form method="post" action="\/" data-save-bar=""[^>]*>\s*<input type="hidden" name="intent" value="delete_fixed_cost"/.test(h) && /<form method="post" action="\/" data-discover="true"><input type="hidden" name="intent" value="delete_fixed_cost"/.test(h));
check("activation (fr) : 3 jalons, 1 / 3, sync faite, coûts à 50 % « Y aller » vers l'écran classique, situation « Y aller » vers Aujourd'hui",
  wrap("fr", React.createElement(ActivationChecklist, { checklist: activationChecklist({ lastSync: "2026-09-24T10:00:00Z", confidence: { rules: [{ id: "cost_coverage", applicable: true, measure: 0.5 }] }, briefing: null, ordersInPeriod: 0 }) })),
  (h) => /data-activation="pending"/.test(h) && /tcc-badge--warn">1 \/ 3</.test(h) && /data-step="synced" data-state="done"[\s\S]*?tcc-badge--good">Fait</.test(h) && /data-step="costs" data-state="todo"[\s\S]*?Aujourd(?:&#x27;|')hui 50.% du CA a un coût connu[\s\S]*?href="\/app\/settings\/products"[^>]*>Y aller</.test(h) && /data-step="situation" data-state="todo"[\s\S]*?href="\/app\/overview"/.test(h));
check("activation complète (en) : 3 / 3, « Everything is in place »",
  wrap("en", React.createElement(ActivationChecklist, { checklist: activationChecklist({ lastSync: "2026-09-24T10:00:00Z", confidence: { rules: [{ id: "cost_coverage", applicable: true, measure: 0.9 }] }, briefing: { situation: [{}] }, ordersInPeriod: 3 }) })),
  (h) => /data-activation="complete"/.test(h) && /3 \/ 3/.test(h) && /Everything is in place/.test(h) && !/>Go</.test(h));
check("fiabilité (manquante) : chaque manque a un lien « Compléter » vers sa page (coûts → Réglages > Coûts produits, frais → Réglages > Coûts, pub → Connexions)",
  wrapEur("fr", React.createElement(DataHealth, { confidence: MIS.confidence, compact: true })),
  (h) => (h.match(/data-fix="/g) ?? []).length === 3 && /data-fix="cost_coverage" href="\/app\/settings\/products"/.test(h.replace(/class="[^"]*" to=/g, "").replace(/href="([^"]*)"[^>]*data-fix="([^"]*)"/g, 'data-fix="$2" href="$1"')) && /Compléter</.test(h) && /data-fix="(payment_fees|shipping_costs)"/.test(h));
check("état vide : « Compléter les réglages » vers /app/settings + écran classique en secondaire",
  wrap("fr", React.createElement(OverviewEmptyState, { excluded: {} })),
  (h) => /href="\/app\/settings"[^>]*>Compléter les réglages</.test(h) && /class="tcc-cta tcc-cta--ghost" href="\/app">Ouvrir l(?:&#x27;|')écran classique</.test(h));

// ════════════════════════════════════════════════════════════════════════════════
//  S2 — objectif (bloc initial), comparaison (2 scénarios + courant), mémoire avec attendu / observé.
// ════════════════════════════════════════════════════════════════════════════════
console.log("\n=== RENDU RÉEL — Simulateur S2 (objectif, comparaison, observé) ===");
check("objectif : bloc « Atteindre un objectif » avec cible (6 options, CM2 % par défaut), valeur, levier (budget pub désactivé sans pub), bouton Trouver, aucun résultat au rendu serveur",
  wrapEur("fr", React.createElement(Simulator, { leaves: simMissing, periodDays: 30, days: 30, initial: {} })),
  (h) => /data-objective="idle"/.test(h) && /Atteindre un objectif/.test(h) && (h.match(/<option value="/g) ?? []).length >= 6 + 8 && /<option value="cm2_pct" selected="">Marge de contribution 2 \(%\)</.test(h) && /<option value="ad_budget" disabled="">Budget publicitaire</.test(h) && /<button type="button" class="tcc-cta">Trouver</.test(h) && !/tcc-objective__result/.test(h));
check("comparaison : courant + 2 retenus = 3 colonnes, 5 lignes, « Recalculé sur la période courante », lien Fermer ; mémoire : « Retirer de la comparaison » sur un scénario comparé, « Comparer » sur l'autre",
  wrapEur("fr", React.createElement(Simulator, { leaves: simLeaves, periodDays: 30, days: 30, initial: { price: 5 }, compare: [{ id: "d1", rule_id: "aov_vs_main_price", values: { basket: 7 } }, { id: "d2", rule_id: null, values: { cogs: -5 } }], memory: [{ id: "d1", decided_at: "2026-09-24", rule_id: "aov_vs_main_price", values: { basket: 7 }, days: 30, horizon: "period", expected_low: 80, expected_high: 120 }, { id: "d3", decided_at: "2026-09-20", rule_id: null, values: { price: 3 }, days: 30, horizon: "period" }], now: "2026-09-24T12:00:00Z" })),
  (h) => /data-compare="3"/.test(h) && /Comparer des scénarios/.test(h) && /Recalculé sur la période courante/.test(h) && (h.match(/role="columnheader">/g) ?? []).length >= 4 + 5 && /Scénario courant</.test(h) && /Panier proche du prix du produit principal</.test(h) && /Fermer la comparaison/.test(h) && /data-decision="d1"[\s\S]*?data-compare-toggle="remove"[^>]*>Retirer de la comparaison</.test(h) && /data-decision="d3"[\s\S]*?data-compare-toggle="add"[^>]*>Comparer</.test(h) && /href="\/app\/simulator\?days=30&amp;price=5&amp;compare=d2"/.test(h));
check("mémoire observée : observé « +95,00 € (toutes causes confondues) », non observable avec la raison, en attente « observé à partir du », due, attendu 80 – 120",
  wrapEur("fr", React.createElement(Simulator, { leaves: simLeaves, periodDays: 30, days: 30, initial: {}, now: "2026-10-25T00:00:00Z", memory: [
    { id: "o1", decided_at: "2026-09-24", rule_id: null, values: { price: 3 }, expected_low: 80, expected_high: 120, review_at: "2026-10-24T10:00:00Z", observed_at: "2026-10-24T10:00:00Z", observed_impact: 95 },
    { id: "o2", decided_at: "2026-09-24", rule_id: null, values: { price: 3 }, review_at: "2026-10-24T10:00:00Z", observed_at: "2026-10-24T10:00:00Z", observed_impact: null, note: "observed:no_history" },
    { id: "o3", decided_at: "2026-10-20", rule_id: null, values: { price: 3 }, review_at: "2026-11-19T10:00:00Z" },
    { id: "o4", decided_at: "2026-09-20", rule_id: null, values: { price: 3 }, review_at: "2026-10-20T10:00:00Z" },
  ] })),
  (h) => /data-decision="o1" data-observed="observed"[\s\S]*?attendu 80,00.€ – 120,00.€[\s\S]*?observé \+95,00.€ \(toutes causes confondues\)/.test(h) && /data-decision="o2" data-observed="unobservable"[\s\S]*?non observable : l(?:&#x27;|')historique ne couvre pas/.test(h) && /data-decision="o3" data-observed="pending"[\s\S]*?observé à partir du 19 nov\. 2026/.test(h) && /data-decision="o4" data-observed="due"[\s\S]*?observation en attente/.test(h));

// ════════════════════════════════════════════════════════════════════════════════
//  F4-D1b Offre, F4-D1a Coûts produits (portage de l'écran classique, traduit).
// ════════════════════════════════════════════════════════════════════════════════
const { PlanCards } = await vite.ssrLoadModule("/app/components/settings/PlanCards.jsx");
const { planView } = await vite.ssrLoadModule("/app/lib/plans.js");
const { ProductCostSummary, ProductCostList: PcList, CustomsPanel, CostsCsv } = await vite.ssrLoadModule("/app/components/settings/ProductCosts.jsx");
const { groupProducts, statusCounts } = await vite.ssrLoadModule("/app/lib/productCosts.js");
const pcRows = [
  { variant_id: "gid://shopify/ProductVariant/1", product_id: "gid://shopify/Product/A", product_title: "Tee", variant_title: "S", price: 60, prix_achat: 22, port_entrant: 5, qty_par_lot: 10, cout_emballage: 0.5, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Textile", source: "confirmed", stored: true, customs_confirmed: false },
  { variant_id: "gid://shopify/ProductVariant/2", product_id: "gid://shopify/Product/A", product_title: "Tee", variant_title: "M", price: 60, prix_achat: 18.4, port_entrant: 8, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "dropshipping", pays_import: "Chine", categorie: "Textile", source: "estimated", stored: false },
  { variant_id: "gid://shopify/ProductVariant/3", product_id: "gid://shopify/Product/B", product_title: "Poster", variant_title: "Default Title", price: 40, prix_achat: 0, port_entrant: 8, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "dropshipping", pays_import: "Chine", categorie: "Autre", source: "estimated", stored: false },
];
const pcProducts = groupProducts(pcRows);

console.log("\n=== RENDU RÉEL — Offre (F4-D1b) ===");
check("offre gratuite (fr), boutique de dev : bandeau test, « Offre actuelle : Gratuit », 3 cartes (prix /mois, essai 7 j), badges Populaire / Recommandé, boutons Choisir Pro et Choisir Expert (formulaires intent), aucun bouton sur Gratuit",
  wrap("fr", React.createElement(PlanCards, { view: planView({ ent: { isPro: false, isExpert: false, source: "live" } }), isDevShop: true })),
  (h) => /tone="info">Boutique de développement/.test(h) && /data-current-plan="free"/.test(h) && /Offre actuelle : Gratuit\./.test(h) && (h.match(/data-plan="/g) ?? []).length === 3 && /29.\$US \/ mois|29.\$ \/ mois/.test(h) && /7 jours d(?:&#x27;|')essai gratuit/.test(h) && /Populaire/.test(h) && /Recommandé/.test(h) && /name="intent" value="subscribe_pro"/.test(h) && /name="intent" value="subscribe_expert"/.test(h) && !/value="subscribe_free"/.test(h) && !/ style="/.test(h));
check("offre Pro (en), boutique bêta : seul « Choose Expert » avec essai de 45 jours ; carte Pro « Current »",
  wrap("en", React.createElement(PlanCards, { view: planView({ ent: { isPro: true, isExpert: false, source: "live" }, isBeta: true, betaTrialDays: 45 }) })),
  (h) => /data-plan="pro" [^>]*|class="tcc-plan is-current" data-plan="pro"/.test(h) && /Current</.test(h) && /45-day free trial/.test(h) && !/value="subscribe_pro"/.test(h) && /value="subscribe_expert"/.test(h));
check("offre Expert (fr) : « la plus complète », aucun bouton ; plan indéterminé : bandeau avertissement, aucun bouton",
  wrap("fr", React.createElement("div", null, React.createElement(PlanCards, { view: planView({ ent: { isPro: true, isExpert: true, source: "cache" } }) }), React.createElement(PlanCards, { view: planView({ ent: { source: "indeterminate" } }) }))),
  (h) => /Vous avez l(?:&#x27;|')offre la plus complète/.test(h) && /dernière offre connue/.test(h) && /tone="warning">Votre offre n(?:&#x27;|')a pas pu être lue/.test(h) && !/name="intent"/.test(h));

console.log("\n=== RENDU RÉEL — Coûts produits (F4-D1a) ===");
check("résumé et liste (fr) : filtres Tous (2) / À compléter (1) / Partiels (1) / Complets (0) ; Tee « Partiel : 1 variantes sur 2 » + « Douane à confirmer » ; Poster « À compléter » ; liens Saisir les coûts",
  wrap("fr", React.createElement("div", null, React.createElement(ProductCostSummary, { counts: statusCounts(pcProducts), filter: "all" }), React.createElement(PcList, { products: pcProducts, filter: "all" }))),
  (h) => /Tous \(2\)/.test(h) && /À compléter \(1\)/.test(h) && /Partiels \(1\)/.test(h) && /Complets \(0\)/.test(h) && /data-product="gid:\/\/shopify\/Product\/A" data-status="partial"[\s\S]*?Partiel : 1 variantes sur 2[\s\S]*?Douane à confirmer/.test(h) && /data-status="todo"[\s\S]*?À compléter/.test(h) && (h.match(/>Saisir les coûts</g) ?? []).length === 2);
check("panneau ouvert (Tee, EUR) : formulaire data-save-bar, 2 variantes (S renseignée, M suggestion), valeurs réelles sur S, exemples « ex : 18,40 » sur M (jamais une valeur), selects Chine / Textile traduits, champ en erreur signalé",
  wrapEur("fr", React.createElement(PcList, { products: pcProducts, openId: "gid://shopify/Product/A", filter: "all", currency: "EUR", result: { intent: "save_product", product_id: "gid://shopify/Product/A", errors: [{ variant_id: "gid://shopify/ProductVariant/2", fields: ["prix_achat"] }], skipped: [{ variant_id: "gid://shopify/ProductVariant/2", empty: ["cout_emballage"] }] } })),
  (h) => /<form method="post" action="\/" data-save-bar=""[^>]*class="tcc-form tcc-pc__panel"/.test(h) && (h.match(/data-variant="/g) ?? []).length === 2 && /S · renseignée/.test(h) && /name="prix_achat_0"[^>]*value="22"/.test(h) && /name="prix_achat_1"[^>]*value=""[^>]*placeholder="ex : 18,40"/.test(h) && /name="prix_achat_1"[^>]*error="Saisissez un nombre\."/.test(h) && /name="cout_emballage_1"[^>]*error="Obligatoire pour enregistrer cette variante\."/.test(h) && /Quantité par lot vide = 1/.test(h) && /<s-option value="Chine">Chine</.test(h) && /<s-option value="Électronique">Électronique</.test(h) && /Prix d(?:&#x27;|')achat \(EUR\)/.test(h) && /name="vid_1" value="gid:\/\/shopify\/ProductVariant\/2"/.test(h));
check("douane (en) : 1 produit à confirmer (Tee, catégorie stockée Textile présélectionnée), formulaire intent confirm_customs ; Poster (aucune variante stockée) absent",
  wrap("en", React.createElement(CustomsPanel, { products: pcProducts })),
  (h) => /Customs classification: 1 product to confirm/.test(h) && /data-customs="gid:\/\/shopify\/Product\/A"/.test(h) && !/data-customs="gid:\/\/shopify\/Product\/B"/.test(h) && /<s-select name="categorie"[^>]*value="Textile"/.test(h) && /<s-option value="Électronique">Electronics</.test(h) && /value="confirm_customs"/.test(h));
check("CSV (fr) : lien d'export data:text/csv téléchargeable, formulaire multipart d'import, résultat 3 importées + 2 lignes rejetées avec champs traduits",
  wrap("fr", React.createElement(CostsCsv, { csv: "variant_id,prix_achat\ngid,1", result: { intent: "import_csv", ok: true, saved: 3, csvErrors: [{ line: 4, fields: ["prix_achat", "categorie"] }, { line: 7, fields: ["variant_id"] }] } })),
  (h) => /href="data:text\/csv;charset=utf-8,variant_id%2Cprix_achat/.test(h) && /download="true-cost-calculator-costs\.csv"/.test(h) && /enctype="multipart\/form-data"/i.test(h) && /<input type="file" name="csv"/.test(h) && /3 variantes importées\. 2 lignes ont été rejetées\./.test(h) && /Ligne 4 : prix d(?:&#x27;|')achat, catégorie/.test(h) && /identifiant de variante manquant/.test(h));

// ════════════════════════════════════════════════════════════════════════════════
//  S3 — Simulateur, mode Produit (produit existant, nouveau produit).
// ════════════════════════════════════════════════════════════════════════════════
const { NewProduct } = await vite.ssrLoadModule("/app/components/simulator/NewProduct.jsx");
const { ModeBar } = await vite.ssrLoadModule("/app/components/simulator/ModeBar.jsx");
const npInit = { price_ttc: "60", prix_achat: "22", port_entrant: "40", qty_par_lot: "10", packaging: "0.5", shipping: "4", payment_pct: "1.5", payment_fixed: "0.25", return_rate_pct: "5", return_cost: "3", vat_regime: "assujetti", shipping_model: "stock", categorie: "Textile" };

console.log("\n=== RENDU RÉEL — Simulateur S3 (mode Produit) ===");
check("barre de modes (fr) : 3 modes (Toute la boutique, Produit existant actif, Nouveau produit), sélecteur de produit en GET (2 produits, CA et commandes), bouton Charger",
  wrapEur("fr", React.createElement(ModeBar, { mode: "product", products: [{ id: "gid://shopify/Product/1", title: "Tee", ca_ht: 1200, orders: 20 }, { id: "gid://shopify/Product/2", title: "Cap", ca_ht: 300, orders: 12 }], product: "gid://shopify/Product/1", days: 30 })),
  (h) => (h.match(/<a class="tcc-subnav__item"/g) ?? []).length === 3 && /aria-current="page"[^>]*>Produit existant</.test(h) && /<form method="get"[^>]*data-product-picker/.test(h) && /<option value="gid:\/\/shopify\/Product\/1" selected="">Tee · 1.200,00.€ · 20 commandes</.test(h) && /Cap · 300,00.€ · 12 commandes/.test(h) && />Charger</.test(h) && /2 produits vendus/.test(h));
check("produit existant : le Simulateur annonce le périmètre produit et porte mode + produit dans « Retenir »",
  wrapEur("fr", React.createElement(Simulator, { leaves: simLeaves, periodDays: 30, days: 30, initial: { price: 5 }, mode: "product", product: "gid://shopify/Product/1", productTitle: "Tee" })),
  (h) => /data-sim-product="gid:\/\/shopify\/Product\/1"/.test(h) && /Simulé sur les commandes réelles de : Tee/.test(h) && /name="mode" value="product"/.test(h) && /name="product" value="gid:\/\/shopify\/Product\/1"/.test(h));
check("nouveau produit (fr, marchand FR) : 11 champs + 3 listes, cascade unitaire (prix HT, coût rendu, CM1, 4 coûts, CM2), CM2 % avec TVA de vente 20 %, méthode douane UE, bloc prix minimum, formulaire keep_new avec les données",
  wrapEur("fr", React.createElement(NewProduct, { initial: npInit, shopCountryCode: "FR", days: 30 })),
  (h) => (h.match(/data-field="/g) ?? []).length === 14 && /data-new-state="ok"/.test(h) && (h.match(/data-line="/g) ?? []).length === 8 && /data-line="price_ht"[\s\S]*?50,00.€/.test(h) && /TVA de vente 20,0.%/.test(h) && /douane UE/.test(h) && /Prix minimum pour un objectif/.test(h) && /name="intent" value="keep_new"/.test(h) && /name="np_prix_achat" value="22"/.test(h) && !/<s-text-field/.test(h));
check("mémoire (fr) : ligne nouveau produit (CM2 unitaire et %, sans Rejouer ni Comparer), ligne produit existant (titre, Rejouer avec mode=product et produit)",
  wrapEur("fr", React.createElement(Simulator, { leaves: simLeaves, periodDays: 30, days: 30, initial: {}, now: "2026-09-25T00:00:00Z", memory: [{ id: "n1", decided_at: "2026-09-25", rule_id: null, values: {}, mode: "new", new_cm2: 12.58, new_cm2_pct: 25.2 }, { id: "p1", decided_at: "2026-09-25", rule_id: null, values: { price: 5 }, days: 30, horizon: "period", mode: "product", product_id: "gid://shopify/Product/1", product_title: "Tee", expected_low: 10, expected_high: 20, review_at: "2026-10-25T00:00:00Z" }] })),
  (h) => { const n = h.match(/<li data-decision="n1"[\s\S]*?<\/li>/)?.[0] ?? "", pr = h.match(/<li data-decision="p1"[\s\S]*?<\/li>/)?.[0] ?? ""; return /Nouveau produit : marge de contribution 2 de 12,58.€ par unité \(25,2.%\)/.test(n) && !/Rejouer|data-compare-toggle/.test(n) && /produit Tee/.test(pr) && /mode=product&amp;product=gid%3A%2F%2Fshopify%2FProduct%2F1/.test(pr) && /data-compare-toggle="add"/.test(pr); });
check("nouveau produit vide (en) : « Enter at least: Selling price incl. tax, Purchase price », bouton Retenir désactivé",
  wrapEur("en", React.createElement(NewProduct, { initial: {}, shopCountryCode: "FR", days: 30 })),
  (h) => /data-new-state="missing"/.test(h) && /Enter at least: Selling price incl\. tax, Purchase price\./.test(h) && /<s-button type="submit" variant="secondary" disabled="true">/.test(h));

// ════════════════════════════════════════════════════════════════════════════════
//  D1c — Section Produits (liste par produit, audit catalogue Expert).
// ════════════════════════════════════════════════════════════════════════════════
const { ProductList, ProductSummary } = await vite.ssrLoadModule("/app/components/products/ProductList.jsx");
const { CatalogAudit } = await vite.ssrLoadModule("/app/components/products/CatalogAudit.jsx");
const { productSummary: pSummary } = await vite.ssrLoadModule("/app/lib/products.js");
const pList = [
  { id: "gid://shopify/Product/1", title: "Tee", ca_ht: 2418, orders: 40, units: 39, cm2: 1267.89, cm2_pct: 52.4, unknown_ca_ht: 0, status: "set" },
  { id: "gid://shopify/Product/2", title: "Cap", ca_ht: 300, orders: 12, units: 12, cm2: -18.5, cm2_pct: -6.2, unknown_ca_ht: 0, status: "to_confirm" },
  { id: "gid://shopify/Product/3", title: "Mug", ca_ht: 150, orders: 6, units: 6, cm2: null, cm2_pct: null, unknown_ca_ht: 150, status: "missing" },
];
const auditRes = { ok: true, intent: "audit", scanned: 4, noCost: 1, incomplete: false, taxesIncluded: true, thresholdPct: 25, missingSettings: ["shipping", "payment_pct"], returnRatePct: 5,
  rows: [{ id: "gid://shopify/Product/1", title: "Tee", price_ttc: 60, cost: 22, cost_source: "merchant", landed: 29.12, cm2: 12.58, cm2_pct: 25.2, category: "Textile", customs_estimated: false },
         { id: "gid://shopify/Product/2", title: "Cap", price_ttc: 20, cost: 25, cost_source: "shopify", landed: 27, cm2: -11.3, cm2_pct: -67.8, category: "Accessoires", customs_estimated: true },
         { id: "gid://shopify/Product/4", title: "Bag", price_ttc: 45, cost: 20, cost_source: "merchant", landed: 23, cm2: 5.1, cm2_pct: 13.6, category: "Maroquinerie", customs_estimated: false }] };

console.log("\n=== RENDU RÉEL — Section Produits (D1c) ===");
check("liste (fr) : synthèse (3 produits, part du CA sans coût), 5 filtres avec compteurs, en-têtes triables, 3 lignes (CA, CM2 négative en rouge, CM2 absente « n/d », unités, statuts renseigné / à confirmer / sans coût), lien Coûts produits",
  wrapEur("fr", React.createElement(React.Fragment, null, React.createElement(ProductSummary, { summary: pSummary(pList), total: 3 }), React.createElement(ProductList, { products: pList, summary: pSummary(pList), days: 30, status: "all", sort: "ca_ht" }))),
  (h) => /3 produits vendus sur la période/.test(h) && /5,2.% du CA produits n(?:&#x27;|')a aucun coût connu/.test(h) && (h.match(/data-status-filter="/g) ?? []).length === 5 && /data-status-filter="set"[^>]*>Coûts renseignés · 1</.test(h) && (h.match(/data-sort="/g) ?? []).length === 4 && /data-sort="ca_ht"[^>]*aria-current="true"|aria-current="true"[^>]*data-sort="ca_ht"/.test(h) && (h.match(/data-cost-status="/g) ?? []).length === 3 && /data-product="gid:\/\/shopify\/Product\/1"[\s\S]*?2.418,00.€[\s\S]*?1.267,89.€[\s\S]*?52,4.%[\s\S]*?39</.test(h) && /tcc-table__amount is-bad" data-col="cm2">-18,50.€/.test(h) && /data-cost-status="missing"[\s\S]*?data-col="cm2">n\. d\.<[\s\S]*?tcc-badge--bad">Sans coût</.test(h) && /tcc-badge--warn">À confirmer</.test(h) && /href="\/app\/settings\/products"/.test(h) && /40 commandes/.test(h) && !/ style="/.test(h));
check("liste filtrée vide (en) : filtre actif, « No product matches this filter. », pas de synthèse sans produit",
  wrapEur("en", React.createElement(React.Fragment, null, React.createElement(ProductSummary, { summary: pSummary([]) }), React.createElement(ProductList, { products: [], summary: pSummary(pList), days: 7, status: "partial", sort: "cm2" }))),
  (h) => /No product matches this filter\./.test(h) && /aria-current="page"[^>]*data-status-filter="partial"|data-status-filter="partial"[^>]*aria-current="page"/.test(h) && !/data-products-summary/.test(h) && /href="\/?\?days=7&amp;status=partial&amp;sort=cm2"/.test(h));
check("audit verrouillé (fr, non Expert) : badge Expert, explication, lien « Voir les offres », aucun formulaire",
  wrapEur("fr", React.createElement(CatalogAudit, { isExpert: false })),
  (h) => /data-audit="locked"/.test(h) && /Audit du catalogue/.test(h) && /tcc-badge--accent">Expert</.test(h) && /href="\/app\/settings\/plan"[^>]*>Voir les offres</.test(h) && !/name="intent"/.test(h));
check("audit, offre indéterminée (fr) : message de rechargement, pas de lien d'offre",
  wrapEur("fr", React.createElement(CatalogAudit, { isExpert: false, indeterminate: true })),
  (h) => /n(?:&#x27;|')a pas pu être vérifiée/.test(h) && !/Voir les offres/.test(h));
check("audit Expert au repos (fr) : formulaire run_audit, taux de retour observé pré-rempli (2,5), bouton « Lancer l'audit »",
  wrapEur("fr", React.createElement(CatalogAudit, { isExpert: true, returnRatePct: 2.5, thresholdPct: 25 })),
  (h) => /data-audit="idle"/.test(h) && /name="intent" value="run_audit"/.test(h) && /name="return_rate_pct"[^>]*value="2.5"/.test(h) && /Lancer l(?:&#x27;|')audit/.test(h) && !/data-audit-group/.test(h));
check("audit Expert avec résultat (fr) : 4 analysés dont 1 sans coût, réglages manquants nommés, 3 groupes (à perte, sous l'objectif 0 à 25 %, à l'objectif), coût Shopify à confirmer, douane estimée",
  wrapEur("fr", React.createElement(CatalogAudit, { isExpert: true, returnRatePct: 5, thresholdPct: 25, result: auditRes })),
  (h) => /data-audit="done"/.test(h) && /4 produits actifs analysés\. 1 produit n(?:&#x27;|')a ni prix ni coût/.test(h) && /Non renseignés, comptés 0 : Votre port par commande, Frais de paiement \(%\)\./.test(h) && /data-audit-group="loser"[\s\S]*?1 à perte[\s\S]*?CM2 sous 0.%[\s\S]*?Cap[\s\S]*?coût Shopify, à confirmer/.test(h) && /data-audit-group="risky"[\s\S]*?1 sous votre objectif[\s\S]*?CM2 de 0 à 25.%[\s\S]*?Bag/.test(h) && /data-audit-group="winner"[\s\S]*?1 à l(?:&#x27;|')objectif[\s\S]*?CM2 de 25.% ou plus[\s\S]*?Tee[\s\S]*?12,58.€[\s\S]*?25,2.%/.test(h) && /catégorie douanière estimée/.test(h) && !/ style="/.test(h));
check("audit en erreur (en) : plafond atteint",
  wrapEur("en", React.createElement(CatalogAudit, { isExpert: true, result: { ok: false, intent: "audit", error: "rate_limited" } })),
  (h) => /<s-banner tone="critical">Limit reached: 10 audits per day\./.test(h) && /data-audit="idle"/.test(h));

console.log("\n" + (ko === 0 ? "✅ Tous les rendus réels OK" : `❌ ${ko} rendu(s) en échec`));
await vite.close();
process.exit(ko === 0 ? 0 : 1);
