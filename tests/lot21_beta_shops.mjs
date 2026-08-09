// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Allowlist bêta — essai Expert 45 j (app/lib/betaShops.js, PUR).
//  T1 : isBetaShop — égalité STRICTE sur le domaine complet normalisé (trim + minuscules).
//       Un suffixe, un préfixe ou un sous-domaine ne matchent JAMAIS (« shop.myshopify.com »
//       vs « evilshop.myshopify.com » et l'inverse). Variable absente/vide/malformée = false.
//  T2 : betaTrialOverride — l'objet étalé dans billing.request (handler subscribe_expert) :
//       bêta → { trialDays: BETA_TRIAL_DAYS } ; sinon {} (objet d'appel INCHANGÉ → la lib sert
//       le trialDays: 7 de la config). Pro/Free : handlers non touchés (scan du source, V3).
//  Pour lancer : node tests/lot21_beta_shops.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { isBetaShop, betaTrialOverride, BETA_TRIAL_DAYS } from "../app/lib/betaShops.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

const SHOP = "true-cost-dev.myshopify.com";

// ── T1 : match exact ──
console.log("\n── T1 : match exact ──");
{
  ok(isBetaShop(SHOP, SHOP) === true, "liste à une entrée, domaine identique → match");
  ok(isBetaShop(SHOP, `a.myshopify.com,${SHOP},b.myshopify.com`) === true, "liste multiple, entrée au milieu → match");
  ok(isBetaShop(SHOP, `a.myshopify.com,b.myshopify.com,${SHOP}`) === true, "liste multiple, entrée en fin → match");
  ok(isBetaShop("autre.myshopify.com", SHOP) === false, "domaine hors liste → false");
}

// ── T1 : insensibilité à la casse ──
console.log("\n── T1 : insensibilité à la casse ──");
{
  ok(isBetaShop(SHOP, "True-Cost-Dev.MYSHOPIFY.COM") === true, "entrée env en majuscules → match");
  ok(isBetaShop("TRUE-COST-DEV.myshopify.com", SHOP) === true, "domaine session en majuscules → match");
  ok(isBetaShop("True-Cost-Dev.MyShopify.Com", "TRUE-COST-DEV.MYSHOPIFY.COM") === true, "casse mixte des deux côtés → match");
}

// ── T1 : espaces parasites ──
console.log("\n── T1 : espaces parasites ──");
{
  ok(isBetaShop(SHOP, ` ${SHOP} `) === true, "entrée entourée d'espaces → match");
  ok(isBetaShop(SHOP, ` a.myshopify.com , ${SHOP} , b.myshopify.com `) === true, "espaces autour des virgules → match");
  ok(isBetaShop(`  ${SHOP}  `, SHOP) === true, "domaine session avec espaces → match (trim des deux côtés)");
}

// ── T1 : variable absente / vide / malformée ──
console.log("\n── T1 : variable absente, vide, malformée ──");
{
  ok(isBetaShop(SHOP, undefined) === false, "BETA_SHOPS absente (undefined) → false, pas de crash");
  ok(isBetaShop(SHOP, null) === false, "BETA_SHOPS null → false");
  ok(isBetaShop(SHOP, "") === false, "BETA_SHOPS vide → false");
  ok(isBetaShop(SHOP, "   ") === false, "BETA_SHOPS espaces seuls → false");
  ok(isBetaShop(SHOP, ",,,") === false, "virgules seules (entrées vides) → false");
  ok(isBetaShop(SHOP, ` , ${SHOP} ,, `) === true, "entrées vides mêlées à une entrée valide → la valide matche");
  ok(isBetaShop(SHOP, "pas-un-domaine") === false, "entrée malformée (pas un domaine) → inerte par égalité stricte");
  ok(isBetaShop(SHOP, 42) === false, "BETA_SHOPS non-string (42) → false");
  ok(isBetaShop(SHOP, ["a.myshopify.com"]) === false, "BETA_SHOPS non-string (tableau) → false");
  ok(isBetaShop(undefined, SHOP) === false, "domaine session undefined → false");
  ok(isBetaShop("", SHOP) === false, "domaine session vide → false");
  ok(isBetaShop("   ", `${SHOP},   `) === false, "domaine session espaces vs entrée vide → false (le vide ne matche jamais le vide)");
}

// ── T1 : doublons ──
console.log("\n── T1 : doublons ──");
{
  ok(isBetaShop(SHOP, `${SHOP},${SHOP},${SHOP}`) === true, "entrée dupliquée → match, pas de crash");
  ok(isBetaShop("autre.myshopify.com", `${SHOP},${SHOP}`) === false, "doublons sans le domaine cherché → false");
}

