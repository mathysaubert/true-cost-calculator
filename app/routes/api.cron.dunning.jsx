// ── Cron quotidien : dunning (récupération de churn involontaire / frozen) ──────
// Resource route (loader seul, server-only). Déclenchée par Vercel Cron (GET) avec
// Authorization: Bearer $CRON_SECRET. Pour CHAQUE boutique installée (session offline) :
//   lire allSubscriptions → DÉRIVER le statut courant → decideDunningAction (pur) → exécuter.
// SÉPARÉ du cron profitability : doit tourner même si la sync commandes échoue pour une
// boutique. Réutilise unauthenticated.admin, Resend (sendDunning*), garde-fou G2.
// engine.js intouché.
import { unauthenticated } from "../shopify.server";
import { supabase } from "../supabase.server";
import prisma from "../db.server";
import { decideDunningAction, deriveSubscriptionStatus, recurringLineItems } from "../lib/dunning.js";
import { sendDunningEmail, sendDunningResolved } from "../lib/email.server.js";

// La sync n'a pas lieu ici (pas de bulk) ; 60 s reste un plafond large et sûr.
export const config = { maxDuration: 60 };

// allSubscriptions (PAS activeSubscriptions : ce dernier masque les FROZEN). On lit aussi le pricing
// des line items du sub gelé → on recrée la charge AU MÊME PRIX (jamais sous-facturer), ET son champ
// `test` (AppSubscription.test, Boolean!) → on recrée DANS LE MÊME MODE que le sub d'origine.
const ALL_SUBS_QUERY = `
  query AllSubs {
    currentAppInstallation {
      allSubscriptions(first: 25, reverse: true) {
        edges { node {
          id name status createdAt test
          lineItems {
            plan { pricingDetails {
              __typename
              ... on AppRecurringPricing { price { amount currencyCode } interval }
            } }
          }
        } }
      }
    }
  }`;

const CREATE_MUTATION = `
  mutation Recreate($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
      confirmationUrl
      appSubscription { id status }
      userErrors { field message }
    }
  }`;

// deriveSubscriptionStatus + recurringLineItems vivent dans lib/dunning.js (purs, testés lot13).

const writeState = (row) =>
  supabase.from("subscription_dunning_state").upsert(row, { onConflict: "shop_domain" });

// Email marchand via l'Admin API (best-effort), comme le cron profitability.
async function resolveEmail(admin) {
  try {
    const sr = await admin.graphql(`{ shop { email contactEmail } }`);
    const sj = await sr.json();
    return sj.data?.shop?.email || sj.data?.shop?.contactEmail || null;
  } catch (e) { console.error("[Dunning] email:", e?.message); return null; }
}

