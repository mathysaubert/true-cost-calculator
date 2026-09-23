# F2 — Sync v2 : implémentation (2026-09-22)

Suite de `docs/rapports/2026-09-22_f2-sync_phase0.md` et des arbitrages B1 à B17 consignés dans
`docs/rapports/2026-09-22_decisions.md` (section E, avec la liste des cases et le texte pour la
demande de données protégées niveau 1).

Statut : **écrit et prouvé localement (gate complet vert). Rien de déployé, aucun commit, aucun
push. Le TOML est modifié dans le dépôt mais non appliqué (aucun `shopify app deploy`, aucun
`shopify app dev`). Aucune migration nouvelle, rien d'appliqué en base.**

## 1. Problème

La sync actuelle est un bulk de 30 jours (commandes et lignes), des remboursements paginés, un
poll bloquant de 25 s et un upsert `order_margins` au format legacy. Aucun webhook de commande,
de remboursement, de retour, d'expédition ni de fin d'op n'existe. Les tables F1 (`orders`,
`refunds`, `returns`, `fulfillments`, `order_fees`, `inventory_daily`, `customers_agg`,
`sync_jobs`, `webhook_events`) sont vides et le moteur F3 n'a pas de feuilles réelles.

## 2. Cause

L'ingestion n'a jamais été conçue comme une source de faits : elle recalcule une marge à la
volée et n'écrit qu'un snapshot legacy. Il manque un normaliseur unique (webhook et bulk), une
file de jobs, une réconciliation et l'écriture des faits externes.

## 3. Solution

### 3.1 Trois flux, un normaliseur (B1 à B5, B9)

