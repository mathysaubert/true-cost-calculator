// ── D2-1 (W1) — Offre du marchand lue par l'API Partner, en SECOURS de l'API Admin ─────────────
// Moyen documenté par Shopify pour les apps en App Pricing inscrites après avril 2026 :
// `activeSubscription(appId, shopId)` (API Partner 2026-07, permission « Manage apps »).
// Inactif tant que PARTNER_API_TOKEN, PARTNER_ORG_ID et PARTNER_APP_ID ne sont pas posés (Vercel) :
// l'app se comporte alors exactement comme avant. Ne lève jamais ; le jeton n'est jamais journalisé.
import { planFromPartnerSubscription } from "./plan.js";

const VERSION = "2026-07";
const TIMEOUT_MS = 1500;
const QUERY = `query($a: ID!, $s: ID!) { activeSubscription(appId: $a, shopId: $s) { trialEndsAt cancelAtEndOfCycle items { handle } } }`;

export const partnerConfigured = (env = process.env) => !!(env.PARTNER_API_TOKEN && env.PARTNER_ORG_ID && env.PARTNER_APP_ID);

// shopGid : `gid://shopify/Shop/<n>` (champ shop.id de l'API Admin). Retour :
//   { ok: true, plan: 'free'|'pro'|'expert', sub } ou { ok: false, reason } (non configuré, erreur, délai).
export async function partnerPlan({ shopGid, env = process.env, fetchImpl = fetch, timeoutMs = TIMEOUT_MS }) {
  if (!partnerConfigured(env)) return { ok: false, reason: "not_configured" };
  const num = String(shopGid ?? "").split("/").pop();
  if (!/^\d+$/.test(num)) return { ok: false, reason: "no_shop_id" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://partners.shopify.com/${env.PARTNER_ORG_ID}/api/${VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env.PARTNER_API_TOKEN },
      body: JSON.stringify({ query: QUERY, variables: { a: `gid://shopify/App/${env.PARTNER_APP_ID}`, s: `gid://shopify/Shop/${num}` } }),
      signal: ctrl.signal,
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.errors) return { ok: false, reason: `http_${res.status}${j?.errors ? "_errors" : ""}` };
    const sub = j.data?.activeSubscription ?? null;
    return { ok: true, plan: planFromPartnerSubscription(sub), sub };
  } catch (e) {
    return { ok: false, reason: e?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
