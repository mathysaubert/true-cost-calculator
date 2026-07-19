// ── UI Monitor — agrégats d'historique : fonction PURE et testable ──────────
// Code PUR (aucun I/O / React). Entrée = lignes order_margins STOCKÉES, sortie =
// regroupements + sommes des colonnes existantes. AUCUNE marge re-dérivée : on ne
// fait QUE grouper et sommer line_net_margin / line_net_revenue / effective_qty
// déjà calculés par engine.js à l'ingestion. (C'est le pendant lecture du BUG 1 :
// jamais de prixVente−coutRendu inline.)

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };

// Formate un montant selon la VRAIE devise (currency_code de l'agrégat), pas l'euro
// codé en dur. Devise invalide/mixte → format neutre + code éventuel (jamais de
// mauvais symbole). Pur affichage : ne touche aucune valeur stockée.
export function formatMoney(n, currency) {
  const v = num(n);
  if (typeof currency === "string" && /^[A-Z]{3}$/.test(currency)) {
    // narrowSymbol → symbole court ($, €, £…) plutôt que la notation longue fr-FR ($US).
    try {
      return new Intl.NumberFormat("fr-FR", { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
    } catch {
      try { // ICU sans narrowSymbol → symbole standard
        return new Intl.NumberFormat("fr-FR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
      } catch { /* code mal formé → fallback neutre ci-dessous */ }
    }
  }
  const plain = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  return currency && currency !== "MIXED" ? `${plain} ${currency}` : plain;
}

// Jour calendaire UTC de order_created_at (le VRAI jour de la commande, pas computed_at).
function utcDay(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── Dépli auditable d'UNE ligne de commande — LECTURE PURE STRICTE ────────────
// Ne projette QUE des colonnes order_margins STOCKÉES (jamais de poste recalculé).
// Deux identités d'agrégation réconcilient AU CENTIME des valeurs STOCKÉES (réplique
// de orderIngest.js, pas une re-dérivation prix−coût) :
//   • revenu : net_unit_revenue × effective_qty = line_net_revenue
//   • marge  : unit_net_margin × effective_qty − allocated_fixed_fee = line_net_margin
// snapshot = INTRANTS figés (coûts saisis), affichés comme contexte, jamais sommés.
// breakdown (Brique B) = sortie computeMargin figée à l'ingestion → alimente le waterfall
// poste-par-poste (lecture pure, cf. waterfallFromBreakdown). null = ligne pré-B → fallback.
export function lineBreakdown(r) {
  return {
    order_id:         r.order_id ?? null,
    line_item_id:     r.line_item_id ?? null,
    order_created_at: r.order_created_at ?? null,
    currency:         r.currency_code ?? null,
    cost_source:      r.cost_source ?? null,
    // identité revenu (valeurs stockées)
    net_unit_revenue: num(r.net_unit_revenue),
    line_net_revenue: num(r.line_net_revenue),
    // identité marge (valeurs stockées) — cible = line_net_margin
    unit_net_margin:     num(r.unit_net_margin),
    allocated_fixed_fee: num(r.allocated_fixed_fee),
    line_net_margin:     num(r.line_net_margin),
    // mécanique D4 (pas un poste €) : effective_qty = quantity − refunded_qty
    quantity:      num(r.quantity),
    refunded_qty:  num(r.refunded_qty),
    effective_qty: num(r.effective_qty),
    // contexte : intrants figés (coûts SAISIS, non décomposés), jamais dans une somme
    snapshot: r.cost_snapshot_json ?? null,
    // Brique B : breakdown figé (lecture pure ; select("*") ramène déjà la colonne).
    breakdown:     r.margin_breakdown_json ?? null,
    has_breakdown: r.margin_breakdown_json != null,
  };
}

// ── Structuration du waterfall poste-par-poste — PURE, LECTURE SEULE ──────────
// Lit margin_breakdown_json (figé par Brique B). AUCUNE valeur recalculée ; le total
// reste ANCRÉ sur unit_net_margin stocké côté UI (non re-sommé ici). Retour :
//   • revenu (+) et revenue_is_ht (libellé "HT" seulement si assujetti + TTC réel)
//   • deductions : postes NIVEAU 1 qui somment vers unit_net_margin (0 masqués ;
//     coutRendu toujours ; adsCost JAMAIS affiché — 0 par design v1, pas de "pub 0 €")
//   • cost_detail : sous-postes de coutRendu (douane, TVA import non récupérable franchise)
//     — informatifs, JAMAIS sommés en parallèle de coutRendu
//   • tva_advanced : TVA import avancée puis RÉCUPÉRÉE (assujetti) — hors coutRendu, non déduite
//   • collected_vat_note : gate W3 de la note TVA collectée (assujetti && shop_taxes_included)
export function waterfallFromBreakdown(breakdown, snapshot) {
  if (!breakdown) return null;
  const b = breakdown;
  const nz = (v) => num(v) !== 0;

  const deductions = [{ key: "coutRendu", amount: num(b.coutRendu) }]; // toujours affiché
  if (nz(b.shopifyCost)) deductions.push({ key: "shopifyCost", amount: num(b.shopifyCost) });
  if (nz(b.stripeCost))  deductions.push({ key: "stripeCost",  amount: num(b.stripeCost) });
  if (nz(b.retoursCost)) deductions.push({ key: "retoursCost", amount: num(b.retoursCost) });
  if (nz(b.fraisFixes))  deductions.push({ key: "fraisFixes",  amount: num(b.fraisFixes) });
  // adsCost volontairement absent (0 par design ; ne jamais suggérer "pub gratuite").

  const tvaNet = num(b.tvaNetCost), tvaImp = num(b.tvaImport);
  const cost_detail = [];
  if (nz(b.douane)) cost_detail.push({ key: "douane", amount: num(b.douane), rate: num(b.customsRate) });
  // Franchise : TVA import NON récupérable, DÉJÀ dans coutRendu (grève la marge via coutRendu).
  if (tvaNet > 0) cost_detail.push({ key: "tvaImportFranchise", amount: tvaNet, rate: num(b.vatRate) });

  // Assujetti : TVA import avancée puis récupérée → hors coutRendu, informative seulement.
  const tva_advanced = (tvaNet === 0 && tvaImp > 0) ? { amount: tvaImp, rate: num(b.vatRate) } : null;

  // Gate W3 (croisé snapshot.vat_regime + breakdown.shop_taxes_included) : note + libellé "HT".
  const isAssujettiTTC = snapshot?.vat_regime === "assujetti" && b.shop_taxes_included === true;

  return {
    revenu: num(b.revenu),
    revenue_is_ht: isAssujettiTTC,
    deductions,
    cost_detail,
    tva_advanced,
    collected_vat_note: isAssujettiTTC,
  };
}

// ── Regroupement des lignes par DÉCOMPOSITION IDENTIQUE (Option A) ────────────
// Problème résolu : un produit vendu sur N commandes économiquement identiques affichait N cartes
// de dépli rigoureusement identiques (illisible ; et à l'échelle — jusqu'à ORDER_MARGINS_CAP lignes —
// carrément inutilisable). On regroupe les lignes dont l'ÉCONOMIE UNITAIRE est identique et on ne
// montre le waterfall/les intrants QU'UNE fois par groupe ; ce qui VARIE par commande (n°, date,
// quantité, remboursement, fixe proraté, totaux de ligne) reste listé commande par commande.
// AUCUN recalcul de marge : on ne fait que grouper des lignes déjà calculées (pendant lecture du BUG 1).
//
// Empreinte = sérialisation STABLE (clés triées → indépendante de l'ordre des clés JSON de la DB) des
// SEULS champs unitaires/figés : breakdown figé + snapshot + devise + source de coût + marge/CA
// unitaires + présence du breakdown. On EXCLUT allocated_fixed_fee / effective_qty / quantity /
// refunded_qty / line_net_* : ils varient légitimement d'une commande à l'autre et n'appartiennent
// pas à la « décomposition ». Deux décompositions réellement identiques mais sérialisées différemment
// dégraderaient au pire en deux groupes (jamais un chiffre faux) — le tri des clés l'évite.
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",")}}`;
}

export function groupLinesByFingerprint(lines = []) {
  const groups = new Map();
  for (const lb of lines) {
    const key = stableStringify({
      b: lb.breakdown ?? null, s: lb.snapshot ?? null,
      c: lb.currency ?? null, src: lb.cost_source ?? null,
      um: lb.unit_net_margin, ur: lb.net_unit_revenue, hb: lb.has_breakdown,
    });
    let g = groups.get(key);
    if (!g) { g = { key, rep: lb, orders: [] }; groups.set(key, g); }
    // Par commande : uniquement ce qui VARIE (le reste vit sur g.rep, affiché une fois).
    g.orders.push({
      order_id: lb.order_id, order_created_at: lb.order_created_at,
      quantity: lb.quantity, refunded_qty: lb.refunded_qty, effective_qty: lb.effective_qty,
      allocated_fixed_fee: lb.allocated_fixed_fee,
      line_net_margin: lb.line_net_margin, line_net_revenue: lb.line_net_revenue,
      currency: lb.currency,
    });
  }
  // Commandes récentes d'abord dans chaque groupe ; groupes triés par leur commande la plus récente.
  const arr = [...groups.values()].map((g) => {
    g.orders.sort((a, b) => (a.order_created_at < b.order_created_at ? 1 : a.order_created_at > b.order_created_at ? -1 : 0));
    g.count = g.orders.length;
    g.mostRecent = g.orders[0]?.order_created_at ?? null;
    return g;
  });
  arr.sort((a, b) => (a.mostRecent < b.mostRecent ? 1 : a.mostRecent > b.mostRecent ? -1 : 0));
  return arr;
}

export function aggregateOrderMargins(rows = []) {
  // [C] cost_source='missing' (marges null) : exclu des agrégats/courbe/rentabilité,
  // rangé à part. Les compter 0 ou perte serait faux.
  const missingCostRows = [];
  const valid = [];
  for (const r of rows) {
    if (r.cost_source === "missing" || r.line_net_margin == null) missingCostRows.push(r);
    else valid.push(r);
  }

  const currencies = [...new Set(valid.map((r) => r.currency_code).filter(Boolean))];
  const multiCurrency = currencies.length > 1;

  // [A] Agrégat PAR PRODUIT (jamais ligne par ligne) — non rentable = Σ marge < 0.
  // F2 : le dépli vit au niveau LIGNE DE COMMANDE (chaque ligne a SON snapshot figé, sa
  // cible line_net_margin). On collecte donc les lignes brutes par produit (`lines`),
  // sans jamais fondre plusieurs snapshots en un seul breakdown.
  // Postes de coût agrégés PAR PRODUIT (poste_unité × effective_qty, sommés). On agrège des
  // NOMBRES déjà calculés par le moteur (margin_breakdown_json), on ne fond jamais les snapshots
  // en un seul breakdown (règle F2) et on ne re-dérive aucune marge (BUG 1). breakdownLines
  // compte les lignes qui ont un détail → l'alerte sait si le poste dominant est calculable.
  const POST_KEYS = ["coutRendu", "douane", "tvaNetCost", "shopifyCost", "stripeCost", "retoursCost", "fraisFixes"];
  const prodMap = new Map();
  for (const r of valid) {
    const key = r.product_id ?? "__unknown__";
    let p = prodMap.get(key);
    if (!p) { p = { product_id: r.product_id ?? null, orderIds: new Set(), effective_qty: 0, net_revenue: 0, net_margin: 0, currencySet: new Set(), lines: [], costPosts: Object.fromEntries(POST_KEYS.map((k) => [k, 0])), breakdownLines: 0 }; prodMap.set(key, p); }
    p.orderIds.add(r.order_id);
    p.effective_qty += num(r.effective_qty);
    p.net_revenue   += num(r.line_net_revenue);
    p.net_margin    += num(r.line_net_margin);
    if (r.currency_code) p.currencySet.add(r.currency_code);
    p.lines.push(lineBreakdown(r));
    const bd = r.margin_breakdown_json;
    if (bd) { const q = num(r.effective_qty); for (const k of POST_KEYS) p.costPosts[k] += num(bd[k]) * q; p.breakdownLines++; }
  }
  const byProduct = [...prodMap.values()].map((p) => ({
    product_id:    p.product_id,
    orders:        p.orderIds.size,
    effective_qty: p.effective_qty,
    net_revenue:   p.net_revenue,
    net_margin:    p.net_margin,
    marginPct:     p.net_revenue > 0 ? (p.net_margin / p.net_revenue) * 100 : null, // CA=0 → null (pas de /0)
    unprofitable:  p.net_margin < 0,
    currency:      p.currencySet.size === 1 ? [...p.currencySet][0] : (p.currencySet.size === 0 ? null : "MIXED"),
    // postes de coût agrégés (€ produit) + dispo du détail (pour le poste dominant de l'alerte)
    costPosts:          p.costPosts,
    breakdownAvailable: p.breakdownLines > 0,
    // lignes les plus récentes d'abord (order_created_at desc), chacune son dépli
    lines:         p.lines.sort((a, b) => (a.order_created_at < b.order_created_at ? 1 : a.order_created_at > b.order_created_at ? -1 : 0)),
    // Dépli GROUPÉ par décomposition identique (Option A) — le rendu itère là-dessus, plus sur lines.
    lineGroups:    groupLinesByFingerprint(p.lines),
  }));

  // [B] Agrégat PAR JOUR (UTC) — deux séries quotidiennes (pas de cumul).
  const dayMap = new Map();
  for (const r of valid) {
    const day = utcDay(r.order_created_at);
    if (!day) continue;
    let d = dayMap.get(day);
    if (!d) { d = { day, net_revenue: 0, net_margin: 0 }; dayMap.set(day, d); }
    d.net_revenue += num(r.line_net_revenue);
    d.net_margin  += num(r.line_net_margin);
  }
  const byDay = [...dayMap.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const unprofitableProducts = byProduct.filter((p) => p.unprofitable);

  // [CTA] Complétude des coûts — EN VARIANTES (F3/F4), dérivée des SEULES lignes du
  // monitor (jamais du catalogue : confirmer une variante sans commande ne bouge pas
  // l'écran). Dénominateur = variantes AVEC commandes sur la fenêtre (toutes lignes,
  // valides + missing). Numérateur = variantes qui tournent sur coût estimé OU manquant
  // (les 'confirmed'/'imported' sont déjà exactes). Wording honnête : ce compteur ne
  // promet un gain que pour ce qui est DANS le monitor.
  const variantsWithOrders = new Set();
  const variantsNeedingCost = new Set();
  for (const r of rows) {
    if (!r.variant_id) continue;                       // variante supprimée → inconfirmable
    variantsWithOrders.add(r.variant_id);
    if (r.cost_source === "estimated" || r.cost_source === "missing") variantsNeedingCost.add(r.variant_id);
  }
  const costCompletion = {
    needing:  variantsNeedingCost.size,   // numérateur (variantes à confirmer/renseigner)
    total:    variantsWithOrders.size,    // dénominateur (variantes avec commandes)
  };

  // Totaux GLOBAUX (à n'afficher que mono-devise — la couche UI gate sur multiCurrency).
  const totals = {
    net_revenue: valid.reduce((s, r) => s + num(r.line_net_revenue), 0),
    net_margin:  valid.reduce((s, r) => s + num(r.line_net_margin), 0),
    orders:      new Set(valid.map((r) => r.order_id)).size,
  };

  return {
    byProduct, byDay,
    unprofitableProducts, unprofitableCount: unprofitableProducts.length,
    missingCostRows, missingCount: missingCostRows.length,
    currencies, multiCurrency,
    totals, validCount: valid.length,
    costCompletion,
  };
}
