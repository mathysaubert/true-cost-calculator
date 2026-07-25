// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU UI Monitor — agrégats d'historique (app/lib/orderHistory.js, PUR)
//  Asserts sur les SORTIES de la fonction pure (pas le rendu). Aucune marge recalculée :
//  uniquement regroupements + sommes des colonnes order_margins stockées.
//  Pour lancer : node tests/lot7_order_history.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { aggregateOrderMargins, formatMoney, lineBreakdown, groupLinesByFingerprint, computeCostReliability } from "../app/lib/orderHistory.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const approx = (a, b, eps = 0.005) => Math.abs(a - b) < eps; // = "au centime"

// Fabrique une ligne order_margins (valeurs déjà calculées par engine.js à l'ingestion).
const row = (o) => ({
  shop_domain: "s", order_id: o.order, line_item_id: o.line ?? o.order + "-L",
  product_id: o.product ?? null, order_created_at: o.day ?? "2026-06-10T10:00:00Z",
  effective_qty: o.qty ?? 1, line_net_revenue: o.rev ?? 0, line_net_margin: o.margin ?? 0,
  cost_source: o.source ?? "confirmed", currency_code: o.cur ?? "USD",
});

// ── [A] Rentable globalement malgré 1 commande à perte → PAS marqué non rentable ──
console.log("\n── [A] agrégat par produit (1 commande à perte n'invalide pas le produit) ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O1", product: "P1", rev: 100, margin: 40 }),
    row({ order: "O2", product: "P1", rev: 100, margin: -10 }), // commande à perte
    row({ order: "O3", product: "P1", rev: 100, margin: 30 }),
  ]);
  const p1 = a.byProduct.find(p => p.product_id === "P1");
  ok(p1.net_margin === 60, `Σ marge P1 = 60 (${p1.net_margin})`);
  ok(p1.orders === 3, `3 commandes distinctes (${p1.orders})`);
  ok(p1.unprofitable === false, "P1 NON marqué à perte (jugé par produit, pas par ligne)");
  ok(a.unprofitableCount === 0, "0 produit à perte");
}

// ── [A] Produit globalement à perte → marqué non rentable ──
console.log("\n── [A] produit globalement à perte ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O4", product: "P2", rev: 50, margin: -20 }),
    row({ order: "O5", product: "P2", rev: 50, margin: -5 }),
  ]);
  const p2 = a.byProduct.find(p => p.product_id === "P2");
  ok(p2.net_margin === -25 && p2.unprofitable === true, `P2 Σ marge -25 → à perte (${p2.net_margin})`);
  ok(a.unprofitableCount === 1 && a.unprofitableProducts[0].product_id === "P2", "compteur = 1 produit à perte");
}

// ── [C] cost_source='missing' → exclu des agrégats/byDay, présent dans missingCostRows ──
console.log("\n── [C] coûts manquants exclus des sommes ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O6", product: "P1", rev: 100, margin: 40 }),
    row({ order: "O7", product: "P3", source: "missing", margin: null, rev: null }),
  ]);
  ok(a.missingCount === 1, "1 ligne missing isolée");
  ok(!a.byProduct.some(p => p.product_id === "P3"), "P3 (missing) absent des agrégats");
  ok(a.byProduct.length === 1 && a.byProduct[0].product_id === "P1", "seul P1 agrégé");
  ok(a.totals.net_margin === 40, "Σ marge = 40 (missing non compté)");
}

// ── [B] 2 jours distincts → byDay a 2 entrées, sommes par jour ──
console.log("\n── [B] agrégat par jour (UTC) ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O8",  product: "P1", rev: 100, margin: 40, day: "2026-06-10T08:00:00Z" }),
    row({ order: "O9",  product: "P1", rev: 50,  margin: 10, day: "2026-06-10T20:00:00Z" }), // même jour
    row({ order: "O10", product: "P1", rev: 80,  margin: 20, day: "2026-06-11T09:00:00Z" }),
  ]);
  ok(a.byDay.length === 2, `2 jours (${a.byDay.length})`);
  const d10 = a.byDay.find(d => d.day === "2026-06-10");
  const d11 = a.byDay.find(d => d.day === "2026-06-11");
  ok(d10.net_revenue === 150 && d10.net_margin === 50, `10/06 : CA 150, marge 50 (${d10.net_revenue}/${d10.net_margin})`);
  ok(d11.net_revenue === 80 && d11.net_margin === 20, `11/06 : CA 80, marge 20`);
  ok(a.byDay[0].day < a.byDay[1].day, "byDay trié chronologiquement");
}

