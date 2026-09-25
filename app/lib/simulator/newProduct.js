// ── S3 — Simulateur, mode « Nouveau produit » (X5a, décision 18) — PUR ─────────────────────────
// Héritier du calculateur de l'écran classique, sans le « + 4,5 % » codé en dur ni table
// `calculations`. Coût rendu par econ/line.js (landedCostUnit → engine.computeLandedCost pour un
// marchand UE, droits génériques sinon) ; TVA de vente au taux du pays du marchand (econ/vat.js).
// Tout est UNITAIRE (une commande = une unité) et « toutes choses égales par ailleurs ».
import { landedCostUnit } from "../econ/line.js";
import { vatRateFor } from "../econ/vat.js";

export const NEW_PRODUCT_FIELDS = [
  { id: "price_ttc",      kind: "money", required: true },
  { id: "prix_achat",     kind: "money", required: true },
  { id: "port_entrant",   kind: "money" },
  { id: "qty_par_lot",    kind: "int" },
  { id: "duty_rate_pct",  kind: "pct" },
  { id: "packaging",      kind: "money" },
  { id: "shipping",       kind: "money" },
  { id: "payment_pct",    kind: "pct" },
  { id: "payment_fixed",  kind: "money" },
  { id: "return_rate_pct", kind: "pct" },
  { id: "return_cost",    kind: "money" },
];
export const NEW_PRODUCT_ENUMS = ["vat_regime", "shipping_model", "categorie"];
const num = (v) => { if (v == null || v === "") return null; const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// Valeurs de départ tirées des réglages CONFIRMÉS (S6) : jamais une valeur non confirmée.
// Partagé par le mode Nouveau produit (S3) et l'audit catalogue (D1c).
export function unitDefaultsFromSettings(settings = {}) {
  const sr = settings.shipping_cost_rules ?? {};
  const gw = (Array.isArray(settings.gateway_fee_rules) ? settings.gateway_fee_rules : []).find((r) => r?.confirmed === true) ?? null;
  const raw = {
    vat_regime: settings.vat_regime ?? null, shipping_model: settings.shipping_model ?? null,
    packaging: settings.packaging_cost_per_order ?? null,
    shipping: sr.confirmed === true && sr.default != null ? sr.default : null,
    return_cost: settings.return_cost_per_return ?? null,
    payment_pct: gw?.pct ?? null, payment_fixed: gw?.fixed ?? null,
  };
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
}

// inputs : valeurs d'écran (chaînes ou nombres) ; shopCountryCode : pays du marchand.
// Options (audit D1c) : inputs.prices_include_tax === false ⇒ le prix saisi est HT ;
// inputs.landed_cost_override ⇒ coût rendu saisi directement (econ/line.js, méthode « override »).
export function unitEconomics({ inputs = {}, shopCountryCode = null, now = new Date() } = {}) {
  const v = Object.fromEntries(NEW_PRODUCT_FIELDS.map((f) => [f.id, num(inputs[f.id])]));
  const missing = NEW_PRODUCT_FIELDS.filter((f) => f.required && !(v[f.id] > 0)).map((f) => f.id);
  if (missing.length) return { ok: false, missing };
  const vatRegime = inputs.vat_regime === "franchise" ? "franchise" : "assujetti";
  const landed = landedCostUnit({
    costRow: { prix_achat: v.prix_achat, port_entrant: v.port_entrant ?? 0, qty_par_lot: v.qty_par_lot ?? 1, vat_regime: vatRegime, shipping_model: inputs.shipping_model === "stock" ? "stock" : "dropshipping", categorie: inputs.categorie ?? "Autre", duty_rate_pct: v.duty_rate_pct ?? 0, landed_cost_override: num(inputs.landed_cost_override) },
    shopCountryCode, now,
  });
  const saleVat = vatRegime === "franchise" ? 0 : vatRateFor({ countryCode: shopCountryCode, categorie: inputs.categorie }) ?? 0;
  const exclTax = inputs.prices_include_tax === false || inputs.prices_include_tax === "false";
  const priceTtc = exclTax ? v.price_ttc * (1 + saleVat) : v.price_ttc;
  const priceHt = exclTax ? v.price_ttc : v.price_ttc / (1 + saleVat);
  const fees = priceTtc * (v.payment_pct ?? 0) / 100 + (v.payment_fixed ?? 0);
  const returnRate = (v.return_rate_pct ?? 0) / 100;
  // Retours : CA perdu (prix HT remboursé) + coût par retour, pondérés par le taux ; produit non
  // récupéré (hypothèse prudente, affichée).
  const returns = returnRate * (priceHt + (v.return_cost ?? 0));
  const cm1 = priceHt - landed.coutRendu;
  const cm2 = cm1 - (v.packaging ?? 0) - (v.shipping ?? 0) - fees - returns;
  return {
    ok: true,
    price_ttc: round2(priceTtc), price_ht: round2(priceHt), sale_vat_rate: saleVat,
    landed: round2(landed.coutRendu), components: Object.fromEntries(Object.entries(landed.components).map(([k, x]) => [k, round2(x)])), method: landed.method,
    packaging: round2(v.packaging ?? 0), shipping: round2(v.shipping ?? 0), payment_fees: round2(fees), returns: round2(returns),
    cm1: round2(cm1), cm2: round2(cm2), cm1_pct: priceHt > 0 ? (cm1 / priceHt) * 100 : null, cm2_pct: priceHt > 0 ? (cm2 / priceHt) * 100 : null,
  };
}

// Prix de vente TTC minimum pour une CM2 % cible (bissection ; la CM2 % croît avec le prix).
export function minPriceFor({ inputs = {}, shopCountryCode = null, targetPct, now = new Date(), lo = 0.01, hi = 100000, iterations = 60 } = {}) {
  const t = num(targetPct);
  if (t == null || t >= 100) return { reached: false, reason: "invalid" };
  const at = (p) => unitEconomics({ inputs: { ...inputs, price_ttc: p }, shopCountryCode, now });
  const fHi = at(hi);
  if (!fHi.ok) return { reached: false, reason: "missing", missing: fHi.missing?.filter((m) => m !== "price_ttc") };
  if (fHi.cm2_pct < t) return { reached: false, reason: "out_of_range" };
  let a = lo, b = hi;
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2, r = at(m);
    if (r.cm2_pct >= t) b = m; else a = m;
  }
  const price = Math.ceil(b * 100) / 100;
  return { reached: true, price, result: at(price) };
}
