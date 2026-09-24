// ── Simulateur boutique (S1, T1/T3/T5) — PUR : leviers du PDF → leviers et surcharges du moteur ──
// Chaque levier de l'écran est un écart relatif (%) ou une valeur (CAC) ; il se traduit en leviers
// multiplicatifs de econ/simulate.js (volume constant sauf « volume ») ou en surcharges de feuilles
// calculées APRÈS les leviers (port, emballage, budget pub) pour rester composable. Aucune
// élasticité inventée : « volume » = conversion à sessions constantes (T5).
export const LEVERS = [
  { id: "price",      kind: "pct",   min: -30,  max: 30,  step: 1, econ: "price_factor" },
  { id: "basket",     kind: "pct",   min: -30,  max: 30,  step: 1, econ: "aov_factor" },
  { id: "volume",     kind: "pct",   min: -50,  max: 50,  step: 1, econ: "cvr_factor" },
  { id: "returns",    kind: "pct",   min: -50,  max: 100, step: 1, econ: "return_rate_factor" },
  { id: "cogs",       kind: "pct",   min: -30,  max: 30,  step: 1, econ: "cogs_factor" },
  { id: "fulfilment", kind: "pct",   min: -50,  max: 50,  step: 1, override: ["shipping_cost", "packaging_cost"], requires: ["shipping_cost"] },
  { id: "ad_budget",  kind: "pct",   min: -100, max: 100, step: 5, override: ["ad_spend"], requires: ["ad_spend"] },
  { id: "cac",        kind: "money", min: 0,    max: 1000, step: 1, econ: "cac", requires: ["new_customers"] },
];
export const LEVER_IDS = LEVERS.map((l) => l.id);
export const leverById = (id) => LEVERS.find((l) => l.id === id) ?? null;

// Nœuds affichés (T1) : CA HT, CM2, CM3, résultat, BE-ROAS. `good` = sens d'un écart favorable
// (même convention que goodDirection des KPI) : un seuil qui baisse est une bonne nouvelle.
export const RESULT_NODES = [
  { id: "ca_ht",      unit: "money", good: "up" },
  { id: "cm2",        unit: "money", good: "up" },
  { id: "cm3",        unit: "money", good: "up" },
  { id: "net_result", unit: "money", good: "up" },
  { id: "be_roas",    unit: "ratio", good: "down" },
];
// Ton d'un écart : favorable / défavorable selon le sens du nœud ; null quand nul ou inconnu.
export function deltaTone(node, delta) {
  if (delta == null || delta === 0) return null;
  const favorable = node.good === "down" ? delta < 0 : delta > 0;
  return favorable ? "good" : "bad";
}

// Fourchette T5 : volume −10 % / +10 % autour du scénario.
export const RANGE_VOLUME = { low: 0.9, high: 1.1 };

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
export const clamp = (l, v) => Math.min(l.max, Math.max(l.min, v));

// Un levier est-il applicable avec ces feuilles ? (pas de budget pub sans dépense, pas de CAC sans nouveaux clients)
export function leverAvailable(lever, leaves = {}) {
  return (lever.requires ?? []).every((k) => num(leaves[k]) != null && num(leaves[k]) > 0);
}

// Valeurs de l'écran → leviers du moteur (facteurs) ; les leviers à 0 % sont ignorés.
export function econLevers(values = {}) {
  const out = {};
  for (const l of LEVERS) {
    const v = num(values[l.id]);
    if (v == null || !l.econ) continue;
    if (l.kind === "pct") { if (v !== 0) out[l.econ] = 1 + v / 100; }
    else out[l.econ] = v;
  }
  return out;
}

// Surcharges de feuilles calculées sur les feuilles DÉJÀ transformées par les leviers.
export function econOverrides(values = {}, leveredLeaves = {}) {
  const out = {};
  for (const l of LEVERS) {
    const v = num(values[l.id]);
    if (v == null || !l.override || v === 0) continue;
    for (const k of l.override) { const base = num(leveredLeaves[k]); if (base != null) out[k] = base * (1 + v / 100); }
  }
  return out;
}

// Leviers du moteur (opportunité, règle, mémoire) → valeurs de l'écran.
export function valuesFromEconLevers(levers = {}) {
  const out = {};
  for (const l of LEVERS) {
    if (!l.econ || levers[l.econ] == null) continue;
    const f = num(levers[l.econ]);
    if (f == null) continue;
    out[l.id] = l.kind === "pct" ? Math.round((f - 1) * 1000) / 10 : f;
  }
  return out;
}
