// ── S2c — Résultat observé à J+30 (W4, W5, W6) — PUR ──────────────────────────────────────────
// review_at = decided_at + horizon (W6). Observé = CM2 de la fenêtre APRÈS la décision − CM2 de la
// fenêtre AVANT (mêmes longueurs, feuilles réelles) : toujours « toutes causes confondues ». Vide,
// avec la raison, si la fenêtre « avant » n'a aucune commande (historique non couvert).
const DAY_MS = 86_400_000;
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

export function reviewAt(decidedAt, horizonDays = 30) {
  const t = Date.parse(decidedAt);
  if (!Number.isFinite(t)) return null;
  return new Date(t + Math.max(1, Math.round(horizonDays)) * DAY_MS).toISOString();
}

// Fenêtre de revue : `now` à passer à loadOverview (fin de la fenêtre « après ») et sa longueur.
export function reviewWindow({ review_at, horizon_days }) {
  return { now: new Date(review_at), days: Math.max(1, Math.round(num(horizon_days) ?? 30)) };
}

// afterNodes / beforeNodes : nœuds boutique des deux fenêtres ; beforeOrders : commandes de la fenêtre avant.
export function observedImpact({ afterNodes = {}, beforeNodes = {}, beforeOrders = 0, node = "cm2" } = {}) {
  const a = num(afterNodes?.[node]), b = num(beforeNodes?.[node]);
  if (!(num(beforeOrders) > 0) || b == null) return { value: null, reason: "no_history" };
  if (a == null) return { value: null, reason: "no_after" };
  return { value: Math.round((a - b) * 100) / 100, reason: null };
}

// État d'une décision retenue pour l'affichage : observed | unobservable | pending | none.
export function observedStatus(m, now = new Date()) {
  if (m?.observed_at) return m.observed_impact == null ? "unobservable" : "observed";
  if (m?.review_at && Date.parse(m.review_at) > now.getTime()) return "pending";
  return m?.review_at ? "due" : "none";
}

// Décisions à revoir : review_at passé, jamais observées.
export function dueForReview(rows = [], now = new Date()) {
  return rows.filter((r) => r?.review_at && !r.observed_at && Date.parse(r.review_at) <= now.getTime());
}
