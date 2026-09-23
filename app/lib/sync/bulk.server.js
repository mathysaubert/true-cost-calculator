// ── Sync v2 (F2) — opérations bulk : lancement, reprise, ingestion, fin par webhook ───────────
// API 2026-01 (B2) : bulkOperation(id:) et bulkOperations remplacent currentBulkOperation. Une seule
// op de NOTRE sync à la fois par boutique (B3) ; la décision de reprise reste decideBulkResume
// (lot22). Le poll est un REPLI (bouton, cron) : la fin normale arrive par bulk_operations/finish.
import { parseBulkJsonl } from "../orderIngest.js";
import { decideBulkResume, isOurSyncQuery } from "../bulkResume.js";
import { fromGraphqlNode } from "./normalize.js";
import { ordersBulkQuery, BULK_OP_QUERY, ACTIVE_BULK_OPS_QUERY, BULK_RUN_MUTATION } from "./queries.js";
import { chunk, bulkFinishStatus } from "./windows.js";
import { loadShopContext, ingestOrders, ingestFulfillments, pullRefundsForWindow, pullReturnsForWindow } from "./ingest.server.js";
import { createJob, findJobByOp, listJobs, markRunning, completeJob, failJob } from "./jobs.server.js";

const TERMINAL_FAIL = new Set(["FAILED", "CANCELED", "EXPIRED"]);
const byOf = (job) => (job.kind === "orders_incremental" ? "updated_at" : "created_at");

// État legacy (B8) : order_sync_state reste alimentée tant que le code en production la lit.
async function legacyState(supabase, shop, patch) {
  const { error } = await supabase.from("order_sync_state").upsert({ shop_domain: shop, ...patch }, { onConflict: "shop_domain" });
  if (error) console.error("[Sync] order_sync_state :", error.message);
}

export async function readBulkOp(admin, id) {
  const j = await (await admin.graphql(BULK_OP_QUERY, { variables: { id } })).json();
  return j.data?.bulkOperation ?? null;
}
export async function activeBulkOps(admin) {
  const j = await (await admin.graphql(ACTIVE_BULK_OPS_QUERY)).json();
  return (j.data?.bulkOperations?.edges ?? []).map((e) => e.node);
}
export async function pollBulkOp({ admin, id, waitMs = 25_000, everyMs = 2_000 }) {
  const startedAt = Date.now();
  let op = await readBulkOp(admin, id);
  while (op && !["COMPLETED", ...TERMINAL_FAIL].includes(op.status) && Date.now() - startedAt < waitMs) {
    await new Promise((r) => setTimeout(r, everyMs));
    op = await readBulkOp(admin, id);
  }
  return op;
}

// Lance (ou reprend) l'op du job. Décision : created | poll | ingest | busy.
export async function startOrdersBulk({ admin, supabase, shop, job }) {
  if (job.bulk_operation_id) {
    const op = await readBulkOp(admin, job.bulk_operation_id);
    const d = decideBulkResume({ op, state: { bulk_operation_id: job.bulk_operation_id, status: job.status } });
    if (d === "poll" || d === "ingest") return { op, decision: d };
    if (d === "busy") return { op, decision: "busy" };
    // create : op perdue/échouée → op fraîche ci-dessous
  }
  const ours = (await activeBulkOps(admin)).find((o) => isOurSyncQuery(o.query));
  if (ours) return { op: ours, decision: "busy" };
  const query = ordersBulkQuery({ start: job.window_start, end: job.window_end, by: byOf(job) });
  const j = await (await admin.graphql(BULK_RUN_MUTATION, { variables: { q: query } })).json();
  const userErrors = j.data?.bulkOperationRunQuery?.userErrors ?? [];
  if (userErrors.length) throw new Error("Requête bulk refusée : " + userErrors.map((e) => e.message).join(" ; "));
  const op = j.data?.bulkOperationRunQuery?.bulkOperation;
  if (!op?.id) throw new Error("Requête bulk refusée : aucune opération créée");
  await markRunning(supabase, job, op.id);
  await legacyState(supabase, shop, { status: "running", window_start: job.window_start, bulk_operation_id: op.id });
  return { op, decision: "created" };
}

// Télécharge et ingère une op COMPLETED (ou les données partielles d'une op FAILED), puis les
// sous-ressources de la fenêtre (B4). Peut THROW (URL expirée ~7 j, réseau) : l'appelant décide.
export async function ingestBulkOp({ admin, supabase, shop, ctx, job, op, now = new Date() }) {
  const url = op.url ?? op.partialDataUrl ?? null;
  let facts = [];
  if (url) {
    const text = await (await fetch(url)).text();
    facts = parseBulkJsonl(text).map(fromGraphqlNode);
  }
  const totals = { orders: 0, lines: 0, inserted: 0, insertedOrders: 0, excluded: 0, fulfillments: 0 };
  for (const batch of chunk(facts, 100)) {
    const r = await ingestOrders({ supabase, shop, ctx, factsList: batch, now });
    for (const k of Object.keys(r)) totals[k] = (totals[k] ?? 0) + r[k];
    const fulfillments = batch.flatMap((f) => f.fulfillments ?? []);
    if (fulfillments.length) totals.fulfillments += (await ingestFulfillments({ supabase, shop, ctx, rows: fulfillments, now })).fulfillments;
  }
  const window = { start: job.window_start, end: job.window_end, by: byOf(job) };
  const sub = {};
  try { sub.refunds = await pullRefundsForWindow({ admin, supabase, shop, ctx, window, now }); }
  catch (e) { console.error(`[Sync] refunds ${shop} :`, e?.message); sub.refunds = { error: e?.message }; }
  try { sub.returns = await pullReturnsForWindow({ admin, supabase, shop, ctx, window, now }); }
  catch (e) { console.error(`[Sync] returns ${shop} :`, e?.message); sub.returns = { error: e?.message }; }
  return { ...totals, partial: !op.url && !!op.partialDataUrl, sub };
}

