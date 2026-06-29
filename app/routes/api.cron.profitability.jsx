// ── Cron quotidien : alerting produit-à-perte ───────────────────────────────
// Resource route (loader seul, server-only). Déclenchée par Vercel Cron (GET) avec
// Authorization: Bearer $CRON_SECRET. Pour CHAQUE boutique installée (session offline) :
//   sync → calcul → diff état → premier-passage silencieux → mail → write état.
// Réutilise tout : syncShopOrders (= bouton), aggregateOrderMargins (pur), computeProfitabilityChanges
// (pur), sendLossAlert (Resend isolé). engine.js intouché.
import { unauthenticated } from "../shopify.server";
import { supabase } from "../supabase.server";
import prisma from "../db.server";
import { syncShopOrders } from "../lib/orderSync.server.js";
import { aggregateOrderMargins } from "../lib/orderHistory.js";
import { computeProfitabilityChanges } from "../lib/profitabilityAlert.js";
import { sendLossAlert } from "../lib/email.server.js";

// @vercel/react-router : durée max de la fonction servant cette route. INDISPENSABLE —
// la sync poll le bulk jusqu'à 25s, au-dessus du défaut Hobby (10s) → sinon timeout.
// Hobby plafonne à 60s ; surveiller si un gros catalogue s'en approche.
export const config = { maxDuration: 60 };

// Même plafond que le monitor (app._index.jsx) → l'alerte juge sur EXACTEMENT ce que voit
// le marchand (lignes order_margins les plus récentes, toutes dates = état cumulé).
const ORDER_MARGINS_CAP = 5000;

const stateRow = (e, shop, now) => ({
  shop_domain: shop, product_id: e.product_id, last_state: e.state,
  last_margin: e.margin, currency_code: e.currency ?? null, last_checked_at: now,
});
const writeStates = (rows) => rows.length
  ? supabase.from("product_profitability_state").upsert(rows, { onConflict: "shop_domain,product_id" })
  : Promise.resolve();

// Résout titres produits (pour le mail) + email marchand via l'Admin API. Best-effort.
async function resolveTitles(admin, productIds) {
  try {
    const resp = await admin.graphql(
      `query Titles($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id title } } }`,
      { variables: { ids: productIds } });
    const j = await resp.json();
    return new Map((j.data?.nodes ?? []).filter(Boolean).map((n) => [n.id, n.title]));
  } catch (e) { console.error("[Cron] titres:", e?.message); return new Map(); }
}
async function resolveEmail(admin) {
  try {
    const sr = await admin.graphql(`{ shop { email contactEmail } }`);
    const sj = await sr.json();
    return sj.data?.shop?.email || sj.data?.shop?.contactEmail || null;
  } catch (e) { console.error("[Cron] email:", e?.message); return null; }
}

async function runForShop(shop) {
  const r = { shop, synced: false, basculements: 0, mailed: false, noEmail: false, mailFailed: false, seeded: 0 };

  // 1. SYNC — token offline (skip+log si refresh expiré).
  let admin;
  try { ({ admin } = await unauthenticated.admin(shop)); }
  catch (e) { console.error(`[Cron] admin offline KO ${shop}:`, e?.message); r.error = "admin_unauthorized"; return r; }
  const sync = await syncShopOrders({ admin, supabase, shop });
  r.synced = !!sync?.success;
  if (!sync?.success) { r.error = sync?.error ?? "sync_failed"; return r; }

  // 2. CALCUL — lecture identique au monitor (cumulé, cap 5000) → agrégat par produit.
  const { data: rows } = await supabase.from("order_margins").select("*")
    .eq("shop_domain", shop).order("order_created_at", { ascending: false }).limit(ORDER_MARGINS_CAP);
  const agg = aggregateOrderMargins(rows ?? []);

  // 3. ÉTAT VEILLE + SEUIL boutique (défaut 0 = perte stricte = legacy).
  const { data: prevRows } = await supabase.from("product_profitability_state")
    .select("product_id, last_state").eq("shop_domain", shop);
  const prevMap = new Map((prevRows ?? []).map((p) => [p.product_id, { last_state: p.last_state }]));
  const { data: planRow } = await supabase.from("shop_plans")
    .select("profitability_threshold_pct").eq("shop_domain", shop).maybeSingle();
  const thresholdPct = planRow?.profitability_threshold_pct ?? 0;

  // 4+5. DIFF (premier passage = prevMap vide → tout en seeds, zéro basculement).
  const { basculements, seeds, majNormales } = computeProfitabilityChanges(agg.byProduct, prevMap, thresholdPct);
  const now = new Date().toISOString();

  // 6. ÉCRITURES INDÉPENDANTES DU MAIL (seeds + maj) — jamais d'alerte ici.
  r.seeded = seeds.length;
  await writeStates([...seeds, ...majNormales].map((e) => stateRow(e, shop, now)));

  // 7. [G2/G3] basculements → mail AVANT d'écrire l'état (jamais d'alerte perdue).
  if (basculements.length) {
    r.basculements = basculements.length;
    const titles = await resolveTitles(admin, basculements.map((b) => b.product_id));
    for (const b of basculements) b.title = titles.get(b.product_id);
    const to = await resolveEmail(admin);

    if (!to) {
      // [G3] email absent → on AVANCE quand même l'état (sinon réessai quotidien à vide).
      console.warn(`[Cron] email absent ${shop} — état avancé sans envoi`);
      r.noEmail = true;
      await writeStates(basculements.map((e) => stateRow(e, shop, now)));
    } else {
      const ok = await sendLossAlert({ to, shop, basculements, thresholdPct });
      if (ok) { r.mailed = true; await writeStates(basculements.map((e) => stateRow(e, shop, now))); }
      else    { r.mailFailed = true; /* état NON avancé → réessai demain */ }
    }
  }
  return r;
}

export async function loader({ request }) {
  // [G0] sécurité : Vercel Cron envoie Authorization: Bearer $CRON_SECRET.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Boutiques installées = sessions offline (une par shop ; dédupe par sûreté).
  const sessions = await prisma.session.findMany({ where: { isOnline: false }, select: { shop: true } });
  const shops = [...new Set(sessions.map((s) => s.shop))];

  const results = [];
  for (const shop of shops) {
    try { results.push(await runForShop(shop)); }
    catch (e) { console.error(`[Cron] échec ${shop}:`, e?.message); results.push({ shop, error: e?.message ?? "exception" }); }
  }
  return Response.json({ ok: true, shops: shops.length, results });
}
