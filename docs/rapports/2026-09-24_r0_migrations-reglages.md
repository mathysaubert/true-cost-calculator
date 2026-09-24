# R0 — Migrations Réglages : colonnes S-01, trigger de recopie S-02 (2026-09-24)

Suite de `2026-09-24_reglages-simulateur_phase0.md` ; arbitrages S1-S10 et T1-T7 consignés dans
`2026-09-22_decisions.md` §I (décision 4 amendée : mois glissant de 30 jours). GO R0 reçu le
2026-09-24 : migrations, rollback, lot 23, application test avec preuve du rollback, prod, commit.

## 1. Problème

L'écran classique écrit ses réglages dans `shop_plans` ; la sync v2, le moteur et les insights
lisent `shop_settings`, copiée une seule fois par F1-01. Les deux divergent depuis. En plus,
`main_product_price` est lue par le moteur et la règle `aov_vs_main_price` sans qu'aucune colonne
n'existe, et l'onboarding du PDF demande des champs absents.

## 2. Solution

| Fichier | Contenu |
|---|---|
| `supabase/migrations/20260924_r0_01_settings_columns.sql` | 5 colonnes nullables sans défaut sur `shop_settings` : `main_product_price NUMERIC(14,2)`, `sales_countries`, `shipping_countries`, `supply_countries` (`TEXT[]`), `report_locale TEXT` (S6 : rien de pré-rempli) |
| `supabase/migrations/20260924_r0_02_shop_plans_sync_trigger.sql` | documente idempotemment les 4 colonnes manuelles de `shop_plans` (frais, pays d'import) ; fonction `sync_shop_plans_to_settings()` (plpgsql, `CREATE OR REPLACE`) : upsert vers `shop_settings` des mêmes colonnes que la copie F1-01, `ON CONFLICT … WHERE … IS DISTINCT FROM` (aucune écriture inutile) ; trigger `AFTER INSERT OR UPDATE OF <colonnes de réglage>` sur `shop_plans`, la colonne `plan` (facturation) exclue |
| `supabase/rollback/20260924_r0_rollback.sql` | retire trigger, fonction et les 5 colonnes ; ne retire pas les colonnes manuelles de `shop_plans` (pré-existantes en prod, documenté) ; IF EXISTS partout |
| `tests/lot23_schema.mjs` | §11 (+13 assertions, 160 au total) : 2 fichiers R0, 5 colonnes nullables, aucune donnée touchée, fonction / trigger / colonnes écoutées sans `plan`, upsert avec `IS DISTINCT FROM`, colonnes recopiées = colonnes copiées par F1-01, rollback exact et idempotent |

Pas de boucle : le nouvel écran Réglages (R1) écrira `shop_settings` puis recopiera vers
`shop_plans` ; le trigger relit des valeurs identiques et ne réécrit rien ; aucun trigger sur
`shop_settings`.

## 3. Faits vérifiés (§5 de la Phase 0)

1. **Formulaires Polaris.** Doc Shopify (`s-text-field`, `s-select`, lue le 2026-09-24) : `name` est
   « used to identify the field's value when the form is submitted » ; `s-option` : « the value
   submitted with the form ». La participation aux formulaires natifs est donc documentée ; la
   preuve finale (FormData reçu par l'action) se fera au premier clic sur la boutique de dev (S3,
   repli champs HTML sinon).
2. **Passerelles stockées.** `orders.gateway_names TEXT[]` (F1-02) est alimenté par la sync v2
   depuis `paymentGatewayNames` (webhook et GraphQL) : R1 peut lister les passerelles vues.
3. **Taille des feuilles pour le client.** 38 feuilles + 67 nœuds + compteurs par période :
   2,3 à 2,6 Ko en JSON sur les trois fixtures ; le Simulateur peut charger cinq périodes sans
   peser (T3).
4. **Horizon.** Décision 4 amendée : mois glissant de 30 jours, cohérent avec `impactRange`
   (× 30 / jours de la période) ; période choisie en bascule (T4).

## 4. Preuves

| Étape | Cible | Résultat |
|---|---|---|
| lot 23 | local | 160 assertions vertes ; lint 0 erreur ; 28 lots verts ; fichiers protégés 0 diff |
| Application R0-01, R0-02 | test (`eu-central-1`) | 2 fichiers OK |
| `verify_r0.mjs present e2e` | test | 15 / 15 : colonnes conformes, fonction et trigger présents sans `plan`, aucune ligne pré-remplie ; boutique fictive : insert `shop_plans` → `shop_settings` créée (TVA, frais, seuil), changement d'offre seul → intacte, même valeur → aucune écriture, frais fixe et CPA → recopiés, `main_product_price` conservé, nettoyage |
| Rollback R0 → `absent` | test | 6 / 6 |
| Réapplication → `present e2e` | test | 15 / 15 |
| Application R0 (filtre `20260924_r0_*`) | prod (`eu-west-1`) | 2 fichiers OK |
| `verify_r0.mjs present` | prod | 9 / 9 ; aucune ligne pré-remplie |

Aucune donnée existante modifiée à l'application : le trigger n'agit qu'aux prochaines écritures
de l'écran classique. Aucune URL ni clé affichée.

## 5. Ce qui reste

R1 (Réglages socle) sur GO d'écriture : routes `/app/settings`, `/app/settings/costs`,
`/app/settings/goals`, écriture `shop_settings` + recopie `shop_plans`, `data_fixed` explicite
(S10), `thresholds()` alimenté par `fixed_costs`, nav Réglages « live ».