// ── T1 : NON-match suffixe / préfixe / sous-domaine (les deux sens) ──
console.log("\n── T1 : jamais de match par suffixe, préfixe ou sous-domaine ──");
{
  ok(isBetaShop("evil-shop.myshopify.com", "shop.myshopify.com") === false, "« evil-shop.… » vs entrée « shop.… » → false");
  ok(isBetaShop("shop.myshopify.com", "evil-shop.myshopify.com") === false, "« shop.… » vs entrée « evil-shop.… » → false (sens inverse)");
  ok(isBetaShop("evilshop.myshopify.com", "shop.myshopify.com") === false, "« evilshop.… » (suffixe sans tiret) vs « shop.… » → false");
  ok(isBetaShop("shop.myshopify.com", "myshopify.com") === false, "entrée tronquée « myshopify.com » ne matche aucun shop complet");
  ok(isBetaShop("sub.shop.myshopify.com", "shop.myshopify.com") === false, "sous-domaine vs domaine → false");
  ok(isBetaShop("shop.myshopify.com", "sub.shop.myshopify.com") === false, "domaine vs sous-domaine → false (sens inverse)");
  ok(isBetaShop("shop.myshopify.com.evil.com", "shop.myshopify.com") === false, "préfixe (domaine rallongé à droite) → false");
  ok(isBetaShop("shop.myshopify.com", "shop.myshopify.com.evil.com") === false, "entrée rallongée à droite → false (sens inverse)");
  ok(isBetaShop("shop.myshopify.co", "shop.myshopify.com") === false, "troncature d'un caractère → false (égalité stricte)");
}

// ── T2 : paramétrage d'abonnement — l'override étalé dans billing.request ──
console.log("\n── T2 : betaTrialOverride (objet étalé dans billing.request) ──");
{
  ok(BETA_TRIAL_DAYS === 45, "BETA_TRIAL_DAYS = 45 (constante unique)");
  const beta = betaTrialOverride(SHOP, SHOP);
  ok(beta.trialDays === BETA_TRIAL_DAYS && Object.keys(beta).length === 1,
    "shop bêta + Expert → override exactement { trialDays: BETA_TRIAL_DAYS }");
  const normal = betaTrialOverride("autre.myshopify.com", SHOP);
  ok(Object.keys(normal).length === 0,
    "shop normal + Expert → override {} : l'objet passé à billing.request est INCHANGÉ");
  ok(Object.keys(betaTrialOverride(SHOP, undefined)).length === 0,
    "BETA_SHOPS absente → override {} pour tout shop (défaut sûr prod)");
  // Sémantique de fusion de la lib billing (mergeBillingConfigs = { ...config, ...overrides }) :
  // on prouve la valeur FINALE de trialDays pour chaque cas, config nominale 7 intacte.
  ok({ trialDays: 7, ...betaTrialOverride(SHOP, SHOP) }.trialDays === 45, "fusion config+override : bêta → 45");
  ok({ trialDays: 7, ...betaTrialOverride("autre.myshopify.com", SHOP) }.trialDays === 7, "fusion config+override : normal → 7 (config)");
}

// ── T2/V3 : scan du source — l'override ne vit QUE dans subscribe_expert ; Pro/Free intacts ──
console.log("\n── T2/V3 : périmètre du câblage dans le source ──");
{
  const route = readFileSync(new URL("../app/routes/app._index.jsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("../app/shopify.server.js", import.meta.url), "utf8");

  const calls = route.match(/betaTrialOverride\(/g) ?? [];
  ok(calls.length === 1, "app._index.jsx : exactement UN appel betaTrialOverride (le handler subscribe_expert)");

  const proBlock = route.slice(route.indexOf('_action === "subscribe"'), route.indexOf('_action === "subscribe_expert"'));
  const expertBlock = route.slice(route.indexOf('_action === "subscribe_expert"'), route.indexOf("// Plan check for action handlers"));
  ok(proBlock.length > 0 && expertBlock.length > 0, "les deux handlers subscribe sont localisés dans le source");
  ok(!proBlock.includes("betaTrialOverride") && !proBlock.includes("trialDays"),
    "handler Pro : AUCUN override, aucun trialDays → shop bêta + Pro reçoit 7 j (O4)");
  ok(expertBlock.includes("betaTrialOverride(session.shop, process.env.BETA_SHOPS)"),
    "handler Expert : override branché sur session.shop + process.env.BETA_SHOPS (env lue au site d'appel, O2)");
  ok(expertBlock.includes("isTest: await isDevStore(admin)"),
    "handler Expert : la ligne isTest est INTACTE (O8 — bêta réelle → test:false)");

  // V3 : plus aucun trialDays en dur hors {config nominale 7 ; constante BETA_TRIAL_DAYS}.
  ok(!/trialDays\s*:\s*\d/.test(route), "app._index.jsx : aucun trialDays numérique en dur");
  ok((server.match(/trialDays\s*:\s*7\b/g) ?? []).length === 2,
    "shopify.server.js : la config nominale trialDays: 7 des DEUX plans est intacte");
  ok(!server.includes("BETA"), "shopify.server.js : aucune logique bêta (la config nominale ne bouge pas)");
  // Scan du CODE seul (commentaires retirés) : la prose a le droit de citer process.env ou 45.
  const libCode = readFileSync(new URL("../app/lib/betaShops.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  ok(!libCode.includes("process.env"), "betaShops.js : aucune lecture de process.env dans le code (helper PUR, O2)");
  ok((libCode.match(/45/g) ?? []).length === 1, "betaShops.js : la valeur 45 n'apparaît qu'une fois dans le code (la constante BETA_TRIAL_DAYS)");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 21 (allowlist bêta) : ✓ Tous les tests passent"
  : ` BILAN LOT 21 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