| Fichier | Lignes | Rôle |
|---|---|---|
| `app/lib/sync/normalize.js` | 480 | Pur. `fromWebhookPayload` et `fromGraphqlNode` → même `OrderFacts` ; `normalizeOrder` → ligne `orders` + lignes `order_margins` (legacy via `buildHistoryRow` et F1 via `computeLineEconomics`, B7) ; remboursements, retours, expéditions, événements ; `dayLocal`, `promisedAt` (jours ouvrés lundi-vendredi) ; `customersAggFromOrders` ; exclusions du brief §9 |
| `app/lib/sync/windows.js` | 72 | Pur. Plancher d'historique (60 jours ou `history_months`), fenêtres mensuelles, `backfillPlan` idempotent par `window_start`, `reconcileWindow` (curseur moins un jour), statut de fin d'op, candidats au re-tirage d'attribution |
| `app/lib/sync/queries.js` | 75 | Requêtes Admin GraphQL validées contre le schéma 2026-01 ; aucun champ nominatif ; bulk sans `first` ; marqueurs de reconnaissance |
| `app/lib/sync/ingest.server.js` | 331 | Écritures Supabase : contexte boutique (fuseau, devise, pays remplis une fois, B14), commandes, remboursements (quantités des lignes recalculées, seules `refunded_qty` et `effective_qty` mises à jour), retours (fusion), expéditions (fusion, `promised_at`), événements, sous-ressources paginées, attribution, frais Shopify Payments, instantané du stock, `customers_agg` borné |
| `app/lib/sync/jobs.server.js` | 46 | `sync_jobs` : création, reprise par op, plan de backfill (B1), curseur de réconciliation |
| `app/lib/sync/bulk.server.js` | 156 | Lancement et reprise d'op (`decideBulkResume` conservé, B3 une op à la fois), poll de repli, ingestion (JSONL en flux, sous-ressources B4), fin par webhook, enchaînement du backfill, `syncNow` (forme legacy) |
| `app/lib/sync/events.server.js` | 26 | Idempotence des webhooks par `X-Shopify-Webhook-Id` ; un événement `failed` est retraité |
| `app/lib/sync/background.server.js` | 9 | `waitUntil` de `@vercel/functions` (B5c), sans effet hors Vercel |
| `app/routes/webhooks.orders.jsx` | 29 | `orders/create`, `orders/updated`, `orders/cancelled` : HMAC, dédoublonnage, ingestion en ligne, `customers_agg` en arrière-plan ; échec → 500 (Shopify réessaie) |
| `app/routes/webhooks.refunds.jsx` | 24 | `refunds/create` (orphelin stocké, B12a) |
| `app/routes/webhooks.returns.jsx` | 23 | `returns/request`, `approve`, `decline`, `close`, `cancel`, `reopen` |
| `app/routes/webhooks.fulfillments.jsx` | 27 | `fulfillments/create`, `fulfillments/update`, `fulfillment_events/create` |
| `app/routes/webhooks.bulk_operations.jsx` | 26 | `bulk_operations/finish` : 200 immédiat, ingestion en arrière-plan (maxDuration 300) |
| `app/routes/api.cron.sync.jsx` | 88 | Cron quotidien 05:00 : jobs en cours, plan, réconciliation, backfill suivant, attribution, frais J-7, stock, clients ; budget 240 s puis ré-invocation signée (B6a) |
| `app/lib/orderSync.server.js` | 10 | Délégué : `syncShopOrders` → `syncNow` (bouton, cron d'alerting, recalcul inchangés) |

Fichiers modifiés : `shopify.app.toml` (scopes et abonnements, **non appliqué**),
`app/shopify.server.js` (`ApiVersion.January26`, B2), `app/lib/bulkResume.js` (marqueurs),
`app/lib/schema.js` (`ORDER_MARGINS_MUTABLE_COLUMNS`), `app/routes/webhooks.app.scopes_update.jsx`
(plan de backfill à l'approbation, B1), `vercel.json` (cron), `package.json` (`@vercel/functions`
3.9.9, lot 25), `package-lock.json`, `scripts/_offline_admin.mjs` (version d'API),
`tests/lot22_bulk_resume.mjs` (scan des nouveaux fichiers, mêmes garanties plus trois nouvelles).

### 3.2 Ce qui change pour l'existant

- Le bouton « Synchroniser les commandes (30 j) », le cron d'alerting et le recalcul passent
  par `syncNow` : job `orders_incremental` sur 30 jours (`updated_at`, qui contient
  `created_at`), poll de repli 25 s, mêmes messages qu'avant. `order_sync_state` reste écrite (B8).
- `order_margins` reçoit les colonnes legacy ET les colonnes F1 (B7). Contrat d'immuabilité
  inchangé : insertion `ON CONFLICT DO NOTHING` ; un seul `UPDATE`, filtré par
  `ORDER_MARGINS_MUTABLE_COLUMNS` (quantités remboursées), vérifié par le lot 25.
- Une carte cadeau donne une ligne `cost_source = 'excluded'` à marges nulles (jamais 0).
- Une commande de test, annulée, brouillon, cartes cadeau seules ou B2B est conservée avec
  `excluded_reason` ; les écrans legacy n'en tiennent pas compte (ils comptaient déjà les tests).

### 3.3 Découvertes d'implémentation (tranchées, à confirmer)

- **B15** : `Order.fulfillments` exige un scope de commandes d'exécution
  (`read_merchant_managed_fulfillment_orders`, `read_third_party_fulfillment_orders`, ou les
  variantes assignées/marketplace) ; `read_fulfillments` ne couvre que les webhooks. Les deux
  premiers sont ajoutés au TOML. Alternative : retirer `fulfillments` du bulk (OTD par webhooks
  seuls).
- **B16** : `shopifyPaymentsAccount` exige `read_shopify_payments_accounts` (ou
  `read_shopify_payments`), pas `read_shopify_payments_payouts` comme prévu en décision 21.
- **B17** : `purchasingEntity { __typename }` suffit à détecter le B2B sans `read_companies` ;
  `purchasing_company_id` reste vide.
- `Fulfillment.deliveredAt` existe en 2026-01 : la date de livraison vient du bulk, les
  événements ne servent qu'au temps réel.
- `balanceTransactions` accepte `processed_at` en filtre : les frais J-7 se lisent sans
  parcourir tout l'historique (risque de la Phase 0 levé).
- `ReturnLineItem.returnReason` est déprécié au profit de `returnReasonDefinition` ; conservé
  en V1 (l'enum de 10 valeurs du brief), à migrer plus tard.

## 4. Preuves

### 4.1 Gate complet (R4)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 345 warnings (aucun nouveau : même compte qu'avant F2) |
| `npm test` | 25 lots verts, 1 184 assertions au total ; lot 25 = 125 assertions |
| `node scripts/render_check.mjs` | « Tous les rendus réels OK » (aucune surface UI touchée) |
| `npm run build` | client et serveur construits sans erreur |

### 4.2 Lot 25 (`tests/lot25_sync.mjs`)

- T1 : la même commande sous forme webhook (ids numériques, prix original moins allocations)
  et sous forme GraphQL (gids, `discountedUnitPriceAfterAllDiscountsSet`) donne des
  `OrderFacts` strictement identiques ; aucun champ nominatif ne traverse ; client invité → null.
- T2 : commande figée : `day_local` dans le fuseau (22:30 UTC → 16 août à Paris), CA HT 44,92
  (2 × 20 + port HT 4,92), CM1 unitaire 14, `cm2_alloc` {emballage 1, port marchand 4,
  paiement 0}, colonnes legacy remplies, carte cadeau exclue, étiquette B2B, coût manquant.
- T3 : les cinq exclusions, toutes dans le CHECK de `orders.excluded_reason`.
- T4 : remboursement webhook ≡ GraphQL ; dédoublonnage par `refund_id` ; non réglé → rien ;
  `no_restock` → restockées 0 connu ; commande ingérée après son remboursement (B12a) ;
  colonnes mutables disjointes des colonnes de snapshot.
- T5 : retours (request avec lignes, close sans lignes), expéditions (webhook et bulk, livrée),
  événement DELIVERED, promesse de 3 jours ouvrés depuis un vendredi = mercredi.
- T6 : fenêtres mensuelles, plancher 60 jours puis 24 mois, plan de 3 puis 23 fenêtres à
  l'approbation, replanification idempotente, réconciliation (chevauchement, plancher, jamais
  le futur), statut de fin d'op, détection du scope, candidats au re-tirage, job suivant,
  stagnation.
- T7 : requêtes (fenêtres `created_at` et `updated_at` avec `sortKey` aligné, marqueurs, pas de
  `first` en bulk, filtres des sous-ressources, aucun champ nominatif).
- T8 : `customers_agg` (invité et commande exclue ignorés, cohorte, deuxième achat, CM2 somme
  ou null si un coût manque).
- T9 : scans statiques : chaque `uri` du TOML a sa route ; topics et scopes déclarés ;
  `read_all_orders` absent ; `include_fields` ; HMAC, dédoublonnage et statut dans chaque route ;
  `waitUntil` sur `bulk_operations/finish` ; un seul `UPDATE` filtré sur `order_margins` ; API
  2026-01 ; cron déclaré, quotidien, secret exigé ; `app/scopes_update` planifie ; aucun module
  `sync/` n'importe `engine.js` ; le cron d'alerting passe toujours par `syncShopOrders`.

### 4.3 Requêtes GraphQL

Les onze opérations de `queries.js` ont été validées contre le schéma Admin 2026-01 le
2026-09-22 (outil de validation Shopify) : bulk commandes, remboursements, retours, parcours,
frais, boutique, variantes, op par id, ops actives, mutation de lancement, commande par id.

### 4.4 B12 (b) sur la boutique de dev : non vérifiable aujourd'hui

Script de lecture seule (scratchpad, non committé) : la session offline de
`true-cost-dev.myshopify.com` a expiré ce matin (HTTP 401 sur une requête `shop`), comme le
note la mémoire du projet (jeton offline expirant, rafraîchi à l'ouverture de l'app). Aucune
autre action tentée. À prouver après déploiement (liste §6, point 9), ou avant si vous ouvrez
l'app dans la boutique de dev et me demandez de relancer le script.

### 4.5 Preuves après déploiement sur la boutique de dev (2026-09-23)

Contexte : commit `eb03762` déployé sur Vercel (success), `SCOPES` alignée, Fluid compute vérifié
(région dub1), `shopify app deploy --allow-updates` → version `true-cost-calculator-42` active,
app ouverte et scopes approuvés par Mathys. `CRON_SECRET` n'est pas sur le poste : le dispatcher
a été exécuté localement pour la seule boutique de dev (mêmes modules que la route, base de prod,
jeton offline lu sans être affiché) ; la boutique de revue Shopify (jeton expiré depuis le 20/09)
n'a pas été touchée.

| Point §6 | Résultat |
|---|---|
| 1 Ré-autorisation | Session offline de la boutique de dev : les 9 scopes du TOML ; jeton valide (HTTP 200). |
| 2 Abonnements | Non listables par `webhookSubscriptions` (la doc le confirme : les abonnements TOML n'y figurent pas) ; prouvés par les livraisons du point 11. |
| 8 / 10 Réconciliation | Job `orders_incremental` `completed` en 7 s : 6 commandes, 6 lignes ; `order_sync_state` `completed` (B8) ; `shop_settings` remplie (fuseau America/New_York, USD, US). |
| 11 Fin d'op par webhook | 4 `BULK_OPERATIONS_FINISH` reçus par la prod et traités en 1 à 2 s chacun ; les 3 fenêtres de backfill se sont enchaînées seules (09:40:18, :21, :26) sans cron. |
| 9 B12 (b) | `order(id:)` sur une commande du 18/07 (67 jours) → `null` sans erreur : la limite de 60 jours vaut aussi par id. (b) est impossible ; (a) reste le seul chemin. |
| Attribution | `customer_order_index = 1` et `attribution_ready = true` fournis par le bulk (résumé de parcours) ; aucun candidat au re-tirage (commandes de plus de 30 jours). |
| Frais | `skipped: no_shopify_payments` (attendu sur une boutique de dev). |
| Stock | 26 variantes capturées pour le 2026-09-23 (`tracked`, `available`, `in_stock` ; `cost_per_unit` vide : aucun coût par article saisi). |

Constats à retenir :

- Les 6 commandes de la boutique de dev sont des commandes brouillon (`shopify_draft_order`) :
  toutes portent `excluded_reason = 'draft'` (brief §9). Une commande passée au checkout d'une
  boutique de dev est marquée `test` et sera exclue de même. Les faits sont stockés ; seuls les
  KPI les ignorent. Pour voir des KPI sur la boutique de dev, F4 devra prévoir un réglage
  « inclure les commandes test/brouillon » réservé aux boutiques de développement (arbitrage F4).
- Les 20 lignes `order_margins` legacy ne sont pas réécrites (contrat DO NOTHING) : leurs colonnes
  F1 restent vides. Le recalcul des marges estimées (point 13) les recréerait avec les colonnes
  F1 ; à déclencher sur décision.
- `ca_ht = total_ttc` sur ces commandes : aucune ligne de taxe dans la boutique de dev.
Points 3, 5, 6, 7 (commande #1022 créée par Mathys : client rattaché, expédiée avec suivi,
livrée, retour #1022-R1 motif défectueux, remboursée avec remise en stock) :

| Point §6 | Résultat en base |
|---|---|
| 3 Commande temps réel | `orders` #1022 en 5 s après création (`ingested_at` 09:46:50 pour `created_at` 09:46:45) : `day_local`, `ca_ht` 600, client présent, `excluded_reason = 'draft'` (brouillon), `attribution_ready = false` (webhook, re-tirage différé). Ligne `order_margins` `breakdown_version = 2`, `cost_source = 'missing'` (aucun coût de variante saisi sur la boutique de dev). 14 webhooks traités entre 86 ms et 1 157 ms (limite 5 s). |
| 5 Remboursement | `refunds` : `settled = true`, `total_refunded` 600, ligne `restock_type = 'return'`, transaction REFUND/SUCCESS. `order_margins.refunded_qty` 1, `effective_qty` 0 ; snapshot intact (`computed_at` 09:46:50 antérieur au remboursement 09:55:10). |
| 6 Retour | `returns` #1022-R1 : `status = CLOSED`, ligne `return_reason = 'DEFECTIVE'`, `closed_at` posé, lignes conservées à la clôture (fusion). `requested_at` vide : le retour a été approuvé sans demande préalable (`returns/approve` puis `returns/close`) ; amélioration possible : poser `requested_at` à l'approbation. |
| 7 Expédition | `fulfillments` : `created_at` 09:49:25, transporteur DPD Local, numéro de suivi, `status = SUCCESS`, `delivered_at` 09:51:03 posé par `fulfillment_events/create` (DELIVERED). `promised_at` vide (aucune promesse réglée) ; `country_code` vide (adresse absente du webhook sans approbation niveau 1). |
| 4 Doublon | **Prouvé** : rejeu vers la prod d'une livraison `orders/updated` signée HMAC avec le `X-Shopify-Webhook-Id` d'un événement déjà traité → HTTP 200 en 1,3 s, `webhook_events.processed_at` inchangé, `orders.updated_at` inchangée. Un premier essai avec un secret périmé dans `.env` local avait reçu 401 : la vérification HMAC rejette une signature invalide sans rien écrire. |

`customers_agg` reste vide : la commande est exclue (brouillon), donc hors cohortes, ce qui est
le comportement attendu.

| Point §6 | Résultat |
|---|---|
| 13 Recalcul des marges estimées | `recalcEstimatedMargins` exécuté pour la boutique de dev (11 s) : 1 ligne recalculable dans la fenêtre de 30 jours (celle de #1022), supprimée puis recréée par la sync v2 avec `breakdown_version = 2`, quantités remboursées conservées (1 remboursée, 0 effective : les remboursements en base sont relus à l'ingestion), 0 ligne restaurée, aucune perte (21 lignes avant et après). Les 20 lignes legacy de juillet sont hors fenêtre : elles gardent leurs colonnes F1 vides, comme attendu du contrat de non-réécriture. |

Observation : quand le poll de repli et le webhook `bulk_operations/finish` traitent la même op,
les deux ingestions sont idempotentes et le `payload` du job reflète le dernier écrivant (ici
`inserted = 0` côté poll alors que le webhook avait déjà inséré la ligne). Sans effet sur les
données ; le compteur mensuel de commandes n'est incrémenté qu'une fois (par l'insertion réelle).

## 5. Vercel : Fluid compute (B6)

Documentation Vercel lue le 2026-09-22 (`/docs/fluid-compute`, mise à jour 2026-08-24) :

- Fluid compute est **activé par défaut pour les projets créés depuis le 23 avril 2025** ; un
  projet plus ancien peut être resté en mode classique (60 s sur Hobby).
- Activer : tableau de bord Vercel → le projet → **Settings** → **Functions** → section
  **Fluid Compute** → basculer l'interrupteur → **Save** → **redéployer** (le réglage s'applique
  au déploiement suivant).
- Vérifier : la même section affiche l'interrupteur activé ; après le déploiement suivant, la
  section **Function Max Duration** de la même page affiche 300 s par défaut pour Hobby (au lieu
  de 60 s) et un appel de `/api/cron/sync` qui dépasse 60 s ne se termine plus en timeout.
- Alternative sans tableau de bord : `"fluid": true` dans `vercel.json` (par déploiement) ; non
  ajouté ici pour ne pas contourner le réglage projet, à votre choix.

Aucune action Vercel n'a été faite (R7).

## 6. À prouver sur la boutique de dev après déploiement

Prérequis : `shopify app deploy` (applique le TOML : scopes, abonnements), variable Vercel
`SCOPES` alignée, `CRON_SECRET` présent, Fluid compute vérifié, ré-approbation des scopes à
l'ouverture de l'app dans la boutique de dev.

1. **Ré-autorisation** : ouvrir l'app → invite d'approbation des nouveaux scopes → la session
   offline (table `Session`) porte les nouveaux scopes ; `webhook_events` reçoit un
   `app/scopes_update` traité.
2. **Abonnements** : Shopify enregistre les cinq abonnements du TOML (Partner Dashboard ou
   `webhookSubscriptions`), URI `/webhooks/orders`, `/refunds`, `/returns`, `/fulfillments`,
   `/bulk_operations`.
3. **Commande temps réel** : créer une commande test dans la boutique de dev → en moins d'une
   minute : une ligne `orders` (`day_local`, `ca_ht`, `excluded_reason = 'test'` si commande de
   test, `attribution_ready = false`), des lignes `order_margins` avec `breakdown_version = 2`
   et les colonnes legacy remplies, un `webhook_events` `processed` ; réponse du webhook en
   moins de 5 s (journal Vercel).
4. **Doublon** : renvoyer le même webhook (Partner Dashboard, « resend ») → aucun nouvel
   `orders`, `webhook_events` inchangé, 200.
5. **Remboursement** : rembourser une ligne avec restock → `refunds` (`settled`, `line_items[].restock_type = 'return'`),
   `order_margins.refunded_qty` et `effective_qty` mis à jour, colonnes de snapshot inchangées.
6. **Retour** : demander puis clôturer un retour → `returns` avec statut et lignes, `closed_at`
   à la clôture, lignes conservées.
7. **Expédition** : expédier avec suivi, puis marquer livrée → `fulfillments` (`created_at`,
   suivi, `promised_at` si une promesse est réglée), puis `delivered_at` après l'événement.
8. **Bouton « Synchroniser les commandes (30 j) »** : un job `orders_incremental` `completed`,
   `order_sync_state` `completed`, le monitor legacy affiche les commandes comme avant, le
   message « Aucune commande… » si la boutique est vide.
9. **B12 (b)** : `order(id:)` sur une commande de plus de 60 jours sans `read_all_orders` →
   noter si Shopify renvoie la commande ou null (script de lecture seule prêt).
10. **Cron** : appeler `/api/cron/sync` avec le secret → réponse JSON avec, par boutique, les
    étapes `running`, `plan` (3 fenêtres créées la première fois), `reconcile` `completed`,
    `backfill` (job lancé ou `completed`), `journeys`, `fees` (`skipped` si pas de Shopify
    Payments), `inventory` (variantes du jour), `customers` ; durée sous 300 s.
11. **Fin d'op par webhook** : pendant un backfill, `bulk_operations/finish` arrive → le job
    passe `completed` sans attendre le cron ; le job suivant démarre.
12. **Attribution différée** : après le cron du lendemain, les commandes de la veille ont
    `attribution_ready = true`, `customer_order_index` et les UTM quand Shopify les fournit.
13. **Recalcul des marges estimées** (action `recalc_estimated_margins`) : les lignes
    supprimées sont recréées par la sync v2 avec les colonnes F1 ; aucune perte (lot 19).
14. **Désinstallation** : `purge_shop` vide aussi `sync_jobs`, `webhook_events`, `orders`… (déjà
    couvert par F1, à revérifier une fois des lignes présentes).

## 7. Périmètre du diff (R6)

Nouveaux : `app/lib/sync/` (8 fichiers), 5 routes webhooks, `api.cron.sync.jsx`,
`tests/lot25_sync.mjs`, ce rapport et le rapport de Phase 0. Modifiés : 11 fichiers listés en
§3.1. `app/lib/engine.js` : 0 diff. Aucune chaîne rendue, aucun composant, aucune migration.

## 8. Ce qui reste (sur GO séparés)

1. GO commit unique + push.
2. Déploiement (`shopify app deploy` applique le TOML ; variable `SCOPES` ; Fluid compute), puis
   les preuves de §6 sur la boutique de dev.
3. Demandes Partner Dashboard (niveau 1 : section E.1 des décisions ; `read_all_orders`).
4. À l'approbation de `read_all_orders` : ajouter le scope au TOML et à `SCOPES`, redéployer ;
   le plan de backfill se complète seul.
