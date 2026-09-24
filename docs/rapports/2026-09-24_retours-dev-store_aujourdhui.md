# Retours boutique de dev sur « Aujourd'hui » : diagnostic et correctifs (2026-09-24)

Contexte : 15 commandes de test créées selon le §6 du rapport I0-A (4 produits, Poster sans coût,
Cap à perte, commande 15 avec TEST20 remboursée) ; « Aujourd'hui » rend les 3 priorités et
l'opportunité. Trois retours, diagnostic en lecture seule sur les données réelles, puis correctifs
(GO du 2026-09-24).

## 1. Sous-ligne du CA net : 720 remboursés sur 1 605 vendus, valeur 855

**Diagnostic au centime** (script scratchpad `diag_ca.mjs`, lecture seule, prod, boutique de dev,
17 commandes brouillon sur 30 jours dont #1022 de la veille) :

| Source | Montant |
|---|---|
| Σ `unit_price_ht × quantité` sur les 18 lignes `order_margins` (prix APRÈS remise : #1038 = 48 + 72) | 1 575,00 |
| Σ `orders.ca_ht` et Σ `orders.total_ttc` | 1 575,00 |
| Σ `orders.discounts_amount` (#1038, TEST20) | 30,00 |
| Σ `refunds.total_refunded` (#1022 : 600 ; #1038 : 120 = 72 + 48) | 720,00 |
| Σ `unit_price_ht × quantité effective` | 855,00 |

Le moteur construit `ca_brut` par ligne à partir du prix unitaire après remise (1 575), puis
`applyOrderDiscounts` ajoute la remise de commande à `ca_brut` ET à `remises` (1 605 / 30) :
`ca_net = 1 605 − 30 − 720 = 855`. **La remise n'est pas déduite deux fois et 855 est le bon CA
net.** Le défaut était dans la sous-ligne : « vendus » affichait `ca_brut` **avant remises**
(1 605), donc vendus − remboursés ≠ CA net.

**Correctif** : « vendus » = CA brut après remises (`ca_brut − remises`, 1 575), et quand une
remise existe la sous-ligne le dit : « 720 $ remboursés sur 1 575 $ vendus après 30 $ de remises »
(clé `overview.tile.refunds_discounts`, tuile et bloc Résultats). 1 575 − 720 = 855.

## 2. CTA « Ouvrir Profit » / « Ouvrir Produits » vers des sections « Bientôt »

**Diagnostic** : le CTA `open_section` ouvrait la modale quand la section n'était pas livrée, avec
un libellé qui promettait une page. **Correctif** (`Analysis.jsx`) : section livrée → lien vers sa
route ; sinon lien de repli « Voir les indicateurs » vers `/app/metrics?days=N`
(`cta.fallback_metrics`, attribut `data-fallback="metrics"`). Aucun CTA ne mène plus à une section
« Bientôt ».

## 3. Fourchettes négatives illisibles

**Diagnostic** : la fourchette est `point × (1 ± u)` avec `u` = demi-largeur par score de fiabilité
(10 / 20 / 35 %) + par niveau (0 / 5 / 15 / 10 %). Sur la boutique de dev le score est bas (coûts
manquants sur Poster, frais et port non confirmés, pas de coûts fixes) et le sujet 1 est « À
vérifier » : `u = 35 % + 15 % = 50 %`, d'où −959,63 à −319,88 autour de −639,75.

**Correctifs** :

- Une perte s'écrit en valeurs absolues croissantes : en-tête « Toutes choses égales par
  ailleurs, entre 320 $ et 960 $ de contribution perdue » (`impact.everything_equal_loss`,
  en/fr) ; le rendu (`render.js`) inverse et met en valeur absolue `low` / `high` dès que la
  fourchette est négative, et les gabarits d'impact des règles de perte sont rédigés en « entre …
  et … perdus » (cm2_drop, refund_pressure, product_concentration, product_loss, cac_above_be,
  roas_below_be, stock_reorder, en/fr).
- « Pourquoi cette conclusion ? » explique la largeur : « Fourchette de ± 50 % autour de
  l'estimation : ± 35 % pour un score de fiabilité de 30 sur 100, et ± 15 % pour le niveau
  « À vérifier ». Compléter les données la resserre. » (`impact.js` renvoie les parts,
  `analysis.range_why`).

## 4. Preuves

Gate complète verte : lint 0 erreur (613 avertissements `prop-types`), 30 lots verts, 94 rendus
réels (cm2_drop : en-tête « entre 170,50 € et 208,39 € de contribution perdue », aucun signe moins
dans l'en-tête, phrase d'impact en perte, explication « ± 10 % … score 100 … Confirmé », CTA de
repli vers `/app/metrics?days=30`, plus aucun « Ouvrir Profit »), build OK, fichiers protégés
0 diff (`econ/aggregate.js` et `adapters.js` intouchés : le calcul était juste).

À revoir sur la boutique de dev après déploiement : tuile CA net « 720 $ remboursés sur 1 575 $
vendus après 30 $ de remises » avec 855 $ ; les trois priorités sans CTA « Ouvrir … » vers une
section absente ; l'en-tête du sujet 1 en « entre … et … de contribution perdue » et l'explication
de la fourchette dans sa modale.
