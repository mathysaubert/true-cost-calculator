# Essai Expert 45 jours pour boutiques bêta (allowlist BETA_SHOPS) — rapport d'implémentation

Date : 2026-08-09. Fait suite à la Phase 0 validée
(`docs/rapports/2026-08-09_essai-expert-45j-beta_phase0.md`) : option A retenue (override de
`trialDays` à l'appel), lecture S1 du cron dunning validée (intouché, hors périmètre).
Aucun commit, aucun push : le GO de commit reste à donner dans un message séparé (R1/L3).

---

## Problème

Les boutiques bêta doivent recevoir un essai de 45 jours sur le plan Expert, sans toucher au
comportement de toutes les autres boutiques (7 jours), sans nouveau nom de plan, sans état
persisté, et sans réintroduire les deux bugs billing passés (`trialDays` manquant, `isTest`).

## Cause (pourquoi ce n'était pas possible avant)

La durée d'essai vivait exclusivement dans la config billing de `shopify.server.js`
(`trialDays: 7` au niveau du plan), identique pour toutes les boutiques : aucun point de
variation par boutique n'existait sur le chemin de création d'abonnement.

## Solution (option A validée)

La lib installée (`@shopify/shopify-app-react-router` 1.2.0 → `@shopify/shopify-api` 13.0.0)
fusionne les paramètres supplémentaires de `billing.request` PAR-DESSUS la config du plan
(`mergeBillingConfigs = { ...billingConfig, ...overrides }`, preuve en Phase 0 P0.2). Le diff :

1. `app/lib/betaShops.js` (NOUVEAU, PUR — aucune lecture d'env, aucune I/O) :
   - `BETA_TRIAL_DAYS = 45` : seule source de la valeur 45 du dépôt.
   - `isBetaShop(shopDomain, rawBetaShops)` : split sur virgules, trim + minuscules, égalité
     STRICTE sur le domaine complet. Jamais d'includes/endsWith/regex. Entrées vides ou
     malformées inertes. Variable absente/vide/non-string → `false` (défaut sûr prod, O1/O2).
   - `betaTrialOverride(shopDomain, rawBetaShops)` : `{ trialDays: BETA_TRIAL_DAYS }` si bêta,
     sinon `{}` (objet d'appel inchangé → la lib sert le 7 de la config).
2. `app/routes/app._index.jsx` : import + étalement de l'override dans le SEUL handler
   `subscribe_expert`. `process.env.BETA_SHOPS` est lue au site d'appel (pattern env existant,
   P0.5) et passée BRUTE au helper. Handler Pro intouché (O4). Ligne `isTest` intouchée (O8).
3. `tests/lot21_beta_shops.mjs` (NOUVEAU) : T1 + T2 (51 assertions), branché à la gate.
4. `package.json` : ajout de lot21 à la chaîne `test` (1 ligne).

Aucun test existant modifié (R4 : la justification ligne à ligne est donc sans objet).
`engine.js` : 0 diff (R2). Aucun état persisté, aucune migration (O7). Aucune nouvelle chaîne
visible, aucun texte marketing touché (R5/R7).

### Décisions annexes documentées (validation Phase 0)

- **S1 / cron dunning** : `api.cron.dunning.jsx` recrée la charge d'un abonnement FROZEN sans
  `trialDays` — délibérément, intouché. LIMITATION : une boutique bêta dont l'abonnement passe
  par cette recréation perd le reliquat d'essai. Remédiation : `appSubscriptionTrialExtend`
  (procédure manuelle ci-dessous).
- **O5** : aucun effet rétroactif — un shop bêta déjà abonné avant le déploiement de
  l'allowlist garde son essai de 7 jours ; rattrapage par la même procédure manuelle.
- **O6** : une boutique bêta qui désinstalle puis réinstalle et re-souscrit Expert reçoit un
  NOUVEL essai de 45 jours (le sub précédent est CANCELLED, `appSubscriptionCreate` repart de
  la config + override). Accepté.
- **I2 / P0.4** : aucune chaîne « 7 jours »/« essai » rendue dans l'app (la seule occurrence
  « 7 jours » est le filtre de période du graphique) → rien à rendre dynamique, zéro diff UI.

### Procédure de rattrapage manuelle — appSubscriptionTrialExtend (O5, L1)

Pour un shop bêta abonné Expert AVANT le déploiement de l'allowlist (ou passé par la
recréation dunning), prolonger l'essai du sub ACTIF de la différence voulue (45 − jours déjà
consommés/accordés). Opération manuelle de Mathys, jamais dans le code :

1. Récupérer l'id du sub actif (GraphiQL de `shopify app dev`, ou l'admin API) :
   `{ currentAppInstallation { activeSubscriptions { id name status trialDays createdAt } } }`
2. Exécuter (API Admin GraphQL, version 2025-10) :
   `mutation { appSubscriptionTrialExtend(id: "gid://shopify/AppSubscription/XXXX", days: 38) {`
   `userErrors { field message } appSubscription { id trialDays } } }`
   avec `days` = le complément à accorder (exemple : abonné en 7 j il y a 0-7 j → 38).
3. Vérifier `trialDays` retourné et l'absence de `userErrors`. La mutation étend l'essai du
   sub EXISTANT : aucun nouveau sub, aucun impact isTest/prix.

---

## Preuves

### V1 — diff complet

Fichiers suivis (git diff) :

```diff
diff --git a/app/routes/app._index.jsx b/app/routes/app._index.jsx
index 388e586..187291e 100644
--- a/app/routes/app._index.jsx
+++ b/app/routes/app._index.jsx
@@ -32,6 +32,7 @@ import { CostSummaryBanner, ReliabilityCounter, ProductCostList, ProductCostPane
 import { computeCpaTargets } from "../lib/cpaTargets.js";
 import { resolveEntitlement } from "../lib/plan.server";
 import { planToOrderCap, alertingEnabled, previousMonth } from "../lib/plan.js";
+import { betaTrialOverride } from "../lib/betaShops.js";
 
 // ── Constants ─────────────────────────────────────────────────────────────────
 
@@ -887,6 +888,8 @@ export const action = async ({ request }) => {
       plan: PLAN_EXPERT,
       isTest: await isDevStore(admin), // dev store → test ; toute incertitude → false (facturation réelle)
       returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?subscribed=true`,
+      // Boutique bêta (BETA_SHOPS) → essai 45 j fusionné par-dessus la config ; sinon {} → config (7 j).
+      ...betaTrialOverride(session.shop, process.env.BETA_SHOPS),
     });
     return null;
   }
diff --git a/package.json b/package.json
index 18d22bb..30f583c 100644
--- a/package.json
+++ b/package.json
@@ -3,7 +3,7 @@
   "private": true,
   "scripts": {
     "build": "react-router build",
-    "test": "node tests/lot1_customs.mjs && ... && node tests/lot20_customs_classification.mjs",
+    "test": "node tests/lot1_customs.mjs && ... && node tests/lot20_customs_classification.mjs && node tests/lot21_beta_shops.mjs",
```

(La ligne `test` de package.json est abrégée ici par lisibilité : le SEUL changement est
l'ajout de `&& node tests/lot21_beta_shops.mjs` en fin de chaîne — cf. le diff git réel.)

Nouveaux fichiers (contenu intégral) — `app/lib/betaShops.js` :

```js
// ── Allowlist bêta — PUR (aucune lecture de process.env, aucune I/O) ─────────────────────────
// BETA_SHOPS (env, lue par l'APPELANT) : domaines .myshopify.com COMPLETS séparés par des
// virgules. Absente ou vide = aucune boutique bêta (défaut sûr en prod). Égalité STRICTE sur le
// domaine complet après normalisation (trim + minuscules) : JAMAIS de includes/endsWith/regex de
// suffixe — « shop.myshopify.com » ne doit matcher ni « evilshop.myshopify.com » ni l'inverse.
// Une entrée malformée (pas un domaine de boutique) est inerte par construction : l'égalité
// stricte ne peut pas la faire correspondre à un session.shop réel.

// Durée d'essai des boutiques bêta sur le plan Expert — SEULE source de la valeur 45.
// La valeur nominale (7 j) reste dans la config billing de shopify.server.js, intacte.
export const BETA_TRIAL_DAYS = 45;

export function isBetaShop(shopDomain, rawBetaShops) {
  if (typeof shopDomain !== "string" || typeof rawBetaShops !== "string") return false;
  const shop = shopDomain.trim().toLowerCase();
  if (!shop) return false;
  return rawBetaShops
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => entry === shop);
}

// Override à ÉTALER dans l'objet passé à billing.request (handler subscribe_expert UNIQUEMENT) :
// shop bêta → { trialDays: BETA_TRIAL_DAYS } fusionné PAR-DESSUS la config du plan par la lib ;
// sinon → {} : l'objet d'appel est identique au comportement actuel au caractère près, la lib
// sert le trialDays: 7 de la config (jamais de trialDays réintroduit en dur ici — cf. bug 9a76bb8).
export function betaTrialOverride(shopDomain, rawBetaShops) {
  return isBetaShop(shopDomain, rawBetaShops) ? { trialDays: BETA_TRIAL_DAYS } : {};
}
```

`tests/lot21_beta_shops.mjs` : nouveau lot de 51 assertions, contenu dans le dépôt (T1 :
match exact, casse, espaces, absente/vide/malformée, doublons, listes multiples, non-match
suffixe/préfixe/sous-domaine dans les deux sens ; T2 : override exact bêta/normal/absente,
fusion config+override → 45/7 ; T2/V3 : scan du source — un seul appel `betaTrialOverride`,
handler Pro sans override ni trialDays, ligne `isTest` intacte, config nominale `trialDays: 7`
des deux plans intacte, helper sans `process.env`, valeur 45 unique dans le code).

### I3 — diff réel vs estimation P0.8

Estimation : ~35 lignes applicatives + ~100-140 de tests. Réel : `app._index.jsx` +3,
`package.json` 1 ligne modifiée, `betaShops.js` 30 lignes, `lot21` 139 lignes. Dans la marge
(< +30 %), pas de STOP I3.

### V2 — gate R4 (tout vert, zéro test skip, zéro assertion assouplie)

1. `npm run lint` : **0 erreur**, 345 warnings (`react/prop-types` et
   `react/no-unescaped-entities`, non bloquants par conception — cf. politique ESLint du dépôt).
2. `npm test` : **21/21 lots verts** (sortie intégrale en annexe A).
3. `node scripts/render_check.mjs` : **« ✅ Tous les rendus réels OK »** (35 scénarios,
   sortie intégrale en annexe B).
4. `npm run build` : succès (`✓ built in 963ms`, `build/server/index.js` 498.80 kB).

Note d'honnêteté sur la première exécution : le premier passage de la gate a rougi sur DEUX
assertions du nouveau lot21 lui-même (le scan source comptait le mot `process.env` et la
valeur `45` PRÉSENTS DANS MES PROPRES COMMENTAIRES de `betaShops.js`). Correction : le scan
retire les commentaires (`//`) avant d'asserter — l'assertion porte sur le code, pas la prose.
Aucun test EXISTANT n'a été modifié ; seul lot21 (nouveau) a été corrigé avant re-passage.

### V3 — grep post-implémentation `trialDays` sur app/**

```
app\shopify.server.js:26:  // trialDays au niveau du PLAN (sibling de lineItems, cf. BillingConfigSubscriptionLineItemPlan).
app\shopify.server.js:27:  // billing.request lit billingConfig.trialDays et le passe à appSubscriptionCreate → l'essai de
app\shopify.server.js:32:      trialDays: 7,
app\shopify.server.js:42:      trialDays: 7,
app\lib\betaShops.js:25:// shop bêta → { trialDays: BETA_TRIAL_DAYS } fusionné PAR-DESSUS la config du plan par la lib ;
app\lib\betaShops.js:27:// sert le trialDays: 7 de la config (jamais de trialDays réintroduit en dur ici — cf. bug 9a76bb8).
app\lib\betaShops.js:29:  return isBetaShop(shopDomain, rawBetaShops) ? { trialDays: BETA_TRIAL_DAYS } : {};
```

Lecture : les seuls `trialDays` du code applicatif sont (1) la config nominale `7` des deux
plans dans `shopify.server.js` (intacte au caractère près, validation point 3) et (2) l'override
`BETA_TRIAL_DAYS` du helper. Aucun autre site de création Expert ne définit d'essai : V3
satisfaite au sens validé ({config 7 ; override BETA_TRIAL_DAYS}). Ce grep est en outre
automatisé en continu par lot21 (assertions « aucun trialDays numérique en dur dans
app._index.jsx » et « config nominale intacte »).

