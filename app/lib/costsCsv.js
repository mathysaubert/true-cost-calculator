// ── Réglages > Coûts produits : modèle CSV et import (2026-09-26) — PUR ─────────────────────────
// Règle « vide = non renseigné, 0 saisi = vrai 0 » (arbitrage du 2026-09-25, étendu au CSV) :
//   • export : une variante sans coût saisi par le marchand sort avec des coûts VIDES (jamais la
//     suggestion, jamais 0) ; la suggestion Shopify est donnée à part (colonne ignorée à l'import) ;
//   • import : une ligne dont un coût est vide reste « à compléter » (ni erreur, ni enregistrée) ;
//     quantité par lot vide = 1 ; 0 saisi = vrai 0, prix d'achat compris ;
//   • chaque rejet dit POURQUOI (raison + valeur reçue + valeurs acceptées) ;
//   • fichier réenregistré par Excel accepté : séparateur « ; » ou « , », décimale « , »,
//     encodage UTF-8 (avec ou sans BOM) ou Windows-1252.
// L'écran classique (protégé jusqu'à D2) garde ses fonctions de variantCosts.js, inchangées.
import { CSV_COLUMNS, VAT_REGIMES, SHIPPING_MODELS, PAYS_KEYS, CATEGORIE_KEYS } from "./variantCosts.js";
import { parseNumber } from "./settings.js";

export const SUGGESTION_COLUMN = "suggestion_prix_achat";
export const CSV_TEMPLATE_COLUMNS = [...CSV_COLUMNS, SUGGESTION_COLUMN];
export const CSV_NUMBER_FIELDS = ["prix_achat", "port_entrant", "qty_par_lot", "cout_emballage"];
export const CSV_ENUM_FIELDS = { vat_regime: VAT_REGIMES, shipping_model: SHIPPING_MODELS, pays_import: PAYS_KEYS, categorie: CATEGORIE_KEYS };
export const CSV_COST_FIELDS = [...CSV_NUMBER_FIELDS, ...Object.keys(CSV_ENUM_FIELDS)];
export const CSV_EMPTY_DEFAULTS = { qty_par_lot: 1 };
export const CSV_REASONS = ["not_number", "negative", "not_integer", "below_one", "too_large", "unknown_value", "missing_id", "bad_id"];
const MAX_AMOUNT = 100000, MAX_QTY = 1000000;
const MERCHANT = new Set(["confirmed", "imported"]);
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
// BOM (U+FEFF) construit, jamais écrit dans le source (règle ESLint no-irregular-whitespace).
const BOM = String.fromCharCode(0xfeff);
const stripBom = (s) => (s.startsWith(BOM) ? s.slice(1) : s);

// ── Export ──────────────────────────────────────────────────────────────────────────────────────
const cell = (v) => { const s = v == null ? "" : String(v); return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function templateRow(r = {}) {
  const merchant = r.stored === true && MERCHANT.has(r.source);
  const out = { variant_id: r.variant_id, product_title: r.product_title, variant_title: r.variant_title };
  for (const f of CSV_NUMBER_FIELDS) out[f] = merchant ? r[f] : "";
  for (const f of Object.keys(CSV_ENUM_FIELDS)) out[f] = r[f] ?? "";
  const suggestion = Number(r.prix_achat);
  out[SUGGESTION_COLUMN] = !merchant && Number.isFinite(suggestion) && suggestion > 0 ? suggestion : "";
  return out;
}
export function costsCsvTemplate(rows = []) {
  const lines = [CSV_TEMPLATE_COLUMNS.join(",")];
  for (const r of rows) { const t = templateRow(r); lines.push(CSV_TEMPLATE_COLUMNS.map((c) => cell(t[c])).join(",")); }
  return lines.join("\r\n");
}

// ── Décodage et découpage ───────────────────────────────────────────────────────────────────────
// Octets → texte : UTF-8 strict (BOM retiré), sinon Windows-1252 (CSV « point-virgule » d'Excel FR).
export function decodeCsvBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(u8); }
  catch { text = new TextDecoder("windows-1252").decode(u8); }
  return stripBom(text);
}
export function detectSeparator(text) {
  const first = stripBom(String(text ?? "")).split(/\r?\n/)[0] ?? "";
  const count = (ch) => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  return count(";") > count(",") ? ";" : ",";
}
function splitCsv(text, sep) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

