# Phase 0 — Refonte de TCC en moteur de décision financière

Date : 2026-09-22. Lecture seule : aucun fichier applicatif modifié, aucune commande qui écrit
(pas de migration, déploiement, commit ni push). Ce document est le seul livrable.

Méthode : état du dépôt vérifié dans git et dans le code (HEAD `4c6e7b1`) ; accès et objets
Shopify confrontés à la documentation officielle (shopify.dev, help.shopify.com) — le MCP Shopify
n'a pas pu se connecter en début de session, les vérifications ont été faites par lecture directe
des pages, liens cités en section 5 et en annexe. Ce que je n'ai pas pu vérifier est marqué
« à confirmer ». Conformément au principe 9 du brief, chaque choix est présenté en options ;
aucune règle de calcul absente du brief n'est inventée : elle est listée comme question.

---

## 0. Résumé exécutif

1. Le brief est réalisable sur les fondations existantes : le socle d'ingestion (bulk +
   reprise + idempotence), le moteur d'import UE (`engine.js`), la facturation, la RGPD et la
   gate de tests se gardent. L'interface (`app._index.jsx`, ~4 000 lignes, 100 % français en
   dur, styles inline) et le modèle de marge (une seule « marge nette » qui mélange CM1, CM2 et
   pub) se refont.
2. Trois approbations Shopify conditionnent le périmètre V1 et doivent être demandées dès
   maintenant (délais non maîtrisés) : `read_all_orders` (historique > 60 jours, indispensable
   aux cohortes/LTV), données clients protégées niveau 2 (obligatoire pour ShopifyQL, donc pour
   tout le module Conversion) et l'accès Google Ads (régime d'accès modifié le 10 septembre
   2026, file d'attente signalée).
