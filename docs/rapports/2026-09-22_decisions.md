# Refonte TCC — décisions de Phase 0, demandes d'accès, plan du chantier F1

Date : 2026-09-22. Fait suite au rapport `docs/rapports/2026-09-22_refonte-phase0.md`.
Lecture seule : ce fichier est la seule écriture de la session. Aucune ligne de code, aucune
migration, rien d'irréversible avant ton GO explicite.

---

## A. Les 21 décisions (justification en une ligne)

### Questions du brief

| # | Décision | Justification |
|---|---|---|
| 1 | Port client dans le CA brut, port marchand en coût (option B) ; le remboursement du port suit la même règle | Aligné sur la définition Shopify de « Total sales » : le marchand retrouve les mêmes chiffres que dans son admin. |
| 2 | Base de commission réglable par code, défaut = CA HT après remise (option C) | Le défaut colle à l'usage dominant des contrats d'influence ; le réglage couvre les contrats atypiques sans sur-payer par défaut. |
| 3 | Délai de retour par défaut : 30 jours (option B) | Usage D2C courant ; plus prudent que 14 j pour marquer les ventes provisoires. |
| 4 | Gains des leviers : horizon mois calendaire, volume constant | Lisible pour le marchand (« ce mois-ci ») et prudent (aucune élasticité inventée en V1). |
| 5 | Seuil de rentabilité : les deux versions, étiquetées (option C) — sur CM3, et sur CM2 avec marketing en coûts fixes | Couvre l'acquisition qui suit le volume ET le budget pub figé, sans imposer un modèle au marchand. |
| 6 | Historique : 24 mois, seuils `minData` affichés | Douze cohortes M+12 complètes au lieu d'une ; même approbation `read_all_orders`. |
| 7 | Import hors UE : formule générique (valeur × taux de droits saisi + port), TARIC automatique pour l'UE, saisie directe du coût rendu possible (option C élargie) | Garde la chaîne chiffre → détail sans réglementation visible ; le repli « coût rendu » évite le mur pour qui ignore son taux. |
| 8 | Graphiques : Polaris Viz pour les écrans, visx pour le simulateur (hybride) | Cohérence Polaris/Built for Shopify sur les écrans, contrôle total là où la qualité visuelle est le produit. |
| 9 | B2B : `purchasingEntity` de type Company + surcharge par étiquette dans Réglages (option C) | Le champ officiel couvre Shopify Plus ; l'étiquette couvre les marchands qui gèrent le B2B autrement. |
| 10 | Taux de change : BCE d'abord, fournisseur commercial seulement si une devise manque ; prévu dans l'architecture (`fx_rates.source`), non branché maintenant | Gratuit et quotidien ; le besoin réel (dépenses pub) ne justifie pas un fournisseur payant tant qu'une devise n'est pas absente. |
| 11 | Langue de départ : **anglais** (tranché le 2026-09-22, second message) ; traduction automatique, relecture humaine des 5 langues principales, lexique financier validé par toi en FR et EN, terminologie de l'admin Shopify réutilisée dans chaque langue | L'anglais est la référence naturelle des relecteurs et de la documentation Shopify ; le lexique FR/EN validé par toi garde la main sur les termes financiers, et le français est traité comme une langue cible relue au même titre que les quatre autres principales. |
| 12 | IA : Anthropic (intégration existante, modèle à mettre à jour), cache d'empreinte + limite quotidienne (§7.3 du rapport) | Zéro nouvelle intégration ; le coût est borné par construction. |
| 13 | 35 langues LTR au lancement ; arabe, hébreu, ourdou (RTL) ensuite ; l'architecture i18n doit les permettre sans refonte | Le RTL touche la mise en page, les graphiques et le simulateur : un chantier propre plutôt qu'un lancement à moitié vérifié. |
| 14 | Tableau de bord : 12 KPI sur ordinateur (liste du rapport), 8 sur mobile avec le reste au clic | Lisibilité mobile sans amputer la vue dirigeant. |

### Questions nées de l'analyse

| # | Décision | Justification |
|---|---|---|
| 15 | Jours ouvrés : lundi–vendredi, sans jours fériés, fuseau de la boutique ; réglage marchand plus tard | Règle simple, déterministe, documentable ; le calendrier de fériés par pays est un chantier à part. |
| 16 | Passerelles hors Shopify Payments : taux par passerelle réglable, valeurs courantes pré-remplies, frais marqués « à confirmer » tant que non validés | Principe 5 (trou visible) : jamais un frais estimé présenté comme réel. |
| 17 | `order_margins` : étendre en place, réingérer par le backfill (option A) | Conserve la clé unique et l'idempotence éprouvées ; une seule période de transition. |
| 18 | `calculations` + `calculation_annotations` : supprimer, avec migration RGPD (option B) | Aucun utilisateur actif ; le calculateur manuel devient un cas du simulateur. |
| 19 | Traitement de fond : dispatcher sur cron Vercel (option A), `sync_jobs` conçue pour passer à une file externe (B) plus tard | Aucun fournisseur nouveau en V1 ; le format « un job = un message » rend la bascule mécanique. |
| 20 | Chiffrement des jetons : clé dans les variables d'environnement Vercel (AES-256-GCM côté app) | Simplicité ; rotation possible par double clé (ancienne/nouvelle) le jour venu. |
| 21 | **`read_customers` : AJOUTÉ** à la liste des scopes — tranché par la doc (voir ci-dessous) | L'objet `Customer` « Requires `read_customers` access scope » ; `Order.customer` renvoie cet objet, donc même `customer { id }` l'exige. Champs lus : `id`, `numberOfOrders`, `createdAt` uniquement (niveau 1, aucun champ nominatif). |