// ── Validation d'un jeu de coûts, avec raisons ──────────────────────────────────────────────────
const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export function validateCostFields(raw = {}) {
  const issues = [], value = {};
  for (const f of CSV_NUMBER_FIELDS) {
    const s = raw[f];
    const n = typeof s === "number" ? s : parseNumber(s);
    if (n === undefined || n == null || !Number.isFinite(n)) { issues.push({ field: f, reason: "not_number", value: String(s ?? "") }); continue; }
    if (f === "qty_par_lot") {
      if (!Number.isInteger(n)) { issues.push({ field: f, reason: "not_integer", value: String(s) }); continue; }
      if (n < 1) { issues.push({ field: f, reason: "below_one", value: String(s) }); continue; }
      if (n > MAX_QTY) { issues.push({ field: f, reason: "too_large", value: String(s), max: MAX_QTY }); continue; }
    } else {
      if (n < 0) { issues.push({ field: f, reason: "negative", value: String(s) }); continue; }
      if (n > MAX_AMOUNT) { issues.push({ field: f, reason: "too_large", value: String(s), max: MAX_AMOUNT }); continue; }
    }
    value[f] = f === "qty_par_lot" ? n : Math.round(n * 100) / 100;
  }
  for (const [f, allowed] of Object.entries(CSV_ENUM_FIELDS)) {
    const s = String(raw[f] ?? "").trim();
    const hit = allowed.find((a) => fold(a) === fold(s));
    if (!hit) issues.push({ field: f, reason: "unknown_value", value: s, expected: allowed });
    else value[f] = hit;
  }
  return { value: issues.length ? null : value, issues };
}

// ── Import ──────────────────────────────────────────────────────────────────────────────────────
// → { rows: [{ line, variant_id, value }], incomplete: [{ line, variant_id, empty }],
//     errors: [{ line, issues }], header: null | { reason: "empty_file" | "missing_columns", columns } }
export function parseCostsCsvStrict(text) {
  const clean = stripBom(String(text ?? ""));
  const sep = detectSeparator(clean);
  const raw = splitCsv(clean, sep);
  const out = { rows: [], incomplete: [], errors: [], header: null, separator: sep };
  if (!raw.length) { out.header = { reason: "empty_file" }; return out; }
  const head = raw[0].map((h) => stripBom(String(h)).trim().toLowerCase());
  const missing = ["variant_id", ...CSV_COST_FIELDS].filter((c) => !head.includes(c));
  if (missing.length) { out.header = { reason: "missing_columns", columns: missing }; return out; }
  const at = (cells, name) => String(cells[head.indexOf(name)] ?? "").trim();
  for (let r = 1; r < raw.length; r++) {
    const cells = raw[r], line = r + 1;
    const variantId = at(cells, "variant_id");
    if (!variantId) { out.errors.push({ line, issues: [{ field: "variant_id", reason: "missing_id", value: "" }] }); continue; }
    if (!VARIANT_GID.test(variantId)) { out.errors.push({ line, issues: [{ field: "variant_id", reason: "bad_id", value: variantId }] }); continue; }
    const input = {}, empty = [];
    for (const f of CSV_COST_FIELDS) {
      const s = at(cells, f);
      if (s === "" && CSV_EMPTY_DEFAULTS[f] != null) input[f] = CSV_EMPTY_DEFAULTS[f];
      else if (s === "") empty.push(f);
      else input[f] = s;
    }
    if (empty.length) { out.incomplete.push({ line, variant_id: variantId, empty }); continue; }
    const { value, issues } = validateCostFields(input);
    if (issues.length) out.errors.push({ line, issues });
    else out.rows.push({ line, variant_id: variantId, value });
  }
  return out;
}
