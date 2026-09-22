# Phase 0 — F3 : moteur économique CM1 / CM2 / CM3 / résultat

Date : 2026-09-22. Lecture seule, aucune ligne de code. Fait suite à F1 (schéma appliqué en
prod, `46c39ee`). Ce rapport définit le périmètre, le contrat du module, le graphe, la
réutilisation de l'existant, le lot de tests, et surtout les arbitrages nécessaires — chacun
en options avec implications, conformément au principe 9 du brief. Aucune règle de calcul
absente du brief n'est décidée ici : elle est posée en question.

---

## 1. Périmètre de F3

**Dans F3** — un module PUR `app/lib/econ/` (aucun I/O, aucun React, comme `engine.js`) :

1. Le **calcul par ligne de commande à l'ingestion** (`computeLineEconomics`) : CA HT depuis
   les lignes de taxe, coût produit rendu (UE via `engine.js`, hors UE via la formule générique
   ou le coût rendu saisi — décision 7), composantes CM1 figées ; c'est F2 qui l'appelle, mais
   la formule vit ici.
2. L'**allocation par commande** (`allocateOrderCosts`) : frais de paiement réels ou règle par
   passerelle, port marchand, emballage → `cm2_alloc` par ligne.
3. L'**agrégation à la lecture** (`aggregate`) : nœuds du graphe par boutique, produit, jour,
   canal, pays, code promo, cohorte — avec remboursements, retours, pub, commissions, coûts
   fixes, sessions, stock ; ventes provisoires ; trous de données comptés, jamais mis à zéro.
4. Les **seuils** (`thresholds`) : BE-ROAS, ROAS cible, BE-CAC, récupération du CAC, seuil de
   rentabilité (deux versions, décision 5).
5. Le **catalogue des nœuds** (`nodes`) : pour chaque nœud, formule, entrées, unité, repère du
   brief, seuil `minData`, clé i18n — la source unique que consommeront écrans, règles,
   alertes, IA.
6. Le **simulateur** (`simulate`) : ré-évaluation du graphe avec entrées surchargées,
   avant/après, recherche de seuil, hypothèses affichées.
7. Les **garde-fous de données** (`dataGaps`, `minData`) : coûts manquants, frais non
   confirmés, connexions absentes, historique insuffisant (« encore N commandes »).

**Hors F3** : l'ingestion Shopify et les webhooks (F2), les règles/leviers/alertes/IA (I1),
tout écran (F4+), les intégrations pub/SEO (X). F3 se teste entièrement sur fixtures, dont
les exemples chiffrés §22 du brief, avant qu'une seule commande réelle ne le traverse.

## 2. Réutilisation de l'existant (lecture faite fichier par fichier)