async function runForShop(shop, now) {
  const r = { shop, status: null, action: "nothing", mailed: false };

  // 1. Admin offline (skip+log si refresh expiré) — n'affecte pas les autres boutiques.
  let admin;
  try { ({ admin } = await unauthenticated.admin(shop)); }
  catch (e) { console.error(`[Dunning] admin offline KO ${shop}:`, e?.message); r.error = "admin_unauthorized"; return r; }

  // 2. STATUT COURANT lu À L'INSTANT T (jamais d'état périmé).
  let nodes = [];
  try {
    const resp = await admin.graphql(ALL_SUBS_QUERY);
    const j = await resp.json();
    nodes = (j.data?.currentAppInstallation?.allSubscriptions?.edges ?? []).map((e) => e.node);
  } catch (e) { console.error(`[Dunning] allSubscriptions KO ${shop}:`, e?.message); r.error = "subs_query_failed"; return r; }

  const { status, frozenNode } = deriveSubscriptionStatus(nodes);
  r.status = status;

  // 3. État de dunning stocké.
  const { data: prev } = await supabase.from("subscription_dunning_state")
    .select("dunning_count, last_dunning_at, last_status, frozen_since").eq("shop_domain", shop).maybeSingle();
  const state = prev ?? {};

  // 4. DÉCISION PURE.
  const action = decideDunningAction({ status, state, now: Date.parse(now) });
  r.action = action;

  if (action === "send_dunning") {
    // 5a. Recréer la charge DU MÊME PLAN (lecture du pricing réel → jamais sous-facturer).
    const lineItems = recurringLineItems(frozenNode);
    const plan = frozenNode?.name ?? null;
    if (!lineItems.length) { console.error(`[Dunning] line items introuvables ${shop}`); r.error = "no_line_items"; return r; }

    // Mode de la charge = mode de l'abonnement D'ORIGINE (frozenNode.test), pas NODE_ENV : test↔test,
    // réel↔réel, quel que soit le type de boutique. Plus fiable que partnerDevelopment (correspond au
    // mode EXACT du sub gelé). DÉFAUT SÛR : tout ce qui n'est pas explicitement true → false (charge
    // réelle) — le doute ne donne JAMAIS un test (même règle que le bouton subscribe).
    const isTest = frozenNode?.test === true;

    let confirmationUrl = null;
    try {
      const resp = await admin.graphql(CREATE_MUTATION, { variables: {
        name: plan,
        returnUrl: `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?subscribed=true`,
        test: isTest,
        lineItems,
      } });
      const payload = (await resp.json()).data?.appSubscriptionCreate;
      if (payload?.userErrors?.length) { console.error(`[Dunning] charge userErrors ${shop}:`, JSON.stringify(payload.userErrors)); r.error = "charge_errors"; return r; }
      confirmationUrl = payload?.confirmationUrl ?? null;
    } catch (e) { console.error(`[Dunning] appSubscriptionCreate KO ${shop}:`, e?.message); r.error = "charge_failed"; return r; }
    if (!confirmationUrl) { r.error = "no_confirmation_url"; return r; }

    // 5b. Destinataire. Sans email on ne peut PAS relancer → on n'avance RIEN (réessai au run suivant).
    const to = await resolveEmail(admin);
    if (!to) { console.warn(`[Dunning] email absent ${shop} — relance impossible`); r.noEmail = true; return r; }

    // 5c. ENVOI puis — G2 STRICT — n'avancer compteur/date qu'APRÈS un envoi réussi.
    // frozenSince = âge du gel de l'épisode → le mail sait si la grâce court encore (accès maintenu)
    // ou est expirée (accès suspendu). Donnée DÉJÀ en portée (state.frozen_since, lu plus haut) et
    // MÊME colonne que la borne d'entitlement — aucune requête nouvelle. À R1, state.frozen_since est
    // encore null (stampé seulement dans le writeState ci-dessous) → rendu en branche sûre "continue".
    const ok = await sendDunningEmail({ to, shop, plan, confirmationUrl, frozenSince: state.frozen_since ?? null, now: Date.parse(now) });
    if (!ok) { r.mailFailed = true; return r; }      // état NON avancé → réessai au prochain run
    r.mailed = true;
    await writeState({
      shop_domain: shop,
      last_status: "frozen",
      dunning_count: (Number(state.dunning_count) || 0) + 1,
      last_dunning_at: now,
      frozen_since: state.frozen_since ?? now,
      updated_at: now,
    });
  } else if (action === "send_resolved") {
    // Retour à active après relance(s) : confirmation (1×) puis reset compteur APRÈS envoi réussi.
    const plan = nodes.find((n) => n.status === "ACTIVE")?.name ?? null;
    const to = await resolveEmail(admin);
    if (!to) { r.noEmail = true; return r; }
    const ok = await sendDunningResolved({ to, shop, plan });
    if (!ok) { r.mailFailed = true; return r; }      // réessai au prochain run (count encore > 0)
    r.mailed = true;
    await writeState({ shop_domain: shop, last_status: "active", dunning_count: 0, frozen_since: null, updated_at: now });
  } else if (action === "stop_cancelled") {
    // Garde de persistance : on n'écrit que si un épisode existait (jamais de ligne pour une
    // boutique free jamais abonnée). Aucun mail.
    if (prev) await writeState({ shop_domain: shop, last_status: "cancelled", updated_at: now });
  }
  // action === "nothing" → aucune écriture.

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
  const now = new Date().toISOString();

  const results = [];
  for (const shop of shops) {
    try { results.push(await runForShop(shop, now)); }
    catch (e) { console.error(`[Dunning] échec ${shop}:`, e?.message); results.push({ shop, error: e?.message ?? "exception" }); }
  }
  return Response.json({ ok: true, shops: shops.length, results });
}
