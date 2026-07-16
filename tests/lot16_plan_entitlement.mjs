// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Plan — droit au plan payant (app/lib/plan.js, PUR). Cœur : un abonnement
//  FROZEN (paiement échoué, fenêtre de grâce Shopify) donne droit au plan payant TANT QUE la
//  grâce n'est pas expirée — c'est le bug que loader/action masquaient (filtre status==="ACTIVE").
//  Couvre aussi : borne FROZEN (D2), gating par ENSEMBLE de noms / renommage (D3), repli sur
//  dernier plan connu (D1), et un test DE BOUT EN BOUT depuis une réponse GraphQL réelle (D5).
//  Pour lancer : node tests/lot16_plan_entitlement.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import {
  planEntitlement,
  entitlementFromPlan,
  fallbackEntitlement,
  retryForLiveEnvelope,
  subscriptionNodesFromResponse,
  planToOrderCap,
  alertingEnabled,
  FROZEN_GRACE_DAYS,
} from "../app/lib/plan.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

const PRO = "True Cost Calculator Pro", EXPERT = "True Cost Calculator Expert";
const node = (name, status) => ({ id: `gid://x/${Math.random()}`, name, status });
// Options par défaut du gating (mêmes que resolveEntitlement) : noms en ENSEMBLE.
const ent = (nodes, extra = {}) => planEntitlement(nodes, { proNames: [PRO], expertNames: [EXPERT], ...extra });
const DAY = 86_400_000;

// ── ACTIVE : droit au plan (référence) ──
console.log("\n── ACTIVE ──");
{
  const p = ent([node(PRO, "ACTIVE")]);
  ok(p.isPro && !p.isExpert, "Pro ACTIVE → isPro, pas Expert");
  const e = ent([node(EXPERT, "ACTIVE")]);
  ok(e.isPro && e.isExpert, "Expert ACTIVE → isPro ET isExpert");
}

// ── FROZEN : LE FIX — droit MAINTENU pendant la fenêtre de grâce ──
console.log("\n── FROZEN : accès maintenu dans la grâce ──");
{
  const p = ent([node(PRO, "FROZEN")]);   // frozenSince par défaut null → grâce accordée
  ok(p.isPro === true, "Pro FROZEN (grâce en cours) → isPro = true (plus de rétrogradation au 1er échec)");
  ok(p.isExpert === false, "Pro FROZEN → pas Expert");
  const e = ent([node(EXPERT, "FROZEN")]);
  ok(e.isPro && e.isExpert, "Expert FROZEN → isPro ET isExpert");
}

// ── D2 : la grâce FROZEN est BORNÉE (pas de payant à vie sans payer) ──
console.log("\n── D2 : borne de la grâce FROZEN ──");
{
  const now = Date.now();
  const within = ent([node(PRO, "FROZEN")], { frozenSince: now - 10 * DAY, now });
  ok(within.isPro === true, `FROZEN depuis 10 j (< ${FROZEN_GRACE_DAYS}) → encore isPro`);
  const boundary = ent([node(PRO, "FROZEN")], { frozenSince: now - FROZEN_GRACE_DAYS * DAY, now });
  ok(boundary.isPro === true, `FROZEN pile à ${FROZEN_GRACE_DAYS} j → encore isPro (borne inclusive)`);
  const expired = ent([node(PRO, "FROZEN")], { frozenSince: now - (FROZEN_GRACE_DAYS + 5) * DAY, now });
  ok(expired.isPro === false, `FROZEN depuis ${FROZEN_GRACE_DAYS + 5} j → grâce expirée → free`);
  // frozen_since inconnu (épisode non encore daté par le dunning) → bénéfice du doute.
  ok(ent([node(PRO, "FROZEN")], { frozenSince: null, now }).isPro === true, "FROZEN sans frozen_since → grâce accordée");
}

