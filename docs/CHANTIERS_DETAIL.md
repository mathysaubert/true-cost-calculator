# True Cost Calculator — Rapport détaillé des chantiers (un par un)

> Complément de [`RECAP_TECHNIQUE.md`]. Ici chaque chantier significatif est documenté individuellement : **problème → cause racine → solution & pourquoi → commit(s)**. Ordre chronologique de construction, groupé par ère. Repo à `main` = `10b57a2` (188 commits).
>
> Convention : un « chantier » = une unité de travail cohérente (1 à N commits). Les commits purement opérationnels (redeploy, debug jetable) sont regroupés en fin de section, non détaillés un par un.

## Sommaire des ères

- [I. Fondations, déploiement, authentification](#i-fondations-déploiement-authentification)
- [II. Le moteur & le droit réglementaire](#ii-le-moteur--le-droit-réglementaire)
- [III. Cohérence d'écran (BUG 1 / BUG 2) & invariants](#iii-cohérence-décran-bug-1--bug-2--invariants)
- [IV. Monitoring — Briques A & B](#iv-monitoring--briques-a--b)
- [V. Alerting produit-à-perte (B7)](#v-alerting-produit-à-perte-b7)
- [VI. Dunning & session reaper](#vi-dunning--session-reaper)
- [VII. CPA prescriptif & fiabilité blended](#vii-cpa-prescriptif--fiabilité-blended)
- [VIII. Refonte tarifaire & bugs billing critiques](#viii-refonte-tarifaire--bugs-billing-critiques)
- [IX. RGPD & conformité](#ix-rgpd--conformité)
- [X. Emails (dark mode & parité)](#x-emails-dark-mode--parité)
- [XI. Activation & dette de groupe (polish UI)](#xi-activation--dette-de-groupe-polish-ui)
- [XII. Recalcul des marges historiques](#xii-recalcul-des-marges-historiques)

---

## I. Fondations, déploiement, authentification

### 1. Init — calculateur + billing freemium — `f9aff1d`
- **Problème / besoin** : créer l'app Shopify embarquée avec un calculateur de marge et un modèle freemium.
- **Solution** : base React Router v7 embarquée, billing par abonnement (`lineItems`, `2850436`), calculateur de marge.
- **Pourquoi** : socle. Tout le reste se greffe dessus.

### 2. Migration Prisma SQLite → PostgreSQL (Supabase) — `6d766a6`
- **Problème** : SQLite ne survit pas au serverless Vercel (système de fichiers éphémère) → sessions perdues.
- **Solution** : Prisma pointe sur Postgres (Supabase) ; `PrismaSessionStorage`.
- **Pourquoi Supabase** : Postgres managé + il sert aussi de base au domaine métier (une seule base à opérer).

### 3. Déploiement Vercel — `b113d16` (+ `ba4eb04`, `9a13adf`)
- **Problème** : optimiser le build pour Vercel + fixer l'URL de prod.
- **Solution** : `vercelPreset()`, `application_url` en dur dans `shopify.app.toml`, retrait du champ déprécié `include_config_on_deploy`.

### 4. Installation OAuth — Token Exchange — `be78cdc` (+ `6349bbc`, `cc53602`, `2fd1fa4`)
- **Problème** : l'installation échouait / bouclait sur `auth/login` ; l'URL de redirect OAuth était fausse (`/api/auth` vs `/auth/callback`).
- **Cause racine** : le flux Token Exchange nécessite une route `/api/auth` dédiée ; le `returnUrl` du billing sortait du contexte Admin → redirection login.
- **Solution** : route `/api/auth`, `returnUrl` qui reste dans l'Admin Shopify (App Bridge intercepte la redirection via `useSubmit`).
- **Diagnostic associé** (jetables) : `17d4c10` détection de boucle + route debug, `1db7949` ErrorBoundary racine, `3071f3e` logs de trace.

### 5. ⚠ Page blanche en production — `04e90e0`
- **Problème** : l'app s'ouvrait sur une **page blanche**, avec **zéro log Vercel** (donc l'iframe n'atteignait même pas le serveur).
- **Cause racine** : `automatically_update_urls_on_dev = true` (valeur par défaut). Chaque `shopify app dev` local **écrasait** l'`application_url` de prod dans Shopify Partners par l'URL du tunnel Cloudflare (`…trycloudflare.com`), morte hors session dev. L'Admin ouvrait alors l'iframe sur cette URL morte.
- **Solution** : (1) flag à `false` ; (2) `shopify app deploy` pour repousser la bonne URL ; (3) `SHOPIFY_API_SECRET` Vercel identique à Partners (sinon JWT invalide → boucle). *Règle* : ne jamais lancer `shopify app dev` contre le `toml` de prod — créer un `shopify.app.dev.toml` séparé.
- **Pourquoi cette solution** : c'est la cause *silencieuse* (aucun log) ; la seule parade est de couper l'écrasement automatique. Voir [`project_production_deploy.md`].

### 6. Sécurité — RLS deny-all — `a85391d`… `a85345b`
- **Problème** : les tables Supabase étaient accessibles par la clé anon (défaut permissif).
- **Solution** : policy **deny-all explicite** (`FOR ALL USING (false) WITH CHECK (false)`) sur chaque table → accès uniquement par la **service role** (côté serveur, bypass RLS).
- **Pourquoi** : défense en profondeur — même si la clé anon fuit, aucune donnée marchand n'est lisible.
- **Migration ré-exécutable** : `DROP POLICY IF EXISTS` avant `CREATE POLICY` (`4d4f404` pour `variant_costs`) car `CREATE POLICY` n'est pas idempotent.

### 7. Détection de plan robuste sur dev stores — `50b7593`
- **Problème** : `billing.check()` échouait à détecter le plan sur les dev stores.
- **Solution** : GraphQL direct (`currentAppInstallation.activeSubscriptions`) au lieu de l'helper.
- **Suite** : ce chemin sera durci plus tard (FROZEN, fail-open — voir §VIII).

### 8. Sentry — `9cb46a3`
- **Problème** : le wizard Sentry ne supporte pas React Router v7.
- **Solution** : intégration manuelle (`sentry.server`, DSN en dur), utilisée notamment pour l'épuisement de crédits IA.

*Opérationnels non détaillés : `3fe303e`, `acd985c`, `5c2bffb`, `1dde038` (triggers de redeploy / debug env var).*

---

## II. Le moteur & le droit réglementaire

### 9. Frais processeur corrects — `0bf3dd8` (+ `962ae6d`)
- **Problème** : les frais de paiement étaient mal modélisés (un seul champ « Stripe »).
- **Solution** : `PAYMENT_PROCESSORS` = liste `{ rate%, fixedFee€ }` par processeur (Stripe EU/non-EU, Shopify Payments Basic/Avancé/Plus), dropdown UI. Chaque transaction = `rate% × montant + 0,25€`.
- **Pourquoi** : le fixe par transaction change tout sur les petits paniers — l'ignorer surestimait la marge.

### 10. Douane CIF selon le droit douanier UE — `b20860b`
- **Problème** : la base de calcul de la douane/TVA était fausse.
- **Solution** : base **CIF** (Cost + Insurance + Freight) conforme au droit douanier UE ; la TVA à l'import se calcule sur (valeur + douane).
- **Pourquoi** : c'est la règle légale ; une base FOB sous-estimait les droits.

### 11. De minimis + régime TVA récupérable — `96a269c`
- **Problème** : pas d'exonération de minimis, pas de distinction assujetti/franchise.
- **Solution** : exonération douane sous `LOW_VALUE_PARCEL_CEILING = 150€` (dropshipping) ; sélecteur régime TVA (assujetti = TVA import récupérable, franchise = non).
- **Pourquoi** : deux marchands identiques n'ont pas la même marge selon leur régime — le produit doit le refléter.

### 12. Coûts fixes dans ROAS/CPA + garde marge négative — `3730652`
- **Problème** : le calcul pub ignorait les coûts fixes et autorisait une pub sur marge négative.
- **Solution** : inclure les frais fixes dans ROAS/CPA ; bloquer le calcul si marge < 0 ; l'audit compte l'emballage.

### 13. Fork douane dropshipping/stock + date-gate réforme UE — `0784f09` (+ `47e6cb4`, `141cd96`)
- **Problème** : la douane dépend du **modèle logistique** (colis direct consommateur vs stock importé en gros) et la **réforme UE du 01/07/2026** supprime l'exonération des colis directs.
- **Cause racine** : un seul chemin douane ne pouvait pas modéliser les deux régimes ni la bascule de date.
- **Solution** : fork `dropshipping`/`stock` dans le moteur ; **date-gate** `EU_DROPSHIP_DUTY_REFORM_DATE` → après le 01/07/2026, forfait `EU_DROPSHIP_FLAT_DUTY = 3€` par position tarifaire. `shipping_model` persisté dans `shop_plans` (`141cd96`), toggles UI + libellés douane dynamiques (`47e6cb4`).
- **Pourquoi le date-gate** : l'app doit rester juste avant **et** après la réforme sans redeploy — d'où le `now` injecté (« douane historique », le calcul suit la date de la commande, pas d'exécution).

### 14. Revenu HT en régime assujetti — `19a4679`
- **Problème** : en assujetti, la TVA collectée n'est pas un revenu → le numérateur devait être HT.
- **Solution** : lire `shop.taxesIncluded` depuis l'API Shopify et calculer le revenu net HT en conséquence.

### 15. TVA réduite 5,5 % — `91d60a5`
- **Problème** : Alimentation et Livres étaient taxés à 20 %.
- **Solution** : `VAT_RATES` = 5,5 % pour Alimentation (art. 278-0 bis CGI) et Livres (278-0 bis A).

### 16. Port entrant réparti sur le lot fournisseur — `fae5180` (+ `cf45a79`)
- **Problème** : le port entrant était compté par unité alors qu'il s'applique au **lot** d'approvisionnement.
- **Solution** : `qty_par_lot` → port réparti (`port / qty_par_lot`). Alignement du calcul de l'Audit sur le moteur validé (`cf45a79`).
- **Invariant associé** : `coutRendu(qty 1) ≥ qty 10 ≥ qty 100` (le port se dilue) — vérifié par les invariants.

### 17. Recalibrage des bornes de validation — `96da414`
- **Problème** : les bornes d'entrée (seuil D1, CPA D2, fees D3) étaient mal calibrées.
- **Solution** : recalibrage cohérent des trois familles de bornes.

---

## III. Cohérence d'écran (BUG 1 / BUG 2) & invariants

### 18. BUG 2 — ROAS/CPA calculé sur TTC — `98fd72f`
- **Problème** : le Break-Even ROAS / CPA max était faux en régime assujetti.
- **Cause racine** : le numérateur utilisait `prixVente` **TTC** au lieu du **revenu HT**.
- **Solution** : numérateur = revenu HT. Hypothèse TTC rendue explicite à l'écran.
- **Pourquoi** : le pixel publicitaire remonte une valeur de conversion TTC ; si le revenu de référence est TTC, le break-even est surévalué.

### 19. BUG 1 — marge dérivée hors moteur — `36f12ee` (+ `d3a6c7a`, `e613226`, `1672601`)
- **Problème** : le payload IA recalculait une marge `prixVente − coutRendu` **inline**, hors `engine.js`.
- **Cause racine** : duplication de formule → risque de divergence avec le moteur canonique.
- **Solution** : payload **100 % sourcé de `computeMargin`** ; les scénarios IA sont **pré-calculés serveur** (`e613226`) — l'IA ne fait plus d'arithmétique, elle commente des nombres déjà justes. Script de test scénarios (`1672601`).
- **Pourquoi** : ériger « aucune dérivation de marge hors moteur » en principe — c'est la racine de la classe de bugs « l'écran se contredit ».

### 20. Invariants cross-lot + moteur partagé — `8c862fc` (+ `358005b`, `7cce2e2`)
- **Problème** : les tests par lot passaient en isolation mais une valeur (`27,41€`) est devenue `25,02€` silencieusement entre le Lot 1 et le Lot 2 — rien ne vérifiait l'ensemble.
- **Solution** : `invariants.mjs` importe le **vrai** moteur et vérifie 76 propriétés cross-lot (égalité multi-chemins, identités CPA, monotonies, ancres écran, adaptateur audit ≡ moteur). `now` rendu injectable sur le chemin IA (`358005b`) pour le déterminisme. Garde-fou tests au build (`7cce2e2`).
- **Pourquoi** : les tests unitaires ne voient pas les dérives de composition — les invariants oui.

### 21. Conseil CPA dérivé du verdict ROAS — `cf3b7d7` (+ `0ceb38f`, `cb59164`, `164530c`, `2d5ae81`, `71d264e`)
- **Problème** : le conseil CPA contredisait le verdict ROAS à l'écran ; un « Meta » était figé en dur ; `cpaColor` incohérent.
- **Cause racine** : plusieurs surfaces calculaient leur verdict indépendamment.
- **Solution** : consolider `cpaAdvice`/`cpaColor`/`roasPhrase` sur **un `statuses` unique** (`164530c`) ; `roasColor`/`roasLabel` sur le verdict agrégé (4 surfaces verrouillées, `2d5ae81`) ; garde-fous permanents BUG 1 / BUG 2 / cpaColor (`71d264e`).
- **Pourquoi** : une seule source de vérité de verdict → l'écran ne peut plus se contredire.

---

## IV. Monitoring — Briques A & B

### 22. Brique A — coûts par variante — `7555d7a` (+ `4d4f404`)
- **Problème** : impossible de calculer une marge réelle sans connaître les coûts par variante.
- **Solution** : table `variant_costs`, module pur `variantCosts.js` (estimation auto depuis `unitCost` Shopify, validation, CSV import/export). Trois `cost_source` : `estimated`/`confirmed`/`imported`.
- **Pourquoi 3 sources** : distinguer une estimation (corrigeable) d'une donnée marchand (autorité) — fondement de la réhydratation et du recalcul (voir §XII).

### 23. Brique B — ingestion des commandes — `0f78683` (+ `a07ce0a`, `fb30e8a`)
- **Problème** : afficher la marge **réelle** sur les vraies commandes.
- **Solution** : scope `read_orders` (`a07ce0a`), module pur d'ingestion + schéma `order_margins` (`0f78683`), wiring route backfill + déclencheur UI (`fb30e8a`). Chaque ligne mappée vers `computeMargin`, **snapshot figé** à l'ingestion.
- **Pourquoi le snapshot** : l'historique ne doit jamais bouger tout seul — une marge passée reste ce qu'elle était (source de la problématique du recalcul).

### 24. Refunds hors bulk operation — `c32189b`
- **Problème** : la bulk operation Shopify interdit une « connection dans un champ liste » → `refunds` (liste contenant `refundLineItems`/`transactions`) est refusé en bulk.
- **Cause racine** : contrainte de l'API bulk.
- **Solution** : récupérer les commandes+lineItems en bulk, mais les **refunds par une requête paginée normale** (où les connexions sous liste sont autorisées), puis re-stitcher par order id.
- **Pourquoi** : c'est le seul moyen d'avoir la quantité effective (`quantity − refunded`) sans exploser la requête.

### 25. Monitor UI + devise réelle — `cb5c5f4` (+ `1dc7ed8`, `8dd758b`)
- **Problème** : l'euro était codé en dur dans l'affichage du monitor.
- **Solution** : sous-bloc repliable lecture seule (`cb5c5f4`), `formatMoney` currency-aware (`1dc7ed8`), symbole court `$/€/£` via `narrowSymbol` (`8dd758b`).

### 26. Dépli auditable + breakdown + waterfall — `d419792` (+ `c55253c`, `c4d900b`, `c47af17`)
- **Problème** : le marchand ne pouvait pas auditer *pourquoi* une marge était ce qu'elle était.
- **Solution** : dépli par ligne de commande (`d419792`), persistance du `margin_breakdown_json` à l'ingestion + backfill auto-validant au centime (`c55253c`), waterfall poste-par-poste en **lecture pure** (`c4d900b`), libellé « (TTC) » cohérent (`c47af17`).
- **Pourquoi lecture pure** : le waterfall lit le JSON figé, il ne recalcule rien (règle BUG 1). Le backfill se **réconcilie au centime** avec la valeur stockée avant d'écrire — sinon il ne touche pas.

### 27. Réhydratation des coûts estimés — `feec910`
- **Problème** : une ligne `estimated` restait fausse même quand Shopify exposait un `unitCost` réel.
- **Solution** : `reconcileEstimatedCost` — un `estimated` se laisse corriger par un `unitCost` réel qui diffère, `needsPersist=true` **seulement si** la valeur change (convergence en 1 write). `confirmed`/`imported` **jamais touchés**.
- **Pourquoi l'asymétrie** : une donnée réelle bat une estimation, mais rien ne bat une donnée validée par le marchand. Même invariant que le recalcul.

### 28. Arrondi au centime par ligne — `b52873a`
- **Problème** : « somme des arrondis ≠ arrondi de la somme » → la colonne produit ne s'additionnait pas exactement au total affiché.
- **Solution** : arrondir **chaque ligne** au centime *avant* de sommer (agrégats d'affichage seulement ; le stockage reste pleine précision).
- **Pourquoi** : un marchand qui additionne ce qu'il voit doit retomber sur le total — sinon perte de confiance.

---

## V. Alerting produit-à-perte (B7)

### 29. Alerting Briques 1→5 — `1594dcf` → `26347ec` → `317c585` → `039d011` → `6ef38e9`
- **Besoin** : prévenir le marchand quand un produit bascule en perte.
- **Solution** : table d'état `product_profitability_state` (`1594dcf`) ; extraction de la sync en module réutilisable (`26347ec`, pour que bouton et cron partagent le chemin) ; diff d'état **pur** `computeProfitabilityChanges` + lot9 (`317c585`) ; mail Resend (`039d011`) ; route cron d'orchestration (`6ef38e9`).
- **Pourquoi le diff pur** : la détection de basculement est testable sans Shopify ni mail (lot9).

### 30. Seuil de rentabilité configurable — `e998be9`
- **Problème** : « perte » était binaire (< 0).
- **Solution** : seuil `%` global (`net_margin < T% × CA`), T=0 = legacy (perte stricte). Mail sous-groupé (perte réelle / sous l'objectif / repassé rentable).

### 31. Mail perte réécrit novice + poste dominant — `def49bd` (+ `f13db8d`, `ec20d9d`)
- **Problème** : le mail était jargonneux (« marge nette cumulée »).
- **Solution** : agrégation des postes de coût par produit (`f13db8d`), `dominantCostPost` pur, mail « **vous perdez X** + le poste le plus lourd » (`def49bd`), objet **sans emoji** (signal anti-spam) + singulier/pluriel correct (`ec20d9d`).
- **Pourquoi factuel** : constat, jamais conseil ni causalité inventée — et un pictogramme d'avertissement dans l'objet déclenche les filtres spam.

### 32. Audit aligné sur le seuil configuré — `895acc7`
- **Problème** : l'audit classait en dur (winner ≥ 15 %, risky 0–15 %) alors que le marchand configure `profitability_threshold_pct` → un produit à 20 % avec seuil 25 % était « Top Performer » dans l'audit mais « sous le seuil » dans l'email : **l'app se contredisait**.
- **Solution** : module `auditClassify.js` = source **unique** de la classification, partagée par l'audit **et** l'alerting (lot18).
- **Pourquoi** : une seule définition de « rentable » — audit et email ne peuvent plus diverger.

### 33. Deep-link dans le mail d'alerte — `863853b`
- **Solution** : lien profond vers l'onglet Coûts, construit **serveur** depuis `shop` + `SHOPIFY_API_KEY` (template pur). Email jamais bloqué si le lien manque.

---

## VI. Dunning & session reaper

### 34. Dunning Briques 1→4 — `97ec4ed` → `245bdbe` → `08a10e6` → `8433dda`
- **Besoin** : récupérer le churn **involontaire** (abonnement gelé faute de paiement).
- **Solution** : table `subscription_dunning_state` (`97ec4ed`) ; décision pure `decideDunningAction` (send/resolved/stop/nothing) + lot11 (`245bdbe`) ; mails relance + resolved, lien toujours présent, ton factuel (`08a10e6`) ; cron quotidien `allSubscriptions → statut → décision → G2` + schedule (`8433dda`).

### 35. Détection FROZEN + robustesse plan — `9c6173a` (+ `dfa201f`, `fcac11f`, `2aed8cd`)
- **Problème** : `activeSubscriptions` ne renvoie **pas** les abonnements FROZEN → l'app rétrogradait un Pro gelé au 1er échec.
- **Cause racine** : Shopify masque les FROZEN dans `activeSubscriptions`.
- **Solution** : requêter `allSubscriptions` puis dériver le statut par précédence `ACTIVE > FROZEN > PENDING > cancelled` (`9c6173a`) ; détection de plan robuste **fail-open** (indétermination ≠ rétrogradation, `dfa201f`) ; mail conditionnel à l'âge du gel — fin de la contre-vérité « Shopify a suspendu » (`fcac11f`) ; extraction `deriveSubscriptionStatus`/`recurringLineItems` purs + lot13 (`2aed8cd`).
- **Pourquoi fail-open** : un doute sur le plan (Shopify injoignable) ne doit jamais couper un service payant à tort.
- **Non prouvable en e2e** : pas de vraie facturation sur dev store → prouvé en pur (lot13). Voir [`dunning_and_offline_token.md`].

### 36. Recréer la charge dans le mode du sub d'origine — `54a1410`
- **Problème** : la relance recréait la charge selon `NODE_ENV` → un abonnement de test aurait pu être recréé en réel (ou l'inverse).
- **Solution** : se baser sur `AppSubscription.test` (le mode réel de l'abonnement d'origine).
- **Pourquoi** : `NODE_ENV` décrit l'environnement d'exécution, pas la nature de l'abonnement — deux choses différentes.

### 37. Session reaper — `59f466d` → `f3c1aee` → `3630785` (+ `b158ac4`)
- **Problème** : les sessions offline mortes s'accumulaient.
- **Solution** : table `session_health` + purge à l'uninstall/redact (`59f466d`) ; logique pure `nextSessionHealth`/`shouldReapSession` + lot14 (`f3c1aee`) ; cron autonome (probe admin → santé → reap) (`3630785`) ; passage en quotidien (`b158ac4`).
- **Le double seuil (pourquoi)** : supprimer une session **seulement si** ≥ 10 échecs **ET** série ≥ 21 j. Un simple compteur d'échecs raterait « beaucoup d'échecs récents » (transitoire) ; un simple délai raterait « vieux mais sain ». `first_failure_at` absent → pas de suppression (ancienneté inconnue = défaut sûr).

---

## VII. CPA prescriptif & fiabilité blended

### 38. Module pur `computeCpaTargets` — `8677e56` (+ `9143535`, `0bc505d`)
- **Besoin** : dire au marchand son CPA max soutenable, par produit et « blended ».
- **Solution** : `computeCpaTargets` (marge dispo/unité + CPA max blended + écart) + lot15 (`8677e56`), étendu A1→A7 (remboursé, CA=0, mix négatif, 0 vs null, dépassement, orders=0, seuil 100 %) (`9143535`), signal `exhaustedCount` + obsolescence 30j (`0bc505d`).

### 39. Machine à états CPA — `49337b3` (+ `f0a5131`)
- **Problème** : les états CPA se chevauchaient (no_acquisition vs value_destroyed).
- **Solution** : machine à **5 états** verrouillée + frontière `== 0` explicite ; compteurs séparés `noAcq`/`valueDestroyed` ; gap calculé **serveur** (`gapLabel`/`gapAmount`, zéro `Math.abs` client, `f0a5131`).
- **Pourquoi serveur** : même règle que BUG 1 — pas de dérivation client.

### 40. Migration + action + UI CPA — `e587a22` (+ `e750477`)
- **Solution** : migration `shop_plans.current_cpa` + `current_cpa_updated_at` (`e587a22`), action `set_current_cpa` + loader `computeCpaTargets` + UI monitor (`e750477`).

### 41. Fiabilité blended — `f1417e2` (+ `5d4c761`, `1704d78`, `4205a14`, `5a0aa3c`)
- **Problème** : un CPA « blended » sur peu de commandes est peu fiable et le jargon statistique perd le marchand.
- **Solution** : `orders`/`avgBasket`/`lowSample` (< 30 commandes) (`f1417e2`), UI fiabilité + date serveur JJ/MM/AAAA UTC zéro locale runtime (`5d4c761`), blended sans jargon + date au fuseau réel de la boutique (`ianaTimezone`, `1704d78`), bandeau échantillon faible qui explicite le contraste avec la colonne (`4205a14`), hiérarchie visuelle overspend (alerte en tête, ambre subordonné, `5a0aa3c`).

### 42. Bornes CPA — `97a0dd7` (+ `cd83c3a`)
- **Solution** : borne 150 + avertissement 80 ; `noAcqCount` unique (libellé honnête, la colonne désambiguïse) ; lot15 devise absente.

---

## VIII. Refonte tarifaire & bugs billing critiques

### 43. Grille tarifaire réécrite — `bf3cfd9` (+ `d5baadf`, `dbb6652`, `aafc557`, `88d2d01`, `35f3d43`)
- **Problème** : positionnement tarifaire à revoir (volume, pas « calculs illimités »).
- **Solution** : Pro 29$ / Expert 69$ (`bf3cfd9`) ; **calcul manuel illimité tous plans** (retrait du plafond 10/mois, `d5baadf`) ; le Gratuit **sauvegarde** ses calculs, lecture Pro+ (`dbb6652`) ; CPA prescriptif réservé Expert (`aafc557`) ; libellés alignés sur le packaging (volume en tête, fin des « calculs illimités », `88d2d01`) ; cartes réécrites + note anti-mur (`35f3d43`).
- **Pourquoi le calcul devient gratuit** : le calcul manuel n'est pas la valeur récurrente — le **monitoring/alerting au volume** l'est. On facture le volume, pas l'accès à la calculette.

### 44. Plafond d'alerting au volume (C4a→C4c) — `824a3bb` → `ca07785` → `6cafd54` → `29289a9`
- **Besoin** : matérialiser le palier de valeur (commandes/mois).
- **Solution** : compteur `usage.orders_count` (incrément atomique RPC, tourne « à vide » d'abord, `824a3bb`) ; décision pure `decideAlertAction`/`shouldAdvanceState`/`previousMonth` + lot17 (`ca07785`) ; branchement cron `suppress` OFF, défaut sûr live-only (`6cafd54`) ; bandeau actif/suspendu (`29289a9`).
- **Bascule différée (pourquoi)** : on coupe l'alerting ce mois **seulement si** le **mois précédent** a dépassé le palier — le mois en cours est toujours servi. Défaut sûr : plan indéterminé → alerting ON (un doute n'avale jamais une alerte). Le piège **G2** (ne jamais avancer l'état pendant OFF) est le cœur de `shouldAdvanceState`.

### 45. ⚠ Bug billing — essai de 7 jours non appliqué — `9a76bb8`
- **Problème** : l'essai gratuit de 7 jours annoncé sur la fiche App Store n'était **pas** appliqué → **facturation immédiate**.
- **Cause racine** : `trialDays` doit vivre au niveau **du plan** (sibling de `lineItems`) dans la config `billing` de `shopify.server.js` ; il était absent → `billing.request` ne le passait pas à `appSubscriptionCreate`.
- **Solution** : `trialDays: 7` dans la config des deux plans. Les handlers subscribe n'ont rien à passer — la valeur vient de la config.
- **Pourquoi critique** : facturer immédiatement un marchand à qui on a promis 7 jours = litige + désinstallation + mauvaise note.

### 46. ⚠ Bug billing — `isTest` sur `NODE_ENV` — `510ed43`
- **Problème** : le flag `isTest` de la charge se basait sur `NODE_ENV`.
- **Cause racine** : `NODE_ENV` ne dit rien sur la nature du marchand (dev store vs réel).
- **Solution** : `isTest` basé sur `partnerDevelopment` (via `shop.plan.partnerDevelopment`), avec **défaut sûr = facturation réelle** au moindre doute (erreur GraphQL, champ absent, timeout).
- **Pourquoi** : un vrai marchand ne doit jamais obtenir une charge de test (revenu perdu) ; un dev store ne doit jamais être facturé pour de vrai. Le doute penche toujours vers le réel.

### 47. Plan Gratuit « 0$/mois » — `d4ee097`
- **Problème** : incohérence de devise dans la grille de prix (le plan gratuit).
- **Solution** : afficher les prix dans la devise de **billing Shopify (USD)**, 0$ inclus.

---

## IX. RGPD & conformité

### 48. Webhooks RGPD unifiés — `4174048` → `8f7dba2` → `4aa8e04` → `4a627be`
- **Problème** : la section `[privacy_compliance]` du toml n'est pas supportée ; les handlers RGPD étaient éparpillés.
- **Solution** : déclarer les topics compliance dans `[[webhooks.subscriptions]]` (`4174048`), retrait de la section invalide (`8f7dba2`/`f7d9d61`), **handler unifié** `webhooks.compliance.jsx` (`4aa8e04`), suppression des handlers séparés (`4a627be`).

### 49. Purge exhaustive à l'uninstall/redact — `8314fd2`
- **Problème** : la désinstallation ne purgeait pas toutes les données marchand.
- **Solution** : purge des **12 tables** marchand (`calculations`, `calculation_annotations`, `margin_alerts`, `order_margins`, `order_sync_state`, `product_profitability_state`, `rate_limits`, `session_health`, `shop_plans`, `subscription_dunning_state`, `usage`, `variant_costs`) + filet sur la session, alignement `shop/redact`. Les deux webhooks (`app/uninstalled` et `compliance` sur `shop/redact`) purgent la **même** liste.
- **Pourquoi** : `shop/redact` (~48h après uninstall) est le signal officiel Shopify — il doit tout effacer.

### 50. Page /privacy + scopes minimisés — `5d806ab` (+ `fe2553f`)
- **Solution** : page publique `/privacy` (`5d806ab`) ; documentation des scopes : `read_orders` lit **uniquement** du financier/line-items, **aucune donnée client** → déclaration **Protected Customer Data à minimiser** (ne cocher aucun champ client, surtout pas IP/géoloc/navigateur/OS) (`fe2553f`).
- **Pourquoi** : le niveau PCD déclaré doit correspondre à l'usage réel — sur-déclarer complique la revue Shopify pour rien.

---

## X. Emails (dark mode & parité)

### 51. Coquille HTML robuste au dark mode — `b6f0a61` (+ `7435a12`)
- **Problème** : en dark mode, les clients mail recoloraient le texte → illisible.
- **Cause racine** : sans couleur explicite, le client mail impose sa propre palette.
- **Solution** : coquille avec fond explicite + metas `color-scheme` (`b6f0a61`), puis couleur de texte explicite **+ `!important`** sur chaque `p/li/h3` (`7435a12`).
- **Pourquoi `!important`** : c'est le seul moyen de gagner contre la recolorisation automatique de certains clients.

### 52. Parité texte brut ≡ HTML — `991bac4`
- **Problème** : la version texte d'un mail pouvait diverger de la version HTML (chiffres différents).
- **Solution** : garde-fou de test qui vérifie **mêmes chiffres** texte/HTML + reflow texte dunning (une ligne par paragraphe).
- **Pourquoi** : un client mail sur deux affiche le texte brut — il doit dire exactement la même chose.

---

## XI. Activation & dette de groupe (polish UI)

### 53. UI d'édition des taux (D2) — `9843291`
- **Solution** : édition des taux `shop_plans` (Shopify %, processeur %, fixe) + action `set_fees` avec bornes.

### 54. Activation first-run — `7df1fba` → `1132e80` → `5fbfaf0`
- **Problème** : un nouveau marchand ne savait pas par où commencer.
- **Solution** : retrait du badge BÊTA (`7df1fba`) ; carte guidée first-run (install → marge réelle en un clic ; l'ordre estimer-coûts **puis** synchroniser est impératif, `1132e80`) ; feedback explicite sur tout état terminal de la carte (`5fbfaf0`).

### 55. Affichage dans la devise de la boutique — `8e8a250` (+ `d28802b`)
- **Problème** : euro codé en dur dans plusieurs surfaces.
- **Solution** : `feesCurrency` = `shop.currencyCode` (source primaire dès J1) → 1re commande → `EUR` (`8e8a250`) ; prompt IA dans la devise de la boutique (`d28802b`). **Restent en €** : douane forfaitaire UE + barèmes processeurs (réglementaires). Voir [`currency_display.md`].

### 56. Désambiguïsation des deux seuils + retrait attributions — `4fe77d0`
- **Problème** : deux seuils s'appelaient tous deux « seuil de rentabilité » (collision) **et** les libellés étaient inversés ; des chiffres marché non sourçables (Fevad) traînaient.
- **Solution** : B7 = « Seuil de rentabilité », `margin_alerts` = « Seuil d'alerte de marge » ; retrait des attributions non sourçables.
- **Pourquoi** : deux réglages différents ne peuvent pas porter le même nom — et une donnée non sourçable est un risque de crédibilité. Voir [`thresholds_and_cpa_states.md`].

### 57. Tableau « Par produit » — itérations layout — `7eaf877` → `9eb3d80` → `a8d157f` → `7bd3ca9` → `b32801f`
- **Problème** : le tableau produit débordait / tronquait dans un `aside` étroit ; le badge « Aucun budget » débordait.
- **Solution** : `table-layout: fixed` (colonne État moins tronquée, `7eaf877`), `minWidth 480` pour annuler une régression (`9eb3d80`), badge sans débordement + note d'audit conditionnelle (`a8d157f`), passage à **6 colonnes** (Ventes fusionnée, **CA net déplacé dans le dépli**, `7bd3ca9`), largeurs recalées (dispo 20 %, état 10 %, `b32801f`).
- **Point de vigilance** : contrainte d'espace réelle — ne pas ré-élargir sans vérifier le rendu mobile.

### 58. Waterfall groupé + CPA blended sans budget — `d83c799`
- **Solution** : waterfall groupé par décomposition identique (cap 20), CPA blended sans budget, libellé capacité pub.
- **Pourquoi le cap** : grouper les commandes identiques évite un dépli illisible — mais grouper ≠ recalculer.

### 59. Vagues UI/mobile pré-beta (groupées)
- **Contenu** : responsive mobile (`c4def5b`, `6f23a2c`, `7aa9bdd`…), système de tooltip (auto-flip, position fixed, fermeture au tap dehors : `b16f437`, `b58f1df`, `06f6ae7`, `e975c77`, `6089bac`), audits qualité pré-beta (`8c214de` 18 fixes, `4c8268e`, `f473e33` sécurité), zoom iOS (`9e3c8a3`).
- **Non détaillés un par un** : itérations d'affinage sans invariant métier — cohérence visuelle, accessibilité, robustesse d'entrée.

---

## XII. Recalcul des marges historiques

*Le seul chantier prouvé de bout en bout en conditions réelles (dev store). Découpé en 3 briques + outillage, chacune validée avant la suivante.*

### 60. Brique 1 — fondation pure — `f8f928d`
- **Problème** : une ligne `order_margins` ingérée sur un coût **estimé** ou **manquant** garde une marge fausse **à vie** (snapshot figé).
- **Solution** : fonctions **pures** dans `recalcMargins.js` — `isRecalcableCostSource` (true pour `estimated`/`missing`, défaut immuable sûr), `buildRecalcSummary` (compare deux états produit, nomme les passés à perte, tronque « max 5 + N autres »), `formatProductNames` + lot19. **Rien branché** (fondation seule).
- **Pourquoi pur d'abord** : verrouiller et tester les décisions avant tout I/O.

### 61. Brique 2 — action serveur — `74b8cca`
- **Problème** : brancher la correction sans casser l'alerting (piège n°5) ni perdre de données.
- **Cause racine identifiée en Phase 0** : (a) le sync utilise `ignoreDuplicates` → il ne recompute jamais l'existant ; (b) une fenêtre sur `computed_at` supprimerait des lignes non re-synchronisables (perte permanente) ; (c) recalculer une marge sans re-baseliner l'état déclencherait une fausse alerte au cron suivant.
- **Solution** : `recalcEstimatedMargins.server.js` — **capture → DELETE fenêtré sur `order_created_at` ≥ J-30 → re-sync → réconciliation/restauration → re-baseline MUET → résumé**. Le re-baseline réécrit `product_profitability_state` via `computeProfitabilityChanges(…, mapVide, seuil).seeds` (upsert direct, **sans importer email.server.js**). Prouvé sans fausse alerte (script `recalc_estimated_margins.mjs`).
- **Pourquoi cette architecture plutôt qu'une transaction** : le bulk Shopify poll ~25 s → impossible en `BEGIN/COMMIT`. La capture+réconciliation couvre mieux le « sync partiel » qu'une transaction (voir §5 du RECAP).

### 62. Brique 3 — UI — `d39b33b`
- **Solution** : bouton « **Corriger les marges calculées sans coût** » dans l'onglet Suivi des coûts, bloc **neutre** (subordonné à Synchroniser), texte explicatif (ce que ça fait / ne touche pas / limite 30 j), état de chargement (anti double-clic), résumé post-op (« N recalculées » + produits passés à perte nommés, ton ambre sobre), gestion rate-limit. **Aucune logique nouvelle** — réutilise le retour de l'action.

### 63. Outillage de test — `f076621` (+ `8831d5e`)
- **Solution** : `recalc_live_proof.mjs` (preview / `--setup` injection réversible / `--run` cycle complet autonome / `--restore`), helper `_offline_admin.mjs` (construit l'admin depuis le token offline sans importer `shopify.server`, qui a des imports sans extension KO en node brut). Outils dev/démo antérieurs (`8831d5e` : diagnostic + purge ciblée).
- **Validation réelle** : marge fausse injectée sur « The 3p Fulfilled Snowboard » (−1212€ réel) → clic bouton → produit nommé passé à perte → marge revenue juste → cron simulé `basculements: 0` → restauration propre.

---

## Annexe — chantiers non détaillés (opérationnels / jetables)

Regroupés ici car sans invariant métier : triggers de redeploy (`3fe303e`, `acd985c`, `5c2bffb`), diagnostics jetables (`1dde038`, `17d4c10`, `1db7949`, `3071f3e`), reverts (`e4a81ab`), ajustements de copie/contenu sidebar (`9af9d1b`, `6a624e6`, `a9cf463`), micro-fixes d'affichage (`68a65a3`, `c2d2514`, `a25ce3d`, `58e159f`, `d24e6c3`, `17e691a`, `e1548bc`), dégradation IA (`00a897f`).

---

*Fin du rapport. Pour la vue synthétique (architecture, systèmes, pièges, décisions), voir [`RECAP_TECHNIQUE.md`]. Sources : git log complet (188 commits), code à `10b57a2`, notes mémoire, suite de tests.*
