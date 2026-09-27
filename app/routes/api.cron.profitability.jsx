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
import { computeProfitabilityChanges, dominantCostPost, decideAlertAction, shouldAdvanceState } from "../lib/profitabilityAlert.js";
import { sendLossAlert, sendOverageEmail } from "../lib/email.server.js";
import { resolveEntitlement } from "../lib/plan.server";
import { partnerConfigured, partnerPlan } from "../lib/partnerPlan.server.js";
import { planLabelOf } from "../lib/plan.js";
import { loadPlanUsage } from "../lib/usage.server.js";

// @vercel/react-router : durée max de la fonction servant cette route. INDISPENSABLE —
// la sync poll le bulk jusqu'à 25s, au-dessus du défaut Hobby (10s) → sinon timeout.
// Hobby plafonne à 60s ; surveiller si un gros catalogue s'en approche.
export const config = { maxDuration: 60 };

// Même plafond que le monitor (app._index.jsx) → l'alerte juge sur EXACTEMENT ce que voit
// le marchand (lignes order_margins les plus récentes, toutes dates = état cumulé).
const ORDER_MARGINS_CAP = 5000;

// C4b : requête d'abonnements pour dériver le plan (→ plafond d'alerting), comme le cron dunning.
// Minimale (id/name/status) — resolveEntitlement lit lui-même frozen_since/shop_plans en interne.
const ALL_SUBS_QUERY = `
  query AllSubs {
    shop { id }
    currentAppInstallation {
      allSubscriptions(first: 25, reverse: true) { edges { node { id name status } } }
    }
  }`;

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

  // 3. ÉTAT VEILLE + SEUIL boutique (défaut 0 = perte stricte = legacy). D1c (X7) : le seuil est lu dans
  // shop_settings (source de vérité), plus dans shop_plans (colonne supprimée en D2).
  const { data: prevRows } = await supabase.from("product_profitability_state")
    .select("product_id, last_state").eq("shop_domain", shop);
  const prevMap = new Map((prevRows ?? []).map((p) => [p.product_id, { last_state: p.last_state }]));
  const { data: settingsRow } = await supabase.from("shop_settings")
    .select("profitability_threshold_pct").eq("shop_domain", shop).maybeSingle();
  // D2-4 : objectif non renseigné (NULL) = perte stricte pour le calcul ; l'e-mail le dit sans « 0 % ».
  const thresholdRaw = settingsRow?.profitability_threshold_pct ?? null;
  const thresholdPct = thresholdRaw ?? 0;

  // 4+5. DIFF (premier passage = prevMap vide → tout en seeds, zéro basculement).
  const { basculements, seeds, majNormales } = computeProfitabilityChanges(agg.byProduct, prevMap, thresholdPct);
  const now = new Date().toISOString();

  // 6. ÉCRITURES INDÉPENDANTES DU MAIL (seeds + maj) — jamais d'alerte ici.
  r.seeded = seeds.length;
  await writeStates([...seeds, ...majNormales].map((e) => stateRow(e, shop, now)));

  // 7. OFFRE du marchand, lue UNE fois par boutique (sert au palier Z3 et aux alertes).
  let ent = { isPro: false, isExpert: false, source: "indeterminate" };
  let subJson = null;
  try {
    try { subJson = await (await admin.graphql(ALL_SUBS_QUERY)).json(); }
    catch (e) { console.error(`[Cron] allSubscriptions KO ${shop}:`, e?.message); }
    ent = await resolveEntitlement({ shop, json: subJson, refetch: async () => (await admin.graphql(ALL_SUBS_QUERY)).json() });
    // W1 (c) — contrôle : l'API Partner (moyen documenté d'App Pricing) doit dire la même chose.
    // Tout écart est journalisé ; il ne change rien à la décision (l'API Admin reste la source).
    if (ent.source === "live" && partnerConfigured()) {
      const p = await partnerPlan({ shopGid: subJson?.data?.shop?.id });
      const label = planLabelOf(ent);
      if (!p.ok) console.warn(`[Plans] contrôle API Partner indisponible ${shop} : ${p.reason}`);
      else if (p.plan !== label) console.warn(`[Plans] ÉCART ${shop} : API Admin ${label}, API Partner ${p.plan}`);
    }
  } catch (e) { console.error(`[Cron] offre KO ${shop}:`, e?.message); }
  r.plan = ent.source === "indeterminate" ? null : planLabelOf(ent);

  // 8. D2-2 (Z3) — dépassement du volume au mois écoulé : UN e-mail par mois dépassé, dédoublonné par
  // alert_state (plan_overage, mois). Uniquement sur une offre CONNUE (live ou dernière connue) : un doute
  // ne doit jamais faire écrire à un marchand qu'il dépasse une offre qu'il n'a peut-être pas.
  if (ent.source !== "indeterminate") {
    const { data: tz } = await supabase.from("shop_settings").select("shop_timezone").eq("shop_domain", shop).maybeSingle();
    const usage = await loadPlanUsage({ supabase, shop, plan: planLabelOf(ent), timeZone: tz?.shop_timezone ?? "UTC" });
    if (usage?.over) {
      r.overage = { month: usage.prevMonth, count: usage.count, cap: usage.cap };
      const { data: sent } = await supabase.from("alert_state").select("last_notified_at")
        .eq("shop_domain", shop).eq("alert_type", "plan_overage").eq("subject_key", usage.prevMonth).maybeSingle();
      if (!sent?.last_notified_at) {
        const to = await resolveEmail(admin);
        if (await sendOverageEmail({ to, shop, usage })) {
          const at = new Date().toISOString();
          await supabase.from("alert_state").upsert({ shop_domain: shop, alert_type: "plan_overage", subject_key: usage.prevMonth, last_state: "notified", last_value: usage.count, last_checked_at: at, last_notified_at: at, payload: { plan: usage.plan, cap: usage.cap, suggest: usage.suggest } }, { onConflict: "shop_domain,alert_type,subject_key" });
          r.overage.mailed = true;
        }
      }
    }
  }

  // 9. [G2/G3] basculements → mail AVANT d'écrire l'état (jamais d'alerte perdue).
  if (basculements.length) {
    r.basculements = basculements.length;
    const titles = await resolveTitles(admin, basculements.map((b) => b.product_id));
    // Enrichissement pour le mail : titre + poste de coût dominant (SERVEUR, agrégat déjà calculé
    // par aggregateOrderMargins ; dominantCostPost est pur). Le template ne fait que rendre (BUG 1).
    const byId = new Map(agg.byProduct.map((p) => [p.product_id, p]));
    for (const b of basculements) {
      b.title = titles.get(b.product_id);
      const p = byId.get(b.product_id);
      b.topCost = dominantCostPost(p?.costPosts);
      b.breakdownAvailable = p?.breakdownAvailable ?? false;
      // Enrichissement AFFICHAGE seul (après la décision) : pire cas classification douanière du produit.
      // N'entre NI dans computeProfitabilityChanges NI dans stateRow → basculements/état inchangés.
      b.customsEstimated = p?.customsEstimated ?? false;
    }
    // D2-2 (Y3) : plus aucune coupure des alertes au volume. (Z4) L'alerte e-mail est incluse en Pro et
    // Expert ; en Gratuit l'état avance sans e-mail. Offre indéterminée → incluse (jamais d'alerte avalée
    // sur un doute) ; dernière offre connue (cache) → elle décide.
    const enabled = true;
    const included = ent.source === "indeterminate" ? true : ent.isPro === true;
    const to = included ? await resolveEmail(admin) : null;
    const action = decideAlertAction({ alertingEnabled: enabled, hasEmail: !!to, hasBasculements: true, included });
    // Diagnostic prod (par boutique) : on n'a rien à deviner.
    console.log(`[Cron] alerting ${shop}: action=${action} (plan ${r.plan ?? "indéterminé"}, source ${ent.source})`);
    r.alertingEnabled = enabled; r.included = included; r.action = action;

    let sendOk = false;
    if (action === "send") sendOk = await sendLossAlert({ to, shop, basculements, thresholdPct: thresholdRaw });
    if (shouldAdvanceState(action, sendOk)) {
      await writeStates(basculements.map((e) => stateRow(e, shop, now)));
    }

    // Reporting (parité avec l'ancien flux) : advance_only=G3, send ok/échec, suppress=OFF.
    if (action === "advance_only") { if (included) r.noEmail = true; else r.notIncluded = true; }
    else if (action === "send") { if (sendOk) r.mailed = true; else r.mailFailed = true; }
    else if (action === "suppress") r.suppressed = true;
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
