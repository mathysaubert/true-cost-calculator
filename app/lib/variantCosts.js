// ── Brique A — coûts par variante : helpers PURS (estimation, validation, CSV) ──
// Code PUR (aucun React/Shopify/Supabase). Importé par la route ET testable Node.
// NB : ce module ne calcule AUCUNE marge. Il prépare/valide les COÛTS d'entrée ;
// la marge reste exclusivement produite par engine.js (brique B). Il réutilise les
// constantes du moteur (SHIPPING_ESTIMATES, CUSTOMS_RATES) — source unique, pas de copie.
import { SHIPPING_ESTIMATES, CUSTOMS_RATES } from "./engine.js";

// Domaines de valeurs autorisés (source unique = clés du moteur).
export const PAYS_KEYS       = Object.keys(SHIPPING_ESTIMATES);          // Chine, Inde, Turquie, UE, Autre
export const CATEGORIE_KEYS  = Object.keys(CUSTOMS_RATES);              // Textile, Sport, … , Autre
export const VAT_REGIMES     = ["assujetti", "franchise"];
export const SHIPPING_MODELS = ["dropshipping", "stock"];
export const COST_SOURCES    = ["estimated", "confirmed", "imported"];

// Colonnes du CSV d'import/export (ordre = ordre du modèle exporté).
export const CSV_COLUMNS = [
  "variant_id", "product_title", "variant_title",
  "prix_achat", "port_entrant", "qty_par_lot", "cout_emballage",
  "vat_regime", "shipping_model", "pays_import", "categorie",
];
// Colonnes réellement persistées (product_title/variant_title = affichage seulement).
const PERSISTED_COLUMNS = [
  "prix_achat", "port_entrant", "qty_par_lot", "cout_emballage",
  "vat_regime", "shipping_model", "pays_import", "categorie",
];

// ── Catégorisation auto (déplacée depuis run_audit pour réemploi, sans duplication) ──
// Mappe un texte → catégorie app par mots-clés. Priorité appelant :
// nom catégorie Shopify Standard → productType → titre. null si rien ne matche.
export function matchCategory(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().trim();
  if (!t) return null;
  if (/textile|shirt|t-shirt|tee|vêtement|clothing|robe|pantalon|chemise|jean|lingerie|mode|fashion/.test(t)) return "Textile";
  if (/electro|électro|tech|phone|ordinateur|computer|gadget|audio|video|gaming|camera/.test(t)) return "Électronique";
  if (/cosmeti|cosmét|beauty|beauté|skincare|soin|parfum|makeup|maquillage/.test(t)) return "Cosmétique";
  if (/sport|fitness|gym|yoga|outdoor|running|cycling|pilates/.test(t)) return "Sport";
  if (/aliment|food|nutrition|supplement|snack|boisson|drink|épicerie/.test(t)) return "Alimentation";
  if (/maroquin|leather|wallet|portefeuille|bagage|luggage/.test(t)) return "Maroquinerie";
  if (/jouet|toy|enfant|kid|bébé|baby/.test(t)) return "Jouets";
  if (/mobil|furniture|meuble|déco|deco|maison|jardin|garden/.test(t)) return "Mobilier";
  if (/livre|book|roman|magazine/.test(t)) return "Livres";
  if (/accessoir|accessory|bijou|jewelry|jewel|montre|watch|bracelet|collier|bague/.test(t)) return "Accessoires";
  return null;
}
export function shopifyTypeToCategory(categoryName, productType, title) {
  return matchCategory(categoryName) ?? matchCategory(productType) ?? matchCategory(title);
}

// ── Estimation auto d'une variante ──────────────────────────────────────────
// prix_achat ← inventoryItem.unitCost (réel) si présent ; categorie ← mapping Shopify ;
// port ← SHIPPING_ESTIMATES[pays boutique] ; vat/shipping ← réglages boutique.
// Seuls qty_par_lot (1), cout_emballage (0) et le pays sont des défauts neutres.
// source = 'estimated' : un coût deviné, JAMAIS présenté comme confirmé.
export function estimateVariantCost({ unitCost, categoryName, productType, title, defaultCountry, vatRegime, shippingModel } = {}) {
  const pays = PAYS_KEYS.includes(defaultCountry) ? defaultCountry : "Chine";
  const cost = parseFloat(unitCost);
  return {
    prix_achat:     Number.isFinite(cost) && cost > 0 ? cost : 0,
    port_entrant:   SHIPPING_ESTIMATES[pays] ?? 5,
    qty_par_lot:    1,
    cout_emballage: 0,
    vat_regime:     VAT_REGIMES.includes(vatRegime) ? vatRegime : "assujetti",
    shipping_model: SHIPPING_MODELS.includes(shippingModel) ? shippingModel : "dropshipping",
    pays_import:    pays,
    categorie:      shopifyTypeToCategory(categoryName, productType, title) ?? "Autre",
    source:         "estimated",
  };
}

