// ════════════════════════════════════════════════════════════════════════════════
//  LOT 41 — D2-1 lot A (2026-09-27) : reconnaissance de l'offre avec Shopify App Pricing.
//  1. Noms App Pricing « Pro », « Expert », préfixe « Expert … » (W2, W6), anciens noms gardés (W5).
//  2. Secours par l'API Partner (W1 c) : correspondance des identifiants, appel, pannes, inactivité.
//  3. Interrupteur SHOPIFY_APP_PRICING et page d'offres de Shopify ; relances sans API de facturation.
//  4. Bêta par prolongation d'essai (W3 b) : plus de BETA_SHOPS ; essai de 14 jours (Y5).
//  Pour lancer : node tests/lot41_d2_1_plan_recognition.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from "node:fs";
import { planEntitlement, planFromPartnerSubscription, PRO_NAMES, EXPERT_NAMES, EXPERT_PREFIXES, LEGACY_PRO_NAME, LEGACY_EXPERT_NAME } from "../app/lib/plan.js";
import { partnerPlan, partnerConfigured } from "../app/lib/partnerPlan.server.js";
import { isAppPricing, pricingPageUrl, DEFAULT_APP_HANDLE, PLAN_OFFERS } from "../app/lib/plans.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (p) => read(p).replace(/\/\/.*$/gm, "");
const ent = (nodes) => { const e = planEntitlement(nodes, { proNames: PRO_NAMES, expertNames: EXPERT_NAMES, expertPrefixes: EXPERT_PREFIXES }); return e.isExpert ? "expert" : e.isPro ? "pro" : "free"; };
const sub = (name, status = "ACTIVE") => ({ name, status });

console.log("\n── 1. Noms des plans ──");
{
  ok(ent([sub("Pro")]) === "pro" && ent([sub("Expert")]) === "expert", "App Pricing : « Pro » → Pro, « Expert » → Expert");
  ok(ent([sub(LEGACY_PRO_NAME)]) === "pro" && ent([sub(LEGACY_EXPERT_NAME)]) === "expert", "anciens noms de l'API de facturation toujours reconnus (abonnés existants, W5)");
  ok(ent([sub("Expert Beta")]) === "expert" && ent([sub("Expert Plus")]) === "expert", "offres sur mesure « Expert … » → Expert (W6)");
  ok(ent([sub("Expertise")]) === "free" && ent([sub("expert")]) === "free" && ent([sub("Pro Max")]) === "free", "préfixe strict : « Expertise », casse différente, « Pro Max » ne donnent rien");
  ok(ent([sub("Free")]) === "free", "« Free » ACTIVE (abonnement à 0 $) → Gratuit");
  // Historique réel mesuré en D2-0 (tcc-tarif-test), du plus récent au plus ancien.
  const d20 = [sub("Pro"), sub("Expert", "CANCELLED"), sub("Free", "CANCELLED"), sub("Pro", "CANCELLED")];
  ok(ent(d20) === "pro", "historique D2-0 (Pro actif, Expert, Free et Pro annulés) → Pro");
  ok(ent([sub("Expert"), sub("Pro", "CANCELLED")]) === "expert" && ent([sub("Pro", "CANCELLED")]) === "free", "changement d'offre : l'abonnement actif décide, les annulés ne comptent pas");
  ok(ent([sub("Expert", "FROZEN")]) === "expert", "gel (FROZEN) dans la grâce : l'accès reste (règle D2 inchangée)");
  ok(PRO_NAMES.every((n) => n.length <= 30) && ["Pro", "Expert", "Free"].every((n) => n.length <= 18), "noms App Pricing dans la limite Shopify (18 caractères)");
}

