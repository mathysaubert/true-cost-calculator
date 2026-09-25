// ── Limite quotidienne par action (table rate_limits) — copie de l'écran classique (D1c) ─────────
// Même table et même clé d'action que app._index.jsx : l'audit de la section Produits et celui de
// l'écran classique partagent le même compteur (10 par jour). Ouvert en cas d'erreur de lecture.
import { supabase } from "../supabase.server";

export async function checkRateLimit(shop, action, maxPerDay) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await supabase.from("rate_limits").select("count").eq("shop_domain", shop).eq("action", action).eq("day", day).maybeSingle();
    const current = data?.count ?? 0;
    if (current >= maxPerDay) return false;
    await supabase.from("rate_limits").upsert(
      { shop_domain: shop, action, day, count: current + 1, updated_at: new Date().toISOString() },
      { onConflict: "shop_domain,action,day" },
    );
  } catch (e) {
    console.error("[RateLimit] error:", e?.message);
  }
  return true;
}