// ── [edge] effective_qty=0 (entièrement remboursé) → contribue 0, pas de perte fictive ──
console.log("\n── [edge] effective_qty=0 ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O11", product: "P4", qty: 0, rev: 0, margin: 0 }),
  ]);
  const p4 = a.byProduct.find(p => p.product_id === "P4");
  ok(p4.effective_qty === 0 && p4.net_margin === 0, "qty 0, marge 0");
  ok(p4.unprofitable === false, "marge 0 → PAS à perte (pas de perte inventée)");
}

// ── [edge] CA net = 0 → marginPct null (pas de division par zéro) ──
console.log("\n── [edge] CA net = 0 → % marge — ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O12", product: "P5", rev: 0, margin: 0 }),
  ]);
  ok(a.byProduct[0].marginPct === null, "marginPct null quand CA net = 0");
}

// ── [edge] product_id null → groupé sous clé neutre, pas de crash ──
console.log("\n── [edge] product_id null ──");
{
  const a = aggregateOrderMargins([ row({ order: "O13", product: null, rev: 10, margin: 5 }) ]);
  ok(a.byProduct.length === 1 && a.byProduct[0].product_id === null, "produit null regroupé sans crash");
}

// ── [LISTE] multi-devises → flag, jamais de somme à l'aveugle ──
console.log("\n── [LISTE] multi-devises signalé ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O14", product: "P1", rev: 100, margin: 40, cur: "USD" }),
    row({ order: "O15", product: "P6", rev: 90,  margin: 30, cur: "EUR" }),
  ]);
  ok(a.multiCurrency === true && a.currencies.length === 2, `multiCurrency=true (${a.currencies.join(",")})`);
}

// ── [DEVISE] formatMoney suit currency_code, pas l'euro codé en dur ──
console.log("\n── [DEVISE] format selon la vraie devise ──");
{
  const usd = formatMoney(1200, "USD");
  const eur = formatMoney(1200, "EUR");
  const gbp = formatMoney(1200, "GBP");
  ok(usd.includes("$") && !usd.includes("US"), `USD → symbole court $ sans "US" (${usd})`);
  ok(eur.includes("€"), `EUR → € (${eur})`);
  ok(gbp.includes("£"), `GBP → £ (${gbp})`);
  ok(usd !== eur && eur !== gbp, "devises formatées distinctement");
  ok(formatMoney(729.27, "USD").includes("729,27"), "montant préservé au centime (729,27)");
  ok(!formatMoney(50, null).includes("€") && !formatMoney(50, "MIXED").includes("€"), "devise nulle/mixte → pas de faux symbole €");
  // devise inconnue (bien formée mais hors ICU) → ne casse pas, renvoie une chaîne avec le code
  const xyz = formatMoney(50, "XYZ");
  ok(typeof xyz === "string" && xyz.length > 0 && xyz.includes("XYZ"), `devise inconnue 'XYZ' ne casse pas (${xyz})`);
}

// ── [edge] vide → sorties vides propres, pas de crash ──
console.log("\n── [edge] entrée vide ──");
{
  const a = aggregateOrderMargins([]);
  ok(a.byProduct.length === 0 && a.byDay.length === 0 && a.unprofitableCount === 0 && a.missingCount === 0, "tout vide, aucun crash");
}

// Ligne order_margins COMPLÈTE (toutes colonnes stockées) pour le dépli auditable.
const frow = (o) => ({
  shop_domain: "s", order_id: o.order, line_item_id: o.line ?? o.order + "-L",
  product_id: o.product ?? null, variant_id: o.variant ?? null,
  order_created_at: o.day ?? "2026-06-20T10:00:00Z", currency_code: o.cur ?? "USD",
  quantity: o.q ?? 1, refunded_qty: o.rq ?? 0, effective_qty: o.eq ?? 1,
  net_unit_revenue: o.nur ?? 0, unit_net_margin: o.unm ?? 0,
  line_net_revenue: o.lnr ?? 0, line_net_margin: o.lnm ?? 0,
  allocated_fixed_fee: o.fee ?? 0, cost_source: o.source ?? "confirmed",
  cost_snapshot_json: o.snap ?? null,
});