// Exécute un job de commandes : lance/reprend, attend (waitMs, repli) ou revient, ingère.
export async function runOrdersJob({ admin, supabase, shop, ctx = null, job, waitMs = 0, now = new Date() }) {
  ctx ??= await loadShopContext({ admin, supabase, shop, now });
  let start;
  try { start = await startOrdersBulk({ admin, supabase, shop, job }); }
  catch (e) {
    await failJob(supabase, job, e?.message);
    await legacyState(supabase, shop, { status: "failed", window_start: job.window_start, last_backfill_at: now.toISOString() });
    return { status: "failed", error: e?.message };
  }
  if (start.decision === "busy") return { status: "busy" };
  let op = start.op;
  if (start.decision !== "ingest") op = waitMs > 0 ? await pollBulkOp({ admin, id: op.id, waitMs }) : await readBulkOp(admin, op.id);
  if (!op) { await failJob(supabase, job, "op introuvable"); return { status: "failed", error: "op introuvable" }; }
  if (TERMINAL_FAIL.has(op.status)) {
    let partial = null;
    if (op.partialDataUrl) { try { partial = await ingestBulkOp({ admin, supabase, shop, ctx, job, op, now }); } catch (e) { console.error("[Sync] partiel :", e?.message); } }
    await failJob(supabase, { ...job, payload: { ...(job.payload ?? {}), partial } }, `${op.status} ${op.errorCode ?? ""}`.trim());
    await legacyState(supabase, shop, { status: "failed", bulk_operation_id: op.id, last_backfill_at: now.toISOString() });
    return { status: "failed", error: `${op.status} ${op.errorCode ?? ""}`.trim(), partial };
  }
  if (op.status !== "COMPLETED") {
    await legacyState(supabase, shop, { status: "running", bulk_operation_id: op.id, last_backfill_at: now.toISOString() });
    return { status: "running", bulk_operation_id: op.id }; // fin par bulk_operations/finish ou prochain passage
  }
  let totals;
  try { totals = await ingestBulkOp({ admin, supabase, shop, ctx, job, op, now }); }
  catch (e) {
    // URL morte (~7 j) ou réseau : le job repart avec une op fraîche au prochain passage (P0.7).
    await failJob(supabase, job, `téléchargement : ${e?.message}`);
    return { status: "failed", error: e?.message };
  }
  await completeJob(supabase, job, totals);
  await legacyState(supabase, shop, { status: "completed", window_start: job.window_start, bulk_operation_id: op.id, last_backfill_at: now.toISOString() });
  return { status: "completed", ...totals };
}

// Backfill : au plus un job en cours ; lance le prochain pending (fenêtre la plus récente d'abord).
export async function advanceBackfill({ admin, supabase, shop, ctx = null, waitMs = 0, now = new Date() }) {
  const running = await listJobs(supabase, shop, { kind: "orders_backfill", status: "running" });
  if (running.length) return { status: "running", job: running[0].id };
  const pending = await listJobs(supabase, shop, { kind: "orders_backfill", status: "pending", limit: 500 });
  const next = pending.sort((a, b) => String(b.window_start).localeCompare(String(a.window_start)))[0];
  if (!next) return { status: "idle" };
  return { job: next.id, ...(await runOrdersJob({ admin, supabase, shop, ctx, job: next, waitMs, now })) };
}

// bulk_operations/finish → ingestion du job correspondant, puis enchaînement du backfill.
export async function handleBulkFinish({ admin, supabase, shop, payload, now = new Date() }) {
  const st = bulkFinishStatus(payload);
  const job = await findJobByOp(supabase, shop, st.id);
  if (!job) return { ignored: true, reason: "no_job" };
  if (job.status === "completed") return { ignored: true, reason: "already_ingested" };
  const ctx = await loadShopContext({ admin, supabase, shop, now });
  const r = await runOrdersJob({ admin, supabase, shop, ctx, job, waitMs: 0, now });
  let next = null;
  if (r.status === "completed" || r.status === "failed") {
    try { next = await advanceBackfill({ admin, supabase, shop, ctx, waitMs: 0, now }); }
    catch (e) { console.error(`[Sync] enchaînement backfill ${shop} :`, e?.message); }
  }
  return { ...r, next };
}

// « Synchroniser maintenant » (bouton, cron d'alerting, recalcul) : job incrémental sur N jours,
// poll de repli, résultat dans la forme legacy { success, ingested, orders, message?, error? }.
export async function syncNow({ admin, supabase, shop, windowDays = 30, waitMs = 25_000, now = new Date() }) {
  const ctx = await loadShopContext({ admin, supabase, shop, now });
  const start = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
  const job = await createJob(supabase, { shop, kind: "orders_incremental", window_start: start, window_end: now.toISOString(), payload: { trigger: "sync_now" } });
  const r = await runOrdersJob({ admin, supabase, shop, ctx, job, waitMs, now });
  if (r.status === "completed") {
    return r.orders === 0
      ? { success: true, ingested: 0, orders: 0, message: "Aucune commande sur les 30 derniers jours." }
      : { success: true, ingested: r.lines, orders: r.orders };
  }
  if (r.status === "busy") return { success: false, error: "Une synchronisation est déjà en cours. Réessayez dans un instant." };
  if (r.status === "running") return { success: false, error: "Synchronisation en cours, relancez dans un instant." };
  return { success: false, error: r.error?.startsWith("Requête bulk refusée") ? r.error : `Bulk échoué (${r.error ?? "?"}).` };
}
