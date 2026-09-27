// ════════════════════════════════════════════════════════════════════════════════
//  LOT 42 — D2-1 lot B (2026-09-27) : écran Offre avec Shopify App Pricing.
//  1. Modèle des offres : prix, essai de 14 jours, volumes Y2, arguments W7, badge (W7 point 4).
//  2. App Pricing allumée : un seul bouton « Changer d'offre » vers la page d'offres (W4 a), aucune
//     facturation créée par l'app (action refusée) ; éteinte : montées comme avant.
//  3. Textes validés par Mathys (2026-09-26), mot pour mot, en/fr.
//  Pour lancer : node tests/lot42_d2_1_plan_screen.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { PLAN_OFFERS, planView } from "../app/lib/plans.js";
import { PLAN_ORDER_CAPS } from "../app/lib/plan.js";
import { CATALOGS } from "../app/locales/index.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const by = Object.fromEntries(PLAN_OFFERS.map((o) => [o.id, o]));
const URL_ = "https://admin.shopify.com/store/s/charges/a/pricing_plans";

console.log("\n── 1. Modèle des offres ──");
{
  ok(by.free.price === 0 && by.pro.price === 29 && by.expert.price === 69, "prix 0 / 29 / 69 $ (Y2)");
  ok(by.free.trialDays === 0 && by.pro.trialDays === 14 && by.expert.trialDays === 14, "essai 14 jours sur Pro et Expert (Y5)");
  ok(PLAN_ORDER_CAPS.free === 50 && PLAN_ORDER_CAPS.pro === 500 && PLAN_ORDER_CAPS.expert === 3000 && by.free.orders === 50 && by.pro.orders === 500 && by.expert.orders === 3000, "volumes 50 / 500 / 3 000 commandes par mois, une seule source (plan.js)");
  ok(by.free.features === 4 && by.pro.features === 5 && by.expert.features === 2, "arguments : Gratuit 4, Pro 5, Expert 2 (W7)");
  ok(by.pro.badge === "recommended" && by.free.badge === null && by.expert.badge === null && !CATALOGS.fr["plan.badge.popular"] && !CATALOGS.en["plan.badge.popular"], "« Recommandé » sur Pro seul ; « Populaire » retiré (clé supprimée)");
}

console.log("\n── 2. App Pricing : allumée / éteinte ──");
{
  const off = planView({ ent: { isPro: false, isExpert: false, source: "live" }, appPricing: false, changeUrl: URL_ });
  ok(off.changeUrl === null && off.offers.filter((o) => o.canSubscribe).map((o) => o.id).join(",") === "pro,expert", "éteinte : pas de bouton « Changer d'offre », montées Pro et Expert comme avant");
  const on = planView({ ent: { isPro: false, isExpert: false, source: "live" }, appPricing: true, changeUrl: URL_ });
  ok(on.changeUrl === URL_ && !on.offers.some((o) => o.canSubscribe), "allumée : « Changer d'offre » vers la page d'offres, aucun bouton d'abonnement par carte");
  const ind = planView({ ent: { source: "indeterminate" }, appPricing: true, changeUrl: URL_ });
  ok(ind.indeterminate && ind.current === null && ind.changeUrl === URL_, "plan indéterminé : jamais « Gratuit », mais changer d'offre reste possible");
  const route = read("app/routes/app.settings.plan.jsx");
  ok(/planView\(\{ ent, appPricing: isAppPricing\(process\.env\.SHOPIFY_APP_PRICING\), changeUrl: pricingPageUrl\(session\.shop, process\.env\.SHOPIFY_APP_HANDLE\)/.test(route), "route : interrupteur et page d'offres calculés côté serveur");
  ok(/if \(isAppPricing\(process\.env\.SHOPIFY_APP_PRICING\)\) return \{ intent, ok: false, error: "app_pricing" \};[\s\S]*?intent === "subscribe_pro"/.test(route), "route : App Pricing allumée → l'action refuse toute facturation, avant tout appel");
  const ui = read("app/components/settings/PlanCards.jsx");
  ok(/<s-button variant="primary" href=\{view\.changeUrl\} target="_top">/.test(ui), "bouton : ouvert dans la fenêtre de l'admin (target _top), l'app étant dans un iframe");
  ok(/view\.top \? t\("plan\.top"\) : t\("plan\.fair_use"\)/.test(ui) && /t\("plan\.custom"\)/.test(ui), "pied : « Jamais de blocage » (ou « la plus complète ») et offre sur mesure");
}

console.log("\n── 3. Textes validés (W7) ──");
{
  const fr = CATALOGS.fr, en = CATALOGS.en;
  ok(fr["plan.feature.pro.4"] === "Le résultat réel de vos décisions, mesuré 30 jours après (toutes causes confondues)" && en["plan.feature.pro.4"] === "The real outcome of your decisions, measured 30 days later (all causes combined)", "Pro : résultat réel mesuré 30 jours après, avec la réserve de l'app");
  ok(fr["plan.feature.expert.2"].startsWith("Audit du catalogue : la marge de chaque produit actif") && fr["plan.feature.pro.2"].startsWith("Simulateur complet : toute la boutique, un produit existant ou un nouveau produit"), "Expert : audit ; Pro : Simulateur complet (3 modes réels)");
  ok(fr["plan.change"] === "Changer d'offre" && en["plan.change"] === "Change plan" && fr["plan.volume"] === "Jusqu'à {{count}} commandes par mois", "bouton et volume");
  ok(fr["plan.fair_use"].startsWith("Jamais de blocage") && !/alertes e-mail sont mises en pause/.test(fr["plan.fair_use"]) && !/e-mail alerts pause/.test(en["plan.fair_use"]), "pied : plus de coupure des alertes annoncée (Y3, lot C)");
  const keys = PLAN_OFFERS.flatMap((o) => Array.from({ length: o.features }, (_, i) => `plan.feature.${o.id}.${i + 1}`));
  ok(keys.every((k) => fr[k] && en[k]) && !fr["plan.feature.pro.6"] && !fr["plan.feature.expert.3"] && !fr["plan.feature.free.5"], "chaque argument traduit en/fr, aucune ancienne clé restante");
  ok(!/200 commandes|1 000 commandes|Calculs de marge manuels/.test(Object.entries(fr).filter(([k]) => k.startsWith("plan.")).map(([, v]) => v).join(" ")), "plus aucun ancien argument (200 / 1 000 commandes, calculs manuels de l'écran classique)");
}

ok(read("package.json").includes("lot42_d2_1_plan_screen"), "lot 42 dans la chaîne de tests");
console.log(`\n══════════════════════════════════════════════════════════════════\n BILAN LOT 42 (D2-1 B) : ${failures === 0 ? "✓ Tous les tests passent" : `✗ ${failures} assertion(s) en échec`}\n══════════════════════════════════════════════════════════════════`);
process.exit(failures === 0 ? 0 : 1);
