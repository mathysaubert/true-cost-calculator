// ── Tableau de bord — logique PURE (fenêtres, KPI, statuts) ───────────────────────────────────
// Aucune I/O, aucun React. dashboard.server.js lit les faits et appelle ici ; la page ne fait
// qu'afficher. Les 12 KPI de la décision 14 ; 8 « primaires » visibles sur conteneur étroit (C10).
// Statuts (principe 5/6) : ok | insufficient (minData, avec « il manque N ») | unknown (coût
// manquant) | unavailable (source non connectée). Jamais un 0 silencieux.
import { gate } from "./econ/minData.js";
import { nodeById } from "./econ/nodes.js";

export const PERIOD_OPTIONS = [7, 30, 90];
export const DEFAULT_PERIOD_DAYS = 30;
export const DASHBOARD_LINES_CAP = 5000;
const DAY_MS = 86_400_000;

// Jour calendaire (YYYY-MM-DD) d'un instant dans un fuseau IANA.
export function dayInTimeZone(date, timeZone = "UTC") {
  const d = date instanceof Date ? date : new Date(date);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch { return d.toISOString().slice(0, 10); }
}
const shiftDay = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);

export function parsePeriodDays(raw, options = PERIOD_OPTIONS, fallback = DEFAULT_PERIOD_DAYS) {
  const n = parseInt(raw, 10);
  return options.includes(n) ? n : fallback;
}

// Fenêtre courante = `days` jours complets finissant HIER (jour boutique) ; précédente contiguë.
export function dashboardWindows({ now = new Date(), timeZone = "UTC", days = DEFAULT_PERIOD_DAYS } = {}) {
  const today = dayInTimeZone(now, timeZone);
  const end = shiftDay(today, -1);
  const start = shiftDay(end, -(days - 1));
  const prevEnd = shiftDay(start, -1);
  const prevStart = shiftDay(prevEnd, -(days - 1));
  return { days, current: { start, end }, previous: { start: prevStart, end: prevEnd } };
}

// Les 12 KPI (décision 14). group : section ; primary : visible sur mobile sans « Voir plus ».
// source : nœud du graphe (shop.nodes) ou module ; unit : money | count | pct | ratio.
export const KPI_DEFS = [
  { id: "ca_ht",       group: "revenue",     unit: "money", primary: true,  inputs: ["ca_brut", "remises", "rembours", "taxes"] },
  { id: "orders",     group: "revenue",     unit: "count", primary: true,  inputs: ["orders"] },
  { id: "aov",        group: "revenue",     unit: "money", primary: true,  inputs: ["ca_ht", "orders"] },
  { id: "cvr",        group: "revenue",     unit: "pct",   primary: false, inputs: ["purchase_sessions", "sessions"], needs: "sessions" },
  { id: "cm2_pct",    group: "margins",     unit: "pct",   primary: true,  inputs: ["known_ca_ht", "cogs", "shipping_cost", "packaging_cost", "payment_fees", "returns_cost"], needsCosts: true },
  { id: "cm3",        group: "margins",     unit: "money", primary: true,  inputs: ["known_ca_ht", "cogs", "shipping_cost", "packaging_cost", "payment_fees", "returns_cost", "ad_spend", "commissions"], needsCosts: true },
  { id: "net_result", group: "margins",     unit: "money", primary: true,  inputs: ["ad_spend", "commissions", "fixed_costs"], needsCosts: true },
  { id: "cac_global", group: "margins",     unit: "money", primary: true,  inputs: ["ad_spend", "commissions", "new_customers"], needs: "ads" },
  { id: "mer",        group: "acquisition", unit: "ratio", primary: false, inputs: ["ca_ht", "ad_spend", "commissions"], needs: "ads" },
  { id: "poas",       group: "acquisition", unit: "ratio", primary: false, inputs: ["attributed_cm2", "ad_spend"], needs: "ads", needsCosts: true },
  { id: "ltv_cac",    group: "acquisition", unit: "ratio", primary: false, inputs: ["ltv_cm2", "cac_global"], needs: "ads", needsCosts: true, module: "customers" },
  { id: "return_rate", group: "acquisition", unit: "pct",  primary: true,  inputs: ["orders_out_of_window"], module: "returns" },
];
export const KPI_GROUPS = ["revenue", "margins", "acquisition"];

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

// Valeur brute d'un KPI depuis le résultat d'aggregate (nœud ou module).
export function kpiRawValue(agg, def) {
  if (!agg) return null;
  if (def.module === "customers") return num(agg.customers?.[def.id]);
  if (def.module === "returns") return num(agg.returns?.[def.id]);
  return num(agg.shop?.nodes?.[def.id]);
}

// Sources non connectées : pub (aucune dépense ni commission), sessions (aucune session).
export function detectSources(agg) {
  const lv = agg?.shop?.leaves ?? {};
  return {
    ads: num(lv.ad_spend) > 0 || num(lv.commissions) > 0,
    sessions: num(agg?.counts?.sessions) > 0,
    customers: num(agg?.counts?.customers) > 0,
  };
}

