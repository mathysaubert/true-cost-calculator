# Phase 0 — Essai Expert 45 jours pour boutiques bêta (allowlist BETA_SHOPS)

Date : 2026-08-09. Exploration seule : aucun code produit, aucun fichier applicatif touché.
Statut : STOP en fin de Phase 0 (conforme au chantier) + une condition S1 levée à trancher
(voir P0.1, chemin dunning).

---

## P0.1 — Cartographie billing

### Point de création d'abonnement Expert (chemin nominal)

Un seul handler de souscription Expert, dans l'action de `app/routes/app._index.jsx` :

- `app/routes/app._index.jsx:885-892` — `body._action === "subscribe_expert"` :

```js
if (body._action === "subscribe_expert") {
  await billing.request({
    plan: PLAN_EXPERT,
    isTest: await isDevStore(admin), // dev store → test ; toute incertitude → false (facturation réelle)
    returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?subscribed=true`,
  });
  return null;
}
```

- Le handler Pro équivalent est `app/routes/app._index.jsx:872-882` (`_action === "subscribe"`).
- Les deux boutons UI (`subscribeBtn` / `subscribeExpertBtn`, lignes 2848-2860) postent des
  `_action` figées — aucun autre déclencheur.

### Site exact du trialDays actuel (le fix « missing trialDays », commit 9a76bb8)

`app/shopify.server.js:30-51` — config `billing` de `shopifyApp`, `trialDays` au niveau du PLAN
(sibling de `lineItems`) :

```js
billing: {
  [PLAN_PRO]: {
    trialDays: 7,
    lineItems: [{ amount: 29, currencyCode: "USD", interval: BillingInterval.Every30Days }],
  },
  [PLAN_EXPERT]: {
    trialDays: 7,
    lineItems: [{ amount: 69, currencyCode: "USD", interval: BillingInterval.Every30Days }],
  },
},
```

Les handlers subscribe ne passent aucun `trialDays` : la valeur vient de cette config
(cf. commentaire `app/shopify.server.js:26-29`).

### DÉCOUVERTE — second chemin appSubscriptionCreate : le cron dunning (condition S1)

`app/routes/api.cron.dunning.jsx:37-44` définit une mutation `appSubscriptionCreate` directe
(`CREATE_MUTATION`), exécutée en `api.cron.dunning.jsx:102-107` :

```js
const resp = await admin.graphql(CREATE_MUTATION, { variables: {
  name: plan,                       // = frozenNode.name : peut être "True Cost Calculator Expert"
  returnUrl: `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?subscribed=true`,
  test: isTest,                     // = frozenNode.test === true (mode du sub d'origine)
  lineItems,                        // pricing relu du sub gelé (jamais sous-facturer)
} });
```

Caractérisation :

- Ce chemin ne crée PAS une souscription initiale : il recrée la charge d'un abonnement FROZEN
  (échec de paiement) au même nom, même prix, même mode test, et — délibérément — SANS
  `trialDays` (un abonné gelé ne doit pas recevoir un nouvel essai gratuit).
- Y injecter 45 jours serait une régression : une boutique bêta dont le paiement échoue à J+46
  obtiendrait 45 jours gratuits supplémentaires à chaque relance.

Lecture proposée : ce chemin est hors périmètre O3 (« création d'un abonnement EXPERT » au sens
souscription avec essai) et ne doit pas être modifié. Mais au sens strict de S1 (« plusieurs
chemins de création d'abonnement Expert »), la condition est levée : je m'arrête et je soumets
cette lecture à validation au lieu de trancher seul. **Décision attendue : confirmer que le
chemin dunning reste intouché et hors périmètre.**

---

## P0.2 — API réellement disponible (citations du code installé)

### Versions installées (lues sur disque)

- `package.json` : `"@shopify/shopify-app-react-router": "^1.1.0"`
- `node_modules/@shopify/shopify-app-react-router/package.json` : version **1.2.0**
- `node_modules/@shopify/shopify-api/package.json` : version **13.0.0** (dépendance effective
  qui exécute la mutation billing)

### Preuve que trialDays est surchargeable par requête

1. Le wrapper react-router transmet tout paramètre supplémentaire de `billing.request` en
   overrides — `node_modules/@shopify/shopify-app-react-router/dist/esm/server/authenticate/admin/billing/request.mjs:8-26` :

```js
return async function requestBilling({ plan, isTest, returnUrl, ...overrides }) {
  ...
  result = await api.billing.request({
    plan: plan,
    session,
    isTest,
    returnUrl,
    returnObject: true,
    ...overrides,
  });
```

2. La lib sous-jacente fusionne ces overrides PAR-DESSUS la config du plan —
   `node_modules/@shopify/shopify-api/dist/esm/lib/billing/request.mjs` :

```js
// :68
return async function ({ session, plan, isTest = true, returnUrl: returnUrlParam, returnObject = false, ...overrides }) {
// :75-78
const billingConfig = { ...config.billing[plan] };
const filteredOverrides = Object.fromEntries(Object.entries(overrides).filter(([_key, value]) => value !== undefined));
// :93-94
if (isLineItemPlan(billingConfig)) {
    const mergedBillingConfigs = mergeBillingConfigs(billingConfig, filteredOverrides);
// :219-220
function mergeBillingConfigs(billingConfig, overrides) {
    const mergedConfig = { ...billingConfig, ...overrides };
```

3. La valeur fusionnée est celle passée à la mutation —
   `request.mjs:181-190` :

```js
const mutationResponse = await client.request(RECURRING_PURCHASE_MUTATION, {
    variables: {
        name: plan,
        trialDays: billingConfig.trialDays,   // billingConfig = mergedBillingConfigs ici
        ...
```

Conclusion : `billing.request({ plan, isTest, returnUrl, trialDays: 45 })` applique 45 jours
pour CET appel, sans toucher la config (qui garde `trialDays: 7` comme défaut pour tous les
autres appels). Détail utile : `filteredOverrides` élimine les clés `undefined` → un override
absent ou `undefined` retombe exactement sur le 7 de la config.

---

## P0.3 — Reconnaissance du plan (sortie brute des greps)

### Constat central

Toute l'identité de plan du dépôt passe par UN entonnoir : les noms ne sont comparés QUE dans
`app/lib/plan.js` (`planEntitlement`, via les ensembles `proNames`/`expertNames`) alimentés par
`app/lib/plan.server.js:20-21` (`PRO_NAMES = [PLAN_PRO]`, `EXPERT_NAMES = [PLAN_EXPERT]`).
Tout le reste du dépôt consomme les booléens dérivés `{ isPro, isExpert }`. L'option A
(aucun nouveau nom de plan) ne modifie donc AUCUN des points ci-dessous.

### Grep `PLAN_EXPERT|PLAN_PRO` (comparaisons de noms)

```
app\shopify.server.js:11:export const PLAN_PRO = "True Cost Calculator Pro";
app\shopify.server.js:12:export const PLAN_EXPERT = "True Cost Calculator Expert";
app\shopify.server.js:31:    [PLAN_PRO]: {
app\shopify.server.js:41:    [PLAN_EXPERT]: {
app\routes\app._index.jsx:3:import { authenticate, PLAN_PRO, PLAN_EXPERT } from "../shopify.server";
app\routes\app._index.jsx:877:      plan: PLAN_PRO,
app\routes\app._index.jsx:887:      plan: PLAN_EXPERT,
app\lib\plan.server.js:10:import { PLAN_PRO, PLAN_EXPERT } from "../shopify.server";
app\lib\plan.server.js:20:const PRO_NAMES = [PLAN_PRO];
app\lib\plan.server.js:21:const EXPERT_NAMES = [PLAN_EXPERT];
```

### Grep `resolveEntitlement|planToOrderCap|alertingEnabled|HISTORY_LIMIT` (consommateurs)

```
app\lib\plan.server.js:48:export async function resolveEntitlement({ shop, json, refetch = null, retries = 2, retryDelayMs = 200, retryBudgetMs = RETRY_BUDGET_MS }) {
app\lib\plan.js:81:export function planToOrderCap(ent = {}) {
app\lib\plan.js:88:export function alertingEnabled(prevMonthCount, cap) {
app\lib\profitabilityAlert.js:186:export function decideAlertAction({ alertingEnabled, hasEmail, hasBasculements } = {}) {
app\lib\profitabilityAlert.js:188:  if (!alertingEnabled) return "suppress";
app\routes\api.cron.profitability.jsx:14:import { resolveEntitlement } from "../lib/plan.server";
app\routes\api.cron.profitability.jsx:15:import { planToOrderCap, alertingEnabled, previousMonth } from "../lib/plan.js";
app\routes\api.cron.profitability.jsx:123:      const ent = await resolveEntitlement({ shop, json: subJson, refetch: async () => (await admin.graphql(ALL_SUBS_QUERY)).json() });
app\routes\api.cron.profitability.jsx:127:        cap = planToOrderCap(ent);
app\routes\api.cron.profitability.jsx:131:        enabled = alertingEnabled(prevCount, cap);
app\routes\app._index.jsx:33:import { resolveEntitlement } from "../lib/plan.server";
app\routes\app._index.jsx:34:import { planToOrderCap, alertingEnabled, previousMonth } from "../lib/plan.js";
app\routes\app._index.jsx:39:const HISTORY_LIMIT_EXPERT = 200;
app\routes\app._index.jsx:40:const HISTORY_LIMIT_PRO = 50;
app\routes\app._index.jsx:41:const HISTORY_LIMIT_FREE = 0;
app\routes\app._index.jsx:631:  const ent = await resolveEntitlement({
app\routes\app._index.jsx:709:      .limit(isExpert ? HISTORY_LIMIT_EXPERT : isPro ? HISTORY_LIMIT_PRO : HISTORY_LIMIT_FREE),
app\routes\app._index.jsx:814:  const alertingCap = planToOrderCap({ isPro, isExpert });
app\routes\app._index.jsx:815:  const alertingActive = alertingEnabled(ordersPrevMonth, alertingCap);
app\routes\app._index.jsx:901:  const billingEnt = await resolveEntitlement({
```

### Grep `isExpert|isPro|shop_plans` — points recensés (extraits significatifs)

- Gates Expert des onglets : Audit Catalogue `app._index.jsx:3538` (`!isExpert ? <ExpertGate/>`),
  auto-refresh audit `:2624`, Suivi des coûts `:3804` (`CostTracker isExpert={isExpert}`),
  sparkline annotable `:206/:221/:3405`, colonnes CPA `:1989/:2018`.
- Plafonds d'alerting par plan : `plan.js:81-83` (`planToOrderCap` : Expert Infinity / Pro 1000 /
  Free 200), bandeau `AlertingQuotaBanner` `app._index.jsx:2058-2062`, cron
  `api.cron.profitability.jsx:127-131`.
- Quotas historique : `app._index.jsx:39-41` + `:709` (`HISTORY_LIMIT_*`).
- Badge « Plan Expert actif » : `app._index.jsx:3977` (`isExpert ? "✦ Plan Expert actif" : ...`),
  badge EXPERT en entête `:3003-3004`, bienvenue `:2904-2906`.
- Cron `api.cron.profitability.jsx` : plan dérivé par `resolveEntitlement` (`:123`), jamais par nom.
- Sync billing → `shop_plans` (celui qui peut écraser) : `plan.server.js:109-116`, upsert du label
  `planLabel(ent)` (`'expert'|'pro'|'free'`) UNIQUEMENT sur succès live ; repli lecture `:56-66` ;
  repli pur `plan.js:102-121` (`entitlementFromPlan`, `fallbackEntitlement`, `KNOWN_PLANS`).
- Lectures `shop_plans` pour RÉGLAGES (pas d'identité de plan) : `app._index.jsx:714` et
  `:916-:1193` (taux, seuils, CPA), `orderSync.server.js:18`, `recalcEstimatedMargins.server.js:94`,
  `api.cron.profitability.jsx:81-83`, `profitabilityAlert.js:21`, `auditClassify.js:3`.
- Purges : `webhooks.app.uninstalled.jsx:28`, `webhooks.compliance.jsx:41` (delete `shop_plans`).
- Dunning : agnostique au nom (recrée `frozenNode.name` tel quel), aucun gate par nom.

---

## P0.4 — UI & chaînes

Grep insensible à la casse `7 jours|7 days|essai|trial` sur `app/**` : les seules occurrences
sont (1) les commentaires de `shopify.server.js` (non rendus), (2) des mots français contenant
« essai » par coïncidence (« réessai » dans les commentaires dunning/email, non rendus), et (3) :

```
app\routes\app._index.jsx:3380: {f === "all" ? "Tout" : f === "7d" ? "7 jours" : f === "30d" ? "30 jours" : "90 jours"}
```

Ce « 7 jours » est le filtre de PÉRIODE du graphique d'historique (fenêtre 7d/30d/90d) — aucun
rapport avec l'essai. La page de tarifs in-app (`app._index.jsx:3017-3080`) affiche des prix en
dur (0/29/69 $/mois) et ne mentionne l'essai nulle part ; la durée d'essai n'est montrée au
marchand QUE sur l'écran d'approbation Shopify (hors app), qui affichera nativement la bonne
valeur (7 ou 45) puisqu'elle vient de la mutation.

Conclusion : ZÉRO chaîne rendue à modifier, aucune incohérence possible in-app, I2 sans objet.
Le chantier atteint son idéal R5 : zéro nouvelle chaîne visible, zéro diff UI.

---

## P0.5 — Environnement

Pattern existant : lecture DIRECTE de `process.env.X` au point d'usage serveur, sans couche de
validation centrale. Exemples :

- `app/shopify.server.js:15-19` (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET || ""`, `SCOPES?.split(",")`,
  `SHOPIFY_APP_URL || ""`) et `:52-54` (spread conditionnel
  `...(process.env.SHOP_CUSTOM_DOMAIN ? { customShopDomains: [...] } : {})` — variable absente =
  branche vide, aucun crash, aucun warning).
- `app/routes/api.cron.dunning.jsx:155-158` (`CRON_SECRET` : `!secret → 401`, défaut sûr).

Pattern à réutiliser tel quel : lire `process.env.BETA_SHOPS` au site d'appel (handler
`subscribe_expert`) et passer la valeur BRUTE au helper pur `isBetaShop(shopDomain, rawBetaShops)`
(aucune lecture d'env dans le helper, conforme O2). `BETA_SHOPS` absente → `undefined` → le helper
retourne `false` pour tout shop → défaut sûr O1, aucun crash, aucun warning.

---

## P0.6 — Matrice de décision

### Option A — surcharge de trialDays à l'appel (RECOMMANDÉE)

Possible proprement : prouvé par le code installé (P0.2). Aucun nouveau nom de plan (priorité
absolue du chantier satisfaite).

Risques listés :

1. Réintroduire le bug « trialDays manquant » en retirant la valeur de la config → n'arrive pas :
   la config garde `trialDays: 7` sur les deux plans, l'override n'est AJOUTÉ que pour
   Expert + shop bêta (spread conditionnel, objet d'appel byte-identique sinon). Couvert par T2.
2. Override accidentel sur Pro → n'arrive pas : le handler Pro n'est pas touché (O4). Couvert
   par T2 et par le diff (V1).
3. Clé mal orthographiée dans l'override (silencieusement ignorée par la lib) → couvert par T1/T2
   qui assertent l'objet exact produit.
4. `trialDays: undefined` passé par erreur → filtré par `filteredOverrides` (request.mjs:78) →
   retombe sur le 7 de la config. Sûr par construction.
5. Dérive future de la lib (l'override cesserait d'être supporté) → le contrat est dans le code
   installé et verrouillé par package-lock ; une montée de version majeure repasse par la gate.

### Option B — variante de plan « expert_beta » dans la config billing (REJETÉE)

Points de P0.3 à adapter obligatoirement : `EXPERT_NAMES` (`plan.server.js:21`) — et c'est le
SEUL point de comparaison de noms, tout le reste (gates des onglets, plafonds `planToOrderCap`,
quotas `HISTORY_LIMIT_*`, badge `:3977`, cron profitability, sync `shop_plans`) suit
automatiquement via `{ isPro, isExpert }`. La page de tarifs in-app ne rend PAS la config billing
brute (prix en dur, `:3017-3080`) → pas de fuite visuelle ni de sélection possible par un shop
normal (les boutons postent des `_action` figées).

Rejetée malgré cela : (1) introduit un nom de plan de plus, contraire à la priorité absolue ;
(2) le nom du plan est VISIBLE du marchand sur l'écran d'approbation et ses factures (un libellé
« beta » dégrade la perception et frôle R7) ; (3) un oubli d'alias futur (renommage tarifaire)
rendrait les abonnés bêta invisibles au gating (risque documenté D3) ; (4) T3 imposerait un test
par point de P0.3. Surface et charge de test supérieures pour zéro bénéfice vs A.

### Option C — mutation appSubscriptionCreate directe (REJETÉE)

Dupliquerait le chemin billing de la lib (session, redirection vers confirmationUrl, gestion 401)
et réintroduirait précisément les deux classes de bugs passés : `trialDays` et `test` redeviennent
des paramètres manuels à chaque appel. Créerait un troisième chemin de création (aggrave S1).
Aucun bénéfice : la lib installée sait déjà surcharger `trialDays`.

### Recommandation

**Option A.** Aucun nouveau nom de plan, diff minimal, comportement non-bêta byte-identique,
T3 sans objet.

---

## P0.7 — Régressions interdites : démonstration

- **Bug « trialDays manquant » (9a76bb8)** : le fix vit dans `shopify.server.js:32` et `:42`
  (`trialDays: 7` au niveau du plan). L'option A n'y touche pas (0 diff sur ce fichier). Le seul
  changement est l'AJOUT conditionnel d'une clé `trialDays` dans l'objet passé à
  `billing.request` du handler `subscribe_expert` quand `isBetaShop` est vrai. Quand il est faux,
  aucun override n'est passé → `mergeBillingConfigs` sert `trialDays: 7` depuis la config,
  exactement comme aujourd'hui. Le chemin non-bêta reste intact au caractère près (O3).
- **Bug isTest** : la ligne `isTest: await isDevStore(admin)` (`app._index.jsx:888`) n'est pas
  modifiée ; `isBetaShop` n'entre jamais dans le calcul d'`isTest` (les deux décisions sont
  orthogonales : l'une choisit la durée d'essai, l'autre le mode de charge). Une boutique bêta
  RÉELLE (non dev-store) produit donc `test:false` → abonnement réel → conversion payante à J+45
  mécaniquement possible (O8). `isDevStore` (`app._index.jsx:850-857`) garde son défaut sûr :
  toute incertitude → `false` → facturation réelle.

---

## P0.8 — Fichiers à toucher + taille de diff estimée

| Fichier | Nature | Lignes estimées |
|---|---|---|
| `app/lib/betaShops.js` (NOUVEAU, pur) | `BETA_TRIAL_DAYS = 45` + `isBetaShop(shopDomain, rawBetaShops)` (split virgules, trim, minuscules, égalité stricte, entrées vides/malformées ignorées) + un helper pur d'override `betaTrialOverride(...)` retournant `{ trialDays: BETA_TRIAL_DAYS }` ou `{}` (testable sans route) | ~30 (commentaires compris) |
| `app/routes/app._index.jsx` | import + spread conditionnel dans le SEUL handler `subscribe_expert` | ~3 |
| `tests/lot21_beta_shops.mjs` (NOUVEAU) | T1 complet (exact, casse, espaces, absente, vide, malformées, doublons, liste multiple, non-match sous-domaine/suffixe/préfixe dans les deux sens) + T2 (objet d'appel exact : bêta+Expert → 45 ; normal+Expert → pas d'override ; bêta+Pro → handler intouché ; Free → aucun appel) | ~100-140 |
| `package.json` | ajout de `node tests/lot21_beta_shops.mjs` à la chaîne `test` | 1 |

Total applicatif hors tests : ~35 lignes. `engine.js` : 0 diff (R2). Aucun état persisté, aucune
migration (O7). Aucun diff UI → preuve R3 par le périmètre du git diff (V6) ; `render_check`
tourne quand même dans la gate.

---

## Éléments pour la suite (rappel des preuves à produire à l'implémentation)

- V4/V5 (captures écran d'approbation 45 j / 7 j) : via `shopify app dev` sur
  `true-cost-dev.myshopify.com`, `BETA_SHOPS` posée puis retirée en local. Rappel poste :
  `automatically_update_urls_on_dev=false` est déjà en place (l'URL prod ne sera pas écrasée).
- Procédure de rattrapage manuelle (`appSubscriptionTrialExtend`) pour un shop bêta déjà abonné
  avant déploiement : à documenter dans le rapport final (O5, L1) — non implémentée.
- Réinstallation d'une boutique bêta → nouvel essai 45 j : accepté (O6), à documenter.
- L'ajout de `BETA_SHOPS` dans Vercel et le redeploy restent des opérations manuelles de Mathys
  après merge (L3).

---

## STOP — décisions attendues avant toute ligne de code

1. Confirmer la lecture S1 : le chemin dunning (`api.cron.dunning.jsx`, recréation d'une charge
   FROZEN sans essai) reste intouché et hors périmètre O3.
2. Valider l'option A (surcharge de `trialDays` à l'appel dans le handler `subscribe_expert`).
3. Valider le périmètre P0.8 (4 fichiers, ~35 lignes applicatives + lot21).
