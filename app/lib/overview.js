// ── Vue d'ensemble (Overview) — logique PURE (fenêtres, KPI, statuts, séries, calcul) ──────────
// Aucune I/O, aucun React. overview.server.js lit les faits et appelle ici ; la page affiche.
// 12 KPI (décision 14) ; 8 « primaires » visibles sur conteneur étroit (C10). Statuts (principes
// 5/6) : ok | insufficient (minData, « il manque N ») | unknown (entrée manquante, raison) |
// unavailable (source non connectée, action). Jamais un 0 silencieux, jamais une valeur quand
// une entrée manque (retour 1).
import { gate } from "./econ/minData.js";
import { nodeById } from "./econ/nodes.js";

export const PERIOD_OPTIONS = [7, 30, 90];
export const DEFAULT_PERIOD_DAYS = 30;
export const OVERVIEW_LINES_CAP = 5000;
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
export const daysBetween = (start, end) => { const out = []; for (let d = start; d <= end; d = shiftDay(d, 1)) out.push(d); return out; };

export function parsePeriodDays(raw, options = PERIOD_OPTIONS, fallback = DEFAULT_PERIOD_DAYS) {
  const n = parseInt(raw, 10);
  return options.includes(n) ? n : fallback;
}

// Fenêtre courante = `days` jours finissant AUJOURD'HUI (jour boutique, journée en cours incluse
// et marquée partielle — retour 4) ; précédente contiguë de même longueur.
export function overviewWindows({ now = new Date(), timeZone = "UTC", days = DEFAULT_PERIOD_DAYS } = {}) {
  const today = dayInTimeZone(now, timeZone);
  const end = today;
  const start = shiftDay(end, -(days - 1));
  const prevEnd = shiftDay(start, -1);
  const prevStart = shiftDay(prevEnd, -(days - 1));
  return { days, today, current: { start, end, partial: true }, previous: { start: prevStart, end: prevEnd, partial: false } };
}

// Les 12 KPI. group : section de l'Overview ; primary : visible sur mobile sans « Voir plus » ;
// goodDirection : sens d'un écart favorable (« down » pour un coût, un taux de retour) ;
// series : le nœud est sommable par jour (mini-courbe) ; calc : lignes de « Voir le calcul ».
export const KPI_DEFS = [
  { id: "ca_ht",       group: "revenue",     unit: "money", primary: true,  series: "day", goodDirection: "up",
    calc: [["", "ca_brut"], ["−", "remises"], ["−", "rembours"], ["−", "taxes"], ["=", "ca_ht"]] },
  { id: "orders",      group: "revenue",     unit: "count", primary: true,  series: "day", goodDirection: "up",
    calc: [["", "orders"]] },
  { id: "aov",         group: "revenue",     unit: "money", primary: true,  series: "day", goodDirection: "up",
    calc: [["", "ca_ht"], ["÷", "orders"], ["=", "aov"]] },
  { id: "cvr",         group: "revenue",     unit: "pct",   primary: false, series: null,  goodDirection: "up", needs: "sessions",
    calc: [["", "purchase_sessions"], ["÷", "sessions"], ["=", "cvr"]] },
  { id: "cm2_pct",     group: "margins",     unit: "pct",   primary: true,  series: "day", goodDirection: "up", needsCosts: true,
    calc: [["", "known_ca_ht"], ["−", "cogs"], ["−", "shipping_cost"], ["−", "packaging_cost"], ["−", "payment_fees"], ["−", "returns_cost"], ["=", "cm2"], ["÷", "known_ca_ht"], ["=", "cm2_pct"]] },
  { id: "cm3",         group: "margins",     unit: "money", primary: true,  series: "day", goodDirection: "up", needsCosts: true,
    calc: [["", "cm2"], ["−", "ad_spend"], ["−", "commissions"], ["=", "cm3"]] },
  { id: "net_result",  group: "margins",     unit: "money", primary: true,  series: "day", goodDirection: "up", needsCosts: true,
    calc: [["", "cm3"], ["−", "fixed_costs"], ["=", "net_result"]] },
  { id: "cac_global",  group: "margins",     unit: "money", primary: true,  series: null,  goodDirection: "down", needs: "ads",
    calc: [["", "ad_spend"], ["+", "commissions"], ["÷", "new_customers"], ["=", "cac_global"]] },
  { id: "mer",         group: "acquisition", unit: "ratio", primary: false, series: null,  goodDirection: "up", needs: "ads",
    calc: [["", "ca_ht"], ["÷", "marketing_spend"], ["=", "mer"]] },
  { id: "poas",        group: "acquisition", unit: "ratio", primary: false, series: null,  goodDirection: "up", needs: "ads", needsCosts: true,
    calc: [["", "attributed_cm2"], ["÷", "ad_spend"], ["=", "poas"]] },
  { id: "ltv_cac",     group: "acquisition", unit: "ratio", primary: false, series: null,  goodDirection: "up", needs: "ads", needsCosts: true, module: "customers",
    calc: [["", "ltv_cm2"], ["÷", "cac_global"], ["=", "ltv_cac"]] },
  { id: "return_rate", group: "acquisition", unit: "pct",   primary: true,  series: null,  goodDirection: "down", module: "returns",
    calc: [["", "orders_out_of_window"], ["=", "return_rate"]] },
];
export const KPI_GROUPS = ["revenue", "margins", "acquisition"];
const COUNT_LEAVES = new Set(["orders", "known_orders", "new_customers", "sessions", "purchase_sessions", "units", "orders_out_of_window"]);

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

