// ── Webhook refunds/create (F2) : remboursement figé + quantités remboursées des lignes ───────
// Un remboursement d'une commande absente (créée avant l'installation, hors 60 j) est stocké tel
// quel (B12a) : il se rattache tout seul quand le backfill apporte la commande.
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { recordWebhook, finishWebhook } from "../lib/sync/events.server.js";
import { refundFromWebhook } from "../lib/sync/normalize.js";
import { loadShopContext, ingestRefunds } from "../lib/sync/ingest.server.js";

export const config = { maxDuration: 60 };

export const action = async ({ request }) => {
  const { shop, topic, payload, webhookId, admin } = await authenticate.webhook(request);
  const fresh = await recordWebhook({ supabase, webhookId, shop, topic });
  if (!fresh) return new Response();
  try {
    const ctx = await loadShopContext({ admin, supabase, shop });
    await ingestRefunds({ supabase, shop, ctx, rows: [refundFromWebhook(payload, { timeZone: ctx.timeZone })] });
    await finishWebhook({ supabase, webhookId, status: "processed" });
    return new Response();
  } catch (e) {
    console.error(`[Webhook] ${topic} ${shop} :`, e?.message);
    await finishWebhook({ supabase, webhookId, status: "failed", error: e?.message });
    return new Response(null, { status: 500 });
  }
};
