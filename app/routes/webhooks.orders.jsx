// ── Webhooks orders/create, orders/updated, orders/cancelled (F2, B5) ─────────────────────────
// authenticate.webhook vérifie le HMAC. Dédoublonnage par X-Shopify-Webhook-Id (webhook_events),
// normalisation + écriture EN LIGNE (la charge utile suffit), 200 en moins de 5 s. Attribution et
// frais (absents du webhook) : attribution_ready=false → réconciliation quotidienne. Un échec
// d'écriture répond 500 : Shopify réessaie (8 fois sur 4 h), l'événement est retraité.
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { recordWebhook, finishWebhook } from "../lib/sync/events.server.js";
import { fromWebhookPayload } from "../lib/sync/normalize.js";
import { loadShopContext, ingestOrders, refreshCustomersAgg } from "../lib/sync/ingest.server.js";
import { background } from "../lib/sync/background.server.js";

export const config = { maxDuration: 60 };

export const action = async ({ request }) => {
  const { shop, topic, payload, webhookId, admin } = await authenticate.webhook(request);
  const fresh = await recordWebhook({ supabase, webhookId, shop, topic });
  if (!fresh) return new Response();
  try {
    const facts = fromWebhookPayload(payload);
    const ctx = await loadShopContext({ admin, supabase, shop });
    await ingestOrders({ supabase, shop, ctx, factsList: [facts] });
    await finishWebhook({ supabase, webhookId, status: "processed" });
    if (facts.customer_id) background(refreshCustomersAgg({ supabase, shop, customerIds: [facts.customer_id] }), "customers_agg");
    return new Response();
  } catch (e) {
    console.error(`[Webhook] ${topic} ${shop} :`, e?.message);
    await finishWebhook({ supabase, webhookId, status: "failed", error: e?.message });
    return new Response(null, { status: 500 });
  }
};