// Valeur brute d'un KPI depuis le résultat d'aggregate (nœud ou module).
export function kpiRawValue(agg, def) {
  if (!agg) return null;
  if (def.module === "customers") return num(agg.customers?.[def.id]);
  if (def.module === "returns") return num(agg.returns?.[def.id]);
  return num(agg.shop?.nodes?.[def.id]);
}

// Sources non connectées : pub (aucune dépense ni commission), sessions, clients identifiés.
export function detectSources(agg) {
  const lv = agg?.shop?.leaves ?? {};
  return {
    ads: num(lv.ad_spend) > 0 || num(lv.commissions) > 0,
    sessions: num(agg?.counts?.sessions) > 0,
    customers: num(agg?.counts?.customers) > 0,
  };
}

// Statut d'un KPI (ordre : aucune commande > unavailable > insufficient > unknown > ok).
export function kpiStatus(agg, def) {
  const sources = detectSources(agg);
  if (!(num(agg?.counts?.orders) > 0)) return { status: "insufficient", value: null, missing: { orders: 1 } };
  if (def.needs && !sources[def.needs]) return { status: "unavailable", source: def.needs, value: null };
  if (def.module === "customers" && !sources.customers) return { status: "unavailable", source: "customers", value: null };
  const raw = kpiRawValue(agg, def);
  const g = gate(def.id, raw, agg?.counts ?? {}, []);
  if (g.status === "insufficient") return { status: "insufficient", value: null, missing: g.missing };
  if (raw == null) {
    const unknownLines = num(agg?.dataGaps?.unknown_cost_lines) ?? 0;
    if (def.needsCosts && (unknownLines > 0 || num(agg?.counts?.known_orders) === 0)) return { status: "unknown", value: null, reason: "costs", unknown_cost_lines: unknownLines };
    return { status: "unknown", value: null, reason: "input" };
  }
  return { status: "ok", value: raw };
}

// Écart vs période précédente : pct pour money/count/ratio (base |prev|), points pour pct ;
// tone = favorable / défavorable / neutre selon goodDirection.
export function kpiDelta(def, current, previous) {
  if (current == null || previous == null) return null;
  let d;
  if (def.unit === "pct") d = { kind: "points", value: current - previous };
  else if (!(Math.abs(previous) > 0)) return null;
  else d = { kind: "pct", value: ((current - previous) / Math.abs(previous)) * 100 };
  const up = d.value > 0, down = d.value < 0;
  d.tone = !up && !down ? "neutral" : (def.goodDirection === "down" ? (down ? "good" : "bad") : (up ? "good" : "bad"));
  d.direction = up ? "up" : down ? "down" : "flat";
  return d;
}

// Série journalière d'un KPI sur la fenêtre (mini-courbe). Jour sans commande : 0 pour money/count
// (vrai zéro), null pour un ratio (non défini). Renvoie null si moins de 2 points définis ou moins
// de 2 jours non nuls (une seule journée d'activité ne fait pas une tendance).
export function kpiSeries(agg, def, window) {
  if (!agg || def.series !== "day" || !window?.start || !window?.end) return null;
  const pts = daysBetween(window.start, window.end).map((day) => {
    const e = agg.byDay?.[day];
    const v = e ? num(e.nodes?.[def.id] ?? e.leaves?.[def.id]) : null;
    if (v != null) return { day, value: v };
    return { day, value: def.unit === "money" || def.unit === "count" ? 0 : null };
  });
  const defined = pts.filter((p) => p.value != null).length;
  const nonZero = pts.filter((p) => p.value != null && p.value !== 0).length;
  return defined >= 2 && nonZero >= 2 ? pts : null;
}