// ── D3 : gating par ENSEMBLE de noms — un renommage ne rend pas les abonnés invisibles ──
console.log("\n── D3 : alias de noms (robustesse au renommage) ──");
{
  // Un sub vendu sous l'ANCIEN nom reste gaté si on garde l'alias dans l'ensemble.
  const legacy = planEntitlement([node("Pro (ancien nom)", "ACTIVE")], {
    proNames: ["Pro (ancien nom)", PRO], expertNames: [EXPERT],
  });
  ok(legacy.isPro === true, "sub sous ancien nom + alias conservé → toujours isPro");
  // Un nom hors ensemble n'entitle pas (évite les faux positifs).
  ok(ent([node("Un autre plan", "ACTIVE")]).isPro === false, "nom inconnu (hors ensemble) → free");
}

// ── statuts NON entitlants → free ──
console.log("\n── statuts NON entitlants → free ──");
{
  for (const st of ["CANCELLED", "EXPIRED", "DECLINED", "PENDING"]) {
    const p = ent([node(PRO, st)]);
    ok(!p.isPro && !p.isExpert, `Pro ${st} → free (ni isPro ni isExpert)`);
  }
  ok(!ent([]).isPro, "aucun abonnement → free");
}

// ── FROZEN noyé dans le bruit d'historique ──
console.log("\n── FROZEN noyé dans le bruit d'historique ──");
{
  const p = ent([node(EXPERT, "CANCELLED"), node(PRO, "EXPIRED"), node(PRO, "FROZEN"), node(PRO, "DECLINED")]);
  ok(p.isPro === true && p.isExpert === false, "FROZEN Pro compté malgré CANCELLED/EXPIRED/DECLINED autour");
  const e = ent([node(PRO, "CANCELLED"), node(EXPERT, "ACTIVE")]);
  ok(e.isPro && e.isExpert, "Expert ACTIVE + vieux Pro CANCELLED → isExpert");
}

// ── D1 : repli PUR sur le dernier plan connu (utilisé quand l'appel GraphQL échoue) ──
console.log("\n── D1 : repli sur dernier plan connu ──");
{
  ok(entitlementFromPlan("expert").isExpert && entitlementFromPlan("expert").isPro, "cache 'expert' → isPro + isExpert");
  ok(entitlementFromPlan("pro").isPro && !entitlementFromPlan("pro").isExpert, "cache 'pro' → isPro seul");
  ok(!entitlementFromPlan("free").isPro, "cache 'free' → free");
  ok(!entitlementFromPlan(null).isPro && !entitlementFromPlan(undefined).isPro, "cache absent (null/undefined) → free");
}

// ── Q1 : échec live + shop_plans VIDE → INDÉTERMINÉ (jamais un free dégradé silencieux) ──
// fallbackEntitlement EST ce que renvoie resolveEntitlement dans sa branche 'pas de signal live'
// (plan.server.js) : `if (lastPlan != null) return fallbackEntitlement(lastPlan)` puis, retries
// épuisés, `return fallbackEntitlement(null)`. Entrée = dernier plan connu (shop_plans.plan) ou null.
// Le loader lève sur source==='indeterminate' (→ ErrorBoundary) ; l'action renvoie un retry. Donc
// prouver ici que null → 'indeterminate' (≠ 'cache'/'live') prouve qu'un marchand au plan inconnu
// n'est PAS rendu free en silence.
console.log("\n── Q1 : échec live + cache vide → indéterminé, pas free ──");
{
  const empty = fallbackEntitlement(null); // GraphQL échoué + shop_plans sans ligne (nouveau marchand)
  ok(empty.source === "indeterminate", "GraphQL échoué + cache vide → source 'indeterminate'");
  ok(empty.source !== "cache" && empty.source !== "live", "… distinct de 'cache'/'live' : PAS un free dégradé silencieux");
  ok(empty.isPro === false && empty.isExpert === false, "… n'accorde rien (géré par retry/ErrorBoundary côté appelant, pas rendu free)");
  // undefined (lecture shop_plans qui a échoué) traité comme inconnu, pas comme free.
  ok(fallbackEntitlement(undefined).source === "indeterminate", "cache illisible (undefined) → 'indeterminate' aussi");
  // Distinction clé : un 'free' CONNU (résolu par un succès live passé) reste servi comme tel.
  const knownFree = fallbackEntitlement("free");
  ok(knownFree.source === "cache" && !knownFree.isPro, "cache 'free' CONNU → 'cache' (réellement gratuit), distinct de l'indéterminé");
  // Plans payants connus : servis depuis le cache (D1, non dégradant).
  ok(fallbackEntitlement("pro").source === "cache" && fallbackEntitlement("pro").isPro, "cache 'pro' connu → 'cache' + isPro (D1)");
  ok(fallbackEntitlement("expert").isExpert && fallbackEntitlement("expert").source === "cache", "cache 'expert' connu → 'cache' + isExpert (D1)");
}

