// ── Impacts en fourchettes (D2) — PUR ─────────────────────────────────────────────────────────
// (a) fourchette = point × (1 ± u), u = demi-largeur liée au score de fiabilité + élargissement par
// statut ; (b) horizon : « period » pour les écarts et priorités, « month » pour l'opportunité
// (point × 30 / jours de la période). Formulation imposée : « toutes choses égales par ailleurs,
// environ … » (clé de catalogue, pas ici).
import { UNCERTAINTY_BY_SCORE, UNCERTAINTY_BY_STATUS } from "./config.js";

export function halfWidth(score, status = "likely") {
  const s = Number.isFinite(score) ? score : 0;
  const base = UNCERTAINTY_BY_SCORE.find((b) => s >= b.min)?.halfWidth ?? 0.35;
  return Math.min(0.6, base + (UNCERTAINTY_BY_STATUS[status] ?? 0.15));
}

// point : montant sur la période (signé). Renvoie null si point est null.
export function impactRange({ point, score, status = "likely", currency = null, horizon = "period", periodDays = 30 } = {}) {
  if (point == null || !Number.isFinite(point)) return null;
  const factor = horizon === "month" ? 30 / Math.max(1, periodDays) : 1;
  const p = point * factor;
  const u = halfWidth(score, status);
  const a = p * (1 - u), b = p * (1 + u);
  return { point: p, low: Math.min(a, b), high: Math.max(a, b), half_width: u, horizon, currency, status };
}
