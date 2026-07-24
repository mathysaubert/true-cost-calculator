# True Cost Calculator — Récapitulatif technique exhaustif

> Document de référence. Objectif : comprendre l'état du produit sans lire tout le code, et retrouver le *pourquoi* de chaque décision. Écrit le 2026‑07‑22. Repo à `main` = `f076621`, **188 commits**, **20 fichiers de test** (lots 1→19 + invariants), **685 assertions** au total.

---

## Sommaire

1. [Architecture générale](#1-architecture-générale)
2. [Fonctionnalités, famille par famille](#2-fonctionnalités-famille-par-famille)
3. [Systèmes invisibles](#3-systèmes-invisibles)
4. [Historique des chantiers (chronologique)](#4-historique-des-chantiers)
5. [Pièges neutralisés (section critique)](#5-pièges-neutralisés)
6. [Décisions de conception assumées](#6-décisions-de-conception-assumées)
7. [État des lieux final](#7-état-des-lieux-final)

---

## 1. Architecture générale

### Stack

| Couche | Techno | Notes |
|---|---|---|
| Framework | **React Router v7** (ex‑Remix), embarqué Shopify | `app/routes/`, loaders + actions server‑side |
| App Bridge | `@shopify/shopify-app-react-router` | iframe admin, token exchange OAuth |
| Base de données produit | **Supabase (Postgres)** | tout le domaine métier ; accès via service role (RLS deny‑all) |
| Sessions Shopify | **Prisma** → Postgres (Supabase) | table `Session`, `PrismaSessionStorage` |
| Hébergement | **Vercel** (`vercelPreset`) | fonctions serverless, `maxDuration: 60` sur les crons |
| Crons | **Vercel Cron** (`vercel.json`) | 3 jobs quotidiens (profitability 06:00, dunning 07:00, session_reaper 08:00 UTC) |
| Emails | **Resend** | `email.server.js`, isolé, best‑effort |
| IA | **Anthropic** | recommandation produit, dégradation gracieuse (timeout 18s, repli neutre) |
| Erreurs | **Sentry** | `sentry.server`, DSN manuel (le wizard ne gère pas React Router v7) |

Config Shopify (`shopify.app.toml`) : `client_id = 86fd438b…`, `application_url = https://true-cost-calculator-silk.vercel.app`, `api_version` webhooks = `2026-07`, scopes = **`read_products,read_inventory,read_orders`** (voir §6 pour la déclaration PCD minimisée). Flag critique `automatically_update_urls_on_dev = false` (voir §4, page blanche prod).

### Le moteur de calcul (`app/lib/engine.js`) — le cœur verrouillé

**Rôle** : `engine.js` (192 lignes) est la **source unique** de toute formule de marge / douane / TVA / frais. Code **100 % pur** (aucun import React / Shopify / Supabase / Sentry), pour être (1) importé par la route `app._index.jsx` (UI + loader + action) **et** (2) importé tel quel par les tests Node. La règle absolue : *toute formule vit ICI et nulle part ailleurs*.

**Pourquoi il est verrouillé** : la contrainte « **engine.js 0 diff** » revient dans chaque chantier récent. C'est une garantie de non‑régression : tant que le moteur ne bouge pas, aucun calcul de marge ne peut dériver. Les fonctionnalités se branchent *autour* de lui (adaptateurs d'arguments, agrégations, lecture pure), jamais dedans. Corollaire : `formatEur` (hard‑EUR) reste dans `engine.js` mais **n'est plus appelé nulle part** (remplacé par `formatMoney` currency‑aware, voir §6) — on le garde pour préserver le 0‑diff.

Contenu clé : constantes réglementaires (`LOW_VALUE_PARCEL_CEILING = 150`, `EU_DROPSHIP_DUTY_REFORM_DATE = 2026-07-01`, `EU_DROPSHIP_FLAT_DUTY = 3`), `PAYMENT_PROCESSORS` (Stripe EU/non‑EU, Shopify Payments Basic/Avancé/Plus — rate % + `fixedFee` 0,25€), `CUSTOMS_RATES` (par catégorie), `SHIPPING_ESTIMATES` (par pays), `VAT_RATES` (5,5 % Alimentation/Livres, 20 % le reste), et les fonctions `computeMargin`, `calcNetMargin`, `computeScenarios`, `computeLandedCost`, `getCustomsDuty`, `getVatRate`, `simulateSellingPrice`.

**Les décompositions D1→D5** (référencées partout) sont les postes du moteur :
- **D1** = revenu net (TTC net, HT si assujetti — dépend de `shop.taxesIncluded`)
- **D2** = frais boutique (Shopify % + processeur % + fixe) — éditables (`shop_plans`)
- **D3** = prorata du fixe processeur au niveau ligne (`allocateOrderFixedFee`)
- **D4** = quantité effective = `quantity − refunded_qty` (clamp ≥ 0)
- **D5** = « douane historique » : le `now` est **injecté** dans le moteur (jamais `Date.now()` interne) pour que la date de réforme UE s'applique selon la date **de la commande**, pas d'exécution.

### Les invariants (`tests/invariants.mjs`) — **76 assertions cross‑lot**

Les tests par lot valident chaque module en isolation ; les invariants attrapent les dérives **entre** modules (motivés par un vrai bug : un `27,41€` devenu `25,02€` silencieusement du Lot 1 au Lot 2, invisible lot‑par‑lot). `invariants.mjs` importe le **vrai** moteur (pas une réimplémentation) et vérifie 76 propriétés :
- **Égalité canonique multi‑chemins** : `computeMargin` ≡ `calcNetMargin` ≡ `computeScenarios.current` (les trois portes d'entrée donnent le même nombre).
- **Identités CPA** : `cpaMax = margeNette` et `cpaMax − adsCost = margeNette` (à 0,001 près).
- **Ordre franchise < assujetti** par catégorie (la TVA récupérable améliore la marge).
- **Monotonie douane** : douane pré‑réforme ≤ post‑réforme.
- **Monotonie coût rendu** : `coutRendu(qty 1) ≥ qty 10 ≥ qty 100` (le port par lot se dilue).
- **Cas dégénérés** : entrées nulles/zéro → toutes sorties finies (jamais NaN/Infinity).
- **Ancres écran (B4)** : cas de référence figés — marge 2,43€, CPA 2,43€, ROAS 20,6× — qui cassent si une règle métier change sans le vouloir.
- **Adaptateur audit ≡ moteur** : l'audit catalogue rejoue son mapping d'arguments (taux ×100, shipping explicite) et doit retomber sur `computeMargin` au centime.

### La suite de tests — ce qu'elle couvre, ce qu'elle ne couvre pas

**19 lots + invariants = 685 assertions.** Chaque lot est **permanent** (« ne pas rm »). Panorama :

| Lot | Couvre |
|---|---|
| lot1 | fork douane dropshipping/stock + date‑gate réforme UE |
| lot2 | libellés UI / cohérence |
| lot3 | CPA / ROAS |
| lot4 | garde‑fous d'affichage (BUG 1 / BUG 2 / cpaColor) |
| lot5 | coûts par variante (estimation, validation, CSV, réhydratation) |
| lot6 | ingestion commandes (mapping → engine, refunds, missing) |
| lot7 | agrégats historique monitor (65 assertions — le plus gros) |
| lot8 | persistance + backfill du breakdown (auto‑validant au centime) |
| lot9 | diff d'état de rentabilité (alerting) |
| lot10 | mail d'alerte perte (novice, poste dominant) |
| lot11 | décision dunning (send/resolved/stop/nothing) |
| lot12 | mail dunning (attribution correcte, parité texte/HTML) |
| lot13 | statut abonnement + line items (FROZEN) |
| lot14 | session reaper (double seuil) |
| lot15 | CPA prescriptif (42 assertions, A1→A7) |
| lot16 | droit au plan / entitlement (54 assertions, FROZEN, fail‑open) |
| lot17 | décision alerting au volume |
| lot18 | classification audit ≡ seuil configuré |
| lot19 | recalcul des marges (décisions pures) |

**Ce que les tests NE couvrent PAS : le JSX.** La suite ne teste que les **fonctions pures**. Conséquence historique (voir §4, dette) : trois bugs JSX (import manquant, expression absurde, référence à une variable supprimée) ont traversé toute la suite le même jour. **C'est pourquoi eslint a été ajouté au gate de build** (`3acd07d`) : `vercel-build = npm run lint && npm test && prisma… && react-router build`. eslint tourne en premier (fail‑fast) et attrape précisément ce que les tests ne voient pas (`no-undef`, imports/variables inutilisés). Voir §5 et [`eslint_build_gate.md`].

### La séparation fonctions pures / I‑O — systématique

Chaque fonctionnalité récente suit le même patron en « briques » :
- **Décisions pures** dans un module `lib/*.js` (aucun I/O) → testables par lot Node.
- **Plumbing I/O** dans un module `lib/*.server.js` ou une route → orchestre, ne décide rien.

Exemples : `recalcMargins.js` (pur) vs `recalcEstimatedMargins.server.js` (I/O) ; `profitabilityAlert.js` (pur : `computeProfitabilityChanges`, `decideAlertAction`, `shouldAdvanceState`) vs `api.cron.profitability.jsx` (I/O) ; `dunning.js` (pur) vs `api.cron.dunning.jsx` (I/O) ; `plan.js` (pur) vs `plan.server.js` (I/O). **Raison** : la logique métier devient testable sans mocker Shopify/Supabase, et le gate attrape les bugs de décision au niveau du lot. La règle transverse du monitor : *aucune dérivation de marge côté client* (« BUG 1 ») — le JSX ne fait que rendre des nombres déjà calculés serveur.

---

## 2. Fonctionnalités, famille par famille

### A — Le calculateur (onglet Simulation / Audit)

**Calcul de marge nette (A1)** — `computeMargin` (engine.js), rendu dans `app._index.jsx`. Prend prix d'achat, prix de vente, catégorie, pays, régime TVA (assujetti/franchise), modèle logistique (dropshipping/stock), frais processeur, taux de retours. Sort : coût rendu, douane, TVA import non récupérable, frais Shopify/processeur, marge nette (€ et %). Cas limites : de minimis douane (colis < 150€ en dropshipping avant réforme), TVA récupérable en assujetti, date‑gate réforme UE (01/07/2026 → forfait 3€), port entrant réparti sur le lot fournisseur (`qty_par_lot`), format FR des nombres (espaces milliers).

**Simulation prix cible (A2)** — `simulateSellingPrice` / `computeScenarios` : « quel prix pour telle marge ? ». Détail des postes (emballage, retours), garde sur les entrées (borne max prix, marge cible cohérente). Le fixe processeur affiché « par vente » sur sa propre ligne.

**Audit catalogue (A3)** — parcourt les produits Shopify (`read_products`), estime les coûts, classe chaque produit. Classification dans `auditClassify.js` (`auditCategory`, `classifyAudit`, `auditLabels`) : `loser < 0`, `risky 0 ≤ x < t`, `winner ≥ t` où **t = le seuil de rentabilité configuré du marchand** (plus de 15 %/0 % en dur — voir §5). L'audit rejoue exactement le mapping d'arguments du moteur (verrouillé par les invariants). Cas limites : TOP X dynamique, dédup podium, catégorie Shopify Standard → productType → titre.

**Recommandation IA** — `aiPayload.js` (`buildMargeLine`) construit un payload **100 % sourcé du moteur** (fin de la marge brute dérivée inline — voir §5 BUG 1) ; le prompt formate dans la devise de la boutique. Dégradation gracieuse : timeout 18s, message de repli neutre, Sentry sur épuisement de crédits.

**Gating A** : le calcul manuel est **illimité sur tous les plans** (le plafond 10/mois a été retiré, `d5baadf`). Le plan Gratuit **sauvegarde** aussi ses calculs (`dbb6652`), la lecture de l'historique avancé reste Pro+.

### B — Le monitoring (onglet Suivi des coûts)

**Coûts par variante — Brique A** — `variantCosts.js`, table `variant_costs`, action `costs_list/costs_save/costs_confirm_all/costs_import_csv`. Estime automatiquement (`estimateVariantCost` : `prix_achat ← unitCost` Shopify, catégorie ← mapping, port ← pays boutique), valide (`validateCostRow`), importe/exporte CSV (`parseCostsCsv`/`buildCostsCsv`). Trois `cost_source` : `estimated` (deviné), `confirmed` (saisi), `imported` (CSV). Réhydratation : une ligne `estimated` se laisse corriger par un `unitCost` réel Shopify (`reconcileEstimatedCost`) ; `confirmed`/`imported` sont **immuables** (voir §5).

**Monitor de marge réelle — Brique B** — `orderIngest.js` + `orderSync.server.js` + `orderHistory.js`, table `order_margins`. Synchronise les vraies commandes 30 j (bulk operation Shopify) → `buildOrderHistoryRows` mappe chaque ligne vers `computeMargin` et **fige** le résultat (snapshot des coûts + `margin_breakdown_json`). L'agrégation (`aggregateOrderMargins`) **ne re‑dérive aucune marge** : elle groupe et somme les colonnes déjà calculées par le moteur. Cas limites : refunds récupérés **hors bulk** (contrainte Shopify « connection‑sous‑liste », `c32189b`), lignes `missing` (coût absent → marge null, jamais comptées 0 ni perte), arrondi au centime **par ligne** avant sommation (`b52873a` — pour que la colonne s'additionne exactement au total).

**Waterfall poste‑par‑poste (B9/B10)** — `c55253c`/`c4d900b` : dépli auditable par ligne de commande, breakdown figé à l'ingestion (`buildMarginBreakdown`), rejouable par `backfillRowBreakdown` (auto‑validant au centime). Regroupement par décomposition identique (`groupLinesByFingerprint`, cap 20 commandes/groupe) — grouper ≠ recalculer.

**Alerting produit‑à‑perte (B7)** — `profitabilityAlert.js` + `api.cron.profitability.jsx`, table `product_profitability_state`. Cron quotidien : sync → agrégat → **diff d'état** (`computeProfitabilityChanges`) → mail sur basculement. Frontière = seuil configurable (`net_margin < (T/100) × net_revenue`, T = 0 par défaut = perte stricte). Mail (`renderLossAlertEmail`) écrit pour un novice : « vous perdez X » + poste de coût dominant (`dominantCostPost`), objet sans emoji (anti‑spam), deep‑link vers l'onglet Coûts. Cas limites : produits multi‑devises (`MIXED`) jamais suivis, produit supprimé (product_id null) non stockable, premier passage = seed silencieux.

**Recalcul des marges figées (chantier récent)** — `recalcMargins.js` (pur) + `recalcEstimatedMargins.server.js` (I/O) + bouton UI. Corrige les marges ingérées sur un coût estimé/manquant : supprime les lignes recalculables (`estimated`/`missing`) dans la fenêtre 30 j, re‑synchronise (recrée avec les coûts actuels), re‑baseline l'état en muet, résume au marchand (« N recalculées » + produits passés à perte nommés). Voir §4 et §5 (piège n°5).

**Gating B** : monitor et alerting disponibles ; le **plafond d'alerting** dépend du plan (voir §3).

### C — L'analyse (CPA / ROAS)

**Break‑Even ROAS (C1/C2)** — `roas.js` : ROAS de rentabilité par plateforme (`AD_PLATFORM_RANGES`, `platformLabel`), verdict agrégé (`computeRoasPhrase`/`computeRoasLabel`/`roasInviable`), conseil CPA dérivé **du même verdict** (`computeCpaAdvice`/`computeCpaColor` — fin de la contradiction d'écran, voir §5 BUG 2). Alerte sur ROAS économiquement inviable (> 10×). Numérateur break‑even = **revenu HT** (pas prixVente TTC) — bug corrigé `98fd72f`.

**CPA prescriptif (B5) + déclaration CPA (B6)** — `cpaTargets.js` (`computeCpaTargets`), table `shop_plans.current_cpa`. Dérive, par produit et « blended » (niveau boutique) : marge disponible/unité (`net_margin − seuil% × CA`), CPA max, écart vs le CPA déclaré. Machine à états verrouillée (5 états + frontière `== 0`, `49337b3`) : `profitable`, `no_acquisition`, `value_destroyed`, etc. Fiabilité blended : `orders`/`avgBasket`/`lowSample` (< 30 commandes), date au fuseau réel de la boutique (`ianaTimezone` Shopify). Flag `blended.noBudget` (`cpaMax ≤ 0`) → « Acquisition impossible » + 2 causes. **Réservés au plan Expert** (`aafc557`).

**Gating C** : Break‑Even ROAS + Audit = Pro+ ; CPA prescriptif/déclaration = **Expert**.

### Résumé du gating par plan (`plan.js`)

`planEntitlement` → `{ isPro, isExpert }` avec **isExpert ⇒ isPro** (l'Expert englobe le Pro). Plafond d'alerting par commandes/mois (`planToOrderCap`) : **Gratuit = 200**, **Pro = 1000**, **Expert = ∞**. Repli pur sur le dernier plan connu (`entitlementFromPlan`/`fallbackEntitlement`), `source: 'live'|'cache'|'indeterminate'` (voir §5, défaut sûr).

---

## 3. Systèmes invisibles

### Le dunning (récupération de churn involontaire) — livré le 2026‑06‑29

Cron quotidien séparé `api.cron.dunning.jsx` (`0 7 * * *`), logique pure `dunning.js` (`decideDunningAction`, `deriveSubscriptionStatus`, `recurringLineItems`), mails dans `email.server.js` (`sendDunningEmail`/`sendDunningResolved`), table `subscription_dunning_state`. Tests lot11/12/13. Grâce **28 j** (`FROZEN_GRACE_DAYS`).

**Gotchas Shopify (vérifiés en vrai, [`dunning_and_offline_token.md`])** :
- `activeSubscriptions` **ne renvoie pas les FROZEN** → il faut `allSubscriptions` puis dériver le statut par précédence `ACTIVE > FROZEN > PENDING > cancelled`.
- Un FROZEN réel est **inatteignable sur un dev store** (pas de vraie facturation) → la détection se prouve en **pur** (lot13), pas en e2e.
- **Recréer la charge dans le mode du sub d'origine** (`AppSubscription.test`) et non `NODE_ENV` (`54a1410`) : un abonnement de test doit être recréé en test, un réel en réel.

### Le plafond d'alerting au volume (C4) — bascule différée

Fondation `plan.js` (`planToOrderCap`, `alertingEnabled`, `previousMonth`) + compteur `usage.orders_count` (incrément atomique RPC `increment_usage_orders`, `824a3bb`). Décision pure `decideAlertAction`/`shouldAdvanceState` (lot17, `ca07785`), branchée sur le cron (`6cafd54`), bandeau UI (`29289a9`). **Bascule différée** : l'alerting est coupé ce mois **si et seulement si** le compteur du **mois précédent** a dépassé le palier du plan (le mois en cours est toujours servi). **Défaut sûr** : plan indéterminé (Shopify injoignable) ou lecture en échec → alerting **ON** (on ne `suppress` jamais sur un doute — au pire un email de trop). Le contournement du piège **G2** (ne jamais avancer l'état pendant OFF) est décrit en §5.

### Le session reaper — double seuil

`sessionReaper.js` (pur : `nextSessionHealth`, `shouldReapSession`), table `session_health`, cron quotidien `api.cron.session_reaper.jsx` (`0 8 * * *`). Supprime une session offline morte **seulement si** ≥ **10 échecs consécutifs ET** série vieille de ≥ **21 j** (double seuil — un simple compteur raterait le cas « beaucoup d'échecs mais récents » et inversement). `first_failure_at` absent → ancienneté inconnue → **pas de suppression** (défaut sûr). Tests lot14.

### La conformité RGPD

Webhook unifié `webhooks.compliance.jsx` (`customers/data_request`, `customers/redact`, `shop/redact`) + `webhooks.app.uninstalled.jsx`. Purge exhaustive des **tables marchand** à la désinstallation / au redact : `calculations`, `calculation_annotations`, `margin_alerts`, `order_margins`, `order_sync_state`, `product_profitability_state`, `rate_limits`, `session_health`, `shop_plans`, `subscription_dunning_state`, `usage`, `variant_costs` (+ filet sur la session). Page publique `/privacy`. Note PCD : `read_orders` ne lit **aucune donnée client** → déclaration Protected Customer Data à **minimiser** (voir §6).

### Les emails (Resend)

`email.server.js` + `emailLayout.js` (`emailShell`, `EMAIL_TEXT`, `EMAIL_MUTED`). Trois familles : alerte perte, dunning (relance + resolved). Robustesse **dark mode** : coquille HTML avec fond explicite + metas `color-scheme`, couleur de texte explicite **+ `!important`** sur chaque `p/li/h3` (anti‑recolorisation par les clients mail, `b6f0a61`/`7435a12`). **Parité HTML ≡ texte brut** garantie par test (`991bac4` — mêmes chiffres, une ligne par paragraphe). **Deep‑links** construits serveur depuis `shop` + `SHOPIFY_API_KEY` (template pur, aucun env) ; email jamais bloqué si le lien manque.

---

## 4. Historique des chantiers

*(Chronologique par thème. Hash = commit principal.)*

### Fondations & déploiement (mai 2026)

- **Init** `f9aff1d` — True Cost Calculator avec billing freemium. `6d766a6` — migration Prisma **SQLite → PostgreSQL (Supabase)**. `b113d16` — `vercelPreset()`.
- **Page blanche en prod** `04e90e0` — *problème* : l'app s'ouvrait sur une page blanche, zéro log Vercel. *Cause racine* : `automatically_update_urls_on_dev = true` (défaut) → chaque `shopify app dev` écrasait l'`application_url` de prod dans Shopify Partners par l'URL du tunnel Cloudflare (morte). *Solution* : passer le flag à `false` + `shopify app deploy` pour repousser la bonne URL + `SHOPIFY_API_SECRET` Vercel == Partners exactement. Voir [`project_production_deploy.md`].
- **OAuth token exchange** `be78cdc`/`6349bbc` — route `/api/auth` pour l'installation. `2fd1fa4` — `returnUrl` reste dans le contexte Admin (évite la boucle auth/login).
- **Sécurité** `a85345b` — policies **RLS deny‑all** explicites sur toutes les tables Supabase (accès serveur uniquement via service role). `f473e33`/`8c214de` — audit sécurité pré‑beta + 18 corrections.
- **Détection de plan** `50b7593` — remplacer `billing.check()` par un GraphQL direct (la détection échouait sur les dev stores).

### Correction du moteur (BUG 1 / BUG 2 & droit réglementaire)

- **BUG 2 — ROAS/CPA sur TTC** `98fd72f` — *problème* : le CPA max / Break‑Even ROAS utilisait `prixVente` **TTC** au numérateur au lieu du **revenu HT** → break‑even faux en assujetti. Corrigé + garde‑fou permanent (`71d264e`).
- **BUG 1 — marge dérivée inline** `36f12ee` — *problème* : le payload IA recalculait une marge brute `prixVente − coutRendu` **hors moteur** → risque de divergence. *Solution* : payload 100 % sourcé de `computeMargin`. Règle érigée en principe (« aucune dérivation de marge hors engine »).
- **Invariants cross‑lot** `8c862fc` — extraction du moteur partagé + `invariants.mjs` (76 assertions) après la dérive silencieuse 27,41 → 25,02.
- **Droit réglementaire** : `b20860b` calcul CIF douane/TVA selon droit douanier UE ; `96a269c` de minimis + sélecteur régime TVA récupérable ; `0784f09` fork douane dropshipping/stock + date‑gate réforme UE 01/07/2026 ; `91d60a5` TVA réduite 5,5 % Alimentation/Livres ; `19a4679` revenu HT en assujetti (`shop.taxesIncluded` lu depuis l'API) ; `0bf3dd8` frais processeur `rate% + fixedFee€` ; `fae5180` port entrant réparti sur le lot.
- **`now` injectable** `358005b` — le chemin IA passe aussi un `now` explicite (déterminisme, douane historique).

### Monitoring — Briques A & B (juin 2026)

- **Brique A (coûts par variante)** `7555d7a` + `4d4f404` (migration ré‑exécutable, `DROP POLICY IF EXISTS`).
- **Brique B (monitor commandes)** `a07ce0a` (scope `read_orders`) → `0f78683` (module pur d'ingestion + schéma) → `fb30e8a` (wiring route backfill) → `c32189b` (refunds hors bulk). Puis UI : `cb5c5f4` sous‑bloc repliable, `1dc7ed8`/`8dd758b` devise réelle + symbole court, `d419792` dépli auditable + CTA complétude, `c55253c`/`c4d900b` breakdown persisté + waterfall.
- **Réhydratation des coûts** `feec910` — `estimated` réhydraté depuis `unitCost` Shopify, `confirmed`/`imported` intouchés (voir §5).
- **Arrondi par ligne** `b52873a` — la colonne s'additionne exactement au total.

### Alerting B7 (juin–juillet 2026)

Briques 1→5 : `1594dcf` (table état) → `26347ec` (extraction sync réutilisable) → `317c585` (diff pur + lot9) → `039d011` (mail Resend) → `6ef38e9` (route cron). Puis `e998be9` seuil configurable, `def49bd` mail novice + `topCost`, `ec20d9d` objet anti‑spam, `895acc7` audit aligné sur le seuil (fin des 15 %/0 % en dur — voir §5), `863853b` deep‑link.

### Dunning & session reaper (juin–juillet 2026)

- **Dunning** : `97ec4ed`→`245bdbe`→`08a10e6`→`8433dda` (Briques 1‑4), `9c6173a` détection FROZEN (fin de la rétrogradation au 1er échec), `dfa201f` plan detection robuste (fail‑open), `fcac11f` mail conditionnel à l'âge du gel, `2aed8cd` extraction pure + lot13, `54a1410` recréer la charge dans le mode du sub d'origine.
- **Session reaper** : `59f466d`→`f3c1aee`→`3630785` (Briques 1‑3), `b158ac4` passage en quotidien.

### CPA prescriptif & fiabilité blended (juillet 2026)

`8677e56` module pur `computeCpaTargets` + lot15 → `9143535` lot15 étendu A1→A7 → `0bc505d` signal `exhaustedCount` + obsolescence 30j → `49337b3` machine à états (5 états, frontière ==0) → `e587a22`/`e750477` migration + action + UI → `f1417e2`→`5d4c761`→`1704d78` fiabilité blended (lowSample, date fuseau boutique) → `97a0dd7`/`cd83c3a` bornes CPA → `5a0aa3c` hiérarchie visuelle overspend.

### Refonte tarifaire C1→C6 & bugs billing critiques (juillet 2026)

- **Grille** : `bf3cfd9` Pro 29$ / Expert 69$ ; `d5baadf` calcul illimité tous plans ; `dbb6652` le Gratuit sauvegarde ; `aafc557` CPA prescriptif réservé Expert ; `88d2d01` libellés alignés sur le packaging (volume en tête) ; `35f3d43` cartes réécrites + note anti‑mur.
- **Plafond alerting C4** : `824a3bb` (C4a compteur) → `ca07785` (C4b‑1 décision pure) → `6cafd54` (C4b‑2 branchement cron) → `29289a9` (C4c bandeau).
- **⚠ Bugs billing critiques** :
  - **`trialDays` absent** `9a76bb8` — *problème* : l'essai de 7 jours annoncé sur la fiche App Store n'était **pas appliqué** → facturation immédiate. *Cause* : `trialDays` doit vivre au niveau du **plan** (sibling de `lineItems`) dans `billing` de `shopify.server.js` ; il était absent → `billing.request` facturait sans essai. *Solution* : `trialDays: 7` dans la config des deux plans.
  - **`isTest` sur `NODE_ENV`** `510ed43` — *problème* : le flag de facturation `isTest` se basait sur `NODE_ENV` → un vrai marchand en prod aurait pu obtenir un abonnement de test (ou l'inverse). *Solution* : `isTest` basé sur `partnerDevelopment` (détection dev store via `shop.plan.partnerDevelopment`), défaut sûr = **facturation réelle** au moindre doute. La même logique de mode d'origine a plus tard corrigé le dunning (`54a1410`).
  - **Plan Gratuit « 0$/mois »** `d4ee097` — cohérence de la grille : les prix s'affichent dans la devise de **billing Shopify (USD)**, y compris le 0$.

### Fiche App Store & PCD

`fe2553f` — `read_orders` ne lit aucune donnée client → déclaration **Protected Customer Data à minimiser** (ne cocher aucun champ client, surtout pas IP/géoloc/navigateur/OS). Scopes documentés dans `shopify.app.toml`.

### Dette de groupe & polish UI (juillet 2026)

- **Devise & seuils** : `8e8a250` affichage dans la devise de la boutique (`shop.currencyCode` source primaire), `4fe77d0` retrait des attributions non sourçables (Fevad) + **désambiguïsation des deux seuils** (voir §6), `d28802b` prompt IA dans la devise de la boutique.
- **Tableau « Par produit »** : `7eaf877` table‑layout fixe → `9eb3d80` minWidth 480 → `a8d157f` badge « Aucun budget » sans débordement → `7bd3ca9` **6 colonnes** (Ventes fusionnée, CA net déplacé dans le dépli) → `b32801f` largeurs recalées. `d83c799` waterfall groupé + CPA blended sans budget.
- **Emails dark mode** : `b6f0a61`/`7435a12` (voir §3).

### Activation (first‑run)

`7df1fba` retire le badge BÊTA → `1132e80` carte guidée first‑run (install → marge réelle en un clic) → `5fbfaf0` feedback sur tout état terminal.

### Recalcul des marges (chantier le plus récent)

Le seul chantier **prouvé en réel de bout en bout** (voir §7). Quatre commits :
- `f8f928d` **Brique 1** — fondation pure : `isRecalcableCostSource`, `selectDeletableLines`, `buildRecalcSummary`, `formatProductNames` + lot19.
- `74b8cca` **Brique 2** — action serveur `recalc_estimated_margins` : capture → DELETE fenêtré (`order_created_at` ≥ J‑30) → re‑sync → réconciliation/restauration → re‑baseline muet. Prouvée sans fausse alerte.
- `d39b33b` **Brique 3** — bouton UI « Corriger les marges calculées sans coût » + résumé (état de chargement, produits passés à perte nommés, rate‑limit).
- `f076621` — outillage de test (`recalc_live_proof.mjs`, mode `--setup`).

Détail du *pourquoi* en §5 (piège n°5).

---

## 5. Pièges neutralisés

*Ce sont les invariants de sécurité qui se re‑casseraient au premier refactor imprudent. À lire avant de toucher au monitoring, à l'alerting ou au billing.*

### G2 — l'état de profitabilité est un DÉTECTEUR de transition, pas un registre de livraison

`product_profitability_state` sert **uniquement** à détecter un basculement `profitable ↔ loss` d'un run de cron à l'autre (`prev.last_state ≠ state`). Le piège : quand l'alerting est **suspendu** (plafond de volume dépassé), il ne faut **jamais avancer l'état stocké**. Sinon, à la reprise, l'état aurait « sauté » les basculements survenus pendant la suspension → **alerte perdue**. La garde vit dans `shouldAdvanceState` (pur, lot17) : `suppress` → `false` (on n'avance pas), `advance_only` → `true`, `send` → `true` **seulement si l'envoi a réussi**. Corollaire : avancer l'état SSI l'email part réellement, sinon on réessaie demain (rafale‑digest à la reprise). **Ne jamais** écrire l'état « pour ranger » — il n'est pas un journal de livraison.

### Piège n°5 — recalculer une marge ne doit PAS déclencher de fausse alerte (le re‑baseline muet)

*Problème* : le recalcul des marges (chantier récent) supprime des lignes `order_margins` et les recrée avec les coûts actuels. Une marge qui passe de « faussement rentable » (coût estimé trop bas) à « réellement en perte » **change l'état de rentabilité du produit**. Si on laissait `product_profitability_state` inchangé, le **prochain cron** verrait une transition `profitable → loss` qui n'a jamais eu lieu commercialement → **fausse alerte email**.

*Solution* (`recalcEstimatedMargins.server.js`) : après le recalcul, **réécrire** `product_profitability_state` dans la même opération, **sans passer par le chemin d'envoi d'email**. Concrètement : `computeProfitabilityChanges(aggApres.byProduct, new Map(), seuil).seeds` (prevMap **vide** → tout ressort en `seeds`, aucun `basculement`) → upsert direct (comme `writeStates` du cron), **jamais** via `runForShop`. Le module **n'importe pas** `email.server.js`. Deux garanties : (1) aucun chemin d'envoi dans le code ; (2) l'état écrit ≡ ce que le prochain cron **recalculera** (même lecture cap 5000, même agrégat, même seuil) → `prev.last_state === state` → `majNormales`, jamais `basculements` → aucun email. **Prouvé en réel** : après un clic sur le bouton, `computeProfitabilityChanges` donne `basculements: 0`.

⚠ Exigence associée : l'état re‑baseliné doit refléter l'**agrégat COMPLET du produit** (lignes recalculées **+** lignes immuables), pas seulement les lignes touchées — un produit peut mélanger les deux. On agrège donc **toutes** les lignes relues, puis on filtre aux produits touchés pour l'écriture.

### Réhydratation des coûts — `estimated` réhydraté, `confirmed`/`imported` immuables

`reconcileEstimatedCost` (variantCosts.js) : une ligne **`estimated`** se laisse corriger si Shopify expose un `unitCost` réel qui diffère (une donnée réelle bat une estimation), avec `needsPersist=true` **seulement si la valeur change** (convergence en 1 write, pas de boucle). Une ligne **`confirmed`/`imported`** (saisie ou CSV du marchand) fait **AUTORITÉ → jamais touchée**. Cette asymétrie est la même que celle du recalcul : on ne détruit/écrase jamais une donnée que le marchand a validée.

### Marges historiques figées (snapshot) & recalcul fenêtré

Une ligne `order_margins` porte un **snapshot figé** des coûts + la marge calculée par le moteur à l'ingestion → l'historique ne bouge jamais tout seul (`ignoreDuplicates` à la re‑sync ne mute jamais un snapshot existant). Conséquence : une ligne ingérée sur un coût faux garde sa marge fausse **à vie** — d'où le recalcul. Deux invariants de sûreté du recalcul :
1. **Fenêtre sur `order_created_at`, pas `computed_at`** (révision assumée en Brique 2). Le re‑sync re‑fetch sur `created_at ≥ J‑30` ; une ligne au `computed_at` récent mais à l'`order_created_at` hors fenêtre ne serait **jamais recréée** → perte permanente. On ne supprime donc **que ce que le sync sait recréer**.
2. **Capture → DELETE → sync → réconciliation → restauration**, pas de transaction (le bulk Shopify poll ~25 s → impossible en `BEGIN/COMMIT`). Toute ligne capturée non recréée par le sync est **restaurée à l'identique** (`missingLines`). Sync KO → tout est restauré (rollback complet). Les lignes `confirmed`/`imported` ne sont **jamais** visées. `order_margins` reste un cache **reconstructible** depuis Shopify (filet ultime).

### Autres invariants de sécurité repérés dans le code

- **Aucune dérivation de marge côté client** (« BUG 1 ») : tout calcul est serveur/pur, le JSX ne fait que rendre. Grouper (`groupLinesByFingerprint`) ≠ recalculer.
- **Défaut sûr sur le plan indéterminé** : Shopify injoignable → `source: 'indeterminate'` → n'accorde rien de payant **mais** l'alerting reste **ON** (un doute ne doit pas avaler une alerte). Jamais rendre `free` sur un échec live (géré par retry/ErrorBoundary).
- **Facturation réelle au moindre doute** : `isDevStore` → toute incertitude (erreur GraphQL, champ absent, timeout) retombe sur **facturation réelle**, jamais test.
- **`missing` jamais compté 0 ni perte** : une ligne sans coût est rangée à part, exclue des agrégats/rentabilité — « la compter 0 ou perte serait faux ».
- **Multi‑devises (`MIXED`) jamais sommé** : somme cross‑devise interdite → produit exclu de l'alerting et du re‑baseline.
- **`no-undef` jamais masqué** : un vrai import manquant se corrige, on ne désactive pas la règle pour faire passer le gate.
- **Classification douanière — flag séparé, orthogonal aux coûts** (chantier douane) : `variant_costs.customs_confirmed` ≠ `source`. Le statut est **figé au snapshot** (jamais résolu au rendu, sinon une confirmation efface le signal sur un historique au mauvais taux) ; **invalidé** dès qu'un autre chemin change la catégorie (catégorie absente du payload ⇒ préservé) ; l'audit **adopte** la catégorie confirmée (jamais deux taux pour un même produit). Aucune écriture de `product_profitability_state` ; recalcul réutilisé (jamais les marges confirmées).

---

## 6. Décisions de conception assumées

### Devise : ce qui est converti vs ce qui reste en €

Tout l'affichage passe par `feesCurrency` (loader `app._index.jsx`) : `shop.currencyCode` (primaire) → devise de la 1re commande → `"EUR"`. Helper `money = (n) => formatMoney(n, feesCurrency)` ; les marges se formatent via la devise **par commande** (`p.currency`). **Restent volontairement en € (les convertir serait faux)** : la douane forfaitaire UE (0€/3€ forfait réglementaire) et les barèmes processeurs EU (« Stripe EU 1,5 % + 0,25€ » — libellés en € par le processeur). Les **plans** s'affichent en **USD** (devise de billing Shopify). Voir [`currency_display.md`].

### Bijection du lexique marchand (référence pour toute chaîne future)

Chantier « simplification du langage » (ère XIV) : **un concept = un terme canonique**, avec des formes courtes **déclarées** (pas de synonyme sauvage). Toute nouvelle chaîne marchand doit s'y conformer. Jargon e-commerce que la cible connaît (ROAS, CPA, dropshipping, SKU) = gardé + explication à la 1ʳᵉ occurrence. Jargon comptable/fiscal/technique et vocabulaire développeur = bannis.

| Concept | Terme canonique | Formes courtes déclarées | Emplacements |
|---|---|---|---|
| Coût d'achat + port + douane (+ TVA si franchise) | **Coût réel total** | « Coût réel par unité » (simulation), colonne courte « Coût réel/unité » (waterfall) | ligne de déduction calc, ventilation, prompt IA (données + définitions) |
| TVA payée à l'import | **TVA à l'import** | « (remboursée) » (assujetti) / « (non remboursée) » (franchise / email de perte) | ventilation, waterfall, tooltips régime, email de perte, prompt IA |
| Mode d'expédition | **Comment vous expédiez** | colonne « Expédition » | champ calc/simulation, params audit, colonne coûts |
| Part de publicité dans le CA | **Part de pub dans vos ventes** | « − Publicité » (déduction), « Aucun budget pub », « Publicité suspendue » (levier IA via `normLevier`) | champ calc, déductions, validation, audit |
| Marge restante pour l'acquisition | **Reste pour la pub** (colonne) | tooltip portant la définition complète | colonne bijection monitor |
| ROAS d'équilibre | **ROAS minimum pour être rentable** | — | carte Expert (×3 occurrences) |
| Statut de classification douane | **Taux estimé, à confirmer** | badge « Taux estimé » | tag douane, panneau de confirmation |
| Régime de TVA | **Assujetti à la TVA** / **Franchise de TVA** | aides « (vous facturez et récupérez la TVA) » / « (vous ne facturez pas la TVA) » | champs calc + simulation, tooltips |
| Droits de douane | **Droits de douane** (`X % sur le produit + port`, `forfait de 3 € par article`, `gratuit`) | — | ventilation, prompt IA |

**Exceptions consignées** (non conformes, assumées) : les *hints* de `PAYMENT_PROCESSORS` (`engine.js:20-24`) portent `—` + `€` en dur → **`engine.js` 0 diff prime**, non touchés. Le levier `Budget ads suspendu` (`engine.js:176`) est **neutralisé à la consommation** par `normLevier` (couche route) avant d'atteindre le prompt IA.

**Typo** : tiret cadratin/demi-cadratin en ponctuation = **banni** (reformulé en `,` / `:` / parenthèses, jamais 1:1) ; plages « A–B » → « A à B » ; séparateurs d'options → « · ». **Intouchables** : signe moins des déductions (U+2212 `−`), traits d'union français (au-delà, e-commerce), placeholders « pas de valeur » (`—` en cellule vide), noms produits, clés de catégories, commentaires, `docs/`, `CLAUDE.md`.

### Les trois notions de seuil (ne jamais reconfondre)

1. **`shop_plans.profitability_threshold_pct`** (défaut 0) — libellé UI **« Seuil de rentabilité »**. Pilote **deux** features alignées : les **alertes email B7** ET la **classification de l'audit catalogue** (`auditClassify.js`). C'est la source unique de « rentable ».
2. **`margin_alerts.threshold`** (défaut 25) — libellé UI **« Seuil d'alerte de marge »**. Feature **séparée** : bandeau `AlertBanner` sur les 20 derniers calculs manuels + sparkline. Rien à voir avec B7/audit.
3. **CPA / marge dispo par unité** (`cpaTargets.js`) — **dérive** du seuil #1 (`availableForAds = net_margin − seuil% × CA`), pas un seuil en soi.

⚠ Historique : les deux premiers s'appelaient tous deux « seuil de rentabilité » (collision) et les libellés étaient **inversés** — renommés en juillet 2026 (`4fe77d0`). **Ne pas réintroduire « rentabilité » pour `margin_alerts`.** Voir [`thresholds_and_cpa_states.md`].

### Ce que le produit NE fait PAS (bornes assumées)

- **30 jours max** de commandes (`read_orders`, fenêtre 30 j ⊂ 60 j → `read_all_orders` non requis ; historique long = v1.1).
- **Pas de multi‑boutiques** : un `shop_domain` = un contexte isolé.
- **Marché Europe / droit français** : TVA FR, douane UE, réforme 01/07/2026. Les taux réglementaires en € sont assumés.
- **Français uniquement** (vouvoiement, format FR des nombres).
- **Aucune donnée client lue** (PCD minimisée) — que du financier/line‑items.

---

## 7. État des lieux final

### Chiffres

- **188 commits** sur `main` (HEAD `f076621`).
- **20 fichiers de test** (lots 1→19 + `invariants.mjs`), **685 assertions** dont **76 invariants cross‑lot**.
- **19 migrations** Supabase, **~18 modules** `app/lib/`, **15 routes**, **3 crons** quotidiens.
- Gate de build : **eslint (0 erreur / 281 warnings tolérés) → tests → prisma → build**.
- `engine.js` = **192 lignes verrouillées** ; `app._index.jsx` = ~3 978 lignes (le gros composant UI).

### Prouvé en réel vs prouvé par le code

- **Prouvé par le code (tests purs)** : tout le moteur, les décisions d'alerting/dunning/reaper/CPA/recalcul, la classification audit, l'entitlement (685 assertions).
- **Prouvé en réel (dev store)** : le **recalcul des marges** — parcours complet testé dans l'app (marge fausse injectée → clic bouton → produit nommé passé à perte → marge revenue juste → cron simulé = `basculements: 0`). C'est le seul chantier validé de bout en bout en conditions réelles.
- **Non prouvable en e2e (par nature)** : la détection FROZEN du dunning (pas de vraie facturation sur dev store) → prouvée en pur (lot13). Le token offline expire ~quotidiennement → tester un maillon Shopify local exige d'ouvrir l'app d'abord (voir [`dunning_and_offline_token.md`]).

### Points de vigilance connus pour l'avenir

- **Tableau « Par produit » à 6 colonnes** dans un `aside` étroit : plusieurs itérations (table‑layout fixe, minWidth, CA net déplacé dans le dépli). Surveiller un débordement horizontal au prochain ajout de colonne — la contrainte est réelle, ne pas ré‑élargir sans vérifier le rendu mobile.
- **CA net dans le dépli** (pas dans la colonne principale) : décision d'espace assumée (`7bd3ca9`). Le total reste cohérent car l'agrégation somme des lignes **déjà arrondies au centime** — ne pas revenir à un « arrondi de la somme » (l'écart « sum of rounded ≠ rounded of sum » reviendrait).
- **Écart de rendu à surveiller à l'échelle** : le waterfall est **groupé** par décomposition identique (cap 20 commandes/groupe) ; au‑delà, le rendu tronque — vérifier la lisibilité si un marchand a beaucoup de commandes identiques.
- **Token offline** : les scripts locaux (`scripts/`) 401 quand le token a expiré → ouvrir l'app d'abord. Le vrai cron n'a pas ce souci (`unauthenticated.admin` rafraîchit).
- **`engine.js` 0 diff** : la contrainte est un contrat implicite de non‑régression. Toute évolution du calcul doit se faire *autour* du moteur (adaptateur), jamais dedans, sauf changement métier volontaire (et alors mettre à jour les ancres des invariants).
- **eslint gate** : ne jamais re‑desserrer `no-undef`/`no-unused-vars` pour faire passer le build — ces règles attrapent exactement ce que les tests (purs) ne voient pas.
- **Borne PostgREST (classification douane)** : le chargement `variant_costs` de l'audit (`run_audit`) n'est **pas paginé** (limite ~1000 lignes). ICP bêta = petit catalogue → pagination = sur‑ingénierie prématurée. **Au‑delà**, des variantes confirmées seraient traitées « estimées » ET leur catégorie confirmée ignorée dans `computeMargin` (faux affichage + faux calcul, aucune erreur levée). Commentaire explicite au point de chargement ; à paginer si le catalogue grossit.
- **Référents indicateur douane monitor vs audit** (assumé) : après ajout d'une variante Shopify post‑confirmation, le panneau (pire cas produit) peut réclamer une confirmation pendant que l'audit (variante scannée) n'affiche rien — référents différents, chacun vrai sur ce qu'il calcule. L'indicateur audit suit la variante dont le chiffre affiché découle : choix voulu, conservé.
- **Dette — `lot2_ui_labels.mjs` réimplémente localement la logique des libellés douane** (`iaDouaneLabel`, `uiDouaneLabel`) au lieu d'importer le code réel de `app._index.jsx` (non importable : couplé à `shopify.server`/JSX). Les chaînes y sont **recopiées à la main** et réalignées manuellement à chaque changement : une dérive du code réel **ne serait pas détectée** par ce lot. Connu et assumé (le coût d'extraire ces fonctions dépasse le risque tant que les libellés sont stables). À convertir en import réel si ces libellés bougent souvent.

### Chantier futur — exactitude réglementaire douanière (backlog, `engine.js` à ce jour 0 diff)

Reporté volontairement (aucune correction moteur tant que ce chantier n'est pas ouvert, avec mise à jour assumée des invariants). Au programme :

**Écarts déjà reportés (audit lecture seule) :**
- **Forfait réforme UE = par UNITÉ, pas par ligne** (`engine.js:60‑69`, `getCustomsDuty` appelé par unité ; dropshipping force `qty=1`). Vraie règle : 3 € par ligne tarifaire par colis. Multi‑unités identiques dans un colis → le monitor sur‑compte (`3 € × qté` au lieu de `3 €`). Impact : commande de 3 unités = 9 € affiché vs 3 € réels, marge sous‑estimée de 6 €.
- **Taxe petits colis française (TPC, 2 €/article) non modélisée** (aucune constante `engine.js`). Dropshipping France depuis mars 2026 : coût sous‑estimé de 2 €/article. Recherche à mener : qui la supporte (DDP côté vendeur vs DDU côté client).
- **Pays « UE » = douane + TVA import appliquées à tort** (`engine.js:100‑104` : douane/TVA par catégorie, `paysImport` ne sert qu'au port). Sourcing UE = libre circulation → ni douane ni TVA import ; requalifier la ligne « TVA import » en TVA fournisseur.

**Taux à vérifier sur RITA (douane.gouv.fr) / Access2Markets :**
- **Électronique 5 %** — accord ITA : la plupart des produits tech sont à **0 %**.
- **Cosmétique 10 %** — chapitre 33 UE très largement **exempt**.
- **Maroquinerie 3 %** — juste pour le cuir ; sacs synthétiques ≈ **9,7 %** → **SOUS‑estimation, direction dangereuse** (marge affichée trop optimiste).
- **Jouets 0 %** — certains ≈ **4,7 %**.

**Origines préférentielles ignorées :** UE (libre circulation), **Turquie en union douanière** (pourtant proposée comme pays d'import → douane nulle possible), autres accords de libre‑échange. Le moteur applique le taux plein quelle que soit l'origine.

---

*Fin du récapitulatif. Sources : git log complet (188 commits), code à `f076621`, notes mémoire (`MEMORY.md` + 5 fichiers associés), suite de tests (lots 1→19 + invariants), config (`shopify.app.toml`, `.eslintrc.cjs`, `vercel.json`, `package.json`).*