// ── Q3 : boucle de retry BORNÉE (refetch mocké) — exécutée, pas narrée ──
// retryForLiveEnvelope EST la boucle qu'utilise resolveEntitlement (plan.server.js) avant de
// conclure 'indeterminate'. On injecte un refetch mocké + sleep no-op (pas d'attente réelle) et on
// prouve : (a) 2 échecs → reste non-live → 'indeterminate' ; (b) 1 échec puis succès → 'live'.
console.log("\n── Q3 : boucle de retry bornée (refetch mocké) ──");
{
  const hasLive = (j) => Array.isArray(j?.data?.currentAppInstallation?.allSubscriptions?.edges);
  const noop = () => Promise.resolve();
  const liveEnv = { data: { currentAppInstallation: { allSubscriptions: { edges: [] } } } };

  // (a) échoue 2 fois (refetch renvoie du non-live) → jamais live → l'appelant rend 'indeterminate'.
  let callsA = 0;
  const outA = await retryForLiveEnvelope({
    envelope: null, hasLive, retries: 2, sleep: noop,
    refetch: () => { callsA++; return Promise.resolve(null); },
  });
  ok(callsA === 2, "échoue 2× : refetch appelé exactement 2 fois (retries épuisés)");
  ok(hasLive(outA) === false, "… toujours non-live → resolveEntitlement rendra 'indeterminate'");
  ok(fallbackEntitlement(hasLive(outA) ? "pro" : null).source === "indeterminate", "… soit bien la branche 'indeterminate' (pas un free dégradé)");

  // (b) échoue 1 fois puis réussit → s'arrête au succès → 'live'.
  let callsB = 0;
  const outB = await retryForLiveEnvelope({
    envelope: null, hasLive, retries: 2, sleep: noop,
    refetch: () => { callsB++; return Promise.resolve(callsB === 1 ? null : liveEnv); },
  });
  ok(callsB === 2, "1 échec puis succès : refetch appelé 2 fois, s'arrête au succès");
  ok(hasLive(outB) === true, "… enveloppe live obtenue → resolveEntitlement résout en 'live'");

  // (c) refetch qui REJETTE (Shopify injoignable) → traité non-live, aucun crash.
  const outC = await retryForLiveEnvelope({
    envelope: null, hasLive, retries: 2, sleep: noop,
    refetch: () => Promise.reject(new Error("net down")),
  });
  ok(hasLive(outC) === false, "refetch qui rejette → non-live (pas de crash) → 'indeterminate'");

  // (d) budget de temps TOTAL : coupe avant d'épuiser les retries (Shopify lent, pas mort).
  let callsD = 0, clock = 0;
  const outD = await retryForLiveEnvelope({
    envelope: null, hasLive, retries: 5, delayMs: 200, budgetMs: 500,
    now: () => clock, sleep: (ms) => { clock += ms; return Promise.resolve(); },
    refetch: () => { callsD++; return Promise.resolve(null); },
  });
  ok(callsD === 2, `budget 500ms / delay 200ms → coupé à 2 tentatives (pas 5) malgré retries=5 (obtenu ${callsD})`);
  ok(hasLive(outD) === false, "… budget épuisé → non-live → 'indeterminate' (jamais bloquant)");
}

