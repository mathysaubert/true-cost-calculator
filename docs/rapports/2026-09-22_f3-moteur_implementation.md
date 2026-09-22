# F3 — Moteur économique CM1/CM2/CM3 : implémentation (2026-09-22)

Suite de `docs/rapports/2026-09-22_f3-moteur_phase0.md` et des arbitrages A1-A12 consignés
dans `docs/rapports/2026-09-22_decisions.md` (section D).

Statut : module écrit et prouvé localement ; **addendum F1 appliqué sur la base de test puis en
prod le 2026-09-22 (GO reçus), rollback prouvé sur la base de test** (section 4.1). A16 et A17
confirmés par Mathys.

## 1. Problème

Le pivot (brief fin septembre 2026) exige un moteur pur qui calcule CM1, CM2, CM3 et résultat
net, les seuils (BE-ROAS, ROAS cible, BE-CAC, point mort), les modules marketing, conversion,
clients, retours, expédition et stock, et un simulateur déterministe. L'existant (`engine.js`,
`orderHistory.js`, `roas.js`) ne couvre que le coût rendu, la marge unitaire et le ROAS ; il
n'a ni graphe de nœuds, ni allocation par ligne, ni seuils de données minimales, ni simulation.

## 2. Cause

Aucune couche intermédiaire entre l'ingestion des commandes et l'affichage : chaque écran
recalcule ses propres chiffres avec ses propres conventions (BE-ROAS HT dans le brief, TTC
dans `roas.js`, TVA française codée en dur dans `engine.js`).

## 3. Solution : module `app/lib/econ/` (pur, sans I/O, sans React)

| Fichier | Lignes | Rôle |
|---|---|---|
| `config.js` | 73 | Table unique `MIN_DATA` (28 nœuds, A11), `BENCHMARKS` (A12), `EU_VAT_STANDARD` (27 taux), `FR_REDUCED_VAT_BY_CATEGORY`, `PLATFORM_UTM_SOURCES`, fenêtre retours 30 j, surstock 60 j |
| `vat.js` | 14 | `isEuCountry`, `vatRateFor({ countryCode, categorie })` (A8) |
| `line.js` | 109 | Snapshot par ligne : prix HT/TTC, unités comptées (A2 avec repli), coût rendu (override, TARIC via `computeLandedCost`, formule générique hors UE A9), CM1 unitaire |
| `allocate.js` | 27 | Prorata du CA HT de ligne pour paiement, port marchand et emballage (A4, A5, D3) |
| `nodes.js` | 94 | Catalogue déclaratif : 33 nœuds, feuilles typées, ordre topologique, `evaluate` avec propagation du null |
| `minData.js` | 26 | `gate(nodeId, value, counts)` : `ok`, `insufficient` (avec `missing` chiffré) ou `unknown` |
| `thresholds.js` | 29 | BE-ROAS TTC, ROAS cible, BE-CAC, payback, point mort sur CM3 et sur CM2 avec marketing |
| `simulate.js` | 77 | Leviers (prix, COGS, panier, conversion, fréquence, retours, CAC) à volume constant, `simulate` avant/après/delta, `findThreshold` par bissection |
| `aggregate.js` | 370 | Coûts de commande (A3), commissions par code (A7), coûts fixes proratisés, agrégation par boutique/jour/produit/canal/pays/code, modules, `dataGaps`, `counts` |
| `index.js` | 12 | Ré-exports |

Règles respectées :

- `app/lib/engine.js` : **0 diff** (R2). Seuls `computeLandedCost` et `CUSTOMS_RATES` sont
  importés, avec `vatRate` passé en paramètre depuis la table UE.
- Aucune chaîne rendue, aucun composant touché (R5).
- Invariants repris du lot 7 : arrondi au centime par ligne, devise unique (`MIXED` jamais
  sommé), lignes à coût inconnu exclues des marges et comptées à part, commandes distinctes.

Conventions adoptées dans `aggregate.js`, **confirmées par Mathys le 2026-09-22** :

| # | Convention | Alternative |
|---|---|---|
| A16 | Remboursements nettés sur le **jour de la commande** (cohérent avec le snapshot par ligne) | Netter sur le jour du remboursement (nécessite `processed_at` du refund dans les feuilles par jour) |
| A17 | Heures ouvrées = heures d'horloge des jours **lundi-vendredi** dans le fuseau boutique (délai de traitement) | Plage 9 h-18 h seulement |

## 4. Addendum F1 (migration écrite, NON appliquée)

`supabase/migrations/20260922_f1_24_addendum_f3.sql` : quatre colonnes idempotentes sur
`shop_settings` : `shipping_cost_rules` (JSONB, défaut `{}`), `packaging_cost_per_order`,
`return_cost_per_return`, `shop_country_code`. Nullables ou défaut neutre, rien recalculé.

Rollback : `supabase/rollback/20260922_f1_rollback.sql` retire ces 4 colonnes en étape 0
(avant les fonctions et les tables). `shop_plans.shipping_model` reste l'exception documentée.

`tests/lot23_schema.mjs` attend désormais 24 fichiers F1 et vérifie que l'addendum ne touche
que `shop_settings` et que le rollback retire bien les 4 colonnes.

### 4.1 Application et preuve du rollback (2026-09-22, GO reçus)