// ── [BREAKDOWN] #1001 : somme des postes STOCKÉS = cible au centime (par ligne) ──
// Preuve de référence : Snowboard Hydrogen 600$ ×3, 1 remboursé (eq 2). unit 364,76 ;
// line = 364,76×2 − 0,25 = 729,27. AUCUN poste recalculé : que des valeurs stockées.
console.log("\n── [BREAKDOWN] dépli ligne #1001 réconcilie au centime ──");
{
  const r1001 = frow({
    order: "gid://shopify/Order/1001", product: "P-snow", variant: "V-hydrogen",
    q: 3, rq: 1, eq: 2, nur: 600, unm: 364.76, lnr: 1200, lnm: 729.27, fee: 0.25,
    source: "confirmed",
    snap: { prix_achat: 214.24, port_entrant: 0, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Sport", source: "confirmed" },
  });
  const lb = lineBreakdown(r1001);
  ok(approx(lb.unit_net_margin * lb.effective_qty - lb.allocated_fixed_fee, lb.line_net_margin),
     `marge : unit×eq − fixe = line (${(lb.unit_net_margin * lb.effective_qty - lb.allocated_fixed_fee).toFixed(2)} = ${lb.line_net_margin})`);
  ok(approx(lb.line_net_margin, 729.27), "cible line_net_margin = 729,27 (stockée)");
  ok(approx(lb.net_unit_revenue * lb.effective_qty, lb.line_net_revenue),
     `revenu : nur×eq = line (${(lb.net_unit_revenue * lb.effective_qty).toFixed(2)} = ${lb.line_net_revenue})`);
  ok(lb.refunded_qty === 1 && lb.effective_qty === 2, "mécanique D4 : 1 remboursé → eq 2 (pas un poste €)");
  ok(lb.snapshot && lb.snapshot.prix_achat === 214.24, "snapshot figé exposé en contexte (intrants saisis)");
}

// ── [F2 MULTI-SNAPSHOTS] 1 produit, 2 commandes, coûts gelés DIFFÉRENTS ──
// Le dépli vit au niveau LIGNE : 2 lignes, chacune SON snapshot, chacune réconcilie.
// Un seul breakdook produit serait faux pour deux structures de coût → interdit.
console.log("\n── [F2] multi-snapshots : dépli par ligne, jamais fondu ──");
{
  const a = aggregateOrderMargins([
    frow({ order: "OA", product: "P-multi", variant: "V-m", q: 2, eq: 2, nur: 20, unm: 5, lnr: 40, lnm: 9.90, fee: 0.10,
           snap: { prix_achat: 10, port_entrant: 1, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Sport", source: "confirmed" } }),
    frow({ order: "OB", product: "P-multi", variant: "V-m", q: 1, eq: 1, nur: 20, unm: 4, lnr: 20, lnm: 3.95, fee: 0.05,
           snap: { prix_achat: 12, port_entrant: 1, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Sport", source: "confirmed" } }),
  ]);
  const p = a.byProduct.find(x => x.product_id === "P-multi");
  ok(p.lines.length === 2, `2 lignes dépliables (${p.lines.length})`);
  ok(p.lines[0].snapshot.prix_achat !== p.lines[1].snapshot.prix_achat, "chaque ligne garde SON snapshot (10 ≠ 12)");
  ok(p.lines.every(lb => approx(lb.unit_net_margin * lb.effective_qty - lb.allocated_fixed_fee, lb.line_net_margin)),
     "chaque ligne réconcilie au centime indépendamment");
  ok(approx(p.net_margin, 9.90 + 3.95), `Σ marge produit = somme des lignes (${p.net_margin.toFixed(2)})`);
}

// ── [F4 CTA] compteur EN VARIANTES : 1 produit, 2 variantes, 1 confirmée → "1 sur 2" ──
console.log("\n── [F4] CTA complétude en variantes (jamais 1 sur 1) ──");
{
  const a = aggregateOrderMargins([
    frow({ order: "OC1", product: "P-cta", variant: "V1", eq: 1, nur: 30, unm: 8, lnr: 30, lnm: 8, source: "confirmed" }),
    frow({ order: "OC2", product: "P-cta", variant: "V2", eq: 1, nur: 30, unm: 6, lnr: 30, lnm: 6, source: "estimated" }),
  ]);
  ok(a.costCompletion.needing === 1, `numérateur = 1 variante à confirmer (${a.costCompletion.needing})`);
  ok(a.costCompletion.total === 2, `dénominateur = 2 variantes avec commandes (${a.costCompletion.total})`);
  ok(!(a.costCompletion.needing === a.costCompletion.total), "→ '1 sur 2', JAMAIS '1 sur 1'");
}

// ── [F3 CTA] missing compté (variante avec commande mais coût manquant) ──
console.log("\n── [F3] CTA : variante 'missing' comptée au numérateur ET dénominateur ──");
{
  const a = aggregateOrderMargins([
    frow({ order: "OD1", product: "P-d", variant: "Vc", eq: 1, nur: 30, unm: 8, lnr: 30, lnm: 8, source: "confirmed" }),
    frow({ order: "OD2", product: "P-d", variant: "Vm", lnm: null, source: "missing" }),
  ]);
  ok(a.costCompletion.total === 2, `dénominateur inclut la variante missing (${a.costCompletion.total})`);
  ok(a.costCompletion.needing === 1, `numérateur = la variante missing (${a.costCompletion.needing})`);
  ok(a.missingCount === 1, "ligne missing toujours isolée des agrégats");
}

// ── [F9] graphe < 2 points : un seul jour → byDay length 1 (état explicite côté UI) ──
console.log("\n── [F9] graphe < 2 points (donnée) ──");
{
  const a = aggregateOrderMargins([
    frow({ order: "OE1", product: "P-e", variant: "Ve", eq: 1, nur: 30, unm: 8, lnr: 30, lnm: 8, day: "2026-06-21T08:00:00Z" }),
    frow({ order: "OE2", product: "P-e", variant: "Ve", eq: 1, nur: 30, unm: 8, lnr: 30, lnm: 8, day: "2026-06-21T20:00:00Z" }),
  ]);
  ok(a.byDay.length === 1, `1 seule journée → byDay length 1 (déclenche le message F9) (${a.byDay.length})`);
}

// ── [K] Postes de coût agrégés par produit (poste_unité × effective_qty) + breakdownAvailable ──
console.log("\n── [K] agrégation des postes de coût (BUG 1 : somme de valeurs stockées) ──");
{
  const bd = (o) => ({ coutRendu: o.cr ?? 0, douane: o.d ?? 0, tvaNetCost: o.tva ?? 0, shopifyCost: o.sh ?? 0, stripeCost: o.st ?? 0, retoursCost: o.re ?? 0, fraisFixes: o.ff ?? 0 });
  const brow = (o) => ({ ...row(o), margin_breakdown_json: o.bd });
  const a = aggregateOrderMargins([
    // 2 unités × (douane 3 / shopify 1) + 1 unité × (douane 3 / shopify 1) = douane 9, shopify 3
    brow({ order: "OK1", product: "PK", qty: 2, rev: 40, margin: -5, bd: bd({ cr: 20, d: 3, sh: 1 }) }),
    brow({ order: "OK2", product: "PK", qty: 1, rev: 20, margin: -2, bd: bd({ cr: 20, d: 3, sh: 1 }) }),
  ]);
  const p = a.byProduct.find((x) => x.product_id === "PK");
  ok(Math.abs(p.costPosts.douane - 9) < 0.001, "douane agrégée = 3×2 + 3×1 = 9 (poste_unité × effective_qty)");
  ok(Math.abs(p.costPosts.shopifyCost - 3) < 0.001, "shopifyCost agrégé = 3");
  ok(Math.abs(p.costPosts.coutRendu - 60) < 0.001, "coutRendu agrégé = 20×3 = 60");
  ok(p.breakdownAvailable === true, "breakdownAvailable true (les lignes ont un détail)");
  // Produit SANS aucun breakdown → costPosts à 0, breakdownAvailable false (fallback mail).
  const b = aggregateOrderMargins([row({ order: "ON1", product: "PN", qty: 1, rev: 10, margin: -4 })]);
  const pn = b.byProduct.find((x) => x.product_id === "PN");
  ok(pn.breakdownAvailable === false && pn.costPosts.douane === 0, "aucun breakdown → breakdownAvailable false, postes à 0");
}

// ── [GROUP] Option A : commandes à décomposition IDENTIQUE regroupées (1 waterfall, pas N) ──
console.log("\n── [GROUP] regroupement par décomposition identique ──");
{
  const snap = { prix_achat: 10, port_entrant: 1, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Sport", source: "confirmed" };
  const a = aggregateOrderMargins([
    frow({ order: "gid://shopify/Order/1", product: "PG", variant: "V", q: 1, eq: 1, nur: 20, unm: 5, lnr: 20, lnm: 4.90, fee: 0.10, day: "2026-06-10T10:00:00Z", snap }),
    frow({ order: "gid://shopify/Order/2", product: "PG", variant: "V", q: 2, eq: 2, nur: 20, unm: 5, lnr: 40, lnm: 9.80, fee: 0.20, day: "2026-06-12T10:00:00Z", snap }),
    frow({ order: "gid://shopify/Order/3", product: "PG", variant: "V", q: 1, eq: 1, nur: 20, unm: 5, lnr: 20, lnm: 4.95, fee: 0.05, day: "2026-06-11T10:00:00Z", snap }),
  ]);
  const p = a.byProduct.find(x => x.product_id === "PG");
  ok(p.lineGroups.length === 1, `3 commandes identiques → 1 groupe (${p.lineGroups.length})`);
  ok(p.lineGroups[0].count === 3, "le groupe compte ses 3 commandes");
  ok(p.lines.length === 3, "p.lines brut conservé (3) — le regroupement n'écrase pas le détail");
  const days = p.lineGroups[0].orders.map(o => o.order_created_at.slice(0, 10));
  ok(days[0] === "2026-06-12" && days[2] === "2026-06-10", `commandes triées récentes d'abord (${days.join(",")})`);
  ok(p.lineGroups[0].orders.some(o => o.effective_qty === 2) && p.lineGroups[0].orders.some(o => o.effective_qty === 1), "ce qui VARIE (qté) reste listé par commande");
  ok(p.lineGroups[0].rep.unit_net_margin === 5, "le représentant porte la marge unitaire commune (5) — affichée une fois");
}

// ── [GROUP] décompositions DIFFÉRENTES (snapshot ≠) → groupes séparés (jamais fondus) ──
console.log("\n── [GROUP] snapshots différents → groupes séparés ──");
{
  const a = aggregateOrderMargins([
    frow({ order: "OG1", product: "PH", variant: "V", eq: 1, nur: 20, unm: 5, lnr: 20, lnm: 5, snap: { prix_achat: 10, vat_regime: "assujetti", shipping_model: "stock", source: "confirmed" } }),
    frow({ order: "OG2", product: "PH", variant: "V", eq: 1, nur: 20, unm: 4, lnr: 20, lnm: 4, snap: { prix_achat: 12, vat_regime: "assujetti", shipping_model: "stock", source: "confirmed" } }),
  ]);
  const p = a.byProduct.find(x => x.product_id === "PH");
  ok(p.lineGroups.length === 2, `coûts figés différents (10 vs 12) → 2 groupes (${p.lineGroups.length})`);
  ok(p.lineGroups.every(g => g.count === 1), "chaque groupe = 1 commande (décompositions distinctes non fondues)");
}

// ── [GROUP] empreinte STABLE : ordre des clés du snapshot indifférent ──
console.log("\n── [GROUP] sérialisation stable (ordre des clés indifférent) ──");
{
  const a = aggregateOrderMargins([
    frow({ order: "OS1", product: "PS", variant: "V", eq: 1, nur: 20, unm: 5, lnr: 20, lnm: 5, snap: { prix_achat: 10, categorie: "Sport", pays_import: "Chine" } }),
    frow({ order: "OS2", product: "PS", variant: "V", eq: 1, nur: 20, unm: 5, lnr: 20, lnm: 5, snap: { pays_import: "Chine", categorie: "Sport", prix_achat: 10 } }),
  ]);
  const p = a.byProduct.find(x => x.product_id === "PS");
  ok(p.lineGroups.length === 1, "mêmes valeurs, clés dans un ordre différent → une seule empreinte (1 groupe)");
}

// ── [GROUP] exhaustivité : Σ des commandes des groupes = nb de lignes (rien perdu, rien dupliqué) ──
console.log("\n── [GROUP] exhaustivité du regroupement ──");
{
  const g = groupLinesByFingerprint([
    lineBreakdown({ order_id: "A", line_item_id: "A-L", order_created_at: "2026-06-10T10:00:00Z", currency_code: "USD", net_unit_revenue: 20, unit_net_margin: 5, line_net_margin: 5, effective_qty: 1 }),
    lineBreakdown({ order_id: "B", line_item_id: "B-L", order_created_at: "2026-06-11T10:00:00Z", currency_code: "USD", net_unit_revenue: 20, unit_net_margin: 5, line_net_margin: 5, effective_qty: 1 }),
    lineBreakdown({ order_id: "C", line_item_id: "C-L", order_created_at: "2026-06-12T10:00:00Z", currency_code: "EUR", net_unit_revenue: 20, unit_net_margin: 5, line_net_margin: 5, effective_qty: 1 }),
  ]);
  const totalOrders = g.reduce((s, x) => s + x.count, 0);
  ok(totalOrders === 3, `Σ commandes des groupes = 3 lignes en entrée (${totalOrders})`);
  ok(g.length === 2, "USD×2 groupées, EUR séparée (devise dans l'empreinte) → 2 groupes");
  ok(g[0].mostRecent >= g[1].mostRecent, "groupes triés par commande la plus récente d'abord");
}

// ── [CENTIME] Σ colonne = total affiché — arrondi PAR LIGNE (fin de l'écart 2 centimes) ──
// Sans arrondi par ligne, un produit à lignes sous-centime affiche une marge (arrondi du brut) qui
// diffère de la somme des lignes du dépli (chacune arrondie) → la colonne « ne tombe pas juste ».
// L'invariant : ligne-au-centime → produit = Σ lignes → total = Σ produits, aux 3 niveaux, marge ET CA.
console.log("\n── [CENTIME] somme des produits = total, à 3 niveaux ──");
{
  const c2 = (v) => Math.round(v * 100) / 100;   // arrondi centime (comme l'agrégat)
  const cents = (v) => Math.round(v * 100);      // centimes entiers → comparaison exacte
  const a = aggregateOrderMargins([
    // Produit PΣ : 3 lignes à 10,006 (sous-centime). Chacune arrondie = 10,01 → 30,03 (PAS 30,02 = round(30,018)).
    frow({ order: "gid://shopify/Order/9001", product: "PΣ", variant: "V", q: 1, eq: 1, nur: 10.006, unm: 10.006, lnr: 10.006, lnm: 10.006 }),
    frow({ order: "gid://shopify/Order/9002", product: "PΣ", variant: "V", q: 1, eq: 1, nur: 10.006, unm: 10.006, lnr: 10.006, lnm: 10.006 }),
    frow({ order: "gid://shopify/Order/9003", product: "PΣ", variant: "V", q: 1, eq: 1, nur: 10.006, unm: 10.006, lnr: 10.006, lnm: 10.006 }),
    // Produit PΩ : 2 lignes à 5,006 → 5,01 chacune → 10,02. (rend le niveau 2 non trivial : 2 produits)
    frow({ order: "gid://shopify/Order/9004", product: "PΩ", variant: "W", q: 1, eq: 1, nur: 5.006, unm: 5.006, lnr: 5.006, lnm: 5.006 }),
    frow({ order: "gid://shopify/Order/9005", product: "PΩ", variant: "W", q: 1, eq: 1, nur: 5.006, unm: 5.006, lnr: 5.006, lnm: 5.006 }),
  ]);
  const p = a.byProduct.find(x => x.product_id === "PΣ");
  // Niveau 1 : Σ des lignes du dépli (affichées au centime) = marge produit.
  const depliMargin = p.lineGroups.reduce((s, g) => s + g.orders.reduce((ss, o) => ss + c2(o.line_net_margin), 0), 0);
  ok(cents(depliMargin) === cents(p.net_margin), `niveau 1 : Σ lignes dépli = marge produit PΣ (${p.net_margin})`);
  ok(cents(p.net_margin) === 3003, `PΣ = 3 × 10,006 arrondis à la ligne = 30,03, pas 30,02 (${p.net_margin})`);
  // Niveau 2 : Σ produits = total (marge nette), sur 2 produits.
  const sumProdMargin = a.byProduct.reduce((s, x) => s + x.net_margin, 0);
  ok(cents(sumProdMargin) === cents(a.totals.net_margin), `niveau 2 : Σ produits = total marge (${a.totals.net_margin})`);
  ok(cents(a.totals.net_margin) === 4005, `total = 30,03 + 10,02 = 40,05 (${a.totals.net_margin})`);
  // Niveau 3 : idem pour le CA net.
  const sumProdRev = a.byProduct.reduce((s, x) => s + x.net_revenue, 0);
  ok(cents(sumProdRev) === cents(a.totals.net_revenue), `niveau 3 : Σ produits = total CA net (${a.totals.net_revenue})`);
}

// ── [R] computeCostReliability : compteur de fiabilité (point 4, option A) ──────────────────
// X % = CA confirmed+imported / CA chiffré (confirmed+imported+estimated). missing hors % (CA null),
// comptés à part. Top-3 « à compléter » par UNITÉS vendues, missing prioritaire. Aucun recalcul.
console.log("\n── [R] computeCostReliability : X %, missing à part, top-3 par unités ──");
{
  // Mélange : confirmed 60 + imported 40 (= 100 « sûrs »), estimated 100 (chiffré mais non sûr) → 100/200 = 50 %.
  const rel = computeCostReliability([
    row({ order: "O1", product: "P1", rev: 60, source: "confirmed", qty: 2 }),
    row({ order: "O2", product: "P2", rev: 40, source: "imported",  qty: 1 }),
    row({ order: "O3", product: "P3", rev: 100, source: "estimated", qty: 3 }),
    // missing : CA null (comme à l'ingestion) → hors dénominateur, compté à part.
    { shop_domain: "s", order_id: "O4", product_id: "P4", effective_qty: 9, line_net_revenue: null, line_net_margin: null, cost_source: "missing" },
  ]);
  ok(Math.round(rel.reliabilityPct) === 50, `X % = 50 (100 sûrs / 200 chiffrés) — reçu ${Math.round(rel.reliabilityPct)}`);
  ok(rel.confirmedRevenue === 100 && rel.pricedRevenue === 200, "dénominateur = chiffré (200), numérateur = confirmé+importé (100)");
  ok(rel.missingCount === 1 && rel.missingProducts[0].product_id === "P4", "missing compté à part (P4), jamais dans le %");
  // Top-3 par unités : P4(9) > P3(3) ; P1/P2 sont confirmés/importés → hors « à compléter ».
  ok(rel.topIncomplete.length === 2, "top à compléter = seulement estimated+missing (P3, P4)");
  ok(rel.topIncomplete[0].product_id === "P4" && rel.topIncomplete[0].status === "missing", "1er = P4 (9 unités), status missing (marge inconnue)");
  ok(rel.topIncomplete[1].product_id === "P3" && rel.topIncomplete[1].status === "estimated", "2e = P3 (3 unités), status estimated");

  // Cas TOUT-MISSING : aucune ligne chiffrée → pct null (l'UI montre l'invite, pas un %).
  const allMissing = computeCostReliability([
    { shop_domain: "s", order_id: "M1", product_id: "P1", effective_qty: 5, line_net_revenue: null, line_net_margin: null, cost_source: "missing" },
    { shop_domain: "s", order_id: "M2", product_id: "P2", effective_qty: 2, line_net_revenue: null, line_net_margin: null, cost_source: "missing" },
  ]);
  ok(allMissing.reliabilityPct === null, "tout-missing → reliabilityPct null (pas de division 0/0)");
  ok(allMissing.missingCount === 2 && allMissing.hasSales === true, "tout-missing → 2 produits à renseigner, ventes présentes");

  // Borne 100 % : aucune ligne estimated/missing → pct 100, rien à compléter.
  const full = computeCostReliability([ row({ order: "F1", product: "P1", rev: 80, source: "confirmed" }) ]);
  ok(Math.round(full.reliabilityPct) === 100 && full.topIncomplete.length === 0 && full.missingCount === 0, "100 % → aucun produit à compléter");

  // Aucune vente : pct null, hasSales false (l'UI montre « synchronisez »).
  const none = computeCostReliability([]);
  ok(none.reliabilityPct === null && none.hasSales === false && none.missingCount === 0, "aucune vente → null, hasSales false");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 7 (historique monitor) : ✓ Tous les tests passent"
  : ` BILAN LOT 7 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