// NB (ère XV) : reconcileEstimatedCost a été SUPPRIMÉ. Il réhydratait le prix_achat d'une ligne estimée
// depuis le unitCost Shopify — un chemin de RÉÉCRITURE qui n'a plus lieu d'être depuis que costs_list est
// en lecture seule (« plus jamais de pré-rempli »). Conserver du code mort qui réécrit des coûts était un
// piège d'intégrité, pas une réserve : retiré avec ses tests (cf. CHANTIERS_DETAIL, ère XV).

// ── Construction des lignes AFFICHÉES du Suivi (PUR — aucune écriture, aucun I/O) ─────────────
// Intégrité (règle d'or « plus jamais de pré-rempli », ère XV) : ce constructeur est le SEUL producteur
// de rangs de coûts et il n'a, PAR CONSTRUCTION, aucun chemin de persistance. Une variante SANS ligne
// stockée reçoit une SUGGESTION estimée (affichage / placeholder), taguée `stored:false` : jamais écrite
// en base ; seuls costs_save / costs_import_csv écrivent. Une ligne stockée fait autorité et est renvoyée
// telle quelle, taguée `stored:true`. Le tag `stored` pilote aussi l'éligibilité à la confirmation douane
// (on ne propose de confirmer que des produits réellement suivis). `storedMap` : Map(variant_id → ligne).
export function buildCostRowsForDisplay({ variants = [], storedMap, defaultCountry, vatRegime, shippingModel } = {}) {
  const map = storedMap instanceof Map ? storedMap : new Map(Object.entries(storedMap ?? {}));
  return variants.map((v) => {
    const display = {
      variant_id: v.variant_id, product_id: v.product_id,
      product_title: v.product_title, variant_title: v.variant_title, price: v.price,
    };
    const existing = map.get(v.variant_id);
    if (existing) return { ...display, ...existing, stored: true };
    const est = estimateVariantCost({
      unitCost: v.unitCost, categoryName: v.categoryName, productType: v.productType,
      title: v.product_title, defaultCountry, vatRegime, shippingModel,
    });
    return { ...display, ...est, stored: false };
  });
}

// ── Statut de complétude des coûts d'UN produit (liste du Suivi, ère XV) — PUR ───────────────
// Sur les lignes AFFICHÉES d'un produit (buildCostRowsForDisplay). « Renseigné » = source marchand
// (confirmed | imported) ; une suggestion estimée ou une variante non stockée reste « à compléter ».
//   toutes renseignées      → { key:"complete", label:"Coûts complets" }
//   aucune renseignée       → { key:"todo",     label:"À compléter" }
//   partiel                 → { key:"partial",  label:"Partiel : N variantes sur M" }
const MERCHANT_SOURCES = new Set(["confirmed", "imported"]);
export function productCostStatus(variantRows = []) {
  const total = variantRows.length;
  const done  = variantRows.filter((r) => MERCHANT_SOURCES.has(r.source)).length;
  if (total === 0)     return { key: "todo", label: "À compléter", done: 0, total: 0 };
  if (done === total)  return { key: "complete", label: "Coûts complets", done, total };
  if (done === 0)      return { key: "todo", label: "À compléter", done, total };
  return { key: "partial", label: `Partiel : ${done} ${done > 1 ? "variantes" : "variante"} sur ${total}`, done, total };
}

