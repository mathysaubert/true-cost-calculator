// ── Idempotence des webhooks (F1-18 webhook_events) : X-Shopify-Webhook-Id = clé ─────────────
// Un id déjà présent et traité → ignoré (200 immédiat). Un id présent en 'failed' → retraité
// (Shopify réessaie 8 fois sur 4 h quand on répond hors 2xx). Une entête absente ou une erreur
// d'écriture inattendue → on traite quand même : toutes les écritures aval sont des upserts.
export async function recordWebhook({ supabase, webhookId, shop, topic }) {
  if (!webhookId) return true;
  const { error } = await supabase.from("webhook_events").insert({ webhook_id: webhookId, shop_domain: shop, topic, status: "received" });
  if (!error) return true;
  if (error.code === "23505") {
    const { data } = await supabase.from("webhook_events").select("status").eq("webhook_id", webhookId).maybeSingle();
    if (data?.status === "failed") {
      await supabase.from("webhook_events").update({ status: "received", error: null }).eq("webhook_id", webhookId);
      return true;
    }
    return false;
  }
  console.error("[Sync] webhook_events :", error.message);
  return true;
}

export async function finishWebhook({ supabase, webhookId, status, error = null }) {
  if (!webhookId) return;
  const { error: e } = await supabase.from("webhook_events")
    .update({ status, error: error ? String(error).slice(0, 500) : null, processed_at: new Date().toISOString() })
    .eq("webhook_id", webhookId);
  if (e) console.error("[Sync] webhook_events (fin) :", e.message);
}
