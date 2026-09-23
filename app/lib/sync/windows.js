// ── Sync v2 (F2) — fenêtres, plan de backfill, curseurs : PUR (décisions B1, B3, B9) ─────────
const DAY_MS = 86_400_000;
export const SIXTY_DAYS_MS = 60 * DAY_MS;
const iso = (ms) => new Date(ms).toISOString();
const up = (v) => (v == null ? null : String(v).toUpperCase());

export function scopeHasAllOrders(scope) {
  return String(scope ?? "").split(",").map((s) => s.trim()).includes("read_all_orders");
}

// Plancher d'historique : 60 jours sans read_all_orders (limite Shopify des REQUÊTES, pas des
// webhooks) ; sinon history_months mois calendaires (début de mois UTC).
export function historyFloor({ now = new Date(), historyMonths = 24, hasAllOrders = false } = {}) {
  const n = new Date(now);
  if (!hasAllOrders) return iso(n.getTime() - SIXTY_DAYS_MS);
  return iso(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - Math.max(1, historyMonths | 0), 1));
}

// Fenêtres MENSUELLES (UTC) couvrant [from, to), la plus récente d'abord (les données récentes
// arrivent en premier à l'écran). Bornes ISO ; la première fenêtre est tronquée à `from`.
export function monthlyWindows({ from, to }) {
  const a = Date.parse(from), b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return [];
  const out = [];
  let end = b;
  while (end > a) {
    const d = new Date(end - 1);
    const start = Math.max(a, Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    out.push({ start: iso(start), end: iso(end) });
    end = start;
  }
  return out;
}

// Plan de backfill : fenêtres à créer = fenêtres du plancher à maintenant, moins celles déjà
// connues (clé = window_start exact : la fenêtre partielle des 60 j et la fenêtre pleine du même
// mois, créée après l'approbation, sont deux jobs distincts — l'ingestion est idempotente).
export function backfillPlan({ now = new Date(), historyMonths = 24, hasAllOrders = false, existingWindows = [] } = {}) {
  const floor = historyFloor({ now, historyMonths, hasAllOrders });
  const known = new Set(existingWindows.map((w) => new Date(w.window_start ?? w.start).toISOString()));
  return monthlyWindows({ from: floor, to: new Date(now).toISOString() }).filter((w) => !known.has(w.start));
}

// Fenêtre de réconciliation (B9) : depuis le curseur moins un jour de chevauchement ; sans
// curseur, depuis le plancher (60 j) ; jamais dans le futur.
export function reconcileWindow({ cursor = null, now = new Date(), overlapDays = 1, floor = null } = {}) {
  const nowMs = new Date(now).getTime();
  let start = cursor && Number.isFinite(Date.parse(cursor)) ? Date.parse(cursor) - overlapDays * DAY_MS : nowMs - SIXTY_DAYS_MS;
  if (floor && Number.isFinite(Date.parse(floor))) start = Math.max(start, Date.parse(floor));
  start = Math.min(start, nowMs);
  return { start: iso(start), end: iso(nowMs) };
}

// bulk_operations/finish livre status/error_code en MINUSCULES (doc) → forme des requêtes.
export function bulkFinishStatus(payload = {}) {
  return { id: payload.admin_graphql_api_id ?? null, status: up(payload.status), errorCode: up(payload.error_code) };
}

export function isStale(job, now = new Date(), minutes = 30) {
  const t = Date.parse(job?.started_at ?? job?.updated_at ?? job?.created_at ?? "");
  return job?.status === "running" && Number.isFinite(t) && new Date(now).getTime() - t > minutes * 60_000;
}

// Commandes dont l'attribution n'est pas prête, de moins de `days` jours (fenêtre Shopify 30 j).
export function journeyRepullCandidates(orders = [], now = new Date(), days = 30) {
  const limit = new Date(now).getTime() - days * DAY_MS;
  return orders.filter((o) => o.attribution_ready !== true && Number.isFinite(Date.parse(o.created_at)) && Date.parse(o.created_at) >= limit).map((o) => o.order_id);
}

export function feesSince(now = new Date(), days = 7) {
  return iso(new Date(now).getTime() - days * DAY_MS);
}

// Prochain job à lancer : le plus récent en fenêtre d'abord (B3, pending seulement).
export function pickNextJob(jobs = []) {
  return jobs.filter((j) => j.status === "pending").sort((a, b) => String(b.window_start ?? "").localeCompare(String(a.window_start ?? "")))[0] ?? null;
}

export function chunk(arr, size = 100) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
