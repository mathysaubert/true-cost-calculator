// ── Données minimales (principe 6, décision A11) — PUR ────────────────────────────────────────
// Compare les COMPTES disponibles (commandes, sessions, clients, mois…) aux seuils de MIN_DATA
// (config.js, seule table à modifier). Sous seuil : { status: "insufficient", missing: { key: n } }
// — « encore N commandes » est calculable par l'écran depuis `missing`. Jamais de valeur partielle.
import { MIN_DATA } from "./config.js";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };

export function minDataFor(nodeId, counts = {}, table = MIN_DATA) {
  const need = table[nodeId];
  if (!need) return null;
  const missing = {};
  for (const [key, min] of Object.entries(need)) {
    const have = num(counts[key]);
    if (have < min) missing[key] = min - have;
  }
  return Object.keys(missing).length ? { need, have: Object.fromEntries(Object.keys(need).map((k) => [k, num(counts[k])])), missing } : null;
}

// Emballe une valeur de nœud avec son statut de données.
//   ok           → { status: "ok", value }
//   insufficient → { status: "insufficient", value: null, missing }
//   unknown      → { status: "unknown", value: null, gaps } (coût manquant, connexion absente…)
export function gate(nodeId, value, counts = {}, gaps = [], table = MIN_DATA) {
  const md = minDataFor(nodeId, counts, table);
  if (md) return { status: "insufficient", value: null, missing: md.missing, need: md.need, have: md.have };
  if (value == null) return { status: "unknown", value: null, gaps: gaps ?? [] };
  return { status: "ok", value };
}
