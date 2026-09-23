// ── Cron quotidien de sync v2 (F2) : dispatcher + réconciliation + enrichissements ───────────
// Vercel Cron (GET, Authorization: Bearer $CRON_SECRET). Pour CHAQUE boutique installée (session
// offline) : jobs en cours (reprise), plan de backfill (B1), réconciliation updated_at (B9),
// backfill suivant (B3), attribution, frais J-7, instantané du stock (B10), customers_agg.
// Hobby (B6a) : une exécution par jour, 300 s par invocation ; quand le budget est épuisé, la
// fonction se ré-invoque (fetch interne signé) pour les boutiques restantes.
import { unauthenticated } from "../shopify.server";
import { supabase } from "../supabase.server";
import prisma from "../db.server";
import { loadShopContext, repullJourneys, pullFees, snapshotInventory, refreshCustomersAgg } from "../lib/sync/ingest.server.js";
import { runOrdersJob, advanceBackfill } from "../lib/sync/bulk.server.js";
import { createJob, listJobs, planBackfill, latestCursor, failJob } from "../lib/sync/jobs.server.js";
import { scopeHasAllOrders, reconcileWindow, historyFloor, isStale, feesSince } from "../lib/sync/windows.js";
import { background } from "../lib/sync/background.server.js";

export const config = { maxDuration: 300 };
const BUDGET_MS = 240_000;     // marge sous les 300 s Hobby
const STEP_RESERVE_MS = 45_000; // temps minimal pour entamer une étape bulk

async function dispatchShop({ admin, shop, scope, now, deadline }) {
  const r = { shop, steps: {} };
  const left = () => deadline - Date.now();
  const hasAllOrders = scopeHasAllOrders(scope);
  const ctx = await loadShopContext({ admin, supabase, shop, now });
  const historyMonths = ctx.settings.history_months ?? 24;
  const step = async (name, fn, minMs = 5_000) => {
    if (left() < minMs) { r.steps[name] = { skipped: "budget" }; return; }
    try { r.steps[name] = await fn(); } catch (e) { console.error(`[Sync] ${name} ${shop} :`, e?.message); r.steps[name] = { error: e?.message }; }
  };

  // 1. Jobs en cours : op relue par son id (ingestion si terminée, échec si perdue, stagnation).
  await step("running", async () => {
    const running = await listJobs(supabase, shop, { kind: ["orders_backfill", "orders_incremental"], status: "running" });
    const out = [];
    for (const job of running) {
      if (left() < STEP_RESERVE_MS) break;
      if (!job.bulk_operation_id) { if (isStale(job, now)) await failJob(supabase, job, "stagnation sans op"); continue; }
      out.push({ job: job.id, ...(await runOrdersJob({ admin, supabase, shop, ctx, job, waitMs: 0, now })) });
    }
    return out;
  });
  // 2. Plan de backfill (B1) : fenêtres manquantes selon le scope actuel.
  await step("plan", () => planBackfill({ supabase, shop, hasAllOrders, historyMonths, now }));
  // 3. Réconciliation quotidienne (B9) : updated_at depuis le curseur − 1 j.
  await step("reconcile", async () => {
    const cursor = await latestCursor(supabase, shop);
    const w = reconcileWindow({ cursor, now, floor: historyFloor({ now, historyMonths, hasAllOrders }) });
    const job = await createJob(supabase, { shop, kind: "orders_incremental", window_start: w.start, window_end: w.end, payload: { trigger: "cron" } });
    return runOrdersJob({ admin, supabase, shop, ctx, job, waitMs: Math.min(60_000, Math.max(0, left() - STEP_RESERVE_MS)), now });
  }, STEP_RESERVE_MS);
  // 4. Backfill : le job suivant (fin par webhook ; poll court en repli).
  await step("backfill", () => advanceBackfill({ admin, supabase, shop, ctx, waitMs: Math.min(60_000, Math.max(0, left() - STEP_RESERVE_MS)), now }), STEP_RESERVE_MS);
  // 5. Enrichissements différés.
  await step("journeys", () => repullJourneys({ admin, supabase, shop, now }));
  await step("fees", () => pullFees({ admin, supabase, shop, since: feesSince(now, 7) }));
  await step("inventory", () => snapshotInventory({ admin, supabase, shop, ctx, now }));
  await step("customers", () => refreshCustomersAgg({ supabase, shop, since: new Date(now.getTime() - 2 * 86_400_000).toISOString(), now }));
  return r;
}

export async function loader({ request }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const now = new Date();
  const deadline = Date.now() + BUDGET_MS;
  const url = new URL(request.url);
  const after = url.searchParams.get("after");

  const sessions = await prisma.session.findMany({ where: { isOnline: false }, select: { shop: true, scope: true } });
  const byShop = new Map();
  for (const s of sessions) if (!byShop.has(s.shop)) byShop.set(s.shop, s.scope ?? "");
  let shops = [...byShop.keys()].sort();
  if (after) shops = shops.filter((s) => s > after);

  const results = [];
  let resumeAfter = null;
  for (const shop of shops) {
    if (deadline - Date.now() < STEP_RESERVE_MS) { resumeAfter = results.length ? results[results.length - 1].shop : after; break; }
    let admin;
    try { ({ admin } = await unauthenticated.admin(shop)); }
    catch (e) { console.error(`[Sync] admin offline KO ${shop} :`, e?.message); results.push({ shop, error: "admin_unauthorized" }); continue; }
    try { results.push(await dispatchShop({ admin, shop, scope: byShop.get(shop), now, deadline })); }
    catch (e) { console.error(`[Sync] échec ${shop} :`, e?.message); results.push({ shop, error: e?.message ?? "exception" }); }
  }
  // Boutiques restantes : ré-invocation signée (B6a), sans attendre la réponse.
  if (resumeAfter != null && results.length) {
    const next = new URL(request.url);
    next.searchParams.set("after", resumeAfter);
    background(fetch(next.toString(), { headers: { authorization: `Bearer ${secret}` } }).then((res) => { if (!res.ok) console.error("[Sync] ré-invocation KO :", res.status); }), "reinvoke");
  }
  return Response.json({ ok: true, shops: shops.length, done: results.length, resumeAfter, results });
}
