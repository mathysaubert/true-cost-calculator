// ── Webhook bulk_operations/finish (F2) : fin d'op → ingestion du job, puis backfill suivant ──
// L'ingestion d'un mois de commandes dépasse les 5 s accordées : on répond 200 tout de suite et
// le travail continue en arrière-plan (waitUntil, dans la limite de maxDuration). Si l'invocation
// est coupée, le job reste 'running' et le cron de sync le reprend (op relue par son id).
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { recordWebhook, finishWebhook } from "../lib/sync/events.server.js";
import { handleBulkFinish } from "../lib/sync/bulk.server.js";
import { background } from "../lib/sync/background.server.js";

export const config = { maxDuration: 300 };

export const action = async ({ request }) => {
  const { shop, topic, payload, webhookId, admin } = await authenticate.webhook(request);
  const fresh = await recordWebhook({ supabase, webhookId, shop, topic });
  if (!fresh || !admin) return new Response();
  background((async () => {
    try {
      const r = await handleBulkFinish({ admin, supabase, shop, payload });
      console.log(`[Sync] bulk fin ${shop} :`, JSON.stringify(r).slice(0, 500));
      await finishWebhook({ supabase, webhookId, status: "processed" });
    } catch (e) {
      console.error(`[Webhook] ${topic} ${shop} :`, e?.message);
      await finishWebhook({ supabase, webhookId, status: "failed", error: e?.message });
    }
  })(), "bulk_operations/finish");
  return new Response();
};