Outils : mêmes scripts scratchpad que F1 (application fichier par fichier via
`prisma db execute`, URLs masquées, vérification en lecture seule dans un shell frais), plus un
script de vérification des 4 colonnes (type, nullabilité, défaut, précision, valeurs neutres sur
les lignes existantes).

| Étape | Base | Résultat |
|---|---|---|
| 1. Application de l'addendum seul | test (eu-central-1) | 1/1 OK ; 4 colonnes conformes ; 0 ligne |
| 2. Rollback mis à jour (étape 0 puis F1 complet) | test | OK ; absence F1 complète (10 contrôles) ; 4 colonnes absentes, table supprimée par le rollback complet (attendu) |
| 3. Réapplication des 24 fichiers F1 | test | 24/24 OK ; schéma conforme au contrat (38 tables, RLS, fonctions) ; 4 colonnes conformes |
| 4. Application de l'addendum seul, filtre `20260922_f1_24*` | **prod (eu-west-1)** | 1/1 OK ; 4 colonnes conformes ; 4 lignes shop_settings toutes aux valeurs neutres ; schéma conforme (40 tables, copies 4/4 et 3/3) |

Rien recalculé, aucune donnée modifiée : les colonnes sont nullables ou à défaut `{}`.

## 5. Preuves

### 5.1 Gate complet (R4), exécuté après la correction eslint

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 345 warnings (politique inchangée, aucun nouveau warning ne vient de `econ/`) |
| `npm test` | 24 lots, tous « Tous les tests passent » (lot 1 à lot 24) |
| `node scripts/render_check.mjs` | « Tous les rendus réels OK » (aucune surface touchée ; preuve de non-régression) |
| `npm run build` | client et serveur construits sans erreur |

Correction faite avant ce passage : trois no-op laissés en fin d'écriture (`cb.commissions =
cb.commissions` dans `aggregate.js`, variable `overridden` dans `allocate.js`, import
`LEAF_INPUTS` dans `simulate.js`) supprimés. Aucune logique changée.

### 5.2 Lot 24 (`tests/lot24_econ.mjs`, 259 lignes, 94 assertions vertes)

- Exemples chiffrés du brief §22 reproduits à l'identique : CM2 64,17 ; BE-ROAS TTC 1,854 ;
  commission 14,88 sur 357,12 ; CAC 14,88 ; BE-CAC 64,17 ; LTV/CAC 4,31 ; MER 6,67 ;
  CM1/CM2/CM3 60/48/30 ; BE-ROAS 2,083 ; ROAS cible 3,571 ; contribution 35/10 ; payback 4 ;
  couverture stock 30 j ; point de commande 300.
- `line.js` : UE (16,80), franchise 150 (20,16), Allemagne 19 %, hors UE formule générique
  (16,50), override de coût, carte cadeau exclue, coût manquant.
- Agrégation sur une fixture d'août 2026 (4 commandes : Facebook FR avec code, Google DE avec
  remboursement restocké, provisoire à coût manquant, commande test exclue) : CA HT 175, CA
  connu 150, CM2 63, CM3 18, résultat net -292, BE-ROAS 180/63, ROAS cible 1/0,15, MER 175/45,
  POAS 2,1, CAC global/payant/partenaires 22,5/15/15, BE-CAC 31,5, part provisoire 25/175,
  Σ produits = boutique, coût des retours 4 (CM2 59), conversion 10/5/40/2 %, retours 50 %,
  livraison à l'heure 50 %, 18 heures ouvrées, surstock 4 800, cohorte M+1 50 %.
- Allocation (prorata, CA null, Σ = 0, surcharge emballage), seuils (statuts ok/unreachable/
  unknown), `minData` (message « il manque N »), graphe (cycle et entrée inconnue rejetés),
  simulateur (levier conversion, seuil trouvé à 4/3), scan statique : aucun import d'engine.js
  hors `computeLandedCost` et `CUSTOMS_RATES`.

### 5.3 Périmètre du diff (R6)

Fichiers suivis modifiés : `docs/rapports/2026-09-22_decisions.md` (+24, section D),
`package.json` (+1/-1, lot 24 dans la chaîne de tests), `supabase/rollback/20260922_f1_rollback.sql`
(+9), `tests/lot23_schema.mjs` (+5/-1). Nouveaux : `app/lib/econ/` (10 fichiers),
`tests/lot24_econ.mjs`, `supabase/migrations/20260922_f1_24_addendum_f3.sql`, les deux
rapports F3. `app/lib/engine.js` : 0 diff. Aucun composant, aucune route, aucune chaîne.

Fichier parasite constaté à la racine, non suivi et hors chantier : `docsPHASE0_AUDIT_SUIVI.md`
(narration d'une exploration antérieure écrite au mauvais chemin). Supprimé le 2026-09-22 sur
demande de Mathys.

## 6. Ce qui reste

1. Commit unique + push (GO reçu) : module, lot 24, addendum, rollback, lot 23, `package.json`,
   décisions, deux rapports F3. Statut Vercel lu via l'API GitHub des déploiements, sans session
   Vercel.
2. A13-A15 restent ouverts pour leurs chantiers.
3. F2 (sync v2) devra fournir les feuilles que le moteur attend : `restockType` des
   remboursements, frais Shopify Payments, retours, fulfillments, UTM, sessions, coûts fixes,
   règles de commission par code, `shop.billingAddress.countryCode`.