3. Cinq scopes à ajouter à l'app : `read_all_orders`, `read_reports`, `read_returns`,
   `read_fulfillments`, `read_shopify_payments_payouts` (+ `read_discounts` pour les webhooks de
   codes ; `read_customers` à confirmer pour l'identifiant client des cohortes).
4. Onze contradictions entre le brief et le code ou la documentation sont listées en
   section 11 ; les plus lourdes : le Suivi des coûts n'est pas réservé à Expert dans le code
   (le plan Free y accède), le CA HT actuel est dérivé par une hypothèse de TVA française et non
   des lignes de taxe, les frais de paiement sont des estimations forfaitaires (2 % / 1,5 %) et
   non ceux de la passerelle réelle, et il n'existe aujourd'hui AUCUN webhook de commande.
5. Ordre de construction recommandé : fondations (modèle de données, sync v2 par webhooks +
   historique, moteur CM1/CM2/CM3, coquille Polaris + i18n) puis modules 100 % Shopify
   (revenus, marges, seuils, produits, retours, expédition, stock), puis intelligence, puis
   intégrations pub/SEO, puis conversion/clients dès approbation. Taille totale : XL, détaillée
   en section 10.

---

## 1. Inventaire de l'existant : ce qui se garde, ce qui se refait

État vérifié : 22 lots de tests (`tests/lot1…lot22` + `invariants.mjs`), pas de lot 23 — le
correctif de l'état vide du Suivi des coûts N'A PAS été fait (dernier commit `4c6e7b1`,
2026-08-30 ; les cinq derniers commits sont ceux des chantiers de cet été). Gate :
eslint → 22 lots → `render_check` 35 scénarios → build.

### 1.1 Se garde tel quel (infrastructure saine)

| Fichier | Rôle | Note |
|---|---|---|
| `app/shopify.server.js` | config app, billing (plans, trialDays), scopes depuis l'env | hors périmètre refonte (§21) ; les scopes seront ajoutés ici et dans `shopify.app.toml` |
| `app/lib/plan.js`, `plan.server.js` | droit au plan (ACTIVE/FROZEN, repli D1, retry borné) | conserver ; voir « découpage par plan » §1.5 |
| `app/lib/dunning.js`, `routes/api.cron.dunning.jsx` | relance abonnements gelés | inchangé |
| `app/lib/betaShops.js` | allowlist 45 j Expert | inchangé |
| `app/lib/sessionReaper.js`, `routes/api.cron.session_reaper.jsx` | entretien sessions mortes | inchangé |
| `app/routes/webhooks.compliance.jsx`, `webhooks.app.uninstalled.jsx` | RGPD + purge 12 tables | se garde, MAIS la liste de purge doit être étendue à chaque nouvelle table (§3.6) |
| `app/lib/email.server.js`, `emailLayout.js` | Resend + gabarit | se garde ; textes à passer en i18n |
| `app/lib/bulkResume.js` | reprise d'une op bulk (decideBulkResume) | se garde ; adapter la lecture d'état à `bulkOperations` (§4.4) |
| `app/lib/orderIngest.js` : `parseBulkJsonl`, `effectiveRefundedQty`, `countDistinctOrders` | re-stitch JSONL, quantité remboursée effective (D4), compteur | se gardent tels quels |
| `app/lib/variantCosts.js` | validation des coûts saisis, CSV RFC4180 | se garde ; ajouter `product_id` à l'import (dette §6) et les nouveaux champs (délai fournisseur, tampon) |
| `app/lib/customsClassification*.js` | fiabilité de la classification douanière | se garde comme sous-module UE |
| `app/lib/engine.js` | moteur douane + TVA import UE, forfait UE dropshipping, estimations de port | **se garde comme module « coût d'import UE »** appelé par le nouveau moteur ; il ne doit plus porter la logique CA HT (§11, contradiction 3) |
| `scripts/render_check.mjs`, `tests/*` | preuve de rendu et gate | se gardent ; render_check à étendre aux composants Polaris WC |
| Migrations Supabase (21 fichiers), politique RLS deny-all + service role | schéma | se garde ; même pattern pour chaque nouvelle table |

### 1.2 Se garde et s'étend

- `app/lib/orderSync.server.js` : la mécanique (une op à la fois, reprise, `ON CONFLICT DO
  NOTHING` sur `(shop_domain, order_id, line_item_id)`, compteur sur lignes réellement insérées
  via RPC `increment_usage_orders`) est le socle de la sync v2. Se refont : la requête bulk (30 j
  → fenêtres mensuelles, ajout des lignes de taxe, codes de réduction, passerelles, entité
  B2B, parcours client), le poll (→ webhook `BULK_OPERATIONS_FINISH`), l'orchestration (§4).
- `app/lib/orderHistory.js` : les PATTERNS (agrégats par produit/jour, devises mixtes jamais
  sommées, `computeCostReliability`, `formatMoney` via Intl) se réutilisent ; les formules
  changent avec la nomenclature CM1/CM2/CM3.
- `app/lib/profitabilityAlert.js` : `computeProfitabilityChanges` (transitions seulement, seeds
  silencieux), `decideAlertAction`, `shouldAdvanceState` (G2 : avancer l'état SSI envoi réussi)
  = le squelette de la machine à états d'alerting généralisée (§7.4).
- `app/lib/cpaTargets.js`, `roas.js` : le « CPA maximum par produit » actuel est déjà un
  BE-CAC (contribution − marge visée) ; ces briques deviennent le module Seuils (10.3) avec la
  nouvelle nomenclature.
- `app/lib/recalcMargins.js` + `recalcEstimatedMargins.server.js` : la décision « lignes
  recalculables = estimated|missing, confirmed/imported immuables » se garde telle quelle.
- Table `variant_costs` (renforcée), `order_margins` (évolue en `order_lines`, §3.3),
  `shop_plans` (à scinder : facturation vs réglages), `usage`, `rate_limits`,
  `subscription_dunning_state`, `session_health`.

### 1.3 Se refait

- `app/routes/app._index.jsx` (loader + action à 15 branches + 6 onglets + composants inline
  + `<style>` mobile) : éclatement en routes par écran (§8), composants Polaris WC, zéro texte
  en dur. C'est le plus gros chantier UI. `app/components/costsUi.jsx` et `customsUi.jsx`
  suivent.
- Le calcul de marge de bout en bout : aujourd'hui `computeMargin` renvoie UNE `margeNette` qui
  soustrait dans le même mouvement le coût rendu, les frais Shopify/processeur, les retours, la
  pub et les frais fixes (avec `ads = 0` et `retours = 0` sur le chemin sync, mais pas sur le
  calculateur manuel). Le nouveau moteur émet la pile CM1 → CM2 → CM3 → résultat, en appelant
  `engine.js` uniquement pour la partie import UE (§3.1).
- Les emails d'alerte (textes, i18n, nouveaux types d'alertes).
- Le calculateur manuel et la simulation actuels deviennent des cas du Simulateur (§2).

### 1.4 Se supprime ou se déprécie (à trancher)

- Tables `calculations` et `calculation_annotations` (historique du calculateur manuel, plan
  Pro) : option A, conserver en lecture seule (« vos anciens calculs ») pendant une version ;
  option B, supprimer avec migration RGPD. Aucun utilisateur actif : B est possible, mais A
  coûte peu.
- Table `margin_alerts` (seuil sparkline) : fusionne dans les réglages d'alertes (§3.3).
- Session Prisma résiduelle : confirmée empiriquement le 2026-08-09 par lecture seule
  (`0gcvgq-bg.myshopify.com`, offline, expirée le 2026-07-26 — c'est la boutique que ton récap
  nomme GlowOn). Sa suppression est une mutation : GO séparé requis ; le reaper (10 échecs
  consécutifs ET 21 jours) devrait l'évacuer seul si le cron tourne.

### 1.5 Où le découpage par plan interviendra (sans toucher à la facturation)

Le code actuel disperse `isPro`/`isExpert` dans le loader, l'action (`set_current_cpa`,
`save_annotation`, `run_audit`, `ai_recommend`) et le JSX (une trentaine de points, cf. audit
pré-bêta). Recommandation : une carte de capacités PURE `planCapabilities(ent) → { modules,
quotas, historyMonths, aiPerDay… }` consommée par les loaders (gate DONNÉES, jamais seulement
visuel, comme `cpaTargets` aujourd'hui) — la tarification restant à décider, seule la carte
changera. Points d'insertion : chaque loader d'écran (§2), les crons (plafond d'alerting,
`planToOrderCap`), le compteur `usage`, les intégrations (nombre de connexions).

---

## 2. Correspondance des écrans et navigation proposée

| Écran actuel | Devient | Ce qui change |
|---|---|---|
| Calculateur (manuel, saisie de tous les coûts) | Simulateur → « nouveau produit » (pré-rempli depuis les réglages et coûts saisis) | plus de double saisie : le simulateur lit le moteur |
| Simulation (scénarios de prix) | Simulateur | scénarios sur toutes les variables du graphe |
| Historique (calculs manuels, sparkline, annotations) | disparaît comme écran ; annotations = « expériences » (V3), sparkline = graphiques des écrans Marges/Produits | voir §1.4 |
| Alertes (seuil sparkline + violations) | Alertes (écran 10) | alertes à seuil multi-modules |
| Audit Catalogue (Expert) | Produits (matrice CA × contribution × croissance, tri, cascade) | données réelles (commandes) au lieu du scan catalogue |
| Suivi des coûts | Réglages > Coûts ; la complétude des coûts s'affiche PARTOUT où un chiffre en dépend | l'onglet le plus dense du code actuel se dissout dans Réglages + indicateurs |
| Bandeau plan / upgrade | Réglages > Abonnement (inchangé, hors périmètre) | — |

Navigation proposée (`s-app-nav` App Bridge, déjà utilisée) — 11 entrées du brief §12 avec un
regroupement pour tenir sur mobile :

1. Tableau de bord (KPI + ce qui a changé / pourquoi / impact / à examiner)
2. Leviers
3. Simulateur
4. Produits
5. Marketing — sous-onglets : Canaux, Campagnes, Codes promo & partenaires
6. Conversion
7. Clients
8. Opérations — sous-onglets : Retours, Expédition, Stock (Stock masqué si aucun stock suivi)
9. Google (Search Console)
10. Alertes
11. Réglages — Coûts, Emballage & port, Délais fournisseurs & tampon, Promesse de livraison,
    Délai de retour, Commissions par code, Coûts fixes, Connexions (Meta, Google Ads, TikTok,
    Search Console), Langue & devise, Abonnement

Règle de navigation : chaque KPI d'un écran d'analyse a un lien « Simuler » (ouvre le
Simulateur pré-chargé) et « Voir le calcul » (détail du chiffre, principe 1). Le Tableau de
bord ne calcule rien : il lit les mêmes nœuds du moteur que les écrans d'analyse.

---

## 3. Modèle de données du moteur économique

### 3.1 Le graphe

Nœuds (brief §8-9), avec leurs entrées :

```
trafic (sessions par source/appareil)            ← sessions_daily (ShopifyQL)
  → conversion (ATC, checkout, finalisation, CVR)
  → commandes, unités, panier moyen              ← orders, order_lines
  → CA brut → remises → remboursements → CA net → CA HT   ← orders (taxLines), refunds
  → coût produit rendu (achat + import)          ← order_lines.cost_snapshot + engine.js (UE)
  → CM1
  → port marchand, emballage, frais de paiement, retours   ← order_fees, refunds, returns, coûts saisis
  → CM2 (%, €, par commande) → BE-ROAS, BE-CAC, ROAS cible
  → pub (par canal) + commissions (codes)        ← ad_spend, promo_code_rules, manual_commissions
  → CM3 → CAC, MER, POAS, LTV/CAC
  → coûts fixes                                   ← fixed_costs
  → résultat net, marge nette
  → stock (couverture, point de commande)        ← inventory_daily, variant_costs (délais)
  → SEO (entonnoir organique)                    ← seo_daily + sessions_daily(source=organic)
```

Implémentation : un module pur `app/lib/econ/` où chaque nœud est déclaré une fois —
`{ id, inputs[], compute(inputs), unit, i18nKey, benchmark, minData: { orders?, days?,
months? } }`. Les KPI, le simulateur (ré-évaluation du DAG avec entrées surchargées), les
règles et les alertes lisent ces nœuds ; aucun écran ne recalcule (principe d'architecture
§8). Le seuil `minData` de chaque nœud porte le principe 6 (« encore 40 commandes »).

Correspondance avec `engine.js` : `computeMargin` continue de produire `douane`, `tvaImport`,
`tvaNetCost`, `coutRendu` (achat + port entrant + douane + forfait UE) pour un marchand UE ;
le nouveau nœud « coût produit rendu » = achat + port entrant + droits + TVA import non
récupérable, où droits/TVA viennent d'`engine.js` (UE) ou de la saisie (hors UE, question 7).
Emballage passe en CM2 (le brief le place là ; `engine.js` le met dans `fraisFixes`).
Frais Shopify/processeur, retours, pub ne sont PLUS demandés à `engine.js` : ils viennent des
faits (`order_fees`, `refunds`, `ad_spend`). Zéro diff sur `engine.js` reste possible : on ne
lit que ses sorties d'import.

### 3.2 Ce qui se fige, ce qui se recalcule (snapshot, décision §5 conservée)

- Figé PAR LIGNE DE COMMANDE à l'ingestion : les coûts saisis (`cost_snapshot_json`, comme
  aujourd'hui), le coût produit rendu et ses composantes (CM1), les frais de paiement réels de
  la commande (`order_fees`, faits externes, non modifiables), le port et l'emballage alloués.
  Une commande passée garde sa marge.
- Recalculé À LA LECTURE (jamais figé) : tout agrégat (CM2/CM3 par période, par produit,
  par canal), car les retours et remboursements arrivent APRÈS la vente (une vente
  « provisoire » pendant le délai de retour, principe 4) et la pub bouge pendant la fenêtre
  d'attribution. Les rollups (§3.3, 21) sont un cache reconstructible, pas une source.
- Point d'attention : le recalc « marges calculées sans coût » (estimated|missing) existant
  reste le seul chemin de réécriture d'un snapshot, à l'initiative du marchand.

### 3.3 Tables (toutes `shop_domain TEXT NOT NULL`, RLS deny-all + service role, comme aujourd'hui)

Faits (append/upsert idempotents, clés Shopify) :

| # | Table | Clé | Colonnes clés | Source |
|---|---|---|---|---|
| 1 | `orders` | `(shop_domain, order_id)` | `created_at`, `processed_at`, `cancelled_at`, `test`, `source_name`, `gateway_names text[]`, `purchasing_company_id` (B2B), `customer_id` (gid seul, pas de nom/email), `customer_order_index` (1 = nouveau client), `currency_code`, `taxes_included`, `subtotal_ttc`, `discounts_amount`, `discount_codes text[]`, `shipping_charged`, `tax_amount`, `total_ttc`, `ca_ht` (calculé à l'ingestion depuis `taxLines`), `utm_source/medium/campaign/content/term`, `visit_source`, `visit_source_type`, `landing_page`, `attribution_ready`, `country_code`, `excluded_reason` (`test|cancelled|gift_card_only|draft|b2b|NULL`), `day_local DATE` (fuseau boutique), `ingested_at`, `updated_at` | bulk + webhooks orders/* |
| 2 | `order_lines` (évolution d'`order_margins`) | `(shop_domain, order_id, line_item_id)` (clé actuelle conservée) | `product_id`, `variant_id`, `quantity`, `refunded_qty`, `effective_qty`, `unit_price_ttc`, `unit_price_ht`, `discount_alloc`, `tax_lines jsonb`, `is_gift_card`, `cost_snapshot_json`, `cm1_components jsonb` (achat, port entrant, droits, tva import), `cm1_unit`, `cm2_alloc jsonb` (emballage, paiement, port marchand), `computed_at`, `breakdown_version` | idem |
| 3 | `refunds` | `(shop_domain, refund_id)` | `order_id`, `created_at`, `day_local`, `total_refunded`, `shipping_refunded`, `line_items jsonb` (line_item_id, qty, subtotal), `transactions jsonb` (kind/status) | webhook `REFUNDS_CREATE` + bulk |
| 4 | `returns` | `(shop_domain, return_id)` | `order_id`, `status`, `requested_at`, `closed_at`, `line_items jsonb` (line_item_id, qty, `return_reason` enum, note) | webhooks `RETURNS_*` (scope `read_returns`) |
| 5 | `fulfillments` | `(shop_domain, fulfillment_id)` | `order_id`, `created_at` (= expédition), `status`, `tracking_company`, `tracking_numbers text[]`, `delivered_at` (événement DELIVERED), `last_event_status`, `estimated_delivery_at`, `promised_at` (calculé : commande + promesse saisie), `country_code` | webhooks `FULFILLMENTS_*`, `FULFILLMENT_EVENTS_CREATE` (scope `read_fulfillments`) |
| 6 | `order_fees` | `(shop_domain, order_id, order_transaction_id)` | `gateway`, `fee_amount`, `net_amount`, `currency`, `transaction_date`, `source` (`shopify_payments|manual_rule`) | `ShopifyPaymentsBalanceTransaction` (fee, associatedOrder) — scope `read_shopify_payments_payouts` ; règle manuelle par passerelle sinon |
| 7 | `inventory_daily` | `(shop_domain, day_local, variant_id)` | `available`, `tracked`, `cost_per_unit`, `in_stock` | webhook `INVENTORY_LEVELS_UPDATE` + instantané quotidien |
| 8 | `sessions_daily` | `(shop_domain, day_local, source, device)` | `sessions`, `visitors`, `atc_sessions`, `checkout_sessions`, `purchase_sessions`, `pulled_at` | ShopifyQL `sessions` (agrégé, aucune donnée nominative) |
| 9 | `ad_spend` | `(shop_domain, day_local, platform, ad_account_id, campaign_id, adset_id, ad_id)` | `spend`, `currency`, `spend_shop_currency`, `fx_rate`, `impressions`, `clicks`, `platform_orders`, `platform_revenue`, `attribution_window`, `pulled_at` | Meta / Google Ads / TikTok |
| 10 | `ad_entities` | `(shop_domain, platform, entity_id)` | `level`, `name`, `status`, `parent_id`, `product_ids text[]` (mapping pub → produit) | idem |
| 11 | `seo_daily` | `(shop_domain, day_local, dim_type, dim_value)` | `clicks`, `impressions`, `ctr`, `position` ; + `seo_index_status(page, indexed, checked_at)` | Search Console |
| 12 | `fx_rates` | `(base, quote, day)` | `rate`, `source` | question 10 |

Saisies marchand :

| # | Table | Contenu |
|---|---|---|
| 13 | `variant_costs` (existante) | + `product_id NOT NULL` (fix dette), `supplier_lead_days`, `buffer_days`, `packaging_cost`, `inbound_shipping_unit`, `duty_rate_pct` (hors UE, question 7) |
| 14 | `promo_code_rules` | `code` PK, `partner_id`, `commission_pct`, `commission_base` (question 2), `active_from/to` |
| 15 | `partners`, `manual_commissions` | partenaire ; commissions sans code par période (anti-doublon : un partenaire = codes OU manuel) |
| 16 | `fixed_costs` | `label`, `amount_monthly`, `currency`, `active_from/to` |
| 17 | `shop_settings` (scission de `shop_plans`) | `return_window_days`, `delivery_promise_days`, `business_days jsonb`, `target_margin_after_ads_pct`, `gateway_fee_rules jsonb`, `locale_override`, `default_import_country`, `vat_regime`, `profitability_threshold_pct`, `current_cpa` (migrent depuis `shop_plans`) — `shop_plans` ne garde que `plan` |
| 18 | `integration_connections` | `(shop_domain, provider)` PK, `status`, `external_account_id`, `access_token_enc`, `refresh_token_enc`, `expires_at`, `scopes`, `last_sync_at`, `last_error` |

État et orchestration :

| # | Table | Contenu |
|---|---|---|
| 19 | `sync_jobs` (évolution d'`order_sync_state`) | `id`, `kind` (`orders_backfill|orders_incremental|refunds|fulfillments|inventory|ads_meta|ads_google|ads_tiktok|gsc|shopifyql`), `window_start/end`, `cursor`, `bulk_operation_id`, `status`, `attempts`, `last_error`, `started_at`, `finished_at` |
| 20 | `webhook_events` | `webhook_id` (en-tête `X-Shopify-Webhook-Id`) PK, `topic`, `received_at`, `processed_at` — idempotence des webhooks |
| 21 | `daily_rollups`, `product_daily_rollups` | `(shop_domain, day_local[, product_id])` + une colonne par nœud du graphe ; `version` ; cache reconstructible |
| 22 | `customers_agg` | `customer_id` PK (gid uniquement), `first_order_at`, `first_channel`, `orders_count`, `cm2_total`, `last_order_at`, `cohort_month` — dérivée d'`orders` (peut être une vue matérialisée) |
| 23 | `alert_state` (généralise `product_profitability_state`) | `(shop_domain, alert_type, subject_key)`, `last_state`, `last_value`, `last_checked_at`, `last_notified_at` |
| 24 | `ai_explanations` | `(shop_domain, fingerprint, locale)`, `text`, `model`, `created_at` — cache (question 12) |

Index : `(shop_domain, day_local)` sur chaque table datée ; `(shop_domain, created_at DESC)`
sur `orders` ; `(shop_domain, product_id)` sur `order_lines` et rollups produits ;
`(shop_domain, customer_id)` sur `orders` ; `(shop_domain, kind, status)` sur `sync_jobs` ;
index partiel `WHERE excluded_reason IS NULL` sur `orders`. Toutes les tables : politique
`deny_public_access` (pattern de `20260622_variant_costs.sql`) — un lot de test « migration
lint » vérifiera qu'aucune table n'est créée sans RLS.

### 3.4 Migration d'`order_margins`

Option A — renommer et étendre en place (colonnes ajoutées nullables, `breakdown_version`),
réingérer par le backfill 12 mois : conserve la clé et l'historique. Option B — nouvelle table
`order_lines`, `order_margins` gelée puis supprimée après réingestion. Avec zéro utilisateur
actif, B est plus propre (pas de colonnes héritées) ; A évite une double période. À trancher.

### 3.5 Support V2 et V3 sans refonte

- V2 anomalies/prévisions : lisent `daily_rollups` (séries temporelles complètes, par nœud) ;
  prévisions stockées dans `forecasts(day, node, horizon, value, interval)`, non créée en V1.
- V2 cash : `order_fees.transaction_date`, payouts (même scope) et `fixed_costs` suffisent ;
  table `payouts` à ajouter.
- V2 RFM / rentabilité client : `customers_agg` + `orders.customer_id` (aucune donnée
  nominative).
- V3 expériences : `experiments(hypothesis, expected_delta, started_at, ended_at,
  observed_delta)` reliée aux scénarios sauvegardés `scenarios(inputs jsonb, outputs jsonb)`.
  Le simulateur V1 produit déjà `inputs/outputs` sérialisables : il suffit de les sauver.
- V3 apprentissage par marchand : les repères (`benchmark`) des nœuds deviennent
  surchargeables par boutique (`node_overrides`).

### 3.6 RGPD

Stocker `customer_id` (gid) et des agrégats est une donnée client protégée (niveau 1, cf. §5).
`customers/redact` → supprimer la ligne `customers_agg` et mettre `orders.customer_id` à NULL
pour ce client (les agrégats de vente restent, non nominatifs) ; `customers/data_request` →
exporter les lignes d'`orders`/`customers_agg` de ce client ; `shop/redact` + uninstall → purge
étendue aux 24 tables (la liste actuelle de 12 doit devenir une constante partagée testée,
pour ne plus dupliquer la liste dans deux webhooks). L'IA ne reçoit que des agrégats (§7.3).

---

## 4. Architecture de synchronisation

### 4.1 Cible

Trois flux, chacun idempotent et rejouable :

1. **Temps réel Shopify (webhooks, §17)** — topics vérifiés dans l'enum
   `WebhookSubscriptionTopic` : `ORDERS_CREATE`, `ORDERS_UPDATED`, `ORDERS_PAID`,
   `ORDERS_CANCELLED`, `ORDERS_EDITED`, `REFUNDS_CREATE` (scope `read_orders`) ;
   `FULFILLMENTS_CREATE`, `FULFILLMENTS_UPDATE`, `FULFILLMENT_EVENTS_CREATE`
   (`read_fulfillments`) ; `RETURNS_REQUEST`, `RETURNS_APPROVE`, `RETURNS_CLOSE`
   (`read_returns`) ; `INVENTORY_LEVELS_UPDATE`, `INVENTORY_ITEMS_UPDATE` (coût par article,
   `read_inventory`) ; `PRODUCTS_UPDATE` ; `DISCOUNTS_CREATE` (`read_discounts`) ;
   `BULK_OPERATIONS_FINISH`. Déclaration dans `shopify.app.toml` (comme les trois existants),
   HMAC par `authenticate.webhook`. Handler : vérifier → dédoublonner (`webhook_events`) →
   upsert de la commande via le MÊME normaliseur que le bulk → répondre 200 en moins de 5 s
   (Shopify réessaie sinon). Un webhook ne porte pas `customerJourneySummary` complet ni les
   frais : ces enrichissements passent par le flux 3.
2. **Historique (bulk)** — backfill 12 mois (question 6) par fenêtres MENSUELLES (une op bulk
   par fenêtre, une seule op à la fois par boutique — contrainte Shopify), pilotées par
   `sync_jobs` ; la fin d'op arrive par `BULK_OPERATIONS_FINISH` → `ingestBulkResult` (réutilisé
   tel quel) ; plus de poll. Les connexions imbriquées dans des listes restent interdites en
   bulk (raison du chemin séparé des refunds aujourd'hui) : refunds, returns, fulfillments et
   événements sont récupérés par requêtes paginées par fenêtre ou par une seconde op bulk
   dédiée par ressource de premier niveau. Volume : 2 000 commandes/mois × 12 = un JSONL de
   quelques dizaines de Mo, à traiter en flux (déjà ligne par ligne dans `parseBulkJsonl`).
3. **Réconciliation quotidienne** — bulk incrémental `updated_at:>=curseur` (commandes
   modifiées, remboursées, annulées) + enrichissements différés (`customerJourneySummary.ready`,
   frais Shopify Payments par `associatedOrder`, dates de livraison) : rattrape les webhooks
   perdus (la livraison n'est pas garantie) et les données « pas encore prêtes ».

Sources en différé (§17) : pub (fenêtre d'attribution mobile → re-tirer J-7 chaque jour),
Search Console (données J-2/J-3), ShopifyQL (« not real time », fraîcheur non documentée) —
chaque écran affiche `pulled_at`.

### 4.2 Scopes à ajouter (vérifiés, liens §5)

`read_all_orders` (approbation Partner Dashboard, « Access requests »), `read_reports`
(ShopifyQL), `read_returns`, `read_fulfillments`, `read_shopify_payments_payouts` (sans
approbation), `read_discounts` ; `read_customers` **à confirmer** pour lire `Order.customer.id`
(nécessaire aux cohortes ; la page Order ne le dit pas, la page de l'objet Customer si).
Nouveau scope = ré-autorisation par le marchand : `webhooks.app.scopes_update` existe déjà.

### 4.3 Montée en charge

Aujourd'hui : un cron de 60 s traite TOUTES les boutiques en séquence (P1 de l'audit). Avec
plus de boutiques et 6 sources, ce modèle casse. Options :

- A — Cron Vercel → « dispatcher » qui lit `sync_jobs` et déclenche une invocation PAR
  boutique et par source (fetch interne signé, `maxDuration` propre) ; aucun fournisseur
  nouveau ; concurrence bornée par un compteur en base. Suffit jusqu'à quelques centaines de
  boutiques.
- B — File externe (Upstash QStash / Inngest) : reprise, délais, backoff gérés ; un
  fournisseur de plus, à déclarer dans la politique de confidentialité (pas de données
  clients dans les messages, seulement des identifiants de job).
- C — Supabase `pg_cron` + Edge Functions : tout chez Supabase, mais un second runtime à
  maintenir à côté de Vercel.

Recommandation : A en V1, avec `sync_jobs` conçue pour B (un job = un message).

### 4.4 Migration `currentBulkOperation` → `bulkOperations`

`currentBulkOperation` est déprécié (constat du chantier reprise). Lecture d'état :
`bulkOperations(first: 5, query: "status:created OR status:running")` + `node(id:)` pour
l'op persistée dans `sync_jobs.bulk_operation_id`. `decideBulkResume` garde ses états
(`create|poll|busy|ingest`) ; `poll` disparaît quand le webhook `BULK_OPERATIONS_FINISH` est en
place (conserver le chemin comme repli). `partialDataUrl` : à consommer pour les ops FAILED
partielles (l'idempotence rend l'ingestion partielle sûre — dette §6 levée par la même
occasion). Compteur `ingested` : renvoyer les lignes insérées (RETURNING) et non construites.

---

## 5. Faisabilité par module (section 10)

Légende disponibilité : **J0** = dès l'installation (60 jours de commandes, scopes standard) ;
**Hist.** = après backfill 12 mois (`read_all_orders`) ; **Conn.** = après connexion d'une
source externe ; **Appr.** = après approbation Shopify.

| Module | Données | Source | Dispo | Accès (état vérifié) |
|---|---|---|---|---|
| 10.1 Revenus et commandes | commandes, lignes, `taxLines`/`taxesIncluded`, remises (`discountCodes`, allocations), remboursements, pays, canal (`sourceName`), UTM (`customerJourneySummary.firstVisit/lastVisit` → `CustomerVisit.utmParameters`, `source`, `sourceType`, `referrerUrl`, `landingPage`) | Shopify Order | J0 (30/60 j) ; croissance vs année précédente et cohortes : Hist. | `read_orders` ✓ ; `read_all_orders` à demander ; données clients protégées niveau 1 à déclarer (les commandes sont un type protégé même sans champ nominatif) |
| 10.2 Marges et résultat | + coûts saisis (`variant_costs`), coût par article Shopify (`InventoryItem.unitCost`, déjà lu en prod par `costs_list` avec `read_products`+`read_inventory`), frais réels (`ShopifyPaymentsBalanceTransaction.fee`/`net`/`associatedOrder`/`sourceOrderTransactionId`), coûts fixes | Shopify + saisies | J0 partiel (« marge inconnue » tant que coûts manquants) | `read_shopify_payments_payouts` ✓ sans approbation ; frais réels UNIQUEMENT pour Shopify Payments : autres passerelles (`paymentGatewayNames`) → règle manuelle par passerelle (§3.3, 17) |
| 10.3 Seuils | dérivés (BE-ROAS, ROAS cible, BE-CAC, récupération du CAC, seuil de rentabilité) | moteur | J0 ; récupération du CAC : Hist. (contribution mensuelle par client) | BE-CAC « CM2 de la première commande » exige le rang de commande : `customerJourneySummary.customerOrderIndex` ✓ (`read_orders`) |
| 10.4 Produits | rollups produits + retours + attribution | moteur | J0 ; CM3 par produit : Conn. + mapping pub→produit | — |
| 10.5 Marketing | dépenses/attribution plateformes, UTM Shopify, FX | Meta Marketing API, Google Ads API, TikTok Marketing API | Conn. | Meta : App Review pour `ads_read` (demande en cours selon §16). Google : accès « Basic » par projet Cloud depuis le 10/09/2026 (jetons développeur en fin de vie), file d'attente signalée, vérification de marque accélère ; **risque de délai**. TikTok : app Marketing API à faire approuver. Liens en annexe |
| 10.6 Codes promo et influenceurs | `discountCodes`/applications sur la commande, règles de commission saisies, rang client, LTV | Shopify + saisies | J0 ; rachat/LTV : Hist. | `read_orders` ✓ ; webhook `DISCOUNTS_CREATE` → `read_discounts` (optionnel) |
| 10.7 Conversion | `sessions`, `sessions_with_cart_additions`, `sessions_that_reached_checkout`, `sessions_that_completed_checkout`, `conversion_rate`, `online_store_visitors`, filtre `human_or_bot_session = 'human'` | ShopifyQL `shopifyqlQuery` (Admin GraphQL ≥ 2025-10) | Appr. ; « not real time » | `read_reports` ✓ + **données clients protégées NIVEAU 2 obligatoire** (exigences : sauvegardes chiffrées, séparation test/prod, journalisation des accès, politique d'incident…). Dimensions source de trafic/appareil : présentes dans les rapports Shopify, **à confirmer dans la référence ShopifyQL**. Repli sans historique : Web Pixel app (événements collectés par l'app à partir de l'installation) |
| 10.8 Clients | `customer_id`, rang, dates → cohortes, rachat, fréquence, LTV CM2 | Shopify Order | Hist. (12 mois minimum ; M+12 complet exige 24 mois, question 6) | niveau 1 + `read_customers` à confirmer |
| 10.9 Retours | remboursements (`refunds`), retours + motifs (`ReturnReason` : COLOR, DEFECTIVE, NOT_AS_DESCRIBED, OTHER, SIZE_TOO_LARGE, SIZE_TOO_SMALL, STYLE, UNKNOWN, UNWANTED, WRONG_ITEM), frais de retour saisis | Shopify | J0 ; motifs absents si app tierce | `read_returns` à ajouter (les retours ne sont PAS couverts par `read_orders`) |
| 10.10 Expédition | `fulfillments.createdAt`, `FulfillmentEvent.status/happenedAt/estimatedDeliveryAt` (livré), promesse saisie, jours ouvrés | Shopify | J0 partiel : OTD « indisponible » si aucun événement DELIVERED (les événements sont créés via `fulfillmentEventCreate` par le transporteur/l'app de suivi : couverture variable) | objet via `read_orders` ; webhooks via `read_fulfillments` |
| 10.11 Stock | `InventoryLevel.available`, `tracked`, coût, ventes/jour, délais saisis | Shopify + saisies | après ~30 j de ventes/jour ; ruptures : instantanés quotidiens | `read_inventory` ✓ ; dropshipping exclu si non suivi |
| 10.12 SEO | clics, impressions, CTR, position par requête/page ; statut d'indexation | Search Console API (OAuth Google, propriété vérifiée par le marchand) | Conn. ; 16 mois d'historique côté GSC | projet Google Cloud (le même que Google Ads) |
| 10.13 Intelligence | tous les nœuds + règles + IA | moteur, fournisseur IA (question 12) | J0 (dégradé par seuils `minData`) | politique de confidentialité à mettre à jour (§18) |

Vérifications documentaires (pages lues) :

- Scopes, limite 60 jours, `read_all_orders`, `read_shopify_payments_payouts`,
  `read_returns`, `read_reports` : https://shopify.dev/docs/api/usage/access-scopes
- ShopifyQL pour les apps (`read_reports`, niveau 2, ≥ 2025-10, « not real time ») :
  https://shopify.dev/docs/apps/build/shopifyql/graphql-admin-api et
  https://shopify.dev/docs/api/admin-graphql/latest/queries/shopifyqlQuery ; changelog :
  https://shopify.dev/changelog/shopifyqlquery-now-available-in-graphql-admin-api
- Dataset `sessions` et `human_or_bot_session` :
  https://changelog.shopify.com/posts/filter-out-bot-traffic-in-your-sessions-related-reports
  et https://help.shopify.com/en/manual/intro-to-shopify/bots/bot-filtering
- Données clients protégées (niveaux 1/2, commandes = type protégé) :
  https://shopify.dev/docs/apps/launch/protected-customer-data
- Objet Order (`customerJourneySummary`, `purchasingEntity`, `taxLines`, `taxesIncluded`,
  `paymentGatewayNames`, `sourceName`, `test`, `cancelledAt`, `refunds`, `returns`,
  `currentTotalPriceSet`) : https://shopify.dev/docs/api/admin-graphql/latest/objects/Order
- `CustomerJourneySummary` (`ready`, `customerOrderIndex`, `daysToConversion`, fenêtre 30 j) :
  https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerJourneySummary ;
  `CustomerVisit` (`utmParameters`, `source`, `sourceType`, `referrerUrl`, `landingPage`) :
  https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerVisit
- Frais réels : https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsBalanceTransaction
- Topics webhooks (17 vérifiés) : https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic
- Livraison : https://shopify.dev/docs/api/admin-graphql/latest/objects/FulfillmentEvent
- Motifs de retour : https://shopify.dev/docs/api/admin-graphql/latest/enums/ReturnReason
- Langues de l'admin (38) : https://help.shopify.com/en/manual/your-account/languages
- Google Ads API, niveaux d'accès et changement du 10/09/2026 :
  https://developers.google.com/google-ads/api/docs/api-policy/access-levels et
  https://developers.google.com/google-ads/api/docs/api-policy/developer-token

Non vérifiés cette session (à faire avant de figer les modules concernés) : la référence
complète des datasets ShopifyQL (dimensions `referrer`/`device`), le scope exact pour
`Order.customer.id`, l'API Web Pixels (repli conversion), les pages Meta/TikTok/Search
Console (accès demandés par toi, §16).

---

## 6. Architecture des intégrations externes

`app/lib/integrations/<provider>/` avec un contrat commun :

- `connect` : routes OAuth (`/integrations/<provider>/auth` → redirection, `/callback` →
  échange de code), état anti-CSRF signé, stockage dans `integration_connections`
  (jetons chiffrés AES-256-GCM, clé dans l'env Vercel — option : Supabase Vault ; à
  trancher), sélection du compte pub / de la propriété GSC par le marchand.
- `client` : appels avec rafraîchissement de jeton, gestion des quotas (Meta : limite par
  app et par compte ; Google Ads : opérations/jour selon niveau d'accès ; GSC : 1 200 req/min),
  backoff, erreurs typées (`revoked`, `rate_limited`, `permission_denied`) remontées au
  marchand (principe 5).
- `sync` : un `sync_jobs.kind` par provider, tirage quotidien J-7 → J (fenêtre d'attribution
  glissante) + « actualiser » manuel ; normalisation vers `ad_spend`/`ad_entities`/`seo_daily`
  dans la devise de la boutique via `fx_rates`.
- `health` : statut affiché dans Réglages > Connexions (dernière sync, erreur, bouton
  déconnexion = révocation côté fournisseur + suppression des jetons, §16).
- Chaque provider est un dossier indépendant, activable par drapeau ; aucun écran ne dépend
  d'un provider absent (état « non connecté » avec l'action de connexion).

Particularités : Meta (Marketing API `insights`, ventilations campaign/adset/ad, `action
attribution windows` à fixer et afficher) ; Google Ads (GAQL, accès lié au projet Cloud depuis
le 10/09/2026, `customer_id` du compte, MCC éventuel) ; TikTok (`report/integrated/get`) ;
Search Console (`searchanalytics.query` par `query`/`page`/`date`, `urlInspection` pour
l'indexation, quota limité → échantillon de pages).

Attribution côte à côte (§7) : `ad_spend.platform_revenue` d'un côté, jointure
`orders.utm_*` ↔ `ad_entities` de l'autre ; le nœud « CA attribué prudent » = min des deux, et
l'écran montre les deux avec la fenêtre de chaque source.

---

## 7. Couche d'intelligence

### 7.1 Règles

Catalogue pur `app/lib/rules/` : une règle = `{ id, module, condition(nodes) → boolean,
diagnosticKey, levers[], estimateEuro(nodes) → { monthly, assumptions }, minData }`. Les
règles viennent de tes checklists (10.1 leviers de panier, 10.7 étape la plus faible, 10.9
motif > 30 %, 10.11 point de commande…). Classement par gain estimé (question 4). Chaque règle
est un cas de test (comme `decideAlertAction` aujourd'hui).

### 7.2 Simulateur

Ré-évaluation du DAG (§3.1) avec entrées surchargées ; sortie avant/après par nœud ; recherche
de seuil par balayage (« jusqu'où la conversion peut baisser… ») ; hypothèses de volume
affichées ; mention « scénario, pas prévision » ; `inputs/outputs` sérialisables (V3). Pur,
testable, sans I/O — le pattern `computeScenarios` d'`engine.js` en est l'ancêtre.

### 7.3 Explications IA — garde-fous (pattern `ai_recommend` existant, généralisé)

Déjà en place et à conserver : intrants sanitisés (`sanitizeForPrompt`), interdiction
explicite de calculer, chiffres copiés depuis le moteur, réponse JSON contrainte, timeout 18 s,
quota par jour (`checkRateLimit`), `aiUnavailable` sans blocage. À ajouter : sortie dans la
langue de l'admin (le prompt reçoit `locale` et un lexique validé, question 11) ; entrée =
agrégats uniquement (jamais d'identifiant client, §18) ; cache `ai_explanations` par empreinte
(diagnostic + chiffres arrondis + locale) — pas de nouvel appel tant que les faits n'ont pas
changé ; plafond de coût par boutique et par jour ; vérification de sortie : tout nombre cité
doit exister dans les intrants (rejet sinon, repli sur le texte déterministe).

### 7.4 Alertes

Généralisation de `profitabilityAlert` : `alert_state` par `(alert_type, subject_key)`,
transitions uniquement, premiers passages silencieux, avancement d'état SSI envoi réussi,
digest quotidien, in-app + email, plafond par plan (carte de capacités §1.5). Types V1 :
produit à perte, CM2 sous repère, stock au point de commande, CAC > BE-CAC, motif de retour
> 30 %, OTD < 95 %, connexion pub rompue.

---

## 8. Polaris Web Components et i18n

### 8.1 Polaris WC

L'app utilise déjà `s-page`, `s-section`, `s-app-nav` (composants App Bridge) ; tout le
reste est en `div` inline. Plan :

1. Nouvel arbre de routes : `app.dashboard`, `app.levers`, `app.simulator`, `app.products`,
   `app.marketing.*`, `app.conversion`, `app.customers`, `app.operations.*`, `app.google`,
   `app.alerts`, `app.settings.*` ; `app._index` redirige vers le tableau de bord. Aucun
   utilisateur actif → bascule en une fois (pas de double UI à maintenir), les routes
   d'auth/billing/webhooks intactes.
2. Composants : `s-table`, `s-banner`, `s-badge`, `s-button`, `s-select`, `s-text-field`,
   `s-stack`/`s-box`/`s-grid`, `s-tabs` ; libellés longs jamais tronqués (pas de `nowrap` sur
   du texte traduit). Polaris 2.0 : suivre la release candidate pour les jetons de style ; ne
   pas figer de couleurs en dur (contrastes, gain/perte jamais par la couleur seule : icône +
   texte).
3. Graphiques et simulateur : librairie dédiée (question 8) dans des `s-section`.
4. `render_check` : étendre aux nouveaux écrans ; les custom elements se rendent en SSR comme
   des balises, les tests de rendu restent valables. Vérification iPhone après déploiement
   pour chaque écran (le débordement portrait du WebView reste ouvert, §11).
5. App Design Guidelines / Built for Shopify : navigation via `s-app-nav`, pas de couleurs de
   marque hors graphiques, états vides et de chargement Polaris, performance (LCP) des pages.

### 8.2 i18n

- Bibliothèque : options `i18next` + `react-i18next` (écosystème, ICU via
  `i18next-icu`), `@shopify/react-i18n` (aligné admin, moins actif), `lingui` (extraction
  compile-time). Recommandation : i18next + ICU ; à trancher avec la question 11.
- Langue : paramètre `locale` fourni à l'app par l'admin au chargement (App Bridge) ; repli
  `Accept-Language` ; surcharge dans Réglages. Nombres, dates, devises : `Intl` avec la locale
  ET la devise de la boutique (`formatMoney` existant, à généraliser).
- 38 langues (liste question 13), dont 3 RTL (arabe, hébreu, ourdou) : `dir="rtl"` au niveau
  page, graphiques et simulateur à vérifier en RTL.
- Gouvernance : catalogues JSON par langue ; clé = identifiant, jamais la phrase source ;
  lint « aucune chaîne en dur dans le JSX » (lot de test, comme `lot2_ui_labels` aujourd'hui) ;
  CI : toute clé présente dans les 38 catalogues avant merge ; pseudo-locale allongée (+40 %)
  pour tester les libellés allemands/finnois ; la table de bijection actuelle devient le
  lexique financier par langue (question 11).

---

## 9. Questions ouvertes : options et implications

1. **Port payé par le client dans le CA ?** A — hors CA : le port client vient en déduction du
   port marchand dans CM2 (repère panier moyen ≈ prix produit, cohérent avec 10.1). B — dans le
   CA brut, port marchand en coût : gonfle panier moyen et CVR en valeur, complique la
   comparaison au prix produit. C — ligne « recettes de port » distincte, hors CA HT produit
   mais dans le total encaissé. Implication commune : le remboursement du port doit suivre la
   même règle.
2. **Base de la commission d'un code.** A — CA HT après remise (ce que le client paie, usage
   dominant des contrats d'influence). B — CA HT avant remise (favorable au partenaire). C —
   réglable par code (défaut A). B expose à sur-payer les partenaires ; C double les cas de
   test.
3. **Délai de retour par défaut.** A — 14 jours (minimum légal UE vente à distance). B — 30
   jours (usage D2C). C — déduit de la politique de retour Shopify (texte libre, non
   exploitable machine → rejeté). Implication : plus le délai est long, plus la part de ventes
   « provisoires » est grande.
4. **Estimation des gains de leviers.** Horizon : 30 jours glissants (aligné sur les rollups)
   ou mensuel calendaire. Volume : constant (prudent, recommandé V1) ou élastique (V3). Le
   choix conditionne le classement des leviers ; l'hypothèse est affichée dans tous les cas.
5. **Seuil de rentabilité.** A — sur CM3 (marketing variable, exact pour une acquisition
   payante qui suit le volume). B — sur CM2 avec marketing ajouté aux coûts fixes (budget pub
   mensuel figé). C — les deux, étiquetés. B sous-estime le seuil quand la pub suit le volume.
6. **Profondeur d'historique.** 12 mois : cohortes M+12 disponibles pour une seule cohorte.
   24 mois : douze cohortes M+12, backfill doublé (même approbation `read_all_orders`).
   Recommandation : demander 24, afficher les seuils `minData`.
7. **Coût d'import hors UE.** A — saisie du coût rendu total. B — moteur par pays (HTS
   US, UK, CA…) : XL, hors V1. C — formule générique (valeur × taux de droits saisi + port) ;
   TARIC automatique pour l'UE. C garde la chaîne « chiffre → détail » sans réglementation
   visible.
8. **Librairie de graphiques.** Polaris Viz (Shopify, alignée Polaris, React) ; Recharts
   (simple, limité en finition) ; visx/d3 (contrôle total, « haut de gamme », plus de code) ;
   ECharts (riche, lourd). Implications : SSR/render_check, RTL, thème Polaris 2.0. Option
   hybride : Polaris Viz pour les écrans, visx pour le simulateur.
9. **Identification B2B.** A — `Order.purchasingEntity` de type Company (vérifié : « Used for
   B2B transactions ») ; B — étiquette `B2B`/canal wholesale ; C — A + surcharge par étiquette
   dans Réglages. A ne couvre pas les marchands qui gèrent le B2B sans Shopify Plus.
10. **Taux de change.** BCE (gratuit, quotidien, base EUR, croisement pour les autres) ;
    fournisseur commercial (toutes bases, coût) ; taux implicite Shopify par commande
    (`shopMoney` vs `presentmentMoney`, seulement pour les commandes, pas pour la pub).
    Besoin réel : convertir des dépenses pub quotidiennes → BCE suffit pour une boutique EUR,
    fournisseur sinon.
11. **Traduction et relecture.** Langue source FR (tu valides) ou EN (référence des
    traducteurs et de Shopify) ; traduction machine (DeepL / modèle IA) + relecture humaine
    des 5 langues principales ; lexique financier : tu valides FR/EN, les relecteurs le reste ;
    réutiliser la terminologie de l'admin Shopify dans chaque langue (« commandes »,
    « sessions »…) pour rester cohérent avec ce que le marchand voit.
12. **Fournisseur et modèle d'IA.** Anthropic (intégration existante, modèle à mettre à
    jour), OpenAI, Mistral (hébergement UE). Coût : ~1 appel par diagnostic et par langue,
    plafonné par le cache d'empreinte (§7.3) et une limite quotidienne ; latence < 10 s ;
    résidence des données et mention dans la politique de confidentialité.
13. **Langues de l'admin Shopify : 38** (vérifié) — arabe, bulgare, chinois simplifié, chinois
    traditionnel, croate, tchèque, danois, néerlandais, anglais, finnois, français, allemand,
    grec, hébreu, hindi, hongrois, indonésien, italien, japonais, coréen, lituanien, malais,
    norvégien (bokmål), polonais, portugais (Brésil), portugais (Portugal), roumain, russe,
    slovaque, slovène, espagnol, suédois, thaï, turc, ourdou, vietnamien. Trois RTL.
14. **Tableau de bord dirigeant.** Proposition 12 KPI : CA HT, commandes, panier moyen, CVR,
    CM2 % / € par commande, CM3, résultat net, CAC, MER, POAS, LTV/CAC, taux de retour (taux de
    rachat en 13e si mobile le permet). Option « 8 KPI + tout le reste au clic » pour mobile.

Questions supplémentaires nées de l'analyse (à trancher aussi) : jours ouvrés et fuseau pour
le délai d'expédition (10.10) ; règle de frais pour les passerelles hors Shopify Payments ;
migration d'`order_margins` (A/B §3.4) ; sort de `calculations` (§1.4) ; file de jobs (§4.3) ;
chiffrement des jetons (env vs Vault) ; scope `read_customers` si confirmé nécessaire.

---

## 10. Tailles, dépendances, ordre de construction, risques

| Chantier | Taille | Dépend de | Risques |
|---|---|---|---|
| F1 Modèle de données (24 tables, RLS, purge RGPD, migration `order_margins`) | L | — | oubli d'une table dans la purge (test de liste partagée) |
| F2 Sync v2 (webhooks, backfill 12/24 mois, `bulkOperations`, `BULK_OPERATIONS_FINISH`, réconciliation, dispatcher) | XL | F1, `read_all_orders` | approbation `read_all_orders` ; volume JSONL ; webhooks manqués (réconciliation obligatoire) |
| F3 Moteur CM1/CM2/CM3 (DAG, `minData`, `engine.js` en sous-module UE) | L | F1 | erreurs de nomenclature (tests = exemples chiffrés §22) |
| F4 Coquille Polaris WC + i18n (38 langues, lint, render_check) | L | — | volume de traduction ; RTL ; Polaris 2.0 en RC |
| M1 Revenus & commandes (10.1) | M | F2, F3, F4 | — |
| M2 Marges & résultat (10.2) + réglages coûts | M | F3, frais réels | passerelles hors Shopify Payments |
| M3 Seuils (10.3) | S | M2 | — |
| M4 Produits (10.4) | M | M2 | — |
| M5 Retours (10.9) | M | F2 (`read_returns`) | motifs absents (apps tierces) |
| M6 Expédition (10.10) | M | F2 (`read_fulfillments`) | couverture des événements DELIVERED |
| M7 Stock (10.11) | M | F2, instantanés quotidiens | 30 j de ventes avant les jours de couverture |
| I1 Intelligence : règles, simulateur, alertes, IA (10.13) + Tableau de bord + Leviers | L | M1–M4 | coût IA ; règles à valider une à une avec toi |
| X1 Cadre d'intégrations (OAuth, jetons, `sync_jobs`) | M | F1 | chiffrement, révocation |
| X2 Meta, X3 Google Ads, X4 TikTok (10.5) | M chacun | X1 | approbations externes ; Google Ads : régime d'accès en changement |
| M8 Codes promo & influenceurs (10.6) | M | M1, M2 | — |
| M9 Conversion (10.7) | M | `read_reports` + niveau 2 | **approbation niveau 2** (exigences de sécurité) ; dimensions à confirmer |
| M10 Clients (10.8) | M | F2 historique, niveau 1, `read_customers` ? | 12 vs 24 mois |
| X5 Search Console + M11 SEO (10.12) | M | X1 | quota d'inspection |

Ordre recommandé : **demandes d'accès dès maintenant** (`read_all_orders`, niveau 2, Meta,
Google Cloud/Ads, TikTok) → F1 → F3 (le moteur se teste sans UI, avec les exemples §22) →
F2 → F4 → M1, M2, M3, M4 (première version montrable, 100 % Shopify) → I1 (dashboard,
leviers, simulateur, alertes) → M5, M6, M7 → X1 puis X2/X3/X4 + M8 → M9, M10 dès approbation
→ X5/M11. Chaque chantier : Phase 0, lot de tests, gate complète, preuve après déploiement
(iPhone pour le mobile).

Risque transverse n° 1 : les délais d'approbation (Shopify niveau 2 et `read_all_orders`,
Google Ads) — d'où les demandes en tête d'ordre et un V1 « Shopify seul » montrable sans elles.
Risque n° 2 : la justesse (principe 1) — les exemples chiffrés de la section 22 deviennent des
tests d'invariants du moteur avant tout écran.

---

## 11. Ce qui, dans le brief, contredit le code ou la documentation

1. **§5 « Suivi des coûts (Expert) » et « Free : sans Suivi »** — faux dans le code : l'onglet
   Suivi des coûts est rendu sans aucune condition de plan (`app._index.jsx`, rendu
   `activeTab === "costs" && <CostTracker …>` sans `isPro`/`isExpert`) ; seuls le CPA déclaré
   et le CPA prescriptif y sont Expert. Free a donc le Suivi. L'Audit, lui, est bien gaté
   Expert (`ExpertGate`), l'Historique Pro.
2. **§5 « 22, peut-être 23 lots »** — 22 (vérifié dans `tests/` et git) ; le correctif de
   l'état vide n'a pas été fait ; la contradiction « Pas encore de commandes analysées » vs
   carte des produits sans coût (§6) est toujours ouverte.
3. **§9 « CA HT : taxes retirées via les lignes de taxe »** — le code actuel ne lit AUCUNE
   ligne de taxe : la requête bulk ne demande pas `taxLines`, et `engine.js` dérive le HT par
   une hypothèse française (`vatRegime` assujetti/franchise, TVA 20 %, `shopTaxesIncluded`).
   Pour un marchand hors France c'est faux ; le nouveau CA HT doit venir des faits.
4. **§9 « frais de paiement de la passerelle réelle »** — aujourd'hui des taux forfaitaires
   saisis (Shopify 2 %, processeur 1,5 % + 0,25 fixe, `shop_plans`), identiques pour toutes les
   commandes, figés dans le snapshot. Les frais réels (vérifiés disponibles) ne couvrent que
   Shopify Payments : le brief ne dit rien des autres passerelles → question supplémentaire.
5. **§7 « la pub n'entre jamais dans CM2 »** — le calculateur manuel actuel inclut `ads` et
   `retours` en % dans sa « marge nette » ; seule la sync les met à zéro. Deux définitions
   coexistent aujourd'hui ; la refonte n'en garde qu'une.
6. **§17 « passer d'une sync par cron à des webhooks »** — il n'existe AUCUN webhook de
   commande, remboursement, expédition ou stock aujourd'hui (`shopify.app.toml` : uniquement
   `app/uninstalled`, `app/scopes_update`, conformité). Tout le flux temps réel est à créer.
7. **§10.7 ShopifyQL** — disponible aux apps (confirmé, octobre 2025), mais le brief omet
   la condition la plus lourde : **données clients protégées niveau 2** obligatoire, avec ses
   exigences de sécurité (sauvegardes chiffrées, journalisation, séparation test/prod,
   politique d'incident). `read_reports` seul ne suffit pas.
8. **§16 « retours »** — non couverts par `read_orders` : scope `read_returns` distinct, absent
   de la liste du brief. Idem `read_fulfillments` pour les webhooks d'expédition et
   `read_discounts` pour ceux des codes.
9. **§16 « UTM sur la commande (customerJourneySummary) »** — les UTM ne sont pas sur le
   résumé mais sur ses visites (`firstVisit`/`lastVisit` → `CustomerVisit.utmParameters`), avec
   un drapeau `ready` (attribution asynchrone) et une fenêtre de 30 jours : l'ingestion doit
   re-tirer les commandes non prêtes (flux de réconciliation §4.1).
10. **§6 « débordement iPhone, cause probable côté WebView »** — état exact : contention
    `body { overflow-x: clip }` livrée (`4c6e7b1`) mais NON validée par capture ; la refonte
    Polaris WC change toute la structure : à re-vérifier sur iPhone après le premier écran
    livré, pas à corriger dans l'ancien code.
11. **§5 « RLS actif, Advisor 0/0 »** — vérifié dans les migrations pour les tables lues
    (`deny_public_access`, service role) ; l'état de l'Advisor Supabase n'est pas vérifiable
    depuis le dépôt (pris tel quel).
12. **§13 « pré-remplir depuis le coût par article »** — déjà fait : `costs_list` lit
    `inventoryItem.unitCost` avec les scopes actuels (`read_products` + `read_inventory`) ;
    aucun scope supplémentaire. La refonte garde ce pré-remplissage en SUGGESTION (règle
    « plus jamais de pré-rempli » de l'ère XV : jamais persisté sans validation).
13. **§9 « exclus : cartes cadeaux »** — les cartes cadeaux sont exclues de la LISTE des coûts
    mais ingérées dans les commandes en « coût manquant » (audit P1) : l'exclusion doit se
    faire à l'ingestion (`is_gift_card` sur la ligne, `excluded_reason` sur la commande).

---

## Annexe — état du dépôt au moment de l'audit

HEAD `4c6e7b1` (2026-08-30). Fichiers non suivis préexistants :
`docs/rapports/2026-08-09_audit-pre-beta.md`, `docsPHASE0_AUDIT_SUIVI.md`. Aucune
modification apportée par cette Phase 0.

STOP. Rien d'irréversible n'a été exécuté ; chaque décision de la section 9 et chaque option
marquée « à trancher » attend ton arbitrage avant tout chantier.
