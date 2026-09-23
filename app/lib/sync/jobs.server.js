// ── sync_jobs (F1-17) : un job = un message (décision 19) — accès Supabase ─────────────────────
import { backfillPlan } from "./windows.js";

const must = ({ data, error }, label) => { if (error) throw new Error(`sync_jobs (${label}) : ${error.message}`); return data; };

export async function createJob(supabase, { shop, kind, window_start = null, window_end = null, payload = {} }) {
  const data = must(await supabase.from("sync_jobs")
    .insert({ shop_domain: shop, kind, window_start, window_end, payload, status: "pending" })
    .select("*").maybeSingle(), "insert");
  return data;
}

export async function listJobs(supabase, shop, { kind = null, status = null, limit = 200 } = {}) {
  let q = supabase.from("sync_jobs").select("*").eq("shop_domain", shop);
  if (kind) q = Array.isArray(kind) ? q.in("kind", kind) : q.eq("kind", kind);
  if (status) q = Array.isArray(status) ? q.in("status", status) : q.eq("status", status);
  return must(await q.order("created_at", { ascending: true }).limit(limit), "list") ?? [];
}

export async function findJobByOp(supabase, shop, opId) {
  if (!opId) return null;
  return must(await supabase.from("sync_jobs").select("*").eq("shop_domain", shop).eq("bulk_operation_id", opId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle(), "by op");
}

export async function updateJob(supabase, id, patch) {
  return must(await supabase.from("sync_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").maybeSingle(), "update");
}
export const markRunning = (supabase, job, bulkOperationId) =>
  updateJob(supabase, job.id, { status: "running", bulk_operation_id: bulkOperationId ?? job.bulk_operation_id ?? null, started_at: new Date().toISOString(), attempts: (job.attempts ?? 0) + 1, last_error: null });
export const completeJob = (supabase, job, payload = {}) =>
  updateJob(supabase, job.id, { status: "completed", finished_at: new Date().toISOString(), cursor: job.window_end ?? null, payload: { ...(job.payload ?? {}), ...payload } });
export const failJob = (supabase, job, error) =>
  updateJob(supabase, job.id, { status: "failed", finished_at: new Date().toISOString(), last_error: String(error ?? "").slice(0, 500) });

// Plan de backfill (B1) : crée les fenêtres manquantes (pending). Idempotent par window_start.
export async function planBackfill({ supabase, shop, hasAllOrders, historyMonths = 24, now = new Date() }) {
  const existing = await listJobs(supabase, shop, { kind: "orders_backfill", limit: 500 });
  const plan = backfillPlan({ now, historyMonths, hasAllOrders, existingWindows: existing });
  if (!plan.length) return { created: 0 };
  must(await supabase.from("sync_jobs").insert(plan.map((w) => ({
    shop_domain: shop, kind: "orders_backfill", window_start: w.start, window_end: w.end, status: "pending",
    payload: { hasAllOrders: hasAllOrders === true },
  }))), "plan");
  return { created: plan.length, windows: plan };
}

// Curseur de réconciliation = fin de la dernière fenêtre incrémentale terminée.
export async function latestCursor(supabase, shop) {
  const data = must(await supabase.from("sync_jobs").select("window_end").eq("shop_domain", shop)
    .eq("kind", "orders_incremental").eq("status", "completed").order("window_end", { ascending: false }).limit(1).maybeSingle(), "cursor");
  return data?.window_end ?? null;
}
