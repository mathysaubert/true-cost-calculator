// ── Réglages > Coûts produits : modèle Excel (.xlsx) — écriture et lecture, côté serveur (2026-09-26) ──
// Bibliothèques (Phase 0 validée) : write-excel-file (écriture) et read-excel-file (lecture), MIT.
// Contenu identique au modèle CSV (costsCsv.templateRow : coûts vides si non renseignés, suggestion
// Shopify à part) ; seconde feuille « Valeurs acceptées ». La lecture rend la première feuille en
// lignes de texte, validées par costsCsv.parseCostRows (mêmes règles que le CSV).
import writeExcelFile from "write-excel-file/node";
import { readSheet } from "read-excel-file/node";
import { CSV_TEMPLATE_COLUMNS, CSV_NUMBER_FIELDS, CSV_ENUM_FIELDS, SUGGESTION_COLUMN, templateRow } from "./costsCsv.js";

export const XLSX_MAX_BYTES = 5 * 1024 * 1024;
export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NUMERIC = new Set([...CSV_NUMBER_FIELDS, SUGGESTION_COLUMN]);

// Signature d'un fichier .xlsx (archive zip) : « PK\x03\x04 ».
export const isXlsx = (u8) => !!u8 && u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04;
// Ancien format Excel (.xls, conteneur OLE) : non pris en charge, signalé.
export const isLegacyXls = (u8) => !!u8 && u8.length > 8 && u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0;

const headerCell = (v) => ({ value: v, fontWeight: "bold" });
function dataCell(col, v) {
  if (v == null || v === "") return null;
  if (NUMERIC.has(col) && Number.isFinite(Number(v))) return { value: Number(v), type: Number };
  return { value: String(v), type: String };
}

// rows : lignes affichées (buildCostRowsForDisplay) ; names : { costs, values } (noms de feuilles traduits).
export async function buildCostsXlsx(rows = [], names = { costs: "Costs", values: "Accepted values" }) {
  const costs = [CSV_TEMPLATE_COLUMNS.map(headerCell), ...rows.map((r) => { const t = templateRow(r); return CSV_TEMPLATE_COLUMNS.map((c) => dataCell(c, t[c])); })];
  const enumCols = Object.keys(CSV_ENUM_FIELDS);
  const depth = Math.max(...enumCols.map((c) => CSV_ENUM_FIELDS[c].length));
  const values = [enumCols.map(headerCell), ...Array.from({ length: depth }, (_, i) => enumCols.map((c) => (CSV_ENUM_FIELDS[c][i] != null ? { value: CSV_ENUM_FIELDS[c][i], type: String } : null)))];
  const width = (c) => ({ width: c === "variant_id" ? 34 : c === "product_title" ? 30 : c === SUGGESTION_COLUMN ? 22 : 16 });
  return writeExcelFile([
    { data: costs, sheet: names.costs, columns: CSV_TEMPLATE_COLUMNS.map(width), stickyRowsCount: 1 },
    { data: values, sheet: names.values, columns: enumCols.map(() => ({ width: 18 })), stickyRowsCount: 1 },
  ]).toBuffer();
}

// Octets .xlsx → lignes de texte de la première feuille (nombres en notation « . », vides en "").
export async function readCostsXlsx(u8) {
  const data = await readSheet(Buffer.from(u8));
  return (data ?? []).map((r) => r.map((c) => (c == null ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))));
}