// Statut d'un KPI (ordre : unavailable > insufficient > unknown > ok).
export function kpiStatus(agg, def) {
  const sources = detectSources(agg);
  // Aucune commande incluse : tout KPI est « insuffisant : encore 1 commande » (jamais un 0 « ok »).
  if (!(num(agg?.counts?.orders) > 0)) return { status: "insufficient", value: null, missing: { orders: 1 } };
  if (def.needs && !sources[def.needs]) return { status: "unavailable", source: def.needs, value: null };
  if (def.module === "customers" && !sources.customers) return { status: "unavailable", source: "customers", value: null };
  const raw = kpiRawValue(agg, def);
  const g = gate(def.id, raw, agg?.counts ?? {}, []);
  if (g.status === "insufficient") return { status: "insufficient", value: null, missing: g.missing };
  if (raw == null) {
    const unknownLines = num(agg?.dataGaps?.unknown_cost_lines) ?? 0;
    if (def.needsCosts && unknownLines > 0) return { status: "unknown", value: null, reason: "costs", unknown_cost_lines: unknownLines };
    if (def.needsCosts && num(agg?.counts?.known_orders) === 0) return { status: "unknown", value: null, reason: "costs", unknown_cost_lines: unknownLines };
    return { status: "unknown", value: null, reason: "input" };
  }
  return { status: "ok", value: raw };
}

// Écart vs période précédente : pct pour money/count/ratio (base |prev|), points pour pct.
export function kpiDelta(unit, current, previous) {
  if (current == null || previous == null) return null;
  if (unit === "pct") return { kind: "points", value: current - previous };
  if (!(Math.abs(previous) > 0)) return null;
  return { kind: "pct", value: ((current - previous) / Math.abs(previous)) * 100 };
}

// Entrées affichées dans « Voir le calcul » : feuilles ou nœuds du périmètre boutique.
function calcInputs(agg, def) {
  const lv = agg?.shop?.leaves ?? {}, nd = agg?.shop?.nodes ?? {};
  const out = [];
  for (const id of def.inputs) {
    let value, unit;
    if (id === "orders_out_of_window") { value = num(agg?.returns?.orders_out_of_window); unit = "count"; }
    else if (id === "ltv_cm2") { value = num(agg?.customers?.ltv_cm2); unit = "money"; }
    else if (id === "cac_global") { value = num(nd.cac_global); unit = "money"; }
    else if (id in lv) { value = num(lv[id]); unit = ["orders", "known_orders", "new_customers", "sessions", "purchase_sessions"].includes(id) ? "count" : "money"; }
    else { value = num(nd[id]); unit = nodeById(id)?.unit ?? "money"; }
    out.push({ id, value, unit });
  }
  return out;
}

// Vue complète des 12 KPI pour la page (valeurs brutes ; le formatage est fait par l'écran).
export function buildKpis({ current, previous } = {}) {
  return KPI_DEFS.map((def) => {
    const st = kpiStatus(current, def);
    const prev = kpiStatus(previous, def);
    const delta = st.status === "ok" && prev.status === "ok" ? kpiDelta(def.unit, st.value, prev.value) : null;
    return { id: def.id, group: def.group, unit: def.unit, primary: def.primary, ...st, previous: prev.status === "ok" ? prev.value : null, delta, inputs: calcInputs(current, def) };
  });
}

// Notes de contexte (jamais bloquantes) : pub non connectée, coûts fixes absents, part provisoire,
// part du CA à coût connu.
export function buildNotes(agg) {
  if (!agg?.shop) return [];
  const lv = agg.shop.leaves, nd = agg.shop.nodes, src = detectSources(agg);
  const notes = [];
  if (!src.ads && num(lv.orders) > 0) notes.push({ id: "no_ad_source" });
  if ((num(lv.fixed_costs) ?? 0) === 0 && num(lv.orders) > 0) notes.push({ id: "no_fixed_costs" });
  if (agg.shop.provisional_share != null && agg.shop.provisional_share > 0) notes.push({ id: "provisional", pct: agg.shop.provisional_share });
  if (nd.ca_ht > 0 && lv.known_ca_ht != null && lv.known_ca_ht < nd.ca_ht) notes.push({ id: "known_share", pct: (lv.known_ca_ht / nd.ca_ht) * 100 });
  return notes;
}

// Trous de données affichés en bandeau (compteurs bruts ; l'écran traduit).
export function buildGaps({ agg, legacyLines = 0, capped = false, excluded = {} } = {}) {
  const g = agg?.dataGaps ?? {};
  const gaps = [];
  if ((g.unknown_cost_lines ?? 0) > 0) gaps.push({ id: "unknown_cost_lines", count: g.unknown_cost_lines });
  if ((g.unconfirmed_fees ?? 0) > 0) gaps.push({ id: "unconfirmed_fees", count: g.unconfirmed_fees });
  if ((g.unconfirmed_shipping ?? 0) > 0) gaps.push({ id: "unconfirmed_shipping", count: g.unconfirmed_shipping });
  if ((g.no_packaging_cost ?? 0) > 0) gaps.push({ id: "no_packaging_cost", count: g.no_packaging_cost });
  if (legacyLines > 0) gaps.push({ id: "legacy_lines", count: legacyLines });
  if (capped) gaps.push({ id: "capped", cap: DASHBOARD_LINES_CAP });
  const exclEntries = Object.entries(excluded).filter(([, n]) => n > 0);
  const exclTotal = exclEntries.reduce((s, [, n]) => s + n, 0);
  if (exclTotal > 0) gaps.push({ id: "excluded", count: exclTotal, reasons: exclEntries.map(([r, n]) => ({ reason: r, count: n })) });
  return gaps;
}