Conséquence de la décision 21 : `Order.customer` est `null` pour un achat invité (« guest
checkout », doc Order) — ces commandes comptent dans le CA mais pas dans les cohortes ; l'écran
Clients affichera « N commandes sans client identifié » (trou visible, principe 5). Rapprocher
les invités par e-mail serait du niveau 2 : non retenu.

Liste finale des scopes à ajouter : `read_all_orders`, `read_reports`, `read_returns`,
`read_fulfillments`, `read_shopify_payments_payouts`, `read_discounts`, `read_customers`.

---

## B. Les trois demandes d'accès

Les formulaires Shopify et Google sont en anglais : chaque demande a une version française
(pour toi) et le texte anglais à coller. Les textes déclarent STRICTEMENT ce que l'architecture
de Phase 0 prévoit — rien de plus, pour ne pas s'engager sur des usages non construits.

### B.1 `read_all_orders` (Shopify)

**Où et comment (vérifié sur la page des scopes).** Partner Dashboard → Apps → True Cost
Calculator → API access → Access requests → carte « Read all orders scope » → formulaire de
justification. Après approbation : ajouter le scope dans `shopify.app.toml` et dans la
variable `SCOPES` (Vercel), redéployer ; les marchands déjà installés ré-autorisent (le webhook
`app/scopes_update` est en place).

**Usage à déclarer (FR).** L'app calcule des indicateurs qui exigent plus de 60 jours de
commandes : cohortes mensuelles de rachat à M+1/M+3/M+6/M+12, valeur vie client en marge de
contribution, comparaison à l'année précédente, délai de récupération du coût d'acquisition.
Fenêtre : 24 mois glissants. Données lues : commandes, lignes, taxes, remises, remboursements,
retours, expéditions ; identifiant client sans nom, e-mail, téléphone ni adresse. Aucune
revente, aucun partage ; suppression à la désinstallation (webhooks `app/uninstalled`,
`shop/redact`, `customers/redact` déjà implémentés).

**Texte anglais à coller.**

> True Cost Calculator computes profitability and retention metrics that require more than
> 60 days of order history: monthly customer cohorts (repeat-purchase rate at M+1, M+3, M+6,
> M+12), customer lifetime value in contribution margin, year-over-year comparisons, and
> customer-acquisition-cost payback. We read a rolling 24-month window of orders, line items,
> tax lines, discounts, refunds, returns, and fulfillments. We store the customer ID only (no
> name, email, phone, or address). Data is used exclusively to display metrics to the merchant
> who installed the app, is never shared or sold, and is deleted on uninstall and on
> `shop/redact` / `customers/redact` webhooks, which are already implemented.