| Existant | Sort dans F3 |
|---|---|
| `engine.js` — `computeLandedCost(prixAchat, shipping, customsRate, vatRate, vatRegime, shippingModel, qty, now)` → `{ droitsDouane, tvaImport, tvaNetCost, coutRendu }`, `getCustomsDuty` (forfait UE dropshipping 3 € / réforme 01-07-2026), `CUSTOMS_RATES`, `SHIPPING_ESTIMATES` | **Appelé tel quel** pour l'import UE : c'est exactement le primitif « coût produit rendu ». `vatRate` est un PARAMÈTRE → F3 peut passer le bon taux sans modifier le fichier (arbitrage A8). 0 diff (R2). |
| `engine.js` — `computeMargin`, `calcNetMargin`, `simulateSellingPrice`, `computeScenarios`, `VAT_RATES` (taux FRANÇAIS), `PAYMENT_PROCESSORS` | Non utilisés par F3 (la pile CM remplace `margeNette`). Restent pour l'ancien calculateur jusqu'à F4. |
| `orderIngest.js` — `netUnitRevenue` (D1 : `shopMoney`, jamais presentment), `effectiveRefundedQty` (D4 : refund settled = transaction REFUND SUCCESS), `allocateOrderFixedFee` (D3 : prorata du CA de ligne) | Patterns repris dans `econ/line.js` et `econ/allocate.js` avec les nouveaux champs ; D1 et D4 conservés à l'identique, D3 généralisé (A5). |
| `orderHistory.js` — arrondi au centime PAR LIGNE avant sommation (Σ produits = total exactement), exclusion des lignes `missing` avec compteur, devise `MIXED` jamais sommée, `costCompletion`, `computeCostReliability` (X % du CA sur coûts confirmés) | Invariants repris tels quels dans `econ/aggregate.js` (lot 7 les protège déjà ; lot 24 les rejouera sur la nouvelle structure). |
| `cpaTargets.js` — `availableForAds = marge − seuil×CA`, `BLENDED_MIN_ORDERS = 30`, `CPA_STALE_DAYS = 30`, machine à 5 états par produit | Devient `thresholds.beCac` (BE-CAC = CM2 de la première commande, brief 10.3) et les états « acquisition impossible » ; 30 commandes = précédent pour `minData` (A11). |
| `roas.js` — convention BE-ROAS « numérateur TTC (pixel) / marge HT », fourchettes ROAS par plateforme, verdict atteignable/tendu/difficile | La convention CONTREDIT l'exemple §22 du brief → arbitrage A1 (bloquant). Fourchettes et verdict repris comme métadonnées de repère du nœud BE-ROAS. |
| `auditClassify.js` — winner/risky/loser selon `profitability_threshold_pct` | Devient la classification de la matrice Produits (10.4), même seuil que les alertes. |
| `profitabilityAlert.js` — « sous le seuil ⟺ net_margin < (T/100) × net_revenue » (comparaison de sommes, jamais de division) | Règle conservée pour tout nœud « sous repère » (évite les /0 sur CA nul). |
| `variantCosts.js`, `customsClassification.js` | Fournissent les intrants (coûts saisis, statut de classification figé) ; inchangés. |

## 3. Le graphe : nœuds, formules, entrées, repères

Conventions communes (brief §9 + décisions) : devise boutique (`shopMoney`) ; agrégation
journalière sur `day_local` (fuseau boutique, figé) ; exclusions (`excluded_reason` non nul)
hors de TOUS les nœuds ; port client dans le CA brut (d1) ; remboursements et frais de
retour dans CM2 (d) ; pub et commissions jamais dans CM2 ; taxes retirées via `taxLines`.

### 3.1 Revenus et commandes (10.1)