// ── D5 : DE BOUT EN BOUT depuis une réponse GraphQL RÉELLE (enveloppe Shopify) ──
// La fixture reproduit l'enveloppe AppSubscriptionConnection documentée par Shopify
// (data.currentAppInstallation.allSubscriptions.edges[].node). On EXÉCUTE l'extraction PARTAGÉE
// par le loader/l'action (subscriptionNodesFromResponse) : si la forme dérive d'un cran, elle
// renvoie [] → billingIsPro devient false → CE test rougit. Le statut FROZEN ne pouvant pas être
// forcé sur demande (il faut un vrai échec de paiement), il est posé dans l'enveloppe réelle.
// Rafraîchir : capturer la vraie réponse sur le dev store, réinjecter les mêmes 3 champs.
console.log("\n── D5 : réponse GraphQL réelle → billingIsPro ──");
{
  const raw = JSON.parse(readFileSync(new URL("./fixtures/allSubscriptions.frozen.json", import.meta.url)));
  const nodes = subscriptionNodesFromResponse(raw);
  ok(nodes.length === 3, "extraction : 3 nœuds sortis de l'enveloppe réelle (garde-fou de forme)");
  ok(nodes[0].status === "FROZEN" && nodes[0].name === PRO, "1er nœud (reverse:true) = Pro FROZEN courant");
  const { isPro, isExpert } = planEntitlement(nodes, { proNames: [PRO], expertNames: [EXPERT], frozenSince: null, now: Date.now() });
  ok(isPro === true, "réponse RÉELLE (Pro FROZEN) → billingIsPro = true de bout en bout");
  ok(isExpert === false, "… et pas Expert (l'Expert de l'historique est CANCELLED)");
}

// ── robustesse : entrées absentes / malformées ──
console.log("\n── robustesse ──");
{
  ok(!planEntitlement(undefined, { proNames: [PRO], expertNames: [EXPERT] }).isPro, "nodes undefined → free (pas de crash)");
  ok(!ent([null, { name: PRO }, { status: "FROZEN" }]).isPro, "nœuds partiels (name/status manquants) → free");
  ok(subscriptionNodesFromResponse(null).length === 0, "réponse null → 0 nœud (pas de crash)");
  ok(subscriptionNodesFromResponse({ data: {} }).length === 0, "enveloppe vide → 0 nœud");
}

// ── C4a : plafond d'alerting — palier par plan + activation (bascule différée, borne inclusive) ──
console.log("\n── C4a : planToOrderCap + alertingEnabled ──");
{
  ok(planToOrderCap({ isPro: false, isExpert: false }) === 200, "Gratuit → 200 commandes/mois");
  ok(planToOrderCap({ isPro: true, isExpert: false }) === 1000, "Pro → 1000 commandes/mois");
  ok(planToOrderCap({ isPro: true, isExpert: true }) === Infinity, "Expert → illimité (Infinity)");
  ok(planToOrderCap({}) === 200, "entrée vide (défaut) → 200 (traité comme gratuit)");
  // alertingEnabled : compteur du mois PRÉCÉDENT vs palier, borne INCLUSIVE.
  ok(alertingEnabled(150, 200) === true, "150 ≤ 200 (sous le palier) → alerting activé");
  ok(alertingEnabled(200, 200) === true, "200 == 200 (pile au palier, borne inclusive) → encore activé");
  ok(alertingEnabled(201, 200) === false, "201 > 200 (dépassé au mois M) → alerting coupé (M+1)");
  ok(alertingEnabled(999999, Infinity) === true, "Expert (cap Infinity) → toujours activé quel que soit le volume");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 16 (droit au plan) : ✓ Tous les tests passent"
  : ` BILAN LOT 16 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