### V4/V5 — écran d'approbation Shopify (45 j / 7 j) : impossibles en LOCAL, procédure amendée

CAUSE RACINE (constat validé par Mathys) : l'URL d'application est ÉPINGLÉE sur la prod Vercel
dans `shopify.app.toml` (`automatically_update_urls_on_dev = false`, décision issue de
l'incident « page blanche » où le tunnel dev avait écrasé l'URL prod). Conséquence : le
preview admin charge TOUJOURS le code déployé sur Vercel, jamais le serveur local — un
`shopify app dev` local ne peut donc pas produire ces captures, quel que soit l'outillage.
(Tentative de cette session : `BETA_SHOPS` ajoutée au `.env` local + dev lancé, tunnel prêt,
`Update URLs: No` confirmé — sans objet pour V4/V5 pour la raison ci-dessus ; la ligne du
`.env` local est INERTE pour ce parcours. Premier lancement dev tombé en outre sur un
`P1001` Supabase transitoire, vérifié rétabli ensuite — sans lien avec le diff.)

Procédure amendée — exécutée par Mathys APRÈS déploiement, dans cet ordre (V5 d'abord :
elle ne demande aucun changement d'environnement) :

1. **V5** : `BETA_SHOPS` ABSENTE de Vercel (état actuel) → sur `true-cost-dev.myshopify.com`,
   ouvrir l'app → « Choisir Expert » → l'écran d'approbation Shopify doit afficher
   **7 jours d'essai**. Capturer. NE PAS approuver (un sub PENDING abandonné est sans effet).
2. **V4** : ajouter `BETA_SHOPS=true-cost-dev.myshopify.com` dans Vercel + redeploy (opération
   manuelle de Mathys, L3) → même parcours → l'écran doit afficher **45 jours d'essai**
   (charge test : dev store → `isTest true`). Capturer.

### V6 — preuve R3 (aucun diff UI)

Périmètre exact du diff : `app/routes/app._index.jsx` (+3 lignes : 1 import, 1 commentaire,
1 étalement d'override — toutes dans le module scope et le handler `subscribe_expert` de
l'action SERVEUR, aucun JSX touché), `package.json` (1 ligne, chaîne de tests),
`app/lib/betaShops.js` (nouveau, lib serveur pure), `tests/lot21_beta_shops.mjs` (nouveau,
test). Aucune surface rendue modifiée. `render_check` (35 scénarios) a néanmoins été exécuté
dans la gate : tout vert (annexe B).

---

## État du poste après ce chantier (à connaître avant le GO commit)

- `.env` local : ligne 14 `BETA_SHOPS=true-cost-dev.myshopify.com` AJOUTÉE (tentative V4).
  Fichier non versionné (absent du git status), INERTE pour le preview admin (qui charge la
  prod Vercel — cf. section V4/V5) ; ne compte que si un serveur local sert un jour le
  parcours de souscription. Laissée en place (consigne : ne pas toucher au `.env`).
- Serveur `shopify app dev` : arrêté (sorti en erreur P1001, rien ne tourne).
- Git : aucun commit. Modifiés : `app/routes/app._index.jsx`, `package.json`. Nouveaux :
  `app/lib/betaShops.js`, `tests/lot21_beta_shops.mjs`, `docs/rapports/` (Phase 0 + ce rapport).
- Vercel : RIEN touché. L'ajout de `BETA_SHOPS` en prod et le redeploy restent tes opérations
  manuelles après merge (L3).

---

## Annexe L2 — brouillon d'entrée pour docs/CHANTIERS_DETAIL.md (NON committé, à recopier)

### Essai Expert 45 jours pour boutiques bêta (allowlist BETA_SHOPS)

- **Problème** : offrir 45 jours d'essai Expert aux boutiques bêta sans toucher les autres
  boutiques (7 j), sans nouveau nom de plan, sans état persisté.
- **Cause racine** : la durée d'essai vivait uniquement dans la config billing
  (`shopify.server.js`, `trialDays: 7` par plan) — aucun point de variation par boutique.
- **Solution** : la lib billing fusionne les overrides de `billing.request` par-dessus la
  config (`mergeBillingConfigs`). Helper PUR `app/lib/betaShops.js` : `isBetaShop` (égalité
  stricte sur domaine complet normalisé, env `BETA_SHOPS` lue par l'appelant, absente = aucune
  bêta) + `BETA_TRIAL_DAYS = 45` (constante unique) + `betaTrialOverride` étalé dans le SEUL
  handler `subscribe_expert`. Config nominale 7 j intacte ; handler Pro intact ; ligne `isTest`
  intacte (bêta réelle → `test:false`, conversion J+45 possible). Tests lot21 (51 assertions,
  dont scan source anti-régression : un seul site d'override, aucun `trialDays` en dur).
- **Limitations documentées** : recréation dunning d'un sub FROZEN sans essai (bêta comprise) et
  abonnés d'avant l'allowlist → rattrapage manuel `appSubscriptionTrialExtend` ; réinstallation
  d'une bêta → nouvel essai 45 j (accepté).

---

## Annexes A (npm test intégral) et B (render_check intégral)

Ajoutées ci-dessous, verbatim et non tronquées (V2). Les caractères de cadre qu'elles
contiennent sont ceux émis par le harnais de tests du dépôt lui-même, cités tels quels en
bloc de code ; la prose de ce rapport n'en utilise aucun.

### Annexe A — sortie integrale de npm test (21 lots)

```text
node.exe : npm warn Unknown project config "shamefully-hoist". This will stop working in the next major version of 
npm. See `npm help npmrc` for supported config options.
Au caractère Ligne:1 : 1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (npm warn Unknow...config options.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 

> test
> node tests/lot1_customs.mjs && node tests/lot2_ui_labels.mjs && node tests/lot3_cpa_roas.mjs && node tests/invariants.mjs && node tests/lot4_display_guardrails.mjs && node tests/lot5_variant_costs.mjs && node tests/lot6_order_ingest.mjs && node tests/lot7_order_history.mjs && node tests/lot8_breakdown_backfill.mjs && node tests/lot9_profitability_alert.mjs && node tests/lot10_loss_alert_email.mjs && node tests/lot11_dunning_decision.mjs && node tests/lot12_dunning_email.mjs && node tests/lot13_dunning_status.mjs && node tests/lot14_session_reaper.mjs && node tests/lot15_cpa_targets.mjs && node tests/lot16_plan_entitlement.mjs && node tests/lot17_alerting_decision.mjs && node tests/lot18_audit_classify.mjs && node tests/lot19_recalc_margins.mjs && node tests/lot20_customs_classification.mjs && node tests/lot21_beta_shops.mjs


── TEST 1 : Stock qty=1 — douane sur CIF plein, plus de seuil ──
  droitsDouane = (40+8) × 5% = 2.4000 € | attendu 2.4000 €
  ✓ Stock qty=1 Sport : droits = 2.4000 € (attendu 2.4000 €)
  ✓ Aucun de minimis en mode stock — droits > 0

── TEST 2 : Stock qty=100 — port divisé, droits sur CIF/unité ──
  shippingPerUnit = 8/100 = 0.0800 €
  droitsDouane = (40+0.08) × 5% = 2.0040 € | attendu 2.0040 €
  ✓ Stock qty=100 : droits = 2.0040 €

── TEST 3 : Dropshipping PRÉ-réforme → 0€ (de minimis) ──
  now=2026-06-16, supplier 2,44€ ≤ 150€ → droitsDouane = 0.0000 €
  ✓ Dropshipping pré-réforme : droits = 0€ (de minimis) | obtenu 0.0000 €

── TEST 4 : Dropshipping POST-réforme → forfait 3€ ──
  now=2026-07-01, supplier 2,44€ ≤ 150€ → droitsDouane = 3.0000 €
  ✓ Dropshipping post-réforme : droits = 3€ | obtenu 3.0000 €

── TEST 5 : Dropshipping haute valeur (200€ > 150€) → tarif % plein, pas 3€ ──
  supplier 200€ > ceiling 150€ → tarif normal : (200+8)×5% = 10.4000 €
  ✓ Haute valeur : droits = 10.4000 € ≠ 3€ forfait
  ✓ Haute valeur : PAS le forfait 3€

── TEST 6 : Cohérence croisée — 4 modules, 0,00€ d'écart ──
  ✓ stock    qty=1  pré | calcNetMargin=25.0167 € audit=25.0167 € écart=0.000000€
  ✓ stock    qty=100 pré | calcNetMargin=33.3327 € audit=33.3327 € écart=0.000000€
  ✓ dropship qty=1  pré | calcNetMargin=27.4167 € audit=27.4167 € écart=0.000000€
  ✓ dropship qty=1  post | calcNetMargin=24.4167 € audit=24.4167 € écart=0.000000€

── TEST 7 : Sanity chaussettes dropshipping post-réforme (~−7,7€) ──
  coutRendu = 2.44 + 8 (qty=1 forcé) + 3€ forfait = 13.4400 €
  revenu HT = 7.9 / 1.20 = 6.5833 €
  marge nette = -7.7123 €
  ✓ Marge chaussettes dropshipping post-réforme -7.7123 € < −7€
  ✓ droitsDouane = 3.0000 € (forfait 3€)
  ✓ coutRendu = coût(2.44) + port(8) + forfait(3) = 13.4400 €

── TEST 8 : Dropshipping ignore qty — fret jamais divisé ──
  ✓ Dropshipping qty=1 et qty=100 donnent même coutRendu (10.4400 € = 10.4400 €)

── TEST 9 : Régression franchise — comportement TVA préservé ──
  ✓ Douane Alimentation stock 200€ = 31.2000 €
  ✓ TVA import 5.5% = 13.1560 €
  ✓ coutRendu franchise = 252.3560 €

══════════════════════════════════════════════════════════════════
 BILAN LOT 1 : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════


── T1 : Threading shippingModel — dropshipping ≠ stock post-réforme ──
  stock marge=25.02 € | dropshipping marge=24.42 € (écart=0.60 €)
  ✓ Dropshipping post-réforme marge < stock (3€ forfait > 2.40€ % sur colis faible valeur)

── T2 : Défauts initiaux = dropshipping ──
  ✓ form.shippingModel initial = dropshipping
  ✓ simForm.shippingModel initial = dropshipping
  ✓ auditParams.shipping_model initial = dropshipping

── T3 : Labels dynamiques prompt IA ──
  ✓ Dropship 40€ pré (faible val) : " (faible valeur, exonéré jusqu'au 30/06/2026)"
  ✓ Dropship 200€ post (haute val) : " (haute valeur, tarif % plein)"
  ✓ Dropship 2.44€ pré: " (faible valeur, exonéré jusqu'au 30/06/2026)"
  ✓ Dropship 2.44€ post (forfait UE) : " (faible valeur, forfait douanier UE depuis le 01/07/2026)"
  ✓ Stock post : label vide ""
  ✓ Notes IA douane : 0 tiret cadratin, 0 « CIF »

── T4 : Labels dynamiques ventilation UI ──
  ✓ Dropship faible val pré : "+ Droits de douane (gratuit jusqu'au 30/06/2026)"
  ✓ Dropship faible val post : "+ Droits de douane (forfait de 3 € par article, réforme UE)"
  ✓ Dropship haute val post : "+ Droits de douane (5 % sur le produit + port)"
  ✓ Stock pré : "+ Droits de douane (5 % sur le produit + port)"
  ✓ Libellés ventilation douane : 0 'de minimis'/'150'/'CIF'/tiret cadratin

── T5 : Non-régression — résultats Lot 1 identiques ──
  ✓ Pré-réforme droits = 0€
  ✓ Pré-réforme marge -4.71 € < 0 (port 8€ dépasse la vente 7,90€)
  ✓ Pré-réforme moins négative que post (-4.71 € > -7.71 €)
  ✓ Post-réforme marge -7.71 € < −7€

══════════════════════════════════════════════════════════════════
 BILAN LOT 2 : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════


── TEST 1 : Cas réel — valeurs de l'énoncé ──
  revenu HT     = 41.6583 € (49.99 / 1.20)
  CPA max AVANT = 10.7600 € (bug — TTC)
  CPA max APRÈS = 2.4283 € (fix — HT)
  ROAS AVANT    = 4.65x | ROAS APRÈS = 20.59x
  ✓ CPA max bug = 10.76€ (reproduit) | obtenu 10.7600 €
  ✓ CPA max fix = 2.43€ (corrigé)   | obtenu 2.4283 €
  ✓ ROAS fix = ~20.6x               | obtenu 20.59x
  ✓ ROAS bug = ~4.65x (reproduit)   | obtenu 4.65x
  ✓ Écart CPA = TVA collectée (8.3317 €) ← signature du bug

── TEST 2 : Réconciliation CPA max = margeNette (ads=0) ──
  Sport/Chine/assujetti/stock | margeNette=5.1758 € cpaMax=5.1758 € diff=0.000000€
  ✓ Sport/Chine/assujetti/stock : CPA max = margeNette au centime
  Textile/Chine/assujetti/dropship | margeNette=3.5758 € cpaMax=3.5758 € diff=0.000000€
  ✓ Textile/Chine/assujetti/dropship : CPA max = margeNette au centime
  Alimentation/Chine/franchise/stock | margeNette=8.5198 € cpaMax=8.5198 € diff=0.000000€
  ✓ Alimentation/Chine/franchise/stock : CPA max = margeNette au centime
  Sport/Chine/assujetti/taxesIncl=F | margeNette=13.0909 € cpaMax=13.0909 € diff=0.000000€
  ✓ Sport/Chine/assujetti/taxesIncl=F : CPA max = margeNette au centime

── TEST 3 : Frais TTC inchangés — seul revenu passe en HT ──
  ✓ Shopify 2% = 2.00€ sur TTC (2.0000 €)
  ✓ Stripe 1.5%+0.25 = 1.75€ sur TTC (1.7500 €)
  ✓ revenu (83.3333 €) < prixVente TTC (100.0000 €)
  ✓ revenu = prixVente/1.20 (83.3333 €)

── TEST 4 : ROAS = prixVente (TTC) / CPA_max ──
  ✓ ROAS = prixVente(TTC) / CPA_max = 100/50.1833 € = 1.99x
  ✓ ROAS TTC (1.99x) > ROAS HT (1.66x) — TTC dénominateur standard

── TEST 5 : Non-régression Lot 1 + Lot 2 — marges inchangées ──
  ✓ Assujetti stock : margeNette finie et positive (25.0167 €)
  ✓ Franchise stock : margeNette finie (30.7700 €)
  assujetti stock margeNette=25.0167 € | franchise stock margeNette=30.7700 €
  ✓ Lot 1 dropship pré    : margeNette=27.4167 € (attendu ~27.42€)
  ✓ Lot 1 dropship post < pré (3€ forfait) : 24.4167 € < 27.4167 €
  ✓ CPA=margeNette assujetti stock : 25.0167 € = 25.0167 €
  ✓ CPA=margeNette franchise : 30.7700 € = 30.7700 €
  ✓ CPA=margeNette dropship pré : 27.4167 € = 27.4167 €
  ✓ CPA=margeNette dropship post : 24.4167 € = 24.4167 €

══════════════════════════════════════════════════════════════════
 BILAN LOT 3 (CPA) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════


── A1 : Cohérence computeMargin = calcNetMargin = computeScenarios.current (PRE + POST) ──
  ✓ [PRE] assujetti/stock/Sport : canon=22.0167 € calc=22.0167 € scen=22.0167 €
  ✓ [PRE] assujetti/stock/Alimentation : canon=28.0974 € calc=28.0974 € scen=28.0974 €
  ✓ [PRE] assujetti/stock/Autre : canon=22.9767 € calc=22.9767 € scen=22.9767 €
  ✓ [PRE] assujetti/stock/Textile : canon=18.6567 € calc=18.6567 € scen=18.6567 €
  ✓ [PRE] assujetti/dropshipping/Sport : canon=24.4167 € calc=24.4167 € scen=24.4167 €
  ✓ [PRE] assujetti/dropshipping/Alimentation : canon=35.2974 € calc=35.2974 € scen=35.2974 €
  ✓ [PRE] assujetti/dropshipping/Autre : canon=24.4167 € calc=24.4167 € scen=24.4167 €
  ✓ [PRE] assujetti/dropshipping/Textile : canon=24.4167 € calc=24.4167 € scen=24.4167 €
  ✓ [PRE] franchise/stock/Sport : canon=27.7700 € calc=27.7700 € scen=27.7700 €
  ✓ [PRE] franchise/stock/Alimentation : canon=30.0140 € calc=30.0140 € scen=30.0140 €
  ✓ [PRE] franchise/stock/Autre : canon=28.9220 € calc=28.9220 € scen=28.9220 €
  ✓ [PRE] franchise/stock/Textile : canon=23.7380 € calc=23.7380 € scen=23.7380 €
  ✓ [PRE] franchise/dropshipping/Sport : canon=30.6500 € calc=30.6500 € scen=30.6500 €
  ✓ [PRE] franchise/dropshipping/Alimentation : canon=37.6100 € calc=37.6100 € scen=37.6100 €
  ✓ [PRE] franchise/dropshipping/Autre : canon=30.6500 € calc=30.6500 € scen=30.6500 €
  ✓ [PRE] franchise/dropshipping/Textile : canon=30.6500 € calc=30.6500 € scen=30.6500 €
  ✓ [POST] assujetti/stock/Sport : canon=22.0167 € calc=22.0167 € scen=22.0167 €
  ✓ [POST] assujetti/stock/Alimentation : canon=28.0974 € calc=28.0974 € scen=28.0974 €
  ✓ [POST] assujetti/stock/Autre : canon=22.9767 € calc=22.9767 € scen=22.9767 €
  ✓ [POST] assujetti/stock/Textile : canon=18.6567 € calc=18.6567 € scen=18.6567 €
  ✓ [POST] assujetti/dropshipping/Sport : canon=21.4167 € calc=21.4167 € scen=21.4167 €
  ✓ [POST] assujetti/dropshipping/Alimentation : canon=32.2974 € calc=32.2974 € scen=32.2974 €
  ✓ [POST] assujetti/dropshipping/Autre : canon=21.4167 € calc=21.4167 € scen=21.4167 €
  ✓ [POST] assujetti/dropshipping/Textile : canon=21.4167 € calc=21.4167 € scen=21.4167 €
  ✓ [POST] franchise/stock/Sport : canon=27.7700 € calc=27.7700 € scen=27.7700 €
  ✓ [POST] franchise/stock/Alimentation : canon=30.0140 € calc=30.0140 € scen=30.0140 €
  ✓ [POST] franchise/stock/Autre : canon=28.9220 € calc=28.9220 € scen=28.9220 €
  ✓ [POST] franchise/stock/Textile : canon=23.7380 € calc=23.7380 € scen=23.7380 €
  ✓ [POST] franchise/dropshipping/Sport : canon=27.0500 € calc=27.0500 € scen=27.0500 €
  ✓ [POST] franchise/dropshipping/Alimentation : canon=34.4450 € calc=34.4450 € scen=34.4450 €
  ✓ [POST] franchise/dropshipping/Autre : canon=27.0500 € calc=27.0500 € scen=27.0500 €
  ✓ [POST] franchise/dropshipping/Textile : canon=27.0500 € calc=27.0500 € scen=27.0500 €

── A2 : CPA max = marge nette quand ads=0 ──
  ✓ assujetti/stock : CPA=22.0167 € margeNette=22.0167 €
  ✓ assujetti/dropshipping : CPA=21.4167 € margeNette=21.4167 €
  ✓ franchise/stock : CPA=27.7700 € margeNette=27.7700 €
  ✓ franchise/dropshipping : CPA=27.0500 € margeNette=27.0500 €
  ✓ ads=10% : margeNette(12.0167 €) = CPA(22.0167 €) − adsCost(10.0000 €)

── A3 : marge assujetti+TTC < marge franchise (toutes choses égales) ──
  ✓ Sport : assujetti 22.0167 € < franchise 27.7700 €
  ✓ Alimentation : assujetti 28.0974 € < franchise 30.0140 €
  ✓ Autre : assujetti 22.9767 € < franchise 28.9220 €
  ✓ Textile : assujetti 18.6567 € < franchise 23.7380 €

── A4 : dropshipping — douane post-réforme ≥ pré-réforme ──
  ✓ Sport/2.44€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Sport/40€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Sport/200€ : douane pré=10.4000 € → post=10.4000 €
  ✓ Alimentation/2.44€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Alimentation/40€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Alimentation/200€ : douane pré=31.2000 € → post=31.2000 €
  ✓ Autre/2.44€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Autre/40€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Autre/200€ : douane pré=6.2400 € → post=6.2400 €
  ✓ Textile/2.44€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Textile/40€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Textile/200€ : douane pré=24.9600 € → post=24.9600 €

── A5 : stock — coût rendu/unité non-croissant en qty ──
  ✓ Sport : coutRendu qty 1≥10≥100 = 50.4000 € ≥ 42.8400 € ≥ 42.0840 €
  ✓ Alimentation : coutRendu qty 1≥10≥100 = 55.2000 € ≥ 46.9200 € ≥ 46.0920 €
  ✓ Autre : coutRendu qty 1≥10≥100 = 49.4400 € ≥ 42.0240 € ≥ 41.2824 €
  ✓ Textile : coutRendu qty 1≥10≥100 = 53.7600 € ≥ 45.6960 € ≥ 44.8896 €

── A6 : aucune sortie NaN/Infinity (cas dégénérés inclus) ──
  ✓ cas dégénéré #1 (qty=0, pa=40, pv=100) → toutes sorties finies
  ✓ cas dégénéré #2 (qty="", pa=40, pv=100) → toutes sorties finies
  ✓ cas dégénéré #3 (qty="abc", pa=40, pv=100) → toutes sorties finies
  ✓ cas dégénéré #4 (qty=undefined, pa=0, pv=100) → toutes sorties finies
  ✓ cas dégénéré #5 (qty=undefined, pa=40, pv=0) → toutes sorties finies
  ✓ cas dégénéré #6 (qty=undefined, pa=0, pv=0) → toutes sorties finies
  ✓ cas dégénéré #7 (qty=0, pa=40, pv=100) → toutes sorties finies

── B : Ancres chiffrées ──
  ✓ B1 stock/assujetti = 25.0167 € (ancre 25.02)
  ✓ B2 stock/franchise = 30.7700 € (ancre 30.77)
  ✓ B3 dropship/post = -7.7123 € (ancre -7.71)
  ✓ B3 douane = forfait 3.0000 €
     coutRendu=24.6288 € revenu=41.6583 € shopify=0.9998 € stripe=0.9999 €
  ✓ B4 coutRendu = 24.6288 € (attendu 24,63)
  ✓ B4 margeNette = 2.4299 € (ancre 2.43)
  ✓ B4 CPA max = 2.4299 € (ancre 2.43)
  ✓ B4 ROAS = 20.57x (ancre 20.6x)

── Transitif : adaptateur audit == canonique (mêmes intrants logiques) ──
  ✓ assujetti/stock : canon=25.0167 € audit=25.0167 €
  ✓ assujetti/dropshipping : canon=24.4167 € audit=24.4167 €
  ✓ franchise/stock : canon=30.7700 € audit=30.7700 €
  ✓ franchise/dropshipping : canon=30.0500 € audit=30.0500 €

══════════════════════════════════════════════════════════════════
 INVARIANTS : ✓ 76 assertions OK
══════════════════════════════════════════════════════════════════


── BUG 2 : cpaAdvice ne nomme aucune plateforme Difficile (balayage ROAS) ──
  ✓ aucun conseil ne nomme une plateforme Difficile sur 116 ROAS testés
  ✓ roasPhrase ne nomme jamais une plateforme Difficile sur 116 ROAS testés
  ✓ le balayage couvre les trois verdicts (Difficile, Limite, Viable)

── BUG 1 : marge brute du payload IA = m.margeBrute (assujetti + taxesIncluded) ──
  ✓ pré-condition : base HT ≠ base TTC (sinon le test ne prouve rien) — HT 32,93 € vs TTC 49,60 €
  ✓ le payload cite la marge brute moteur 32,93 €
  ✓ le payload ne contient PAS la valeur re-dérivée TTC 49,60 €
  ✓ franchise/stock : marge brute citée = moteur (28,87 €)
  ✓ assujetti/non-TTC : marge brute citée = moteur (32,39 €)
  ✓ assujetti/dropship : marge brute citée = moteur (22,66 €)
  ✓ défaut = EUR (rétro-compat : identique à formatEur)
  ✓ devise USD → montants en $, aucun € dans la ligne de marges du prompt

── cpaColor : assert croisé couleur ⟺ conseil (balayage ROAS) ──
  ✓ vert ⟺ le conseil nomme ≥ 1 plateforme (donc non-vert ⟺ organique)
  ✓ rouge ⟺ 3× Difficile ou ROAS irréaliste

── Cohérence des 4 surfaces ROAS (couleur chiffre / label / phrase / cpaColor) ──
  ✓ couleur chiffre, label et phrase dérivent tous du même verdict agrégé

── Typo : 0 tiret cadratin/demi-cadratin dans conseils & phrases ROAS ──
  ✓ aucun tiret cadratin dans conseil/phrase ROAS sur 116 ROAS

── Bascules cpaColor (PV=100€ pour mémoire) ──
  ROAS  | Meta/TikTok/Google           | couleur | conseil
  1.5   | Meta:V TikTok:V Google:V     | VERT   | nomme plateformes
  2     | Meta:V TikTok:L Google:V     | VERT   | nomme plateformes
  2.6   | Meta:L TikTok:D Google:V     | VERT   | nomme plateformes
  2.9   | Meta:L TikTok:D Google:V     | VERT   | nomme plateformes
  3     | Meta:L TikTok:D Google:L     | ORANGE | organique ◄ bascule
  4     | Meta:D TikTok:D Google:L     | ORANGE | organique
  5     | Meta:D TikTok:D Google:L     | ORANGE | organique
  5.1   | Meta:D TikTok:D Google:D     | ROUGE  | organique ◄ bascule
  6.7   | Meta:D TikTok:D Google:D     | ROUGE  | organique
  11    | Meta:D TikTok:D Google:D     | ROUGE  | organique

══════════════════════════════════════════════════════════════════
 BILAN LOT 4 (garde-fous affichage) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── Estimation auto ──
  ✓ prix_achat = unitCost réel (12.5)
  ✓ port = SHIPPING_ESTIMATES[Chine] (8)
  ✓ catégorie mappée depuis productType (Textile)
  ✓ vat/shipping = réglages boutique
  ✓ défauts neutres qty=1, emballage=0
  ✓ source = estimated (jamais présenté comme confirmé)
  ✓ unitCost absent → prix_achat 0
  ✓ type non reconnu → catégorie Autre
  ✓ pays invalide → fallback Chine

── Validation ──
  ✓ ligne valide acceptée
  ✓ qty_par_lot parsé en entier
  ✓ ligne invalide rejetée (value null)
  ✓ 7 erreurs distinctes remontées — prix/port/qty/vat/shipping/pays/catégorie (7)
  ✓ prix négatif refusé (message dédié)
  ✓ qty non entière refusée
  ✓ pays hors domaine refusé
  ✓ prix d'achat 0 → ligne refusée (coût fictif)
  ✓ prix 0 → message « Indiquez le prix d'achat fournisseur »
  ✓ prix d'achat > 0 (0,01) accepté
  ✓ enums vat/shipping fermés
  ✓ domaines pays/catégorie = clés moteur

── CSV import / export ──
  ✓ en-tête = CSV_COLUMNS
  ✓ titre avec virgule échappé entre guillemets
  ✓ round-trip : 1 ligne valide, 0 erreur
  ✓ variant_id préservé
  ✓ valeurs persistées correctes
  ✓ 1 ligne valide retenue
  ✓ 2 lignes en erreur rapportées (2)
  ✓ numéros de ligne corrects (3 et 4)
  ✓ en-tête incomplet → erreur claire, rien importé

── buildCostRowsForDisplay : suggestion display-only vs ligne stockée ──
  ✓ toutes les variantes rendues pour l'affichage
  ✓ sans ligne stockée → stored:false (suggestion, jamais offerte à la confirmation douane)
  ✓ suggestion display-only marquée source estimated
  ✓ suggestion : prix_achat reflète le unitCost Shopify
  ✓ ligne stockée → stored:true, valeurs marchand préservées
  ✓ variante non stockée du même produit → stored:false
  ✓ pur : appels répétés identiques (aucun effet de bord, aucune écriture)

── productCostStatus : complet / partiel / à compléter ──
  ✓ toutes confirmées/importées → complete
  ✓ toutes estimées (suggestion) → à compléter
  ✓ estimée seule / aucune variante → à compléter
  ✓ 1 confirmée sur 3 → « Partiel : 1 variante sur 3 »
  ✓ pluriel « 2 variantes »

══════════════════════════════════════════════════════════════════
 BILAN LOT 5 (coûts par variante) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── F1 : mono-ligne, preuve au centime ──
  ✓ 1 ligne produite
  ✓ unit_net_margin = ancre (216.50 = 216.50)
  ✓ line_net_margin AU CENTIME = ancre (649.25 = 649.25)
  ✓ fixe entier sur mono-ligne (0.25)
  ✓ line_net_revenue = 600×3 (1800.00)
  ✓ effective_qty 3, source confirmed

── F2 : multi-ligne, prorata fixe + remises AfterAll seul ──
  ✓ L2a revenu = AfterAll seul = 45 (45.00), pas 50 ni 40
  ✓ Σ fixe ligne = fixe commande 0.25 (0.25)
  ✓ prorata correct (0.19 / 0.06)
  ✓ L2a line_net_margin AU CENTIME (51.26)
  ✓ L2b line_net_margin AU CENTIME (13.29)

── F3 : refund partiel settled ──
  ✓ refund settled → refunded 1, effective 2 (1/2)
  ✓ line_net_margin sur 2 unités effectives AU CENTIME (432.75)

── F4 : refund non settled → ignoré ──
  ✓ refund PENDING ignoré → effective 3 (3)

── F5 : coûts manquants ──
  ✓ cost_source = missing
  ✓ marges/revenu null (jamais de marge fausse)
  ✓ fixe non imputé sur ligne missing

── F6 : fallback D1 (AfterAll null) ──
  ✓ fallback déclenché quand AfterAll null
  ✓ fallback = original − Σalloc/qty = 45 (45.00)
  ✓ AfterAll présent → 45, pas de fallback, pas d'ajout d'alloc

── Re-stitch (ordre inversé) ──
  ✓ order ← lineItem re-stitché
  ✓ refund ← refundLineItems + transactions re-stitchés
  ✓ effectiveRefundedQty lit l'arbre re-stitché

── Idempotence ──
  ✓ clé (order_id|line_item_id) stable
  ✓ deux ingestions → ligne identique (snapshot figé, zéro diff)

── Clamp effective_qty ≥ 0 ──
  ✓ effective_qty clampé à 0 (0)
  ✓ revenu 0 et marge 0 (fixe prorata 0 car Σrevenu=0)

── C4a : countDistinctOrders ──
  ✓ tableau vide → 0
  ✓ null → 0 (pas de crash)
  ✓ undefined → 0 (pas de crash)
  ✓ non-tableau → 0
  ✓ 3 lignes MÊME order_id → 1 commande (dédup)
  ✓ 3 lignes 3 order_id → 3 commandes
  ✓ mélange (A,A,B) → 2 commandes distinctes
  ✓ order_id null/vide/absent IGNORÉ → 2 (A,B) — jamais de sur-comptage

══════════════════════════════════════════════════════════════════
 BILAN LOT 6 (ingestion commandes) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── [A] agrégat par produit (1 commande à perte n'invalide pas le produit) ──
  ✓ Σ marge P1 = 60 (60)
  ✓ 3 commandes distinctes (3)
  ✓ P1 NON marqué à perte (jugé par produit, pas par ligne)
  ✓ 0 produit à perte

── [A] produit globalement à perte ──
  ✓ P2 Σ marge -25 → à perte (-25)
  ✓ compteur = 1 produit à perte

── [C] coûts manquants exclus des sommes ──
  ✓ 1 ligne missing isolée
  ✓ P3 (missing) absent des agrégats
  ✓ seul P1 agrégé
  ✓ Σ marge = 40 (missing non compté)

── [B] agrégat par jour (UTC) ──
  ✓ 2 jours (2)
  ✓ 10/06 : CA 150, marge 50 (150/50)
  ✓ 11/06 : CA 80, marge 20
  ✓ byDay trié chronologiquement

── [edge] effective_qty=0 ──
  ✓ qty 0, marge 0
  ✓ marge 0 → PAS à perte (pas de perte inventée)

── [edge] CA net = 0 → % marge — ──
  ✓ marginPct null quand CA net = 0

── [edge] product_id null ──
  ✓ produit null regroupé sans crash

── [LISTE] multi-devises signalé ──
  ✓ multiCurrency=true (USD,EUR)

── [DEVISE] format selon la vraie devise ──
  ✓ USD → symbole court $ sans "US" (1 200,00 $)
  ✓ EUR → € (1 200,00 €)
  ✓ GBP → £ (1 200,00 £)
  ✓ devises formatées distinctement
  ✓ montant préservé au centime (729,27)
  ✓ devise nulle/mixte → pas de faux symbole €
  ✓ devise inconnue 'XYZ' ne casse pas (50,00 XYZ)

── [edge] entrée vide ──
  ✓ tout vide, aucun crash

── [BREAKDOWN] dépli ligne #1001 réconcilie au centime ──
  ✓ marge : unit×eq − fixe = line (729.27 = 729.27)
  ✓ cible line_net_margin = 729,27 (stockée)
  ✓ revenu : nur×eq = line (1200.00 = 1200)
  ✓ mécanique D4 : 1 remboursé → eq 2 (pas un poste €)
  ✓ snapshot figé exposé en contexte (intrants saisis)

── [F2] multi-snapshots : dépli par ligne, jamais fondu ──
  ✓ 2 lignes dépliables (2)
  ✓ chaque ligne garde SON snapshot (10 ≠ 12)
  ✓ chaque ligne réconcilie au centime indépendamment
  ✓ Σ marge produit = somme des lignes (13.85)

── [F4] CTA complétude en variantes (jamais 1 sur 1) ──
  ✓ numérateur = 1 variante à confirmer (1)
  ✓ dénominateur = 2 variantes avec commandes (2)
  ✓ → '1 sur 2', JAMAIS '1 sur 1'

── [F3] CTA : variante 'missing' comptée au numérateur ET dénominateur ──
  ✓ dénominateur inclut la variante missing (2)
  ✓ numérateur = la variante missing (1)
  ✓ ligne missing toujours isolée des agrégats

── [F9] graphe < 2 points (donnée) ──
  ✓ 1 seule journée → byDay length 1 (déclenche le message F9) (1)

── [K] agrégation des postes de coût (BUG 1 : somme de valeurs stockées) ──
  ✓ douane agrégée = 3×2 + 3×1 = 9 (poste_unité × effective_qty)
  ✓ shopifyCost agrégé = 3
  ✓ coutRendu agrégé = 20×3 = 60
  ✓ breakdownAvailable true (les lignes ont un détail)
  ✓ aucun breakdown → breakdownAvailable false, postes à 0

── [GROUP] regroupement par décomposition identique ──
  ✓ 3 commandes identiques → 1 groupe (1)
  ✓ le groupe compte ses 3 commandes
  ✓ p.lines brut conservé (3) — le regroupement n'écrase pas le détail
  ✓ commandes triées récentes d'abord (2026-06-12,2026-06-11,2026-06-10)
  ✓ ce qui VARIE (qté) reste listé par commande
  ✓ le représentant porte la marge unitaire commune (5) — affichée une fois

── [GROUP] snapshots différents → groupes séparés ──
  ✓ coûts figés différents (10 vs 12) → 2 groupes (2)
  ✓ chaque groupe = 1 commande (décompositions distinctes non fondues)

── [GROUP] sérialisation stable (ordre des clés indifférent) ──
  ✓ mêmes valeurs, clés dans un ordre différent → une seule empreinte (1 groupe)

── [GROUP] exhaustivité du regroupement ──
  ✓ Σ commandes des groupes = 3 lignes en entrée (3)
  ✓ USD×2 groupées, EUR séparée (devise dans l'empreinte) → 2 groupes
  ✓ groupes triés par commande la plus récente d'abord

── [CENTIME] somme des produits = total, à 3 niveaux ──
  ✓ niveau 1 : Σ lignes dépli = marge produit PΣ (30.03)
  ✓ PΣ = 3 × 10,006 arrondis à la ligne = 30,03, pas 30,02 (30.03)
  ✓ niveau 2 : Σ produits = total marge (40.05)
  ✓ total = 30,03 + 10,02 = 40,05 (40.05)
  ✓ niveau 3 : Σ produits = total CA net (40.05)

── [R] computeCostReliability : X %, missing à part, top-3 par unités ──
  ✓ X % = 50 (100 sûrs / 200 chiffrés) — reçu 50
  ✓ dénominateur = chiffré (200), numérateur = confirmé+importé (100)
  ✓ missing compté à part (P4), jamais dans le %
  ✓ top à compléter = seulement estimated+missing (P3, P4)
  ✓ 1er = P4 (9 unités), status missing (marge inconnue)
  ✓ 2e = P3 (3 unités), status estimated
  ✓ tout-missing → reliabilityPct null (pas de division 0/0)
  ✓ tout-missing → 2 produits à renseigner, ventes présentes
  ✓ 100 % → aucun produit à compléter
  ✓ aucune vente → null, hasSales false

══════════════════════════════════════════════════════════════════
 BILAN LOT 7 (historique monitor) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── REF #1001 : Σ postes = unit_net_margin 364,76 ──
  ✓ Σ postes = 364,76 (364.76)
  ✓ store US → shop_taxes_included = false (pas de TVA collectée)
  ✓ douane/tvaImport exposés séparément dans le JSON

── NATIF : breakdown figé à l'ingestion, réconcilie ──
  ✓ margin_breakdown_json peuplé nativement
  ✓ Σ postes = unit_net_margin stocké (364.76 = 364.76)
  ✓ total #1001 reproduit = 364,76 (364.76)
  ✓ shop_taxes_included false figé (store US)

── NATIF FR : shop_taxes_included true, revenu HT ──
  ✓ shop_taxes_included = true figé (boutique FR TTC)
  ✓ revenu = HT < 60 TTC (50.00) — TVA collectée hors marge
  ✓ Σ postes = unit_net_margin (30.60 = 30.60)

── MISSING : pas de breakdown ──
  ✓ ligne missing → margin_breakdown_json null

── RE-RUN auto-validant : OK quand rien n'a dérivé ──
  ✓ re-run OK (réglages inchangés)
  ✓ breakdown rejoué réconcilie au unit_net_margin stocké (364.76 = 364.76)
  ✓ ligne d'entrée NON mutée (lecture pure)

── RE-RUN auto-validant : SKIP quand un taux a dérivé ──
  ✓ SKIP reconcile_mismatch (rejoué 346.76 ≠ stocké 364.76)

── RE-RUN : ligne sans coût figé → no_snapshot ──
  ✓ no_snapshot (rien à rejouer)

── Déterminisme du re-run ──
  ✓ deux re-runs → breakdown identique (déterministe)

── WATERFALL #1001 : Σ niveau 1 = unit_net_margin, tvaImport non déduit ──
  ✓ Σ niveau 1 = 364,76 (364.76)
  ✓ aucune TVA en déduction niveau 1 (W1)
  ✓ tvaImport informatif 42,85 (avancée puis récupérée)
  ✓ sous-détail coutRendu : douane seule (tvaNetCost=0 → pas de TVA non récupérable)
  ✓ note TVA collectée ABSENTE (store US, shop_taxes_included=false)
  ✓ libellé revenu neutre (pas 'HT' sur boutique sans TVA)
  ✓ adsCost jamais en déduction (pas de 'pub 0 €')

── WATERFALL W1 (franchise) : tvaImport DANS coutRendu, jamais doublé ──
  ✓ Σ niveau 1 = unit_net_margin 26,50 SANS ajouter tvaImport (26.50)
  ✓ tvaImport PAS une déduction niveau 1 (déjà dans coutRendu)
  ✓ sous-détail : TVA import non récupérable 14 € (dans coutRendu)
  ✓ PAS de libellé 'récupérée' en franchise (ne ment pas au marchand)

── WATERFALL W3 : gate note TVA collectée ──
  ✓ assujetti + taxesIncluded=true → note présente + libellé HT
  ✓ taxesIncluded=false → note absente (#1001)
  ✓ franchise → note absente (pas de TVA collectée)
  ✓ W4 : breakdown null (ligne pré-B) → pas de waterfall, pas de note

══════════════════════════════════════════════════════════════════
 BILAN LOT 8 (persistance breakdown) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── rentable → perte ──
  ✓ 1 basculement
  ✓ from profitable → to loss
  ✓ product_id + margin portés
  ✓ ni seed ni maj

── perte → rentable ──
  ✓ loss → profitable

── inchangé (les deux signes) ──
  ✓ aucun basculement
  ✓ 2 maj normales
  ✓ aucun seed

── nouveau produit → seed silencieux ──
  ✓ P5 en seed (state loss)
  ✓ pas d'alerte sur un produit jamais vu

── premier passage : prevStateMap vide ──
  ✓ tous seedés, aucun mail au premier run
  ✓ seeds portent product_id (pas id brut)

── exclusion multi-devises (MIXED) ──
  ✓ produit MIXED absent des 3 listes

── exclusion product_id null ──
  ✓ product_id null ignoré

── mélange réaliste ──
  ✓ A bascule (rentable→perte)
  ✓ B inchangé
  ✓ C seedé (nouveau)
  ✓ D (MIXED) exclu partout

── produit absent de current (état stocké conservé, zéro alerte) ──
  ✓ aucun basculement (pas de fausse alerte rentable)
  ✓ ni seed ni maj — l'état stocké est laissé tel quel par l'appelant

── seuil 15 % : marge 20 % > seuil → profitable ──
  ✓ aucun basculement (20 % ≥ 15 %)
  ✓ état profitable conservé

── seuil 15 % : marge 8 % (>0) < seuil → bascule loss ──
  ✓ bascule profitable → loss bien que marge > 0
  ✓ margin + marginPct portés (pour le mail)

── seuil 15 % : marge < 0 → loss ──
  ✓ marge négative → loss

── frontière stricte : marge == (T/100)×CA ──
  ✓ marge = 15 % pile = seuil → profitable (comparaison stricte <)

── CA = 0 & marge < 0, seuil 15 % → loss (pas de /0) ──
  ✓ CA=0 & marge<0 → loss
  ✓ marginPct null quand CA=0 (jamais NaN/Infinity)

── NON-RÉGRESSION : seuil = 0 == perte stricte legacy ──
  ✓ seuil 0 : marge 8 % reste profitable (perte STRICTE)
  ✓ param par défaut ≡ thresholdPct=0 (bit pour bit)
  ✓ comportement legacy intact (X rentable→perte, Y inchangé)

══════════════════════════════════════════════════════════════════
 BILAN LOT 9 (alerting diff état) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── ligne 1 imposée + objet ──
  ✓ objet mène avec la perte (demo.myshopify.com : 1 produit vendu à perte)
  ✓ objet FACTUEL sans emoji (anti-spam)
  ✓ objet : singulier correct
  ✓ ligne 1 imposée présente en HTML ET texte
  ✓ section retours au-dessus de l'objectif présente
  ✓ titres produits affichés
  ✓ plus de jargon 'marge nette cumulée'
  ✓ typo : le gabarit n'ajoute aucun tiret cadratin/demi-cadratin

── liste par produit : marge + écart vs objectif ──
  ✓ ligne 1 : pluriel « 2 produits sont »
  ✓ Tasse (perte) : préfixe « vendu à perte » + marge + % + écart 24 points
  ✓ Carnet : marge + % + écart 7 points
  ✓ produits présents en HTML

── poste de coût dominant + suffixe douane ──
  ✓ ligne perte : préfixe « vendu à perte » + marge
  ✓ poste dominant réinjecté (achat/port + surcharge)
  ✓ suffixe « (taux de douane estimé) » présent (texte + HTML, parité)

── suffixe douane : conditions négatives ──
  ✓ douane confirmée → aucun suffixe
  ✓ poste dominant ≠ douane → aucun suffixe (même si estimé)

── fallback : détail de coûts absent ──
  ✓ note fallback présente (explique l'absence + remède)
  ✓ aucune ligne de poste dominant (topCost absent)
  ✓ note fallback aussi en HTML (parité)
  ✓ breakdown dispo → aucune note fallback

── cause + contrat de déclenchement ──
  ✓ cause en une ligne présente (HTML + texte)
  ✓ la cause cite VOLONTAIREMENT la fenêtre 30 jours (contrat de calcul)
  ✓ contrat de déclenchement : la condition présente (HTML + texte)
  ✓ contrat : l'instruction de mise à jour des coûts présente
  ✓ aucun verbe d'action sur la marge (constat, pas conseil)
  ✓ aucune causalité inventée

── retours au-dessus de l'objectif, seuls ──
  ✓ ligne 1 adaptée : repassé au-dessus
  ✓ aucune mention « sous l'objectif » quand il n'y a que des retours

── pertes seules ──
  ✓ sous objectif seul, pas de section retours

── fallback nom produit ──
  ✓ titre absent → 'Produit 4242'

── devise par produit ──
  ✓ EUR formaté en €

── marge % absente ──
  ✓ marge % absente → montant seul, aucun écart inventé

── texte brut ≡ HTML : mêmes chiffres ──
  ✓ html ET texte non vides (jamais HTML-only)
  ✓ « -4,05 » présent dans le HTML ET le texte
  ✓ « -3,0 » présent dans le HTML ET le texte
  ✓ « 729,27 » présent dans le HTML ET le texte
  ✓ « 60,8 » présent dans le HTML ET le texte
  ✓ « 19,2 points » présent dans le HTML ET le texte

── dark mode : fond + texte explicites, bouton contrasté ──
  ✓ conteneur : fond blanc EXPLICITE (jamais inversé en dark)
  ✓ corps : couleur de texte foncée EXPLICITE avec !important
  ✓ bouton : fond plein + texte blanc EXPLICITES
  ✓ lien de repli : couleur EXPLICITE (jamais un bleu illisible en dark)

── lien app : parité HTML/texte + envoi jamais bloqué ──
  ✓ appUrl fourni → lien dans le HTML ET le texte (parité)
  ✓ libellé de bouton « Voir le suivi de marge » (HTML, inchangé)
  ✓ libellé + lien en texte brut
  ✓ appUrl absent → aucun lien d'app (ni HTML ni texte)
  ✓ email rendu QUAND MÊME sans lien (envoi jamais bloqué)

══════════════════════════════════════════════════════════════════
 BILAN LOT 10 (mail alerte) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── frozen, sous plafond, cadence écoulée ──
  ✓ 1re relance (jamais relancé) → send_dunning
  ✓ count 2, dernier envoi il y a 3 j → send_dunning
  ✓ count 4 (< plafond) → send_dunning

── frozen, cadence pas écoulée ──
  ✓ dernier envoi il y a 2 j (<3) → nothing
  ✓ envoyé aujourd'hui → nothing

── PIÈGE plafond : frozen, count >= 5 ──
  ✓ count 5 = plafond → nothing (même très espacé)
  ✓ count 9 > plafond → nothing
  ✓ constantes : plafond 5 / espacement 3 j

── active après relances → resolved ──
  ✓ paiement régularisé pendant le dunning → send_resolved
  ✓ résolu même au plafond → send_resolved

── PIÈGE : active jamais relancé → silence ──
  ✓ active sain (count 0) → nothing, jamais de mail intempestif

── PIÈGE : cancelled → stop définitif ──
  ✓ cancelled pendant dunning → stop_cancelled (pas send_dunning)
  ✓ cancelled → stop_cancelled

── statuts neutres (pending, expired, inconnu) ──
  ✓ pending (charge en attente d'approbation) → nothing
  ✓ expired → nothing
  ✓ statut inconnu → nothing

── frontière cadence : exactement 3 jours ──
  ✓ pile 3 j → send_dunning (comparaison ≥)
  ✓ 3 j moins 1 s → nothing

── robustesse entrées ──
  ✓ state absent → traité comme count 0, jamais relancé → send_dunning
  ✓ state vide → send_dunning

══════════════════════════════════════════════════════════════════
 BILAN LOT 11 (décision dunning) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── relance : lien de régularisation présent ──
  ✓ lien présent dans le HTML (bouton + lien copiable)
  ✓ lien présent dans le texte brut
  ✓ lien cliquable (href)
  ✓ sujet factuel : paiement échoué (Le paiement de votre abonnement True Cost Calculator a échoué)
  ✓ plan nommé (le bon plan)

── accès maintenu, coupure à venir, honnête, aucun dark pattern ──
  ✓ aucune affirmation de verrouillage actuel (faux : rien n'est coupé en grâce)
  ✓ ne prétend pas que l'abonnement/accès est déjà inactif
  ✓ vérité : l'accès continue pendant la grâce
  ✓ coupure présentée comme conditionnelle / à venir, pas actuelle
  ✓ rassurance données conservées (pas de dark pattern par peur)
  ✓ pas d'attribution fausse à Shopify (frozen ≠ coupure Shopify)
  ✓ échéance honnête (délai selon Shopify), aucune fausse date inventée
  ✓ aucun terme dark-pattern (trouvés: aucun)
  ✓ aucun mot en CAPITALES

── Chantier B suite : mail conditionnel à l'âge du gel ──
  ✓ gel 5 j (grâce en cours) → 'accès continue', pas de suspension
  ✓ gel 30 j (grâce expirée) → ABSENCE de 'votre accès continue' (fin de la contre-vérité)
  ✓ gel 30 j → 'est maintenant suspendu' (état réel)
  ✓ gel 30 j → rétablissement dès régularisation (aidant)
  ✓ gel 30 j → confirmationUrl TOUJOURS présent (action principale)
  ✓ gel 30 j → aucun terme dark-pattern
  ✓ gel 30 j → pas de fausse attribution à Shopify
  ✓ gel 30 j → aucun mot en CAPITALES
  ✓ pile à 28 j → borne INCLUSIVE = encore en grâce (comme la borne d'entitlement D2)
  ✓ frozenSince null → défaut SÛR 'accès continue' (jamais annoncer une suspension à tort)
  ✓ parité branche grâce : fragment dans HTML ET texte
  ✓ parité branche suspension : « est maintenant suspendu… » dans HTML ET texte
  ✓ parité branche suspension : « rétabli dès que votre pa… » dans HTML ET texte
  ✓ parité branche suspension : « https://demo.myshopify.c… » dans HTML ET texte

── resolved : sobre ──
  ✓ sujet : c'est réglé / accès rétabli (C'est réglé : votre accès est rétabli)
  ✓ corps : abonnement réactivé + merci
  ✓ pas de lien de charge dans le 'resolved' (rien à régulariser)

── plan absent (fallback neutre) ──
  ✓ fallback 'votre abonnement' + lien conservé

── texte brut ≡ HTML ──
  ✓ relance : html ET texte non vides (jamais HTML-only)
  ✓ « https://demo.myshopify.com/a… » dans le HTML ET le texte
  ✓ « True Cost Calculator Pro… » dans le HTML ET le texte
  ✓ « votre accès à True Cost Calc… » dans le HTML ET le texte
  ✓ « Vos données sont conservées… » dans le HTML ET le texte
  ✓ resolved : html ET texte non vides, 'réactivé' dans les deux

── typo : 0 tiret cadratin dans les mails dunning ──
  ✓ relance/grâce : 0 tiret cadratin (sujet/html/texte)
  ✓ relance/suspension : 0 tiret cadratin (sujet/html/texte)
  ✓ resolved : 0 tiret cadratin (sujet/html/texte)

══════════════════════════════════════════════════════════════════
 BILAN LOT 12 (mail dunning) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── frozen au milieu de l'historique bruité ──
  ✓ statut = frozen malgré 5 lignes de bruit
  ✓ frozenNode = le sub gelé (bon plan capturé)

── précédence : ACTIVE > FROZEN ──
  ✓ ACTIVE présent → active (gagne sur frozen)
  ✓ pas de frozenNode quand active

── précédence : FROZEN > PENDING ──
  ✓ frozen + pending → frozen (la cadence ≥3j gère l'anti-spam)

── pending seul ──
  ✓ pending + expired → pending

── plus rien d'actif → cancelled ──
  ✓ cancelled/expired/declined → cancelled
  ✓ historique vide → cancelled
  ✓ argument absent → cancelled (robustesse)

── recurringLineItems : même prix/intervalle ──
  ✓ 1 line item récurrent reconstruit
  ✓ amount = 15 (Number, pas string)
  ✓ devise + intervalle préservés

── recurringLineItems : filtrage & robustesse ──
  ✓ pricing non récurrent (usage) ignoré
  ✓ lineItems absent → []
  ✓ node null → [] (pas de crash)

══════════════════════════════════════════════════════════════════
 BILAN LOT 13 (statut + line items dunning) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── nextSessionHealth : succès remet à zéro ──
  ✓ compteur remis à 0
  ✓ first_failure_at effacé (série close)
  ✓ last_success_at = now

── nextSessionHealth : premier échec ──
  ✓ compteur = 1
  ✓ first_failure_at fixé à now
  ✓ last_failure_at = now

── nextSessionHealth : échec suivant ──
  ✓ compteur incrémenté (3 → 4)
  ✓ first_failure_at préservé (pas réécrit)

── shouldReap : pas assez d'échecs ──
  ✓ 9 échecs (< 10) même très ancien → pas de suppression

── shouldReap : trop récent ──
  ✓ 50 échecs mais série vieille de 20 j (< 21) → pas de suppression

── shouldReap : les deux seuils atteints ──
  ✓ 10 échecs ET 21 j → suppression
  ✓ largement au-delà → suppression

── frontières (≥) ──
  ✓ pile 10 / pile 21 j → true
  ✓ 21 j moins 1 s → false

── robustesse ──
  ✓ 99 échecs mais first_failure_at absent → false (ancienneté inconnue)
  ✓ health vide → false
  ✓ aucun argument → false
  ✓ constantes : 10 échecs / 21 j

══════════════════════════════════════════════════════════════════
 BILAN LOT 14 (reaper sessions) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── seuil=0 : marge dispo/unité = net_margin/qty ──
  ✓ 100/4 = 25,00, state 'ok'
  ✓ availableForAds(seuil=0) == net_margin

── seuil 10 % : réserve retirée ──
  ✓ (100 − 10%×200)/4 = 20,00

── machine à 5 états : un cas nommé chacun ──
  ✓ ok : margeDispoUnite > 0
  ✓ no_acquisition : margeDispoUnite < 0 (vend mais marge ≤ 0)
  ✓ value_destroyed : qty=0 & net_margin<0 (remboursé à perte)
  ✓ no_units : qty=0 & net_margin≥0 (remboursement neutre)
  ✓ mixed_currency : devise MIXED

── frontière : availableUnit == 0 → no_acquisition (verrou anti-refactor ≤/<) ──
  ✓ marge dispo/unité pile 0,00 (net_margin == requiredProfit)
  ✓ 0 € de budget = AUCUNE acquisition possible → no_acquisition (≤ 0, pas 'ok')

── exhaustivité : aucun état inattendu ──
  ✓ seuil 0% : tous les états ∈ {5 prévus}
  ✓ seuil 0% : montant ⇔ (ok|no_acquisition), null sinon
  ✓ seuil 10% : tous les états ∈ {5 prévus}
  ✓ seuil 10% : montant ⇔ (ok|no_acquisition), null sinon
  ✓ seuil 50% : tous les états ∈ {5 prévus}
  ✓ seuil 50% : montant ⇔ (ok|no_acquisition), null sinon
  ✓ seuil 100% : tous les états ∈ {5 prévus}
  ✓ seuil 100% : montant ⇔ (ok|no_acquisition), null sinon

── noAcqCount inconditionnel : les deux réalités, un compteur ──
  ✓ noAcqCount = 3 (A no_acquisition + C,D value_destroyed) — un compteur, libellé honnête ; la colonne les distingue
  ✓ catalogue sain → 0 (aucune bannière)
  ✓ value_destroyed seul → compté (jamais sous-estimé)

── A2 : CA=0 & qty>0 → seuil inopérant, capté ──
  ✓ requiredProfit=50%×0=0 (inopérant) ; −6/2=−3 → no_acquisition

── A3 : blended positif mais A saigne ──
  ✓ blended = 100/10 = 10,00 (positif, tentant)
  ✓ A en no_acquisition, compté → bannière inconditionnelle

── blended ──
  ✓ 300/10 = 30,00
  ✓ (300 − 15%×1000)/10 = 15,00
  ✓ multi-devises → null
  ✓ A6 : orders=0 → null (pas de NaN)

── noBudget : plafond blended ≤ 0 (miroir de no_acquisition) ──
  ✓ marge globale négative → cpaMax<0, noBudget true
  ✓ (100 − 20%×1000)/10 = −10 → noBudget true (marge absorbée par le seuil)
  ✓ plafond positif (30) → noBudget false
  ✓ cpaMax exactement 0 → noBudget true (frontière ≤ 0, cohérente margeDispoUnite)

── A7 : seuil 100 % → no_acquisition partout ──
  ✓ (50 − 100%×200)/5 = −30 : conséquence logique d'un seuil absurde

── écart : gapLabel/gapAmount serveur, 0 ≠ null ──
  ✓ déclaré 20 < 30 → 'Marge de manœuvre' 10 (magnitude serveur)
  ✓ déclaré 45 > 30 → 'Dépassement' 15 (magnitude POSITIVE, aucun Math.abs client)
  ✓ A4 : currentCpa=0 (déclaré) → écart plein (30)
  ✓ A4 : currentCpa=null (jamais saisi) → écart null (l'action DOIT mapper '' → null)

── blended : base exposée + lowSample (< 30 commandes) ──
  ✓ orders exposé (1)
  ✓ avgBasket = 2 unités/commande (le plafond par commande en dépend)
  ✓ 1 commande < 30 → lowSample (plafond indicatif, pas fiable)
  ✓ avgBasket = 17 unités / 10 commandes = 1,7 (arrondi serveur)
  ✓ 10 < 30 → lowSample
  ✓ pile 30 commandes → fiable (lowSample false)

── multi-devises → blended ET écart null (même avec CPA déclaré) ──
  ✓ devise ambiguë → pas de plafond ni d'écart (l'UI ne compare pas dans le vide)

── écart.stale : fraîcheur du CPA déclaré ──
  ✓ déclaré il y a 5 j (< 30) → frais
  ✓ déclaré il y a 40 j (≥ 30) → stale (grisé)
  ✓ pile 30 j → stale (≥)
  ✓ date absente → stale (fraîcheur invérifiable)

══════════════════════════════════════════════════════════════════
 BILAN LOT 15 (CPA prescriptif) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── ACTIVE ──
  ✓ Pro ACTIVE → isPro, pas Expert
  ✓ Expert ACTIVE → isPro ET isExpert

── FROZEN : accès maintenu dans la grâce ──
  ✓ Pro FROZEN (grâce en cours) → isPro = true (plus de rétrogradation au 1er échec)
  ✓ Pro FROZEN → pas Expert
  ✓ Expert FROZEN → isPro ET isExpert

── D2 : borne de la grâce FROZEN ──
  ✓ FROZEN depuis 10 j (< 28) → encore isPro
  ✓ FROZEN pile à 28 j → encore isPro (borne inclusive)
  ✓ FROZEN depuis 33 j → grâce expirée → free
  ✓ FROZEN sans frozen_since → grâce accordée

── D3 : alias de noms (robustesse au renommage) ──
  ✓ sub sous ancien nom + alias conservé → toujours isPro
  ✓ nom inconnu (hors ensemble) → free

── statuts NON entitlants → free ──
  ✓ Pro CANCELLED → free (ni isPro ni isExpert)
  ✓ Pro EXPIRED → free (ni isPro ni isExpert)
  ✓ Pro DECLINED → free (ni isPro ni isExpert)
  ✓ Pro PENDING → free (ni isPro ni isExpert)
  ✓ aucun abonnement → free

── FROZEN noyé dans le bruit d'historique ──
  ✓ FROZEN Pro compté malgré CANCELLED/EXPIRED/DECLINED autour
  ✓ Expert ACTIVE + vieux Pro CANCELLED → isExpert

── D1 : repli sur dernier plan connu ──
  ✓ cache 'expert' → isPro + isExpert
  ✓ cache 'pro' → isPro seul
  ✓ cache 'free' → free
  ✓ cache absent (null/undefined) → free

── Q1 : échec live + cache vide → indéterminé, pas free ──
  ✓ GraphQL échoué + cache vide → source 'indeterminate'
  ✓ … distinct de 'cache'/'live' : PAS un free dégradé silencieux
  ✓ … n'accorde rien (géré par retry/ErrorBoundary côté appelant, pas rendu free)
  ✓ cache illisible (undefined) → 'indeterminate' aussi
  ✓ cache 'free' CONNU → 'cache' (réellement gratuit), distinct de l'indéterminé
  ✓ cache 'pro' connu → 'cache' + isPro (D1)
  ✓ cache 'expert' connu → 'cache' + isExpert (D1)

── Q3 : boucle de retry bornée (refetch mocké) ──
  ✓ échoue 2× : refetch appelé exactement 2 fois (retries épuisés)
  ✓ … toujours non-live → resolveEntitlement rendra 'indeterminate'
  ✓ … soit bien la branche 'indeterminate' (pas un free dégradé)
  ✓ 1 échec puis succès : refetch appelé 2 fois, s'arrête au succès
  ✓ … enveloppe live obtenue → resolveEntitlement résout en 'live'
  ✓ refetch qui rejette → non-live (pas de crash) → 'indeterminate'
  ✓ budget 500ms / delay 200ms → coupé à 2 tentatives (pas 5) malgré retries=5 (obtenu 2)
  ✓ … budget épuisé → non-live → 'indeterminate' (jamais bloquant)

── D5 : réponse GraphQL réelle → billingIsPro ──
  ✓ extraction : 3 nœuds sortis de l'enveloppe réelle (garde-fou de forme)
  ✓ 1er nœud (reverse:true) = Pro FROZEN courant
  ✓ réponse RÉELLE (Pro FROZEN) → billingIsPro = true de bout en bout
  ✓ … et pas Expert (l'Expert de l'historique est CANCELLED)

── robustesse ──
  ✓ nodes undefined → free (pas de crash)
  ✓ nœuds partiels (name/status manquants) → free
  ✓ réponse null → 0 nœud (pas de crash)
  ✓ enveloppe vide → 0 nœud

── C4a : planToOrderCap + alertingEnabled ──
  ✓ Gratuit → 200 commandes/mois
  ✓ Pro → 1000 commandes/mois
  ✓ Expert → illimité (Infinity)
  ✓ entrée vide (défaut) → 200 (traité comme gratuit)
  ✓ 150 ≤ 200 (sous le palier) → alerting activé
  ✓ 200 == 200 (pile au palier, borne inclusive) → encore activé
  ✓ 201 > 200 (dépassé au mois M) → alerting coupé (M+1)
  ✓ Expert (cap Infinity) → toujours activé quel que soit le volume
  ✓ juillet 2026 → '2026-06' (mois normal)
  ✓ janvier 2026 → '2025-12' (rollover année)
  ✓ décembre 2026 → '2026-11'
  ✓ 31 mars → '2026-02' (jour d'entrée indifférent, pas de débordement)

══════════════════════════════════════════════════════════════════
 BILAN LOT 16 (droit au plan) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── decideAlertAction ──
  ✓ pas de basculement → 'nothing' (même ON + email)
  ✓ pas de basculement → 'nothing' (même OFF, sans email)
  ✓ basculement + OFF (+ email) → 'suppress'
  ✓ basculement + OFF (sans email) → 'suppress'
  ✓ basculement + ON + pas d'email → 'advance_only' (G3)
  ✓ basculement + ON + email → 'send'
  ✓ aucun argument (défaut) → 'nothing'

── shouldAdvanceState (invariant G2) ──
  ✓ 'nothing' → pas d'avance
  ✓ 'suppress' → JAMAIS avancer pendant OFF (zéro alerte perdue, rafale à la reprise)
  ✓ 'advance_only' → avance (G3 : pas d'email mais on avance)
  ✓ 'send' + envoi réussi → avance
  ✓ 'send' + échec envoi → PAS d'avance (réessai demain, invariant G2)
  ✓ 'send' sans sendOk (défaut false) → pas d'avance
  ✓ 'suppress' même avec sendOk=true → pas d'avance (OFF prime)
  ✓ 'advance_only' ignore sendOk → avance quand même

══════════════════════════════════════════════════════════════════
 BILAN LOT 17 (décision alerting) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── auditCategory : frontières au seuil 25 % ──
  ✓ 25 % pile au seuil → winner (borne inclusive, cohérente B7 ≥)
  ✓ 24,99 % → risky (rentable mais sous l'objectif)
  ✓ LE BUG CORRIGÉ : 20 % avec seuil 25 → risky, PAS Top Performer
  ✓ 0 % → risky (rentable au sens strict, sous l'objectif)
  ✓ -0,01 % → loser (perte réelle)
  ✓ 60 % → winner

── seuil 0 : bande risky structurellement vide ──
  ✓ 0 % avec seuil 0 → winner (≥ 0, pas une perte)
  ✓ 0,01 % → winner
  ✓ -0,01 % → loser
  ✓ seuil 0 → aucun produit « à risque » (0 ≤ x < 0 impossible)
  ✓ seuil 0 → tout rentable = winner, seule la perte réelle = loser

── classifyAudit : partition + ordre ──
  ✓ winners = a,d (≥25) dans l'ordre d'entrée
  ✓ risky = b,e (0≤x<25)
  ✓ losers = c (<0)
  ✓ partition exhaustive (aucun produit perdu ni compté deux fois)

── netPct manquant / non fini ──
  ✓ undefined → loser (pas winner par défaut)
  ✓ NaN → loser
  ✓ seuil absent (→0) : 10 % → winner
  ✓ seuil négatif normalisé à 0 : 10 % → winner

── auditLabels : cohérence libellé ≡ calcul ──
  ✓ winners → « marge ≥ 25 % » (pas « > 15 % »)
  ✓ risky → « marge 0 à 25 % »
  ✓ losers → « marge < 0 % »
  ✓ seuil 0 : libellé risky lisible, pas « marge 0 à 0 % » absurde (seuil à 0 %, bande inactive)
  ✓ seuil 0 : winners → « marge ≥ 0 % »
  ✓ seuil décimal formaté FR : « marge ≥ 25,5 % »

══════════════════════════════════════════════════════════════════
 BILAN LOT 18 (classification audit) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── isRecalcableCostSource : recalculable ⇔ estimated|missing ──
  ✓ estimated → recalculable
  ✓ missing → recalculable
  ✓ confirmed → IMMUABLE (autorité marchand)
  ✓ imported → IMMUABLE (CSV marchand)
  ✓ valeur inconnue → IMMUABLE (défaut sûr)
  ✓ null → IMMUABLE
  ✓ undefined → IMMUABLE

── selectDeletableLines : recalculable ∧ fenêtre order_created_at ──
  ✓ ne supprime QUE o1,o2 (recalculables ∧ dans la fenêtre)
  ✓ retourne les LIGNES COMPLÈTES (pour capture/restauration)
  ✓ confirmed/imported/hors-fenêtre/sans-date : tous préservés
  ✓ isDeletableLine : estimated récent → supprimable
  ✓ isDeletableLine : hors fenêtre (order_created_at) → NON supprimable (perte évitée)
  ✓ isDeletableLine : confirmed → jamais supprimable
  ✓ isDeletableLine : sans order_created_at → on garde
  ✓ horloge invalide ⇒ ne rien supprimer
  ✓ rows null ⇒ [] (null-safe)
  ✓ fenêtre 0j ⇒ rien de re-synchronisable
  ✓ fenêtre 60j ⇒ o3 rentre aussi

── touchedProductIds : produits impactés ──
  ✓ p1 (dédupé) + p2 ; product_id null exclu
  ✓ null-safe → set vide

── missingLines : réconciliation capture ↔ présent ──
  ✓ restaure o2,o3 (absentes après sync), pas o1 (recréée)
  ✓ lineKey déterministe
  ✓ lineKey sans collision de concaténation
  ✓ sync KO (rien de présent) → toutes restaurées = rollback complet
  ✓ aucune capture → rien à restaurer

── formatProductNames : troncature 5 ──
  ✓ aucun nom → chaîne vide (l'UI masque la ligne)
  ✓ ≤ 5 → liste simple
  ✓ pile 5 → pas de troncature
  ✓ 6 → 5 + « et 1 autre » (singulier)
  ✓ 8 → 5 + « et 3 autres » (pluriel)
  ✓ vides / non-string ignorés

── buildRecalcSummary : aucun changement ──
  ✓ états identiques → aucun passé à perte
  ✓ états identiques → aucun redevenu rentable
  ✓ lignesRecalculees = lignes de l'état après

── buildRecalcSummary : produits passés à perte ──
  ✓ Tapis + Lampe passés à perte (ordre = apres)
  ✓ Chaise déjà en perte → PAS un basculement
  ✓ resume texte des passés à perte

── buildRecalcSummary : > 5 produits à perte ──
  ✓ les 7 basculements sont bien tous listés (tableau complet)
  ✓ resume tronqué à 5 + « et 2 autres »

── buildRecalcSummary : redevenus rentables ──
  ✓ Tapis redevenu rentable (perte → ≥ 0)
  ✓ aucun passé à perte

── buildRecalcSummary : mix + états inconnus ──
  ✓ seul Tapis bascule en perte (basculement connu-connu)
  ✓ seul Lampe redevient rentable
  ✓ états inconnus (avant absent/non fini) exclus de tout basculement

── buildRecalcSummary : repli de nom + entrées vides ──
  ✓ nom absent → repli « Produit <id> »
  ✓ états vides ⇒ résumé neutre (null-safe)

══════════════════════════════════════════════════════════════════
 BILAN LOT 19 (recalcul marges — décisions pures) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── classificationStatus : true ⇔ confirmée, tout le reste ⇒ estimée ──
  ✓ true → confirmée
  ✓ false → estimée
  ✓ null (miss de jointure) → estimée
  ✓ undefined (legacy) → estimée
  ✓ valeur non-booléenne 1 → estimée (pas de coercition)

── customsRateForCategory : taux TARIC + repli ──
  ✓ Textile → 12 %
  ✓ Sport → 5 %
  ✓ Jouets → 0 %
  ✓ catégorie inconnue → repli 3 %
  ✓ undefined → repli 3 %

── customsRateChanged : basé sur le taux ──
  ✓ Textile 12 % → Sport 5 % : changement
  ✓ Sport → Sport : identique, pas de changement
  ✓ Jouets 0 % → Livres 0 % : MÊME taux → PAS de changement (pas de recalcul à tort)
  ✓ Textile 12 % → Jouets 0 % : changement

── customsIndicator : confirmée ⇒ null ──
  ✓ confirmée → null (aucun indicateur)
  ✓ estimée → libellé « à confirmer »
  ✓ adossé à la nomenclature TARIC (pas de chapitre inventé)

── resolveCustomsConfirmedOnWrite : catégorie changée ⇒ false, identique ⇒ préserve ──
  ✓ changée depuis un flag confirmé → false (le cas import CSV qui écrase)
  ✓ changée depuis estimé → false
  ✓ identique + confirmé → PRÉSERVE true (réécrire la même valeur n'invalide pas)
  ✓ identique + estimé → reste estimé
  ✓ flag absent → estimé
  ✓ newCat undefined + confirmé → PRÉSERVE true (pas de dé-confirmation silencieuse)
  ✓ newCat null + confirmé → PRÉSERVE true
  ✓ newCat undefined + estimé → reste estimé

── resolveAuditCategory : confirmé ⇒ catégorie adoptée + aucun indicateur ──
  ✓ variante confirmée → ADOPTE 'Sport' (≠ mapping 'Textile'), aucun indicateur
  ✓ variante non confirmée → mapping 'Textile' + indicateur
  ✓ variante SANS ligne (trou) → estimé (jamais d'optimisme)
  ✓ vc undefined → estimé
  ✓ produit confirmé : audit et tableau de coûts s'accordent sur la catégorie

── invalidation appliquée par chemin (costs_save / costs_import_csv) ──
  ✓ costs_save : catégorie éditée → classification repasse estimée
  ✓ costs_save : catégorie inchangée → classification préservée
  ✓ costs_import_csv : même catégorie → préservée
  ✓ costs_import_csv : catégorie écrasée → estimée

── frozenClassificationStatus : lecture du champ figé ──
  ✓ snapshot flag true → confirmée
  ✓ snapshot flag false → estimée
  ✓ champ absent (legacy) → estimée
  ✓ snapshot null (missing/legacy) → estimée

── composition : rateChanged ⇒ recalcul ne touche PAS les lignes confirmed ──
  ✓ prérequis : la correction change bien le taux
  ✓ le recalcul ne supprimerait QUE o1 (estimated) + o3 (missing) — o2 confirmed intacte

── email : suffixe douane estimé (pire cas, parité texte/HTML) ──
  ✓ customsEstimated + douane dominante → suffixe présent (texte)
  ✓ … présent aussi en HTML (parité)
  ✓ customsEstimated=false → aucun suffixe
  ✓ poste dominant ≠ douane → aucun suffixe (même si estimé)

── cron : décision de basculement inchangée par customsEstimated ──
  ✓ basculements IDENTIQUES avec/sans customsEstimated (champ inerte)
  ✓ fixture golden : p1→loss, p2→profitable
  ✓ p3 = seed (nouveau) — écriture d'état inchangée

── confirmCustomsCategory : validation + aucune écriture si invalide ──
  ✓ catégorie hors CATEGORIE_KEYS → error explicite, ZÉRO écriture (DB non touchée)
  ✓ productId absent → error, ZÉRO écriture
  ✓ catégorie vide → error, ZÉRO écriture

── applyCustomsInvalidation : chunk 100 + invalidation à cheval ──
  ✓ lookup chunké : 100+50 (pas un seul .in() de 150 GIDs)
  ✓ v0 (chunk 1) catégorie identique → flag PRÉSERVÉ true
  ✓ v149 (chunk 2) catégorie changée → flag false (invalidation correcte à cheval)
  ✓ v5 (chunk 1) sans ligne stockée → estimé (false)

── mergeCustomsFeedback : nudge rateChanged collant ──
  ✓ succès(rc=true) puis succès(rc=false) → rc RESTE true (collant)
  ✓ erreur puis succès(rc=false) → rc=false (l'erreur n'apportait pas de rc)
  ✓ succès(rc=true) puis erreur → erreur affichée (rc perdu, l'erreur prime)
  ✓ next absent → prev conservé
  ✓ chaîne de succès reste un succès

══════════════════════════════════════════════════════════════════
 BILAN LOT 20 (classification douanière) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── T1 : match exact ──
  ✓ liste à une entrée, domaine identique → match
  ✓ liste multiple, entrée au milieu → match
  ✓ liste multiple, entrée en fin → match
  ✓ domaine hors liste → false

── T1 : insensibilité à la casse ──
  ✓ entrée env en majuscules → match
  ✓ domaine session en majuscules → match
  ✓ casse mixte des deux côtés → match

── T1 : espaces parasites ──
  ✓ entrée entourée d'espaces → match
  ✓ espaces autour des virgules → match
  ✓ domaine session avec espaces → match (trim des deux côtés)

── T1 : variable absente, vide, malformée ──
  ✓ BETA_SHOPS absente (undefined) → false, pas de crash
  ✓ BETA_SHOPS null → false
  ✓ BETA_SHOPS vide → false
  ✓ BETA_SHOPS espaces seuls → false
  ✓ virgules seules (entrées vides) → false
  ✓ entrées vides mêlées à une entrée valide → la valide matche
  ✓ entrée malformée (pas un domaine) → inerte par égalité stricte
  ✓ BETA_SHOPS non-string (42) → false
  ✓ BETA_SHOPS non-string (tableau) → false
  ✓ domaine session undefined → false
  ✓ domaine session vide → false
  ✓ domaine session espaces vs entrée vide → false (le vide ne matche jamais le vide)

── T1 : doublons ──
  ✓ entrée dupliquée → match, pas de crash
  ✓ doublons sans le domaine cherché → false

── T1 : jamais de match par suffixe, préfixe ou sous-domaine ──
  ✓ « evil-shop.… » vs entrée « shop.… » → false
  ✓ « shop.… » vs entrée « evil-shop.… » → false (sens inverse)
  ✓ « evilshop.… » (suffixe sans tiret) vs « shop.… » → false
  ✓ entrée tronquée « myshopify.com » ne matche aucun shop complet
  ✓ sous-domaine vs domaine → false
  ✓ domaine vs sous-domaine → false (sens inverse)
  ✓ préfixe (domaine rallongé à droite) → false
  ✓ entrée rallongée à droite → false (sens inverse)
  ✓ troncature d'un caractère → false (égalité stricte)

── T2 : betaTrialOverride (objet étalé dans billing.request) ──
  ✓ BETA_TRIAL_DAYS = 45 (constante unique)
  ✓ shop bêta + Expert → override exactement { trialDays: BETA_TRIAL_DAYS }
  ✓ shop normal + Expert → override {} : l'objet passé à billing.request est INCHANGÉ
  ✓ BETA_SHOPS absente → override {} pour tout shop (défaut sûr prod)
  ✓ fusion config+override : bêta → 45
  ✓ fusion config+override : normal → 7 (config)

── T2/V3 : périmètre du câblage dans le source ──
  ✓ app._index.jsx : exactement UN appel betaTrialOverride (le handler subscribe_expert)
  ✓ les deux handlers subscribe sont localisés dans le source
  ✓ handler Pro : AUCUN override, aucun trialDays → shop bêta + Pro reçoit 7 j (O4)
  ✓ handler Expert : override branché sur session.shop + process.env.BETA_SHOPS (env lue au site d'appel, O2)
  ✓ handler Expert : la ligne isTest est INTACTE (O8 — bêta réelle → test:false)
  ✓ app._index.jsx : aucun trialDays numérique en dur
  ✓ shopify.server.js : la config nominale trialDays: 7 des DEUX plans est intacte
  ✓ shopify.server.js : aucune logique bêta (la config nominale ne bouge pas)
  ✓ betaShops.js : aucune lecture de process.env dans le code (helper PUR, O2)
  ✓ betaShops.js : la valeur 45 n'apparaît qu'une fois dans le code (la constante BETA_TRIAL_DAYS)

══════════════════════════════════════════════════════════════════
 BILAN LOT 21 (allowlist bêta) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════
```

### Annexe B — sortie integrale de scripts/render_check.mjs (35 scenarios)

```text
=== RENDU RÉEL — CustomsClassificationPanel (Suivi des coûts) ===
node : Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server 
renderer's output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To 
avoid this, useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
Au caractère Ligne:1 : 475
+ ... hpad\render_check.txt"; node scripts/render_check.mjs *> $out; Write- ...
+                             ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (Warning: useLay...r common fixes.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  rows=null (ÉTAT INITIAL avant réponse listFetcher) — ne doit PLUS crasher
       → (vide — composant retourne null)
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  rows=[] (chargé, catalogue vide) → panneau masqué
       → (vide — composant retourne null)
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  rows=[1 produit estimé] → affiche « à confirmer »
       → <div style="padding:12px 14px;border-radius:8px;background:#FBFBFC;border:1px solid #E4E5E7;margin-bottom:16px"><div sty…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  rows=[1 produit confirmé] → panneau masqué (null)
       → (vide — composant retourne null)
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  rows=[2 variantes divergentes] → « catégories divergentes »
       → <div style="padding:12px 14px;border-radius:8px;background:#FBFBFC;border:1px solid #E4E5E7;margin-bottom:16px"><div sty…

=== RENDU RÉEL — CustomsEstimatedTag (Monitor / Audit) ===
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  estimated=true → badge « Taux estimé »
       → <span title="Le taux de douane dépend de la catégorie, encore estimée. Confirmez-la dans « Suivi des coûts » pour un tau…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  estimated=false → null (aucun affichage, par contrat)
       → (vide — composant retourne null)
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  estimated=undefined (champ absent) → null
       → (vide — composant retourne null)

=== RENDU RÉEL — CustomsFeedbackBanner (Suivi [4], règle d'or) ===
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  feedback null → rien
       → (vide — composant retourne null)
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  succès + rateChanged → « taux a changé », prochains calculs, pas de « vérités auditées »
       → <div style="padding:10px 14px;border-radius:8px;margin-bottom:12px;display:flex;align-items:flex-start;gap:10px;backgrou…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  succès sans changement → « prochains calculs », message court
       → <div style="padding:10px 14px;border-radius:8px;margin-bottom:12px;display:flex;align-items:flex-start;gap:10px;backgrou…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  erreur → message d'erreur affiché
       → <div style="padding:10px 14px;border-radius:8px;margin-bottom:12px;display:flex;align-items:flex-start;gap:10px;backgrou…

=== RENDU RÉEL — CostSummaryBanner (Suivi [1], toujours visible) ===
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  sans commande analysée → invite « synchronisez »
       → <div style="padding:14px 18px;border-radius:10px;background:#F9FAFB;border:1px solid #E4E5E7;color:#6D7175;font-size:13p…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  avec données → CA net, marge nette, commandes, pill à perte
       → <div style="padding:14px 18px;border-radius:10px;background:#F1F8F5;border:1px solid #00806033;margin-bottom:16px;displa…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  multi-devises → renvoi au détail (pas de total agrégé faux)
       → <div style="padding:14px 18px;border-radius:10px;background:#F9FAFB;border:1px solid #E4E5E7;color:#6D7175;font-size:13p…

=== RENDU RÉEL — ReliabilityCounter (Suivi, point 4) ===
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  aucune vente (hasSales false) → null (l'invite « synchronisez » vit ailleurs)
       → (vide — composant retourne null)
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  X % + missing + top-3 → « ventes analysées », ligne missing, produits cliquables
       → <div style="padding:14px 18px;border-radius:10px;background:#FBFBFC;border:1px solid #E4E5E7;margin-bottom:16px"><div st…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  tout-missing (pct null) → invite « Renseignez vos coûts », pas de %
       → <div style="padding:14px 18px;border-radius:10px;background:#FBFBFC;border:1px solid #E4E5E7;margin-bottom:16px"><div st…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  borne 100 % → aucun produit à compléter, aucune ligne missing
       → <div style="padding:14px 18px;border-radius:10px;background:#FBFBFC;border:1px solid #E4E5E7;margin-bottom:16px"><div st…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  produit supprimé (titleFor null) → « (produit supprimé de la boutique) », lien inactif
       → <div style="padding:14px 18px;border-radius:10px;background:#FBFBFC;border:1px solid #E4E5E7;margin-bottom:16px"><div st…

=== RENDU RÉEL — ProductCostList (Suivi) ===
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  liste vide → « Aucun produit actif »
       → <div style="padding:32px;text-align:center;color:#6D7175;font-size:13px;border:1px solid #E4E5E7;border-radius:10px">Auc…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  liste partielle → titre + « Partiel » + marge réelle + note 30 jours
       → <div style="font-size:11px;color:#6D7175;margin-bottom:8px;line-height:1.5">La marge réelle se calcule sur vos commandes…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  liste : produit sans vente (marge « — ») → tooltip explicatif présent
       → <div style="font-size:11px;color:#6D7175;margin-bottom:8px;line-height:1.5">La marge réelle se calcule sur vos commandes…

=== RENDU RÉEL — ProductCostPanel (Suivi, champs vides + placeholders) ===
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  panneau : bouton « Enregistrer ce produit », suggestion en placeholder (« ex : 8 »), ✓ sur variante confirmée, aide repli
       → <div style="border:1px solid #E4E5E7;border-radius:8px;background:#FBFBFC;padding:12px"><div style="font-size:11px;color…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  panneau : erreur de validation prix d'achat (≤ 0) affichée
       → <div style="border:1px solid #E4E5E7;border-radius:8px;background:#FBFBFC;padding:12px"><div style="font-size:11px;color…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  panneau multi-variantes → en-tête « Variante » présent
       → <div style="border:1px solid #E4E5E7;border-radius:8px;background:#FBFBFC;padding:12px"><div style="font-size:11px;color…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  panneau mono-variante → aucune colonne « Variante », ni « Variante unique »
       → <div style="border:1px solid #E4E5E7;border-radius:8px;background:#FBFBFC;padding:12px"><div style="font-size:11px;color…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  post-save : produit incomplet restant → « Continuez : {titre} » cliquable
       → <div style="border:1px solid #E4E5E7;border-radius:8px;background:#FBFBFC;padding:12px"><div style="font-size:11px;color…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  post-save : tout renseigné + aucune commande → invite synchroniser
       → <div style="border:1px solid #E4E5E7;border-radius:8px;background:#FBFBFC;padding:12px"><div style="font-size:11px;color…
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
  OK  post-save : tout renseigné + commandes présentes → clôture « marges se calculent avec ces coûts »
       → <div style="border:1px solid #E4E5E7;border-radius:8px;background:#FBFBFC;padding:12px"><div style="font-size:11px;color…
  OK  panneau : intro « ces coûts servent à calculer votre vraie marge »
       → <div style="border:1px solid #E4E5E7;border-radius:8px;background:#FBFBFC;padding:12px"><div style="font-size:11px;color…

✅ Tous les rendus réels OK
Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded into the server renderer's 
output format. This will lead to a mismatch between the initial, non-hydrated UI and the intended UI. To avoid this, 
useLayoutEffect should only be used in components that render exclusively on the client. See 
https://reactjs.org/link/uselayouteffect-ssr for common fixes.
    at RouterProvider (file:///C:/Users/mathy/true-cost-calculator/true-cost-calculator/node_modules/react-router/dist/
development/chunk-4N6VE7H7.mjs:6658:3)
```