// Lignes de « Voir le calcul » : [{ op, id, value, unit, strong }] depuis feuilles/nœuds boutique.
export function calcRows(agg, def) {
  const lv = agg?.shop?.leaves ?? {}, nd = agg?.shop?.nodes ?? {};
  return def.calc.map(([op, id]) => {
    let value, unit;
    if (id === "orders_out_of_window") { value = num(agg?.returns?.orders_out_of_window); unit = "count"; }
    else if (id === "return_rate") { value = num(agg?.returns?.return_rate); unit = "pct"; }
    else if (id === "ltv_cm2") { value = num(agg?.customers?.ltv_cm2); unit = "money"; }
    else if (id === "ltv_cac") { value = num(agg?.customers?.ltv_cac); unit = "ratio"; }
    else if (id in lv && !(id in nd)) { value = num(lv[id]); unit = COUNT_LEAVES.has(id) ? "count" : "money"; }
    else { value = num(nd[id]); unit = nodeById(id)?.unit ?? (COUNT_LEAVES.has(id) ? "count" : "money"); }
    return { op, id, value, unit, strong: op === "=" };
  });
}

// Option A (retour 3) : un vrai zéro s'explique. Sur les KPI de revenu et de marge, quand des
// remboursements existent sur la période, la tuile porte « {remboursé} remboursés sur {vendu} »
// (feuilles rembours / ca_brut) ; `full` = tout le CA brut a été remboursé.
const REFUND_NOTE_IDS = new Set(["ca_ht", "aov", "cm2_pct", "cm3", "net_result"]);
export function kpiRefunds(agg, def) {
  if (!REFUND_NOTE_IDS.has(def.id)) return null;
  const lv = agg?.shop?.leaves ?? {};
  const refunded = num(lv.rembours), gross = num(lv.ca_brut);
  if (!(refunded > 0)) return null;
  return { refunded, gross: gross ?? 0, full: gross != null && refunded >= gross };
}

// Vue complète des 12 KPI pour la page (valeurs brutes ; le formatage est fait par l'écran).
export function buildKpis({ current, previous, window } = {}) {
  return KPI_DEFS.map((def) => {
    const st = kpiStatus(current, def);
    const prev = kpiStatus(previous, def);
    const delta = st.status === "ok" && prev.status === "ok" ? kpiDelta(def, st.value, prev.value) : null;
    const series = st.status === "ok" ? kpiSeries(current, def, window) : null;
    const refunds = st.status === "ok" ? kpiRefunds(current, def) : null;
    return { id: def.id, group: def.group, unit: def.unit, primary: def.primary, ...st, previous: prev.status === "ok" ? prev.value : null, delta, series, refunds, calc: calcRows(current, def) };
  });
}

// Notes de contexte (jamais bloquantes).
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

// Trous de données (compteurs bruts ; l'écran traduit). `legacy` = commandes lues par l'ancienne
// version, sans ligne analysable : non comptées (retour 1).
export function buildGaps({ agg, capped = false, excluded = {} } = {}) {
  const g = agg?.dataGaps ?? {};
  const gaps = [];
  if ((excluded.legacy ?? 0) > 0) gaps.push({ id: "legacy_orders", count: excluded.legacy });
  if ((g.unknown_cost_lines ?? 0) > 0) gaps.push({ id: "unknown_cost_lines", count: g.unknown_cost_lines });
  if ((g.unconfirmed_fees ?? 0) > 0) gaps.push({ id: "unconfirmed_fees", count: g.unconfirmed_fees });
  if ((g.unconfirmed_shipping ?? 0) > 0) gaps.push({ id: "unconfirmed_shipping", count: g.unconfirmed_shipping });
  if ((g.no_packaging_cost ?? 0) > 0) gaps.push({ id: "no_packaging_cost", count: g.no_packaging_cost });
  if (capped) gaps.push({ id: "capped", cap: OVERVIEW_LINES_CAP });
  const exclEntries = Object.entries(excluded).filter(([r, n]) => r !== "legacy" && n > 0);
  const exclTotal = exclEntries.reduce((s, [, n]) => s + n, 0);
  if (exclTotal > 0) gaps.push({ id: "excluded", count: exclTotal, reasons: exclEntries.map(([r, n]) => ({ reason: r, count: n })) });
  return gaps;
}
