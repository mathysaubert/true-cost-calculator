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
import { sendLossAlert } from "../lib/email.server.js";
import { resolveEntitlement } from "../lib/plan.server";
import { planToOrderCap, alertingEnabled, previousMonth } from "../lib/plan.js";

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
    // ── C4b : plafond d'alerting au volume — DÉCISION d'envoi/avance (fonctions PURES, lot17) ──
    // Tout ce qui précède (sync, agg, diff, seeds/maj) est INCHANGÉ ; seul CE bloc décide s'il faut
    // envoyer l'alerte et avancer l'état. Bascule DIFFÉRÉE : alerting coupé ce mois SSI le compteur
    // de commandes du mois PRÉCÉDENT a dépassé le palier du plan (le mois en cours est toujours servi).
    //   • 'send'/'advance_only'/'send'-échoué → comportement STRICTEMENT identique à avant.
    //   • 'suppress' (OFF) → ni envoi ni avance d'état → aucune alerte perdue (rafale-digest à la reprise).
    // DÉFAUT SÛR : si le plan est indéterminé (Shopify injoignable) OU si la lecture échoue → alerting
    // ON. On ne 'suppress' JAMAIS sur un doute : une incertitude ne doit pas avaler une alerte (au pire
    // un email de trop à un marchand dépassé). La décision elle-même est pure et testée (lot17).
    let enabled = true, cap = Infinity, prevCount = 0, planSource = "default-on";
    try {
      let subJson = null;
      try { subJson = await (await admin.graphql(ALL_SUBS_QUERY)).json(); }
      catch (e) { console.error(`[Cron] allSubscriptions KO ${shop}:`, e?.message); }
      const ent = await resolveEntitlement({ shop, json: subJson, refetch: async () => (await admin.graphql(ALL_SUBS_QUERY)).json() });
      planSource = ent.source;
      if (ent.source === "live") {
        // Plan FRAIS et autoritatif : on peut décider la bascule différée.
        cap = planToOrderCap(ent);
        const { data: um } = await supabase.from("usage").select("orders_count")
          .eq("shop_domain", shop).eq("month", previousMonth(new Date())).maybeSingle();
        prevCount = um?.orders_count ?? 0;
        enabled = alertingEnabled(prevCount, cap);
      } else {
        // 'cache' (live échoué → dernier plan connu, possiblement périmé) OU 'indeterminate' :
        // l'appel LIVE du plan n'a pas abouti → DOUTE. On ne 'suppress' QUE sur un plan live ;
        // sinon ON. Un doute ne doit jamais avaler une alerte (au pire un email de trop).
        enabled = true;
      }
    } catch (e) {
      console.error(`[Cron] plan/plafond KO ${shop} → alerting ON par défaut:`, e?.message);
      enabled = true;
    }

    const to = await resolveEmail(admin);
    const action = decideAlertAction({ alertingEnabled: enabled, hasEmail: !!to, hasBasculements: true });
    // Diagnostic prod (par boutique) : on n'a rien à deviner.
    console.log(`[Cron] alerting ${shop}: prevCount=${prevCount} cap=${cap} enabled=${enabled} action=${action} (plan ${planSource})`);
    r.alertingEnabled = enabled; r.action = action;

    let sendOk = false;
    if (action === "send") sendOk = await sendLossAlert({ to, shop, basculements, thresholdPct });
    if (shouldAdvanceState(action, sendOk)) {
      await writeStates(basculements.map((e) => stateRow(e, shop, now)));
    }

    // Reporting (parité avec l'ancien flux) : advance_only=G3, send ok/échec, suppress=OFF.
    if (action === "advance_only") r.noEmail = true;
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