// ── Validation d'un jeu de coûts (saisie UI ou ligne CSV) ───────────────────
// Renvoie { value, errors } : value = objet nettoyé prêt à persister (champs
// PERSISTED_COLUMNS), errors = liste de messages lisibles (jamais d'avalage silencieux).
const MAX_AMOUNT = 100000;
function numField(raw, label, { min = 0, max = MAX_AMOUNT, integer = false }, errors) {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(n)) { errors.push(`${label} : valeur numérique requise (reçu « ${raw} »)`); return null; }
  if (n < min)            { errors.push(`${label} : doit être ≥ ${min} (reçu ${n})`); return null; }
  if (n > max)            { errors.push(`${label} : doit être ≤ ${max} (reçu ${n})`); return null; }
  if (integer && !Number.isInteger(n)) { errors.push(`${label} : doit être un entier (reçu ${n})`); return null; }
  return n;
}
function enumField(raw, label, allowed, errors) {
  const v = String(raw ?? "").trim();
  if (!allowed.includes(v)) { errors.push(`${label} : valeur invalide « ${raw} » (attendu : ${allowed.join(" | ")})`); return null; }
  return v;
}
export function validateCostRow(raw = {}) {
  const errors = [];
  const value = {
    // prix_achat parsé sans borne basse ici (min négatif large) → le contrôle d'intégrité ci-dessous
    // donne UN message unifié pour tout prix ≤ 0 (le scandale des marges gonflées « confirmées »).
    prix_achat:     numField(raw.prix_achat,     "prix_achat",     { min: -MAX_AMOUNT }, errors),
    port_entrant:   numField(raw.port_entrant,   "port_entrant",   { min: 0 }, errors),
    qty_par_lot:    numField(raw.qty_par_lot,    "qty_par_lot",    { min: 1, max: 1000000, integer: true }, errors),
    cout_emballage: numField(raw.cout_emballage, "cout_emballage", { min: 0 }, errors),
    vat_regime:     enumField(raw.vat_regime,     "vat_regime",     VAT_REGIMES, errors),
    shipping_model: enumField(raw.shipping_model, "shipping_model", SHIPPING_MODELS, errors),
    pays_import:    enumField(raw.pays_import,    "pays_import",    PAYS_KEYS, errors),
    categorie:      enumField(raw.categorie,      "categorie",      CATEGORIE_KEYS, errors),
  };
  // Intégrité (ère XV) : un prix d'achat ≤ 0 = coût fictif. Refus explicite → JAMAIS de ligne persistée
  // (confirmée ou importée) à marge gonflée. Vaut pour le repli du panneau (suggestion 0 sans unitCost)
  // comme pour l'import CSV. La variante fautive n'est pas écrite ; les autres du produit le sont.
  if (value.prix_achat != null && value.prix_achat <= 0) {
    errors.push("Indiquez le prix d'achat fournisseur");
  }
  return { value: errors.length ? null : value, errors };
}

// ── CSV : parse robuste (RFC4180-ish, gère guillemets et virgules échappées) ──
function parseCsvRaw(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') { inQuotes = true; }
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* swallow CR */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Parse un CSV d'import → { rows, errors }.
//   rows   : [{ variant_id, value:{…persisté} }] des lignes VALIDES uniquement
//   errors : [{ line, messages:[…] }] des lignes en erreur (jamais avalées)
// Erreur d'en-tête (colonne requise absente) → errors[0] avec line:1 et rows vide.
export function parseCostsCsv(text) {
  const raw = parseCsvRaw(String(text ?? "")).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (raw.length === 0) return { rows: [], errors: [{ line: 1, messages: ["Fichier CSV vide."] }] };

  const header = raw[0].map((h) => String(h).trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const required = ["variant_id", ...PERSISTED_COLUMNS];
  const missing = required.filter((c) => idx(c) === -1);
  if (missing.length) {
    return { rows: [], errors: [{ line: 1, messages: [`Colonnes manquantes dans l'en-tête : ${missing.join(", ")}`] }] };
  }

  const rows = [], errors = [];
  for (let r = 1; r < raw.length; r++) {
    const cells = raw[r];
    const get = (name) => String(cells[idx(name)] ?? "").trim();
    const variantId = get("variant_id");
    const lineErrors = [];
    if (!variantId) lineErrors.push("variant_id manquant");

    const { value, errors: vErrors } = validateCostRow({
      prix_achat: get("prix_achat"), port_entrant: get("port_entrant"),
      qty_par_lot: get("qty_par_lot"), cout_emballage: get("cout_emballage"),
      vat_regime: get("vat_regime"), shipping_model: get("shipping_model"),
      pays_import: get("pays_import"), categorie: get("categorie"),
    });
    lineErrors.push(...vErrors);

    if (lineErrors.length) errors.push({ line: r + 1, messages: lineErrors });
    else rows.push({ variant_id: variantId, value });
  }
  return { rows, errors };
}

// Sérialise une cellule CSV (échappe si virgule/guillemet/retour ligne).
function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Construit le CSV « modèle » pré-rempli pour l'export (toutes les variantes).
// `items` = [{ variant_id, product_title, variant_title, ...PERSISTED_COLUMNS }].
export function buildCostsCsv(items = []) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const it of items) {
    lines.push(CSV_COLUMNS.map((c) => csvCell(it[c])).join(","));
  }
  return lines.join("\r\n");
}
