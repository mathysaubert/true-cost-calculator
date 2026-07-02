// ── Cron hebdomadaire : entretien des sessions mortes ───────────────────────
// Resource route (loader seul, server-only). Déclenchée par Vercel Cron (GET) avec
// Authorization: Bearer $CRON_SECRET. AUTONOME : refait son propre probe admin, ne touche
// NI au cron profitability NI au cron dunning (zéro risque de régression pour un gain d'entretien).
//
// Pour CHAQUE boutique installée (session offline) : probe unauthenticated.admin(shop).
//   succès             → nextSessionHealth('success') : compteur remis à 0.
//   admin_unauthorized → nextSessionHealth('failure') : compteur++ (throw de unauthenticated.admin
//     UNIQUEMENT — jamais une erreur d'opération : une session vivante peut échouer un bulk).
// Puis shouldReapSession (pur) : si 10 échecs consécutifs ET série ≥ 21 j → supprime la ligne
// Session (+ sa ligne session_health). Suppression réversible : si l'app est encore installée,
// le marchand re-OAuth au prochain accès. Données Supabase intactes (hors scope v1). engine.js intouché.
import { unauthenticated } from "../shopify.server";
import { supabase } from "../supabase.server";
import prisma from "../db.server";
import { nextSessionHealth, shouldReapSession } from "../lib/sessionReaper.js";

export const config = { maxDuration: 60 };

async function probeShop(shop, nowMs, nowIso) {
  const r = { shop, outcome: null, failures: 0, reaped: false };

  // Probe = SEULE l'acquisition admin. unauthenticated.admin tente déjà le refresh du token
  // offline ; son throw = échec d'auth (potentiellement mort). On ne lance AUCUNE opération ici
  // → aucun risque de compter une erreur d'opération (ex. bulk ACCESS_DENIED) comme un échec d'auth.
  let alive = true;
  try { await unauthenticated.admin(shop); }
  catch (e) { alive = false; console.warn(`[Reaper] admin offline KO ${shop}:`, e?.message); }
  r.outcome = alive ? "success" : "failure";

  // État de santé courant → nouvel état.
  const { data: prev } = await supabase.from("session_health").select("*").eq("shop_domain", shop).maybeSingle();
  const next = nextSessionHealth(prev ?? {}, alive ? "success" : "failure", nowMs);
  r.failures = next.consecutive_failures;

  if (!alive && shouldReapSession({ health: next, now: nowMs })) {
    // Seuils atteints → suppression de la session (toutes lignes du shop) + de sa santé.
    await prisma.session.deleteMany({ where: { shop } });
    await supabase.from("session_health").delete().eq("shop_domain", shop);
    r.reaped = true;
  } else {
    // Sinon : on avance simplement l'état de santé (reset au succès, incrément à l'échec).
    await supabase.from("session_health").upsert(
      { shop_domain: shop, ...next, updated_at: nowIso }, { onConflict: "shop_domain" });
  }
  return r;
}

export async function loader({ request }) {
  // [G0] sécurité : Vercel Cron envoie Authorization: Bearer $CRON_SECRET.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sessions = await prisma.session.findMany({ where: { isOnline: false }, select: { shop: true } });
  const shops = [...new Set(sessions.map((s) => s.shop))];
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const results = [];
  for (const shop of shops) {
    try { results.push(await probeShop(shop, nowMs, nowIso)); }
    catch (e) { console.error(`[Reaper] échec ${shop}:`, e?.message); results.push({ shop, error: e?.message ?? "exception" }); }
  }
  const reaped = results.filter((r) => r.reaped).length;
  return Response.json({ ok: true, shops: shops.length, reaped, results });
}
