// ── Réglages > Coûts produits (F4-D1a, X3) — PUR ──────────────────────────────────────────────
// Portage de l'onglet « Suivi des coûts » de l'écran classique : la logique reste celle de
// variantCosts.js / customsClassification.js (testées aux lots 1, 5, 20) ; ce module ne fait que
// grouper, lire les formulaires et traduire les erreurs en champs.
import { productCostStatus, VAT_REGIMES, SHIPPING_MODELS, PAYS_KEYS, CATEGORIE_KEYS } from "./variantCosts.js";
import { validateCostFields } from "./costsCsv.js";

export const NUMBER_FIELDS = ["prix_achat", "port_entrant", "qty_par_lot", "cout_emballage"];
export const ENUM_FIELDS = { vat_regime: VAT_REGIMES, shipping_model: SHIPPING_MODELS, pays_import: PAYS_KEYS, categorie: CATEGORIE_KEYS };
export const COST_FIELDS = [...NUMBER_FIELDS, ...Object.keys(ENUM_FIELDS)];
export const STATUS_FILTERS = ["all", "todo", "partial", "complete"];
const MERCHANT = new Set(["confirmed", "imported"]);
export const isMerchant = (r) => MERCHANT.has(r?.source);

// rows : sortie de buildCostRowsForDisplay → produits { product_id, title, variantRows, status, customs }.
export function groupProducts(rows = []) {
  const map = new Map();
  for (const r of rows) {
    const key = r.product_id ?? r.variant_id;
    let g = map.get(key);
    if (!g) { g = { product_id: r.product_id, title: r.product_title, variantRows: [] }; map.set(key, g); }
    g.variantRows.push(r);
  }
  return [...map.values()].map((g) => {
    const st = productCostStatus(g.variantRows);
    const stored = g.variantRows.filter((r) => r.stored);
    const cats = new Set(stored.map((r) => r.categorie));
    return {
      ...g,
      status: { key: st.key, done: st.done, total: st.total },
      // Douane : à confirmer si au moins une variante stockée n'a pas customs_confirmed (seules les
      // variantes stockées peuvent être confirmées : confirmCustomsCategory met à jour variant_costs).
      customs: stored.length ? { estimated: stored.some((r) => r.customs_confirmed !== true), divergent: cats.size > 1, category: cats.size === 1 ? [...cats][0] : null } : null,
    };
  }).sort((a, b) => String(a.title ?? "").localeCompare(String(b.title ?? "")));
}

export function statusCounts(products = []) {
  const c = { all: products.length, todo: 0, partial: 0, complete: 0 };
  for (const p of products) c[p.status.key] = (c[p.status.key] ?? 0) + 1;
  return c;
}

export const filterProducts = (products = [], status = "all") => (status === "all" || !STATUS_FILTERS.includes(status) ? products : products.filter((p) => p.status.key === status));

// Formulaire d'un produit : pour chaque index i, vid_i + champs <champ>_i. Arbitrage du 2026-09-25
// (option c) : un champ de coût laissé VIDE = non renseigné → la variante n'est pas enregistrée et
// reste à compléter ; jamais la suggestion enregistrée comme confirmée. Exception : quantité par lot
// vide = 1. Une variante déjà renseignée dont on vide un champ garde ses valeurs enregistrées.
export const EMPTY_DEFAULTS = { qty_par_lot: "1" };
export function parseProductForm(form, { productId = null } = {}) {
  const rows = [], errors = [], skipped = [];
  for (let i = 0; i < 500; i++) {
    const vid = form.get(`vid_${i}`);
    if (vid == null) break;
    const raw = { variant_id: String(vid) };
    const empty = [];
    for (const f of COST_FIELDS) {
      const v = form.get(`${f}_${i}`);
      const s = v == null ? "" : String(v).trim();
      if (s === "" && EMPTY_DEFAULTS[f] != null) raw[f] = EMPTY_DEFAULTS[f];
      else if (s === "") empty.push(f);
      else raw[f] = s;
    }
    if (empty.length) { skipped.push({ variant_id: raw.variant_id, index: i, empty }); continue; }
    // Règle du 2026-09-26 : 0 saisi = vrai 0 (prix d'achat compris) ; vide = non renseigné (ci-dessus).
    const { value, issues } = validateCostFields(raw);
    if (issues.length) errors.push({ variant_id: raw.variant_id, index: i, fields: [...new Set(issues.map((x) => x.field))], issues });
    else rows.push({ variant_id: raw.variant_id, product_id: productId, value });
  }
  return { rows, errors, skipped };
}

