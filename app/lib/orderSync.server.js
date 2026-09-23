// ── Sync commandes — point d'entrée LEGACY conservé (bouton, cron d'alerting, recalcul) ──────
// F2 : délègue à la sync v2 (app/lib/sync/bulk.server.js, syncNow) : job incrémental sur 30 jours
// (updated_at, ⊇ created_at), poll de repli 25 s, ingestion par le normaliseur unique (colonnes
// legacy + colonnes F1, B7), état legacy order_sync_state toujours écrit (B8). Même signature,
// même forme de retour { success, ingested?, orders?, message?, error? } qu'avant.
import { syncNow } from "./sync/bulk.server.js";

export async function syncShopOrders({ admin, supabase, shop }) {
  return syncNow({ admin, supabase, shop, windowDays: 30, waitMs: 25_000 });
}