console.log("\n── 2. API Partner (secours et contrôle) ──");
{
  ok(planFromPartnerSubscription({ items: [{ handle: "pro" }] }) === "pro" && planFromPartnerSubscription({ items: [{ handle: "expert" }] }) === "expert", "identifiants pro / expert");
  ok(planFromPartnerSubscription({ items: [{ handle: "expert-plus" }] }) === "expert" && planFromPartnerSubscription({ items: [{ handle: "free" }] }) === "free" && planFromPartnerSubscription(null) === "free" && planFromPartnerSubscription({ items: [{ handle: "experts" }] }) === "free", "sur mesure « expert-… » ; free, absent ou inconnu → Gratuit");
  const env = { PARTNER_API_TOKEN: "prtapi_test", PARTNER_ORG_ID: "1234567", PARTNER_APP_ID: "364121522177" };
  ok(!partnerConfigured({}) && !partnerConfigured({ PARTNER_API_TOKEN: "x" }) && partnerConfigured(env), "inactif tant que jeton, organisation et app ne sont pas tous posés");
  ok((await partnerPlan({ shopGid: "gid://shopify/Shop/1", env: {} })).reason === "not_configured", "sans configuration : aucun appel, raison « not_configured »");
  const calls = [];
  const fake = (payload, status = 200) => async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(payload), { status }); };
  const r = await partnerPlan({ shopGid: "gid://shopify/Shop/84420296918", env, fetchImpl: fake({ data: { activeSubscription: { trialEndsAt: null, items: [{ handle: "expert" }] } } }) });
  const body = JSON.parse(calls[0].init.body);
  ok(r.ok && r.plan === "expert", "réponse activeSubscription → Expert");
  ok(calls[0].url === "https://partners.shopify.com/1234567/api/2026-07/graphql.json" && calls[0].init.headers["X-Shopify-Access-Token"] === "prtapi_test", "API Partner 2026-07 de l'organisation, jeton en en-tête");
  ok(body.variables.a === "gid://shopify/App/364121522177" && body.variables.s === "gid://shopify/Shop/84420296918" && /activeSubscription\(appId: \$a, shopId: \$s\)/.test(body.query), "identifiants au format documenté (gid://shopify/App, gid://shopify/Shop)");
  ok((await partnerPlan({ shopGid: "gid://shopify/Shop/1", env, fetchImpl: fake({ errors: [{ message: "x" }] }) })).ok === false, "erreur GraphQL → échec propre (le résultat Admin est gardé)");
  ok((await partnerPlan({ shopGid: "gid://shopify/Shop/1", env, fetchImpl: fake({}, 401) })).reason === "http_401", "refus HTTP → échec propre");
  ok((await partnerPlan({ shopGid: null, env, fetchImpl: fake({}) })).reason === "no_shop_id", "sans identifiant de boutique → pas d'appel");
  const slow = (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  ok((await partnerPlan({ shopGid: "gid://shopify/Shop/1", env, fetchImpl: slow, timeoutMs: 30 })).reason === "timeout", "délai dépassé → abandon (1,5 s par défaut)");
  const ps = code("app/lib/plan.server.js");
  ok(/if \(!ent\.isPro\) \{[\s\S]*?partnerPlan\(\{ shopGid: envelope\?\.data\?\.shop\?\.id \}\)[\s\S]*?p\.ok && p\.plan !== "free"/.test(ps), "résolveur : l'API Partner n'est consultée que si aucune offre payante n'est reconnue par l'API Admin");
  ok(/expertPrefixes: EXPERT_PREFIXES/.test(ps) && !/PLAN_PRO|PLAN_EXPERT/.test(ps), "résolveur : listes de noms et préfixe de plan.js");
  ok(/shop \{ id \}/.test(read("app/lib/billing.server.js")) && /shop \{ id \}/.test(read("app/routes/api.cron.profitability.jsx")), "requêtes d'abonnements : identifiant de boutique lu (billing, cron)");
  const cron = code("app/routes/api.cron.profitability.jsx");
  ok(/ent\.source === "live" && partnerConfigured\(\)/.test(cron) && /ÉCART/.test(read("app/routes/api.cron.profitability.jsx")), "cron : contrôle croisé Admin / Partner, écart journalisé");
  ok(!/console\.[a-z]+\([^)]*(TOKEN|env\.)/.test(read("app/lib/partnerPlan.server.js")) && !/console\.[a-z]+\([^)]*PARTNER_API_TOKEN/.test(read("app/lib/plan.server.js") + read("app/routes/api.cron.profitability.jsx")), "le jeton n'est jamais journalisé");
}

console.log("\n── 3. App Pricing : interrupteur, page d'offres, relances ──");
{
  ok(isAppPricing("1") && isAppPricing(" 1 ") && !isAppPricing("") && !isAppPricing(undefined) && !isAppPricing("true") && !isAppPricing("0"), "interrupteur : seul « 1 » allume App Pricing");
  ok(pricingPageUrl("tcc-tarif-test.myshopify.com", "tcc-tarification-test") === "https://admin.shopify.com/store/tcc-tarif-test/charges/tcc-tarification-test/pricing_plans", "page d'offres de l'app de test (adresse vue en D2-0)");
  ok(pricingPageUrl("True-Cost-Dev.myshopify.com") === `https://admin.shopify.com/store/true-cost-dev/charges/${DEFAULT_APP_HANDLE}/pricing_plans`, "vraie app : identifiant par défaut, domaine en minuscules");
  ok(pricingPageUrl("evil.com/x") === null && pricingPageUrl("") === null && pricingPageUrl("a.myshopify.com", "../x") === null, "domaine ou identifiant malformé → aucune adresse");
  const dun = read("app/routes/api.cron.dunning.jsx");
  ok(/if \(isAppPricing\(process\.env\.SHOPIFY_APP_PRICING\)\) \{\s*confirmationUrl = pricingPageUrl\(shop, process\.env\.SHOPIFY_APP_HANDLE\);[\s\S]*?\} else try \{\s*const resp = await admin\.graphql\(CREATE_MUTATION/.test(dun), "relances : App Pricing allumée → lien vers la page d'offres, aucune facturation créée ; éteinte → comportement d'avant");
  const dev = read("scripts/d2_0_dev.mjs");
  ok(/SHOPIFY_APP_PRICING: "1"/.test(dev) && /SHOPIFY_APP_HANDLE: "tcc-tarification-test"/.test(dev), "lanceur de l'app de test : App Pricing allumée, identifiant de l'app de test");
}

console.log("\n── 4. Bêta et essai ──");
{
  ok(!existsSync(new URL("../app/lib/betaShops.js", import.meta.url)) && !existsSync(new URL("./lot21_beta_shops.mjs", import.meta.url)), "module BETA_SHOPS et son lot retirés (W3 b)");
  const all = ["app/lib/billing.server.js", "app/lib/plans.js", "app/routes/app.settings.plan.jsx", "app/shopify.server.js"].map(code).join("\n");
  ok(!/BETA_SHOPS|betaTrial|isBeta/.test(all), "plus aucune référence à la bêta par liste dans le code");
  const cfg = read("app/shopify.server.js");
  ok((cfg.match(/trialDays: 14,/g) ?? []).length === 2 && !/trialDays: 7/.test(cfg), "configuration de facturation : essai de 14 jours (Y5)");
  ok(PLAN_OFFERS.find((o) => o.id === "pro").trialDays === 14 && PLAN_OFFERS.find((o) => o.id === "expert").trialDays === 14, "écran Offre : 14 jours");
  ok(read("package.json").includes("lot41_d2_1_plan_recognition") && !read("package.json").includes("lot21_beta_shops"), "lot 41 dans la chaîne, lot 21 retiré");
}

console.log(`\n══════════════════════════════════════════════════════════════════\n BILAN LOT 41 (D2-1 A) : ${failures === 0 ? "✓ Tous les tests passent" : `✗ ${failures} assertion(s) en échec`}\n══════════════════════════════════════════════════════════════════`);
process.exit(failures === 0 ? 0 : 1);
