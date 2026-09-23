// ── Webhooks fulfillments/create, fulfillments/update, fulfillment_events/create (F2) ─────────
// Expédition = ligne fulfillments (date d'expédition, suivi) ; événement DELIVERED → delivered_at.
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { recordWebhook, finishWebhook } from "../lib/sync/events.server.js";
import { fulfillmentFromWebhook, fulfillmentEventPatch } from "../lib/sync/normalize.js";
import { loadShopContext, ingestFulfillments, applyFulfillmentEvent } from "../lib/sync/ingest.server.js";

export const config = { maxDuration: 60 };

export const action = async ({ request }) => {
  const { shop, topic, payload, webhookId, admin } = await authenticate.webhook(request);
  const fresh = await recordWebhook({ supabase, webhookId, shop, topic });
  if (!fresh) return new Response();
  try {
    if (String(topic).toLowerCase().includes("fulfillment_events")) {
      await applyFulfillmentEvent({ supabase, shop, patch: fulfillmentEventPatch(payload) });
    } else {
      const ctx = await loadShopContext({ admin, supabase, shop });
      await ingestFulfillments({ supabase, shop, ctx, rows: [fulfillmentFromWebhook(payload, { timeZone: ctx.timeZone })] });
    }
    await finishWebhook({ supabase, webhookId, status: "processed" });
    return new Response();
  } catch (e) {
    console.error(`[Webhook] ${topic} ${shop} :`, e?.message);
    await finishWebhook({ supabase, webhookId, status: "failed", error: e?.message });
    return new Response(null, { status: 500 });
  }
};