| Nœud | Formule | Niveau | Repère / minData proposé |
|---|---|---|---|
| `ca_brut` | Σ (prix unitaire d'origine × quantité) + port facturé au client | boutique, produit, canal, pays, jour | — |
| `remises` | Σ allocations de remise (lignes + commande) | idem | — |
| `rembours` | Σ `refunds.total_refunded` (settled) sur la période | idem | — |
| `ca_net` | `ca_brut − remises − rembours` | idem | — |
| `ca_ht` | `ca_net − taxes` (lignes de taxe, `taxesIncluded` respecté ; remboursements nettés de leurs taxes) | idem | — |
| `orders`, `units`, `aov` (= `ca_ht / orders`), `items_per_order`, `avg_unit_price` | définitions du brief | idem | AOV : repère +10/+20/+30-50 % vs prix du produit principal ; minData ≥ 10 commandes |
| `growth_wow / mom / yoy` | vs période précédente | boutique, produit | minData : période précédente complète (A15) |

### 3.2 Marges (10.2)

| Nœud | Formule |
|---|---|
| `cogs` (coût produit rendu) | Σ lignes : `cm1_components` figées × unités comptées (A2) ; NULL (pas 0) si une ligne a un coût manquant → compteur `unknown_cost_lines` |
| `cm1` | `ca_ht − cogs` |
| `shipping_cost` | port marchand (A3) |
| `packaging_cost` | emballage (A4) |
| `payment_fees` | `order_fees.fee_amount` (réels) ou règle par passerelle marquée « à confirmer » (d16) |
| `returns_cost` | remboursements déjà dans `ca_net` ; ici : frais de retour saisis (A2) |
| `cm2`, `cm2_pct` (= `cm2 / ca_ht`), `cm2_per_order` | `cm1 − shipping − packaging − payment − returns_cost` ; repère 40-60 % (A12) |
| `ad_spend`, `commissions` | `ad_spend.spend_shop_currency` ; commissions par code (A7) + manuelles |
| `cm3` | `cm2 − ad_spend − commissions` |
| `fixed_costs` | mensuel × jours de la période / jours du mois (A6) |
| `net_result`, `net_margin_pct` | `cm3 − fixed_costs` ; `/ ca_ht` |
| `provisional_share` | part du CA HT des commandes encore dans le délai de retour (A10) |

### 3.3 Seuils (10.3)

| Nœud | Formule (brief) | Note |
|---|---|---|
| `be_roas` | `1 / cm2_pct` | base HT ou TTC : **A1** |
| `target_roas` | `1 / (cm2_pct − target_margin_after_ads_pct)` | `shop_settings.target_margin_after_ads_pct` ; indéfini si dénominateur ≤ 0 |
| `be_cac` | CM2 moyen des PREMIÈRES commandes (`customer_order_index = 1`) | minData A11 |
| `cac_payback_months` | `cac / contribution_mensuelle_moyenne_par_client` | exige cohortes (Hist.) |
| `breakeven_orders`, `breakeven_revenue` | version A : `fixed_costs / cm3_per_order` ; version B : `(fixed_costs + marketing) / cm2_per_order` ; CA = idem / marge % | les deux étiquetées (d5) ; « non atteignable » si contribution ≤ 0 |

### 3.4 Marketing, codes, conversion, clients, retours, expédition, stock, SEO

Nœuds définis à l'identique du brief (10.5 → 10.12) ; les formules qui exigent un arbitrage
sont renvoyées à la section 5 : attribution prudente et POAS (A14), MER = `ca_total /
(ad_spend + commissions)` (repère ≥ 3), CAC global/payant/partenaires/canal, concentration ;
commissions par code (A7) ; entonnoir sessions → ATC → checkout → achat (repères 5-10 %,
3-6 %, 1,5-3 %) ; cohortes M+1/3/6/12, fréquence, délai 2e achat, LTV CM2 6-12 mois,
LTV/CAC ≥ 3 ; taux de retour/remboursement/coût, motifs (repères < 5 %, < 1 % défectueux…) ;
délai d'expédition en jours ouvrés lun-ven (d15), OTD ≥ 95 % ou « indisponible » ;
couverture = stock / ventes par jour, point de commande = ventes/jour × (délai + tampon),
CA perdu = ventes/jour × jours de rupture × prix moyen, repère 30-60 jours ; SEO : CTR,
position, entonnoir organique.

### 3.5 Implémentation du graphe

Un `nodeCatalog` déclaratif : `{ id, inputs: [ids], compute(values, settings), unit,
level, benchmark, minData, i18nKey }`. `evaluate(catalog, inputs, settings)` fait un tri
topologique (test d'acyclicité) et calcule une fois ; `simulate` ré-évalue avec des
`overrides` sur des nœuds d'ENTRÉE (prix, coûts, panier, conversion, CAC, retours, fréquence)
et renvoie avant/après par nœud + la liste des hypothèses (volume constant, décision 4).
Chaque nœud renvoie soit une valeur, soit `{ status: "insufficient", need: {…} }`, soit
`{ status: "unknown", gaps: […] }` (coût manquant / connexion absente) — jamais 0 par défaut.

## 4. Contrat du module (signatures, sans code)

- `computeLineEconomics({ line, order, costRow, settings, now }) → { unit_price_ht, tax_lines,
  cm1_components: { achat, port_entrant, droits, tva_import_non_recup }, cm1_unit,
  cost_source, customs_estimated, is_gift_card }` — pur, appelé par F2 à l'ingestion ; snapshot
  figé (ne change jamais).
- `allocateOrderCosts({ lines, order, fees, settings }) → cm2_alloc par ligne` — prorata (A5).
- `aggregate({ orders, lines, refunds, returns, fulfillments, fees, adSpend, adEntities,
  codeRules, manualCommissions, fixedCosts, sessions, inventory, settings, window, now }) →
  { shop, byProduct, byDay, byChannel, byCountry, byCode, byCohort, dataGaps }`.
- `thresholds(shopNodes, settings) → { be_roas, target_roas, be_cac, cac_payback_months,
  breakeven: { onCm3, onCm2WithMarketing } }`.
- `simulate({ base, overrides, settings }) → { before, after, delta, assumptions, thresholds }`.
- `nodeCatalog`, `evaluate`, `minDataFor(nodeId, counts)`.

Tout est déterministe (`now` injecté), sérialisable (V3 : scénarios sauvegardés).

## 5. Arbitrages nécessaires (options et implications)

Bloquants pour écrire F3 : A1 → A12. Reportables (modules Marketing/UI) : A13 → A15.

**A1 — Base du BE-ROAS / ROAS cible / ROAS réel : HT ou TTC ?**
Contradiction à trancher : l'exemple §22 calcule `BE-ROAS = 1/CM2 % = 1/0,647 ≈ 1,55` avec
CM2 % sur le CA **HT** (64,17/99,17) ; `roas.js` existant documente un numérateur **TTC**
(« valeur de conversion remontée par le pixel = prix TTC ») ; les plateformes pub affichent
un ROAS sur revenu TTC (souvent port inclus). Comparer un ROAS plateforme TTC à un BE-ROAS HT
fait croire à tort que l'on est au-dessus du seuil (1,70 TTC = 1,42 HT < 1,55).
(a) Tout en HT : BE-ROAS = 1/CM2 % HT (exemple du brief conservé) ; le CA attribué par les
plateformes est converti en HT (÷ (1 + taux de TVA effectif de la boutique sur la période)) avant
comparaison — exact côté Shopify (UTM), approché côté plateformes.
(b) Tout en TTC : BE-ROAS = CA TTC / CM2 (exemple : 119/64,17 = 1,85), directement comparable au
ROAS plateforme ; l'exemple §22 est réécrit (1,85 au lieu de 1,55).
(c) Les deux affichés (« seuil pixel » TTC et « seuil comptable » HT).
Implication commune : POAS et ROAS cible suivent la même base. Recommandation : (b) — c'est
le chiffre que le marchand compare à son gestionnaire de pub ; (a) si tu tiens à l'exemple
du brief tel quel.

**A2 — Coût produit et unités remboursées.**
(a) Actuel (D4) : COGS sur `effective_qty = quantité − remboursées` ; le remboursement neutralise
la vente ET son coût (hypothèse : l'unité revient en stock) ; `returns_cost` = frais de retour
saisis seulement. Simple, déjà testé, mais faux quand l'unité remboursée n'est pas restockée
(perdue, gardée par le client : le coût est bien perdu).
(b) Brief littéral : COGS sur toutes les unités vendues, remboursements déduits en CM2 ; faux
dans l'autre sens (unité restockée comptée comme perdue).
(c) Exact : `RefundLineItem.restockType` (RETURN / CANCEL = restockée, NO_RESTOCK = perdue) →
COGS sur `quantité − restockées` ; remboursements dans `ca_net` ; frais de retour saisis dans
`returns_cost`. Exige `restockType` dans la requête bulk et le webhook (F2, un champ de plus).
Recommandation : (c), avec repli (a) quand `restockType` est absent.

**A3 — Port payé par le marchand (absent de Shopify).**
Le coût réel des étiquettes n'est pas exposé par l'Admin API. (a) Règle par pays/zone saisie
dans Réglages (`shipping_cost_rules` : pays → coût par commande, défaut) — exige un ajout au
schéma F1 (colonne JSONB sur `shop_settings` ou table dédiée). (b) Hypothèse « = port facturé
au client », marquée « estimé » tant que la règle (a) n'est pas saisie. (c) Saisie par commande —
irréaliste. Recommandation : (a) avec (b) en pré-remplissage « à confirmer ».

**A4 — Emballage : par unité ou par commande ?**
`variant_costs.cout_emballage` est par unité (existant, entre dans `coutRendu` d'`engine.js`
via `fraisFixes`). Le brief place l'emballage en CM2, par commande (« le panier moyen dilue le
port et l'emballage », 10.2). (a) Par commande : `shop_settings.packaging_cost_per_order`,
alloué aux lignes ; le champ par variante devient une surcharge optionnelle. (b) Par unité
(existant) : simple, mais un panier de 3 articles compte 3 emballages. Recommandation : (a).

**A5 — Allocation des coûts de commande aux lignes** (frais de paiement, port marchand,
emballage par commande) : (a) prorata du CA HT de ligne (D3 existant) ; (b) égal par unité.
Recommandation : (a), un seul mécanisme, déjà testé (lot 6).

**A6 — Coûts fixes** : (a) niveau boutique seulement (jour = mensuel / jours du mois ;
`net_result` produit = non applicable) ; (b) alloués aux produits au prorata du CA HT (un
« résultat net par produit » discutable). Recommandation : (a) en V1.

**A7 — Commissions par code** : plusieurs codes sur une commande (remises combinables) →
(a) chaque règle de code présente s'applique sur sa base ; (b) une seule (la première)
règle par commande. Base après remise = CA HT de la commande hors port (?) — le port client
est dans le CA brut (d1) : (i) commission sur CA HT produits ; (ii) sur CA HT total port
inclus. Recommandation : (a) + (i).

**A8 — Taux de TVA à l'import (UE) pour un marchand hors France.** `engine.js` embarque des
taux FRANÇAIS (20 % / 5,5 %). `computeLandedCost` prend `vatRate` en paramètre : F3 peut
calculer le bon taux sans toucher `engine.js`. (a) Taux standard du pays du marchand (table de
27 taux dans `econ/`, taux réduits FR conservés) ; (b) taux saisi dans Réglages ; (c) garder FR.
N'impacte que le régime franchise (`tvaNetCost`) et l'information « TVA avancée ».
Recommandation : (a). Exige de connaître le pays de la boutique → A9.

**A9 — Pays de la boutique et détection « UE / hors UE ».** `shop_settings` (F1) n'a pas de
`shop_country_code`. (a) Ajout d'une colonne (addendum F1, 1 migration idempotente) remplie
depuis `shop.billingAddress.countryCode` à la première sync ; (b) lecture Shopify à chaque
calcul (I/O dans un module pur : non). Recommandation : (a). Formule hors UE (décision 7) :
`coût rendu = prixAchat + port_unitaire + (prixAchat + port_unitaire) × duty_rate_pct`, sans
TVA d'import (pas de TVA à l'import hors UE dans le modèle V1 — à confirmer), `landed_cost_override`
prioritaire s'il est saisi.

**A10 — Ventes provisoires** (délai de retour 30 j, d3) : (a) comptées dans tous les
agrégats, retours = 0, avec `provisional_share` et un marquage sur les périodes récentes ;
(b) exclues des comparaisons aux repères tant qu'elles sont provisoires. Recommandation : (a),
le marquage suffit (principe 4).

**A11 — Seuils `minData` (valeurs).** Proposition, à valider ou ajuster : CVR ≥ 200
sessions et ≥ 10 commandes ; panier moyen ≥ 10 commandes ; CM2 % ≥ 10 commandes à coût connu ;
BE-CAC ≥ 20 premières commandes ; CAC/MER/POAS ≥ 30 commandes attribuées (convention
`BLENDED_MIN_ORDERS` existante) ; cohorte M+k : âge ≥ k mois ET ≥ 30 clients ; LTV ≥ 6 mois et
≥ 30 clients ; taux de retour ≥ 50 commandes sorties du délai ; OTD ≥ 20 colis livrés ;
couverture stock ≥ 14 jours de ventes ; croissance vs année ≥ 13 mois. Chaque nœud affiche ce
qui manque (« encore 40 commandes »).

**A12 — Repère CM2 « 40 à 60 % selon le produit ».** (a) Bande fixe 40-60 pour tous ; (b) bande
par catégorie douanière (les 11 catégories existantes) — les valeurs restent à te fournir ;
(c) objectif saisi par le marchand (`profitability_threshold_pct` existant) + bande fixe en
rappel. Recommandation : (c) (le seuil existe déjà et pilote les alertes).

**A13 (reportable) — Croissance** : semaine glissante (7 j vs 7 j précédents) ; mois et
année calendaires « à date » (aligné sur la décision 4) — ou tout glissant. Recommandation :
glissant pour la semaine, calendaire à date pour mois/année.

**A14 (reportable, module Marketing) — POAS et attribution prudente.** Seule l'attribution
UTM donne une CM2 par commande ; la plateforme ne donne qu'un revenu. (a) POAS = CM2 des
commandes attribuées par UTM / dépense (exact) ; ROAS affiché côte à côte (plateforme et UTM),
levier sur le plus prudent ; (b) POAS « prudent » = CM2 UTM × min(1, revenu plateforme / revenu
UTM). Recommandation : (a).

**A15 (reportable, F2/X) — Jointure UTM ↔ entités pub** : `utm_campaign` = nom exact de
campagne, ou identifiant, ou correspondance approchée. À trancher avec le premier
connecteur.

## 6. Lot de tests prévu — `tests/lot24_econ.mjs`

1. **Les 8 exemples chiffrés du brief (§22) rejoués à l'identique** (au centime / à 0,01 de
   ratio) : 119 € TTC → 99,17 HT → CM2 64,17 (64,7 %) → BE-ROAS (selon A1) ; commission 15 % →
   14,88 ; 24 clients → 357,12 ; BE-CAC 64,17 ; LTV/CAC 4,31 ; MER 6,67 ; CA 100 → CM1 60 → CM2 48
   → CM3 30 ; ROAS cible 3,57 ; 70/50 %/25 → 35 et 10 ; CAC 40 / 10 par mois → 4 mois ; stock 120 /
   4 par jour → 30 jours, point de commande 300.
2. Ligne : CA HT depuis `taxLines` avec `taxesIncluded` vrai et faux ; remboursement partiel
   (A2) ; carte cadeau exclue ; coût manquant → `unknown`, jamais 0.
3. Invariants d'agrégation repris du lot 7 : Σ produits = total (arrondi par ligne), `MIXED`
   jamais sommé, commandes distinctes, exclusions (`excluded_reason`) hors de tout nœud.
4. Allocation A5 : Σ des allocations = frais de la commande, lignes `missing` ignorées, CA nul
   → 0 sans division.
5. Seuils : dénominateur ≤ 0 → `unreachable` ; BE-CAC uniquement sur `customer_order_index = 1` ;
   deux versions du seuil de rentabilité.
6. `minData` : chaque nœud sous seuil renvoie `insufficient` avec le manque chiffré ; aucun
   nœud ne renvoie 0 faute de données.
7. Graphe : acyclique, ordre topologique stable, toute entrée d'un nœud existe ; simulateur :
   déterminisme (mêmes entrées → mêmes sorties), surcharge d'un nœud d'entrée ne touche que ses
   descendants, `assumptions` listées, recherche de seuil converge.
8. `engine.js` intouché : lot 1 à 4 et 20 inchangés ; F3 n'importe que `computeLandedCost`,
   `getCustomsDuty`, `CUSTOMS_RATES` (scan du source).

## 7. Fichiers, taille, dépendances

| Fichier | Contenu | Estimation |
|---|---|---|
| `app/lib/econ/nodes.js` | catalogue déclaratif + `evaluate` (tri topologique) | ~250 lignes |
| `app/lib/econ/line.js` | `computeLineEconomics` (HT, CM1, hors UE, override) | ~150 |
| `app/lib/econ/allocate.js` | `allocateOrderCosts` (D3 généralisé) | ~60 |
| `app/lib/econ/aggregate.js` | agrégats multi-niveaux, provisoire, trous, cohortes | ~400 |
| `app/lib/econ/thresholds.js` | seuils | ~80 |
| `app/lib/econ/simulate.js` | ré-évaluation, recherche de seuil, hypothèses | ~120 |
| `app/lib/econ/minData.js`, `econ/index.js` | seuils de données, exports | ~80 |
| `tests/lot24_econ.mjs` + fixtures JSON | 8 familles ci-dessus | ~450 |
| Addendum F1 (selon A3/A4/A9) | `shop_settings.shipping_cost_rules JSONB`, `packaging_cost_per_order`, `shop_country_code` — 1 migration idempotente + rollback + lot23 | ~40 |

Taille : **L**. Dépendances : F1 (fait) ; aucune dépendance à F2 pour écrire et tester (fixtures).
Risques : dérive de nomenclature (contrée par les tests §22), et surtout les arbitrages A1/A2
qui changent des chiffres affichés — à figer AVANT d'écrire.

---

## STOP — décisions attendues

Bloquantes : A1 (base HT/TTC), A2 (unités remboursées), A3 (port marchand), A4 (emballage),
A5, A6, A7, A8, A9 (pays boutique + hors UE), A10, A11 (table `minData`), A12 (repère CM2).
Reportables mais utiles : A13, A14, A15. Puis GO d'écriture (addendum F1 compris si A3/A4/A9
le demandent — appliqué sur test puis prod avec les mêmes preuves qu'F1).