**À faire toi-même.** Remplir le formulaire ; joindre l'URL de la politique de confidentialité
(à mettre à jour avant : mention de la fenêtre de 24 mois et du modèle d'IA, cf. brief §18).

### B.2 Données clients protégées — niveau 2 (Shopify)

**Pourquoi le niveau 2.** Il est exigé par `shopifyqlQuery` (module Conversion, vérifié :
« Level 2 access to Customer data including name, address, phone, and email fields »), même si
l'app ne stocke aucun de ces champs. Le niveau 1 (commandes, identifiant client) est requis de
toute façon pour les commandes.

**Où et comment (vérifié sur la page « protected customer data »).** Partner Dashboard →
Apps → l'app → API access → « Protected customer data access » → demander l'accès, cocher
les catégories, justifier chaque champ, compléter les « Data protection details », soumettre.
Tant que l'approbation n'est pas accordée, les appels renvoient les données masquées.

**Exigences à remplir — niveau 1 (5 critères, cités de la doc).** « Process only the minimum
personal data required » ; transparence envers les marchands (politique de confidentialité) ;
usage limité aux finalités déclarées ; respect des consentements clients ; chiffrement « at
rest and in transit » (Supabase et Vercel : TLS + chiffrement au repos, à citer).

**Exigences supplémentaires — niveau 2 (citées de la doc).** Sauvegardes chiffrées (Supabase :
à vérifier dans le plan de la base) ; séparation des données de test et de production
(aujourd'hui une seule base Supabase sert au dev store ET à la prod → **un projet Supabase de
test distinct devient nécessaire**, décision à prendre) ; stratégie de prévention des fuites ;
accès du personnel limité (tu es seul : le déclarer, avec 2FA partout) ; mots de passe forts ;
journalisation des accès (Supabase logs + un journal applicatif des lectures ShopifyQL à
prévoir) ; politique de réponse aux incidents (un document d'une page : détection, notification
sous 72 h, révocation des jetons).

**Usage à déclarer (FR).** Commandes et identifiant client (niveau 1) : marges, cohortes,
valeur vie. Sessions agrégées via ShopifyQL (niveau 2 exigé par Shopify) : taux de conversion
par source et appareil. Aucun champ nom/adresse/téléphone/e-mail n'est lu ni stocké ; ShopifyQL
n'est interrogé qu'en agrégats journaliers. Rien n'est envoyé au modèle d'IA hors agrégats.

**Texte anglais à coller (justification par catégorie).**

> Orders and customer ID (Level 1): used to compute contribution margins, monthly cohorts,
> repeat-purchase rates and lifetime value shown to the merchant. We store the customer ID,
> order dates and amounts only.
> Customer name, address, phone, email (Level 2): NOT read and NOT stored. Level 2 is requested
> solely because Shopify requires it to run `shopifyqlQuery` (sessions and conversion-rate
> datasets, aggregated by day, traffic source and device). No personally identifiable field is
> ever queried, stored, or sent to our AI provider (aggregates only).

**À faire toi-même.** Rédiger la politique d'incident (une page) ; décider du projet Supabase
de test (séparation test/prod) ; activer et documenter les sauvegardes chiffrées ; mettre à
jour la politique de confidentialité (IA, 24 mois, données lues) ; remplir le formulaire.

### B.3 Google Ads API (Google)

**Contexte vérifié (pages Google + presse spécialisée, septembre 2026).** Depuis le 10
septembre 2026, le niveau d'accès suit le PROJET Google Cloud utilisé pour les identifiants
OAuth (les jetons développeur sont en fin de vie). Niveaux : Test (comptes de test), Basic
(production, 15 000 opérations/jour), Standard (illimité, sur demande ultérieure). Basic :
« jusqu'à 5 jours ouvrés » officiellement, délais plus longs constatés en 2026 ; le pilote de
**vérification de marque** du projet Cloud ramène l'examen à quelques heures. Un même projet
Cloud servira à Google Ads ET à Search Console (même écran de consentement OAuth).

**Usage à déclarer (FR).** Lecture seule des rapports de dépenses et de performance (campagne,
groupe d'annonces, annonce, jour, pays) pour les afficher au marchand à côté de ses marges ;
aucune modification de campagne, aucune création, aucune enchère. Le marchand connecte son
propre compte par OAuth et peut révoquer à tout moment.

**Texte anglais à coller (résumé d'usage).**

> True Cost Calculator is a Shopify-embedded profitability app. We request read-only access
> to Google Ads reporting (campaign, ad group, ad, daily cost, impressions, clicks,
> conversions, by country) to display advertising spend next to the merchant's contribution
> margin and compute break-even ROAS, CAC and POAS. We do not create, edit, or bid on
> campaigns. Each merchant authorizes their own account via OAuth and can disconnect at any
> time; tokens are encrypted at rest and deleted on disconnect or uninstall.

**À faire toi-même.** (1) Créer ou désigner le projet Google Cloud, activer l'API Google Ads
et l'API Search Console ; (2) configurer l'écran de consentement OAuth (application
externe, politique de confidentialité, page d'accueil, scopes `adwords` et
`webmasters.readonly`) — la vérification Google de l'app OAuth est un second examen,
indépendant, à lancer en parallèle ; (3) faire la vérification de marque du projet Cloud
(accélère) ; (4) depuis un compte administrateur Google Ads (MCC), ouvrir l'API Center et
demander l'accès Basic en liant le projet ; (5) me communiquer le `client_id`/`client_secret`
UNIQUEMENT via les variables d'environnement Vercel (jamais dans un message ni un rapport).
Points à confirmer le jour J (non vérifiés ligne à ligne) : le libellé exact des champs du
formulaire et l'applicabilité des « Required Minimum Functionality » (elles visent les outils de
gestion de campagnes ; une app de reporting seul en est normalement exempte).

Pour Meta et TikTok (accès déjà demandés par toi) : même texte d'usage, adapté (« Marketing
API insights, read-only »).

---

## C. Plan du chantier F1 — modèle de données

Périmètre : le schéma, ses politiques, la purge RGPD, les migrations de données existantes,
un module pur « contrat de schéma », et le lot de tests associé. Aucune UI, aucune sync,
aucun moteur (F2/F3/F4). Rien n'est appliqué sans GO ; les migrations sont écrites
ré-exécutables (pattern `IF NOT EXISTS` / `DROP POLICY IF EXISTS` déjà utilisé).

### C.1 Principes retenus

- Une migration par table ou par groupe cohérent, préfixe daté comme aujourd'hui
  (`YYYYMMDD_nom.sql`), chacune avec `ENABLE ROW LEVEL SECURITY` + politique
  `deny_public_access` + index.
- Montants : `NUMERIC(14,2)` en devise de la boutique (comme les tables existantes) ; taux et
  pourcentages `NUMERIC(8,4)` ; identifiants Shopify en `TEXT` (gid complets, comme
  aujourd'hui).
- `day_local DATE` calculé à l'ingestion dans le fuseau de la boutique, ET `shop_timezone`
  mémorisé dans `shop_settings` (voir arbitrage C.4-e).
- Aucune colonne ajoutée à `order_margins` n'a de `DEFAULT` qui réécrirait un snapshot ; les
  nouvelles colonnes sont nullables jusqu'au backfill (F2).

### C.2 Migrations prévues (ordre d'application)

| # | Migration | Contenu |
|---|---|---|
| 01 | `shop_settings` | Nouvelle table ; copie des colonnes de réglages depuis `shop_plans` (`vat_regime`, `shipping_model`, `default_import_country`, `shopify_fee_pct`, `processor_fee_pct`, `processor_fixed_fee`, `profitability_threshold_pct`, `current_cpa*`) + nouvelles : `return_window_days` (défaut 30), `delivery_promise_days`, `target_margin_after_ads_pct`, `gateway_fee_rules jsonb` (défaut : valeurs courantes, `confirmed=false`), `shop_timezone`, `locale_override`, `b2b_tag`. `shop_plans` garde `plan`/`updated_at` (les anciennes colonnes sont supprimées dans une migration ULTÉRIEURE, après bascule du code — pas en F1). |
| 02 | `orders` | Table des commandes (§3.3-1 du rapport) ; `excluded_reason` en `TEXT` contraint par `CHECK`. |
| 03 | `order_margins` → `order_lines` | `ALTER TABLE … RENAME` + colonnes ajoutées nullables (`unit_price_ht`, `tax_lines`, `is_gift_card`, `cm1_components`, `cm1_unit`, `cm2_alloc`, `breakdown_version`) ; clé unique `(shop_domain, order_id, line_item_id)` INCHANGÉE. Une VUE `order_margins` en lecture seule pendant la transition (le code actuel continue de fonctionner jusqu'à F2). |
| 04 | `refunds` | § 3.3-3 |
| 05 | `returns` | § 3.3-4, `return_reason` contraint aux 10 valeurs de l'enum Shopify + `OTHER` note |
| 06 | `fulfillments` | § 3.3-5 |
| 07 | `order_fees` | § 3.3-6, `source` ∈ {`shopify_payments`, `manual_rule`}, `confirmed boolean` (décision 16) |
| 08 | `inventory_daily` | § 3.3-7 |
| 09 | `sessions_daily` | § 3.3-8 |
| 10 | `ad_spend`, `ad_entities` | § 3.3-9/10 |
| 11 | `seo_daily`, `seo_index_status` | § 3.3-11 |
| 12 | `fx_rates` | § 3.3-12, `source` ∈ {`ecb`, `provider`} (décision 10) |
| 13 | `variant_costs` (extension) | + `supplier_lead_days`, `buffer_days`, `packaging_cost`, `inbound_shipping_unit`, `duty_rate_pct`, `landed_cost_override` (décision 7) ; `product_id` : voir arbitrage C.4-a |
| 14 | `partners`, `promo_code_rules`, `manual_commissions` | décision 2 : `commission_base` ∈ {`ht_after_discount` (défaut), `ht_before_discount`} ; contrainte « un partenaire = codes OU manuel » |
| 15 | `fixed_costs` | § 3.3-16 |
| 16 | `integration_connections` | § 3.3-18, colonnes `*_enc BYTEA` (décision 20) |
| 17 | `order_sync_state` → `sync_jobs` | nouvelle table + migration des lignes existantes (`status`, `bulk_operation_id`, `window_start`) en un job `orders_backfill` ; ancienne table conservée jusqu'à F2 (décision 19 : format « un job = un message ») |
| 18 | `webhook_events` | § 3.3-20 |
| 19 | `daily_rollups`, `product_daily_rollups` | § 3.3-21 |
| 20 | `customers_agg` | § 3.3-22 (`customer_id` gid, aucun champ nominatif) |
| 21 | `product_profitability_state` → `alert_state` | nouvelle table + migration des lignes (`alert_type = 'product_loss'`, `subject_key = product_id`) ; ancienne table conservée jusqu'à I1 |
| 22 | `ai_explanations` | § 3.3-24 |
| 23 | Suppressions (décision 18) | `DROP TABLE calculations, calculation_annotations` ; `margin_alerts` : ses lignes deviennent une `alert_rule` dans `shop_settings.alert_rules jsonb` (voir arbitrage C.4-d) puis `DROP`. Appliquée EN DERNIER et seulement après que le code ne les lit plus (F4) — F1 l'écrit, ne l'applique pas. |
| 24 | RGPD | fonction SQL `purge_shop(shop_domain)` qui vide les 24 tables (une seule source de vérité côté base) + `redact_customer(shop_domain, customer_id)` (`customers_agg` supprimée, `orders.customer_id` mis à NULL). Les deux webhooks appelleront ces fonctions via RPC au lieu de dupliquer la liste. |

Code F1 (hors migrations, aucune UI) : `app/lib/schema.js` (pur : liste des tables, clés,
colonnes « snapshot » immuables — consommé par les tests et la purge), mise à jour de
`webhooks.app.uninstalled.jsx` et `webhooks.compliance.jsx` pour appeler `purge_shop` /
`redact_customer` (comportement identique aujourd'hui, liste étendue), chiffrement
`app/lib/crypto.server.js` (AES-256-GCM, clé `TOKEN_ENCRYPTION_KEY` dans Vercel — à créer par
toi, jamais dans un rapport).

### C.3 Lot de tests prévu — `tests/lot23_schema.mjs` (+ gate complète)

1. Chaque `CREATE TABLE` des migrations est suivi de `ENABLE ROW LEVEL SECURITY` et d'une
   politique `deny_public_access` (scan statique des fichiers SQL).
2. Chaque migration est ré-exécutable (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`) — scan.
3. La liste de tables de `app/lib/schema.js` = ensemble des tables créées par les migrations
   (moins les tables infra explicitement exclues : `session_health`, `rate_limits`,
   `subscription_dunning_state`, `usage`, `shop_plans` — à confirmer, C.4-g).
4. La fonction `purge_shop` cite chaque table de la liste (scan du SQL) ; les deux webhooks
   appellent la RPC et ne contiennent plus de liste en dur (scan du source).
5. `order_lines` : la clé unique historique est présente ; aucune nouvelle colonne n'a de
   `DEFAULT` non nul ; les colonnes « snapshot » listées dans `schema.js` sont exactement celles
   d'aujourd'hui + les composantes CM1 (contrat d'immuabilité).
6. Chiffrement : aller-retour, clé absente → erreur explicite (jamais de stockage en clair),
   texte chiffré différent à chaque appel (IV aléatoire).
7. `redact_customer` : fixture SQL rejouée sur un schéma temporaire ? — non disponible sans
   base de test : remplacé par un scan du SQL + un cas E2E documenté à exécuter APRÈS
   application (lecture seule, sur le dev store), comme la preuve E1 du chantier bulk.

Preuve d'application (après GO) : sortie intégrale de `supabase db push` (ou de l'exécution
SQL), puis lecture seule du catalogue (`information_schema`) montrant les 24 tables avec RLS
activé, dans le rapport du chantier.

### C.4 Points où j'aurai besoin d'un arbitrage (avant d'écrire F1)

- **a. `variant_costs.product_id`** : des lignes créées par import CSV ont `product_id NULL`
  (dette connue). Option 1 : backfill par lecture Shopify (variant → product) dans F1 puis
  `NOT NULL` ; option 2 : rester nullable, correction dans F2 à la première sync. L'option 1
  exige un appel Admin API par boutique dans une migration applicative (pas SQL pur).
- **b. Identifiant client** : stocker le gid brut (nécessaire pour `customers/redact`, qui
  transmet l'id) — recommandé — ou un hachage (rend le redact impossible sans table de
  correspondance). Je recommande le gid brut, niveau 1.
- **c. Pays de livraison** : `country_code` est nécessaire à « par pays » (10.1, 10.9, 10.10).
  Ce n'est pas l'adresse, mais la doc classe « address » en niveau 2 : je propose de le
  déclarer explicitement dans la demande B.2 (« country code only, no street address »).
  À valider avec le texte de la demande.
- **d. Seuils d'alertes** : colonne `alert_rules jsonb` dans `shop_settings` (simple, un seul
  endroit) ou table `alert_rules` (une ligne par type, requêtable par le cron). Je recommande
  la table (le cron filtre par type sans charger tout le JSON).
- **e. Changement de fuseau par le marchand** : `day_local` figé à l'ingestion → les jours
  passés ne bougent pas (recommandé, cohérent avec le snapshot), ou recalcul rétroactif (coût
  et instabilité des rollups). À confirmer.
- **f. Granularité des rollups produits** : produit (recommandé V1) ou variante (× 10 lignes,
  utile pour 10.4 « par variante » qui peut se calculer à la volée sur `order_lines`).
- **g. Tables hors purge RGPD** : je propose d'exclure de `purge_shop` les tables infra
  (`session_health`, `rate_limits`, `usage`, `subscription_dunning_state`, `shop_plans`) —
  mais aujourd'hui elles SONT purgées à la désinstallation. Conserver la purge totale (comme
  aujourd'hui) est plus simple et plus sûr RGPD : c'est ma recommandation, à confirmer.
- **h. Base de test séparée** (exigence niveau 2, B.2) : si tu la crées, F1 s'applique d'abord
  dessus, puis en prod — ordre à définir avec toi le jour du GO.
- **i. Question 11 (langue source)** : tranchée (anglais) — plus rien à arbitrer ici.

Taille F1 : L (24 migrations, un module pur, deux webhooks, le chiffrement, un lot de tests).
Dépendances : aucune. Suivant : F3 (moteur, testable sur les exemples §22 du brief sans
attendre F2).

### C.5 Réponses aux arbitrages C.4 (2026-09-22, troisième message) et GO d'écriture

| # | Décision | Conséquence dans F1 |
|---|---|---|
| a | `variant_costs.product_id` reste nullable ; correction à la première sync (F2) | Aucun appel Shopify dans une migration ; F1 = SQL pur. |
| b | Identifiant client : gid brut, niveau 1 | `orders.customer_id TEXT`, `customers_agg.customer_id TEXT` ; `redact_customer` matche sur le gid transmis par le webhook. |
| c | Pays de livraison : `country_code` seul, à déclarer « country code only, no street address » dans la demande niveau 2 | Colonne `orders.country_code CHAR(2)` ; aucune colonne d'adresse. |
| d | Seuils d'alertes : table `alert_rules` | Migration 21 crée `alert_rules` (une ligne par type) à côté d'`alert_state`. |
| e | Fuseau : `day_local` figé à l'ingestion | `shop_settings.shop_timezone` mémorise le fuseau utilisé ; aucun recalcul rétroactif. |
| f | Rollups par produit en V1, variante à la volée sur `order_lines` ; ajout d'une table par variante plus tard sans toucher au reste | `daily_rollups` et `product_daily_rollups` partagent exactement le même jeu de colonnes de métriques (préfixe commun) ; une future `variant_daily_rollups` = même jeu + `variant_id`. |
| g | Purge totale à la désinstallation, comme aujourd'hui | `purge_shop()` vide TOUTES les tables porteuses de `shop_domain` (y compris infra) ; seule `fx_rates` (référentiel sans boutique) est hors purge. |
| h | Base de test séparée créée par toi ; F1 s'applique d'abord dessus, puis en prod | Voir C.6 pour ce dont j'ai besoin et où le mettre. |

Deux ajustements de séquencement décidés en écrivant F1 (pour ne rien casser en prod le jour
de l'application) :

- **`order_margins` n'est PAS renommée en F1** : le code en production y écrit encore
  (upsert PostgREST), et `ON CONFLICT` n'est pas garanti sur une vue. F1 l'ÉTEND en place
  (colonnes nullables, décision 17) ; le renommage en `order_lines` se fait en F2, avec le code
  qui l'utilise.
- **La migration de suppression (décision 18 : `calculations`, `calculation_annotations`,
  `margin_alerts`) n'est PAS écrite en F1** : `supabase db push` appliquerait tout le dossier,
  et le code actuel lit encore ces tables. Elle sera écrite dans le chantier qui retire ce code
  (F4), avec la mise à jour de `purge_shop`.

### C.6 Base de test — ce dont j'ai besoin (jamais dans le chat, jamais committé)

1. Crée le projet Supabase de test (même région que la prod, `eu-west-1`).
2. Dépose dans un fichier LOCAL `.env.test` à la racine du dépôt (couvert par `.env.*` dans
   `.gitignore` — vérifié) les quatre variables, mêmes noms qu'en prod :
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (clé service_role), `DATABASE_URL` (chaîne « pooler »,
   transaction mode) et `DIRECT_URL` (chaîne directe, pour `prisma migrate deploy` — la table
   `Session` doit exister aussi sur la base de test). Aucune valeur entre guillemets.
3. Génère la clé de chiffrement des jetons : en PowerShell,
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` → variable
   `TOKEN_ENCRYPTION_KEY` dans `.env.test` maintenant, et dans Vercel (Production, « Sensitive »)
   le jour où les intégrations partiront — jamais dans un fichier suivi.
4. Application des migrations : par le CLI déjà utilisé sur ce poste (`supabase link
   --project-ref <ref>` puis `supabase db push`, qui te demandera le mot de passe de la base) ou
   par le SQL Editor du dashboard, fichier par fichier dans l'ordre. Je te fournirai la
   commande exacte au second GO ; je ne lance rien qui écrive.
5. Preuve après application : lecture seule d'`information_schema.tables` +
   `pg_policies` (les 26 nouvelles tables avec RLS et politique, 2 fonctions RGPD), consignée
   au rapport du chantier (`docs/rapports/2026-09-22_f1-modele-de-donnees.md`).

GO d'écriture reçu : migrations F1 + `lot23_schema` + module `schema.js` + chiffrement + webhooks
(fichiers écrits, rien appliqué, rien committé — second GO requis pour appliquer, troisième pour
committer).

---

## D. Arbitrages F3 — moteur économique (2026-09-22)

Rapport de Phase 0 : `docs/rapports/2026-09-22_f3-moteur_phase0.md`.

| # | Décision | Conséquence dans F3 |
|---|---|---|
| A1 | Tout en **TTC** pour ROAS : BE-ROAS = CA TTC ÷ CM2, ROAS cible et POAS sur la même base ; exemple §22 réécrit (119 ÷ 64,17 ≈ **1,85**) | Le MER reste sur CA **HT** (l'exemple « 1 ÷ 0,15 ≈ 6,67 » l'exige, la commission étant sur le HT) — seul écart, documenté. |
| A2 | COGS sur `quantité − unités restockées` via `RefundLineItem.restockType` ; repli `quantité − remboursées` si absent | F2 devra remonter `restockType` ; `line.js` accepte `restocked_qty` nullable. |
| A3 | Règle de port marchand par pays (`shipping_cost_rules`), pré-remplie « = port facturé au client » marquée « à confirmer » | Addendum F1 : colonne JSONB ; `dataGaps.unconfirmed_shipping`. |
| A4 | Emballage par commande (`packaging_cost_per_order`), surcharge optionnelle par variante | Addendum F1 : colonne ; `cout_emballage` variante = surcharge. |
| A5 | Allocation au prorata du CA HT de ligne (D3) | `allocate.js`. |
| A6 | Coûts fixes au niveau boutique seulement ; pas de résultat net par produit en V1 | `net_result` produit = non applicable. |
| A7 | Chaque règle de code présente s'applique ; base = CA HT produits hors port | `aggregate.js`, `commission_base` par règle. |
| A8 | Taux de TVA standard du pays du marchand (table des 27 dans `econ/`), taux réduits FR conservés ; `engine.js` à 0 diff | `vat.js` ; `computeLandedCost(…, vatRate, …)`. |
| A9 | `shop_country_code` rempli depuis `shop.billingAddress.countryCode` à la première sync ; hors UE : pas de taxe d'import dans le modèle V1, le marchand qui ne la récupère pas l'inclut dans `duty_rate_pct` (texte d'aide) | Addendum F1 : colonne ; `line.js` formule générique. |
| A10 | Ventes provisoires comptées partout, retours = 0, `provisional_share` + marquage | `aggregate.js`. |
| A11 | Seuils `minData` acceptés, avec : (1) chaque nœud dit précisément ce qui manque (« encore 12 commandes ») ; (2) une seule table de configuration modifiable sans toucher au moteur | `econ/config.js` (MIN_DATA) + `minData.js`. |
| A12 | Objectif saisi par le marchand (`profitability_threshold_pct`) + bande fixe 40-60 en rappel | `config.js` (BENCHMARKS). |
| A13-A15 | Ouverts, à représenter au chantier concerné (croissance, POAS/attribution, jointure UTM) | V1 du moteur : POAS sur UTM (exact), croissance glissante par défaut — révisables. |
| A16 | Remboursements nettés sur le **jour de la commande** (confirmé) | `aggregate.js`, feuilles par jour. |
| A17 | Heures ouvrées = heures d'horloge des jours **lundi-vendredi**, fuseau boutique (confirmé) | `businessHoursBetween`. |

Implémentation : `docs/rapports/2026-09-22_f3-moteur_implementation.md`. Addendum F1 appliqué
(test puis prod) le 2026-09-22, rollback prouvé sur la base de test.

---

## E. Arbitrages F2 — sync v2 (2026-09-22)

Rapport de Phase 0 : `docs/rapports/2026-09-22_f2-sync_phase0.md`. Implémentation :
`docs/rapports/2026-09-22_f2-sync_implementation.md`.

| # | Décision | Conséquence dans F2 |
|---|---|---|
| B1 | (a) Backfill borné à 60 jours + webhooks ; à l'approbation de `read_all_orders`, création automatique des fenêtres mensuelles manquantes jusqu'à `history_months` (détection par `app/scopes_update`, repli : replanification quotidienne par le cron) | `windows.js` (`backfillPlan`), `jobs.server.js` (`planBackfill`), `webhooks.app.scopes_update.jsx`. `read_all_orders` n'est PAS dans le TOML avant approbation. |
| B2 | (a) `apiVersion` 2026-01 ; `bulkOperation(id:)` et `bulkOperations` ; `currentBulkOperation` supprimé | `shopify.server.js`, `sync/queries.js`. Cohabitation notée : webhooks sérialisés en 2026-07 (`[webhooks].api_version`), requêtes en 2026-01. |
| B3 | (a) Fenêtres mensuelles séquentielles, une op à la fois | `advanceBackfill` : au plus un job `orders_backfill` en cours. |
| B4 | (a) Remboursements par requête paginée ; retours par requête paginée (leurs lignes sont une connexion de profondeur 3, interdite en bulk) ; `Order.fulfillments` dans le bulk avec `deliveredAt` lu directement (les événements ne servent qu'au temps réel) | `pullRefundsForWindow`, `pullReturnsForWindow`, `fulfillmentFromGraphql`. |
| B5 | (c) Traitement en ligne dans le handler + `waitUntil` (`@vercel/functions` ajouté) pour les écritures secondaires ; `include_fields` sur `orders/*` | Routes `webhooks.*.jsx`, `background.server.js`. Un échec d'écriture répond 500 → Shopify réessaie ; l'événement `failed` est retraité. |
| B6 | (a) Hobby : cron quotidien 05:00, 300 s par invocation, ré-invocation signée pour les boutiques restantes ; architecture inchangée pour Pro | `api.cron.sync.jsx`, `vercel.json`. Fluid compute à vérifier (rapport §5). |
| B7 | (a) Double écriture dans `order_margins` : colonnes legacy (`buildHistoryRow`) + colonnes F1 (`computeLineEconomics`), jusqu'à F4 | `normalize.js` (`normalizeOrder`). Seules `refunded_qty`, `effective_qty` sont mises à jour après insertion (`ORDER_MARGINS_MUTABLE_COLUMNS`). |
| B8 | (a) `order_sync_state` toujours alimentée ; `sync_jobs` source de vérité ; suppression en F4 | `bulk.server.js` (`legacyState`). |
| B9 | (a) Réconciliation quotidienne `updated_at` depuis le curseur moins un jour ; re-tirage des attributions non prêtes de moins de 30 jours ; frais Shopify Payments depuis J-7 | `reconcileWindow`, `repullJourneys`, `pullFees`. |
| B10 | (c) Instantané quotidien du stock seul (webhook `inventory_levels/update` non abonné en V1) | `snapshotInventory` (`productVariants`, quantité agrégée). |
| B11 | (a) Dernier écrit gagne, clé `refund_id` ; quantités par ligne recalculées depuis tous les remboursements réglés | `ingestRefunds`. |
| B12 | (a) Remboursement orphelin stocké, rattaché quand le backfill apporte la commande (quantités relues à l'ingestion de la commande) ; (b) vérifié sur la boutique de dev : voir le rapport d'implémentation | `ingestOrders` lit `refunds` avant de figer les lignes. |
| B13 | (a) Tous les scopes en `scopes` | `shopify.app.toml`. |
| B14 | (a) Fuseau figé à la première sync, jamais recalculé | `loadShopContext` ne remplit que les valeurs absentes. |
| B15 | **Nouveau, tranché par le schéma** : `Order.fulfillments` exige un scope de commandes d'exécution ; ajoutés `read_merchant_managed_fulfillment_orders` et `read_third_party_fulfillment_orders` (3PL) en plus de `read_fulfillments` (webhooks) | `shopify.app.toml`. À confirmer par Mathys (sinon retirer `fulfillments` du bulk : l'OTD ne viendrait que des webhooks). |
| B16 | **Nouveau, tranché par le schéma** : `shopifyPaymentsAccount` exige `read_shopify_payments_accounts` (ou `read_shopify_payments`), pas `read_shopify_payments_payouts` | `shopify.app.toml` ; la liste de la décision 21 est corrigée en conséquence. |
| B17 | **Nouveau** : `purchasingEntity { __typename }` seul (B2B détecté sans `read_companies`) ; `purchasing_company_id` reste vide en V1 | `queries.js`, `normalize.js`. |

Variable Vercel `SCOPES` : à aligner sur le TOML au déploiement (R7 : action de Mathys).

### E.1 Données clients protégées — niveau 1 : quoi cocher, quoi coller

Parcours (doc « Work with protected customer data », vérifié le 2026-09-22) : Partner Dashboard →
Apps → True Cost Calculator → **API access requests** → carte **Protected customer data access**
→ **Request access**.

Cases à cocher :

1. **Protected customer data** : OUI (c'est le niveau 1). Motifs proposés par le formulaire :
   cocher **App functionality** (les indicateurs de l'app) et **Analytics** (agrégats par cohorte) ;
   ne pas cocher Marketing, ni Advertising, ni « Sharing with third parties ».
2. **Protected customer fields** (niveau 2) : **ne cocher AUCUN champ** : ni Name, ni Address, ni
   Phone, ni Email. (La demande de niveau 2 pour ShopifyQL, §B.2, est un dossier séparé, à ne
   déposer qu'au chantier Conversion.)
3. **Data protection details** : répondre aux questions du niveau 1 (minimisation, transparence,
   finalités, consentement, chiffrement) ; les cinq réponses courtes sont ci-dessous.

Champs effectivement lus (à citer si le formulaire le demande) : `Order.customer.id`,
`Order.shippingAddress.countryCodeV2` (code pays seul), `Order.customerJourneySummary`
(source de trafic, UTM, rang de commande), webhooks `orders/*` limités par `include_fields` aux
mêmes champs. Aucun nom, e-mail, téléphone, adresse, IP, navigateur ni géolocalisation.

Texte à coller (motif d'usage) :

> True Cost Calculator computes contribution margins and retention metrics for the merchant who
> installed the app. To do so, we process protected customer data at level 1 only: the customer
> ID on each order (to count new versus returning customers, build monthly cohorts, and compute
> lifetime value), the shipping country code (margin by destination country and shipping cost
> rules), and the order's customer journey summary (traffic source and UTM parameters, to
> attribute orders to marketing channels). We do not request, read, or store any name, email,
> phone number, street address, IP address, browser or geolocation data. Webhook payloads are
> restricted with include_fields to the same fields. Data is used exclusively to display
> metrics to the merchant, is never shared or sold, is encrypted in transit (TLS) and at rest
> (Supabase, Vercel), and is deleted on uninstall and on the shop/redact and customers/redact
> webhooks, which are implemented.

## F. Arbitrages F4 — coquille Polaris WC, i18n, Tableau de bord (2026-09-23)

Rapport de Phase 0 : `docs/rapports/2026-09-23_f4-coquille-i18n-dashboard_phase0.md`.
Implémentation F4-A : `docs/rapports/2026-09-23_f4-a_implementation.md`.

| # | Décision | Conséquence dans F4-A |
|---|---|---|
| C1 | (a) React 18.3 pour F4-A et F4-B ; React 19 retranché en Phase 0 de F4-B | Aucun champ Polaris contrôlé : période par liens, bascule par `<Form>` natif. |
| C2 | (a) Canal Polaris actuel (`polaris.js` via `AppProvider` 1.2.0) ; montée de version en F4-B | Aucune dépendance modifiée. |
| C3 | (a) Surcharge > `?locale=` > cookie `tcc_locale` (`SameSite=None; Secure; HttpOnly`) > `Accept-Language` > `en` | `app/lib/i18n/resolveLocale.js`, loader de `app.jsx` ; phrase de politique de confidentialité dans le rapport d'implémentation §5. |
| C4 | (c) Module maison à API compatible i18next, réévalué en F4-C | `app/lib/i18n/t.js` ; catalogues en modules JS (attributs d'import JSON refusés par ESLint 8). |
| C5 | (a) `en` + `fr` en F4-A ; 33 autres en une passe en F4-D ; lint `fr = en` | `app/locales/`, lot 26 §3. |
| C6 | (a) `shop_settings.include_test_orders` + `is_dev_shop` (addendum idempotent + rollback + lot 23), bascule depuis le Tableau de bord, visible si `shop.plan.partnerDevelopment` ; `cancelled`, `gift_card_only`, `b2b` toujours exclues | Migration `20260923_f4_01_dev_shop_settings.sql` (non appliquée), `dashboard.server.js`, `econ/adapters.js`. |
| C7 | (b) Adaptateur pur + `discounts_amount` injecté comme remise de commande ; (c) addendum F2 noté avant l'écran Produits | `econ/adapters.js` (`lineFromOrderMarginsRow`, `applyOrderDiscounts`). |
| C8 | (a) Faits lus au chargement, plafond 5 000 lignes signalé | `DASHBOARD_LINES_CAP`, trou `capped`. |
| C9 | (b) Lint sur tout `app/` sauf liste d'exclusion | lot 26 §4 (77 fichiers scannés). |
| C10 | (a) 4 KPI secondaires sous « Voir plus » sur conteneur étroit ; vérification iPhone | Secondaires = CVR, MER, POAS, LTV/CAC (liste de la décision 14, qui n'inclut pas l'OTD). |
| C11 | (a) `/app/dashboard` nouveau, `/app` inchangé | `app.dashboard.jsx`, `s-link rel="home"` sur `/app`. |

Réponses courtes « Data protection details » (niveau 1) :

> Minimum data: customer ID, country code and journey summary only; no identifying fields.
> Transparency: our privacy policy lists the fields processed and the purpose (profitability and
> retention metrics for the merchant).
> Purpose limitation: data is processed only to compute and display metrics inside the app.
> Consent: we do not market to customers; opt-out decisions are respected because no customer
> is contacted or profiled outside the merchant's own store metrics.
> Encryption: TLS in transit; encrypted at rest on Supabase (Postgres) and Vercel; third-party
> tokens are encrypted with AES-256-GCM before storage.
