// ── Webhooks returns/* (F2, scope read_returns) : retour + motifs par ligne ───────────────────
// cancel / close / reopen n'apportent pas les lignes : fusion avec l'existant (ingestReturns).
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { recordWebhook, finishWebhook } from "../lib/sync/events.server.js";
import { returnFromWebhook } from "../lib/sync/normalize.js";
import { loadShopContext, ingestReturns } from "../lib/sync/ingest.server.js";

export const config = { maxDuration: 60 };

export const action = async ({ request }) => {
  const { shop, topic, payload, webhookId, admin } = await authenticate.webhook(request);
  const fresh = await recordWebhook({ supabase, webhookId, shop, topic });
  if (!fresh) return new Response();
  try {
    const ctx = await loadShopContext({ admin, supabase, shop });
    await ingestReturns({ supabase, shop, ctx, rows: [returnFromWebhook(payload, { timeZone: ctx.timeZone })] });
    await finishWebhook({ supabase, webhookId, status: "processed" });
    return new Response();
  } catch (e) {
    console.error(`[Webhook] ${topic} ${shop} :`, e?.message);
    await finishWebhook({ supabase, webhookId, status: "failed", error: e?.message });
    return new Response(null, { status: 500 });
  }
};
