# I0-A — Couche narrative pure, fiabilité des données, lot 27 : implémentation (2026-09-23)

Suite de `2026-09-23_i0_copilote_phase0.md` et des arbitrages D1 à D11, C12 (message du
2026-09-23, consignés ci-dessous). Contenu pédagogique validé sur le fond (annexe
`2026-09-23_i0_contenu-pedagogique_brouillon.md`), retours de ton attendus en I0-D.

Statut : **écrit et prouvé localement (gate complète verte). Aucun écran, aucune migration, aucun
commit, aucun push.** `app._index.jsx`, `engine.js`, `app/lib/econ/*` existants, `app/lib/sync/*`,
`app/routes/*`, `app/components/*` : 0 diff. La synthèse stratégique est versionnée sous
`docs/produit/synthese-strategique-tcc.pdf` (883 Ko, version du 23/09 lue pour la Phase 0).

## 1. Problème

Le moteur produit des KPI justes mais aucun jugement : pas de sélection des signaux, pas de cause
portée par une décomposition, pas d'impact en euros, pas de niveau de confiance, pas de score de
fiabilité des données. Le PDF exige un briefing (situation, 3 priorités, opportunité) qui dit ce
qu'il sait et à quel point il le sait.

## 2. Cause

Rien entre `aggregate()` et l'écran : chaque écran devait interpréter lui-même les nœuds.

## 3. Solution

### 3.1 Modules purs (aucune I/O, aucun React, aucune phrase)

| Fichier | Lignes | Rôle |
|---|---|---|
| `app/lib/insights/config.js` | 78 | Tables : poids de priorité (D11 : 0,3 / 0,2 / 0,3 / 0,1 / 0,1), valeurs de confiance, seuils de statut, incertitude par score et par statut (D2a), référence (D1), seuils des règles, `RULE_MIN_DATA`, urgence / facilité / réversibilité, règles de fiabilité et poids (D8), niveaux |
| `reference.js` | 21 | D1 : moyenne null-aware des 4 dernières périodes (`periods`, N semaines), `previous` si une seule, `six_months` dès 182 jours couverts |
| `bridge.js` | 47 | Pont de contribution CM2 (volume, panier, taux de coût produit, taux de coûts de commande) et CM3 (+ pub, commissions) ; additif, résidu affiché, part expliquée ; feuille absente → effets `null`, rien d'inventé ; classement des effets dans le sens de l'écart |
| `impact.js` | 20 | D2 : demi-largeur par score (10 / 20 / 35 %) + statut (0 / 5 / 15 / 10 %), horizon `period` ou `month` |
| `status.js` | 35 | Niveaux de confiance par règles (trous ≤ 10 % / ≤ 30 %, part expliquée ≥ 80 % / ≥ 50 %, référence ≥ 4 périodes), `minData` par règle, part des trous (coûts inconnus plein, frais non confirmés × 0,25) |
| `rules.js` | 259 | 17 règles : signal, variables de gabarit, preuves copiées du moteur, formule d'impact déclarée, cause (pont ou motif de retour seulement), levier de simulation, CTA unique, urgence / facilité / réversibilité ; les règles pub ne s'évaluent pas sans source pub (D3a) |
| `priority.js` | 43 | Score pondéré, sélection de 3 : une par sujet, au plus une règle de données, jamais deux leviers identiques, contexte à défaut |
| `situation.js` | 37 | 4 créneaux (résultat, tendance, facteur, données), chacun une clé + variables, variantes partielles |
| `index.js` | 117 | `buildBriefing` : sources, référence, ponts CM2/CM3, insights (statut, fourchette, empreinte), 3 résultats (D9a : résultat estimé marqué sans coûts fixes / sans pub), priorités, opportunité (simulée, horizon mois), situation |
| `app/lib/confidence.js` | 59 | Score 0-100 par 7 règles pondérées ; non applicable hors dénominateur (pub sans commande attribuée, coût rendu hors composantes CM1 ou hors UE) ; `points_if_fixed`, `if_fixed` (« de 30 à 55 » en confirmant les frais), déblocages, manque principal |

Contrat d'un insight : `{ id, kind, subject, status, vars, evidence[{node, value, unit}], impact:
{ formula, point, range, precision_only }, cause: { factor, contributions, explained } | null,
explained, simulation | null, cta, lever, unlocks, urgency, ease, reversibility, gaps_share,
fingerprint }` ; `status: "partial"` avec `missing` quand `minData` n'est pas satisfait.

### 3.2 Fixtures et lot 27

`tests/fixtures/i0_shops.mjs` (83 lignes) : générateur déterministe de trois boutiques (D4a),
période courante septembre 2026 + jusqu'à 4 périodes précédentes de 30 jours, faits au format
du loader → `aggregate()` :

| Boutique | Profil | Ce qu'elle doit produire |
|---|---|---|
| saine | 40 commandes, prix 62, coût 22, 1 remboursement, pub connectée, coûts fixes, panier 62 vs prix principal 60 | aucune priorité de dégradation ; opportunité panier simulée ; fiabilité 100 |
| en baisse | 48 commandes (+13 % de CA), coût 22 → 30, remboursements 2,5 → 8,5 % (motif DEFECTIVE), remises | `cm2_drop` (−12,9 pt, cause taux de coût produit, confirmé), `revenue_vs_contribution`, `refund_pressure`, `cm2_below_target` ; 3 priorités à leviers distincts (prix, coût, retours) |
| données manquantes | 12 commandes, une ligne sur deux sans coût, frais et port non confirmés, ni emballage ni coûts fixes, UTM sans pub | `cost_coverage`, `fees_unconfirmed`, `no_ad_source` ; aucune règle marketing ; fiabilité 30 (« de 30 à 55 » en confirmant les frais) ; résultat « estimé, coûts fixes non renseignés » |

`tests/lot27_insights.mjs` (240 lignes, **94 assertions**) : référence (kinds, moyenne
null-aware, plafond 4) ; pont (Σ effets + résidu = Δ exactement, résidu ≈ 0 sur feuilles
complètes, facteur dominant, feuille absente → `null`, pont CM3) ; fourchettes (demi-largeurs,
signe conservé, horizon mois) ; statuts (table de décision, D1) ; fiabilité (scores, applicabilité,
`if_fixed`, poids = 100, score = points / max applicable) ; règles sur les trois boutiques
(déclenchements attendus et non attendus, cause = taux de coût produit, motif DEFECTIVE,
D3a, impact inconnu jamais 0, preuves = valeurs du moteur, aucune cause sans contribution,
formule déclarée partout) ; priorité (poids, 3 rangs, leviers distincts, ≤ 1 règle de données,
impact moyen confirmé devant gros impact à vérifier) ; situation, résultats (D9a), opportunité
(simulation, mois, après > avant, hypothèses), déterminisme, empreintes ; catalogues (name /
observation / recommendation / partial pour les 17, structure complète pour 7, 12 KPI × 4,
clés de `situation.js`, confiance, facteurs, références, actions, `fr = en` sur 410 clés, chaque
variable de gabarit fournie par sa règle) ; scans (10 fichiers, aucun aléa / date / I/O / React,
aucune phrase en dur hors formules déclarées, poids dans `config.js`, aucun import d'`engine.js`).

### 3.3 Catalogues

`app/locales/en.js` / `fr.js` : + 208 clés (`confidence.*`, `factor.*`, `reference.*`, `cta.*`,
`impact.*`, `unlock.*`, `situation.*`, `insight.<17>.*`, `learn.kpi.<12>.*`) → 410 clés, `fr = en`.
Le lot 26 réserve ces préfixes (non encore consommés par un écran, I0-B).

### 3.4 Arbitrages appliqués et écarts à signaler

| # | Appliqué | Note |
|---|---|---|
| D1 | `reference.js` : 4 périodes, « previous » en repli, « six_months » ≥ 182 j ; `status.js` : < 4 périodes → très probable au mieux | Le libellé « vs vos N dernières semaines » est calculé (4 × jours / 7 : 17 semaines pour des périodes de 30 j, 8 pour 14 j) |
| D2 | `impact.js` : (a) fourchette par score, (b) horizon mois pour l'opportunité, période pour les priorités | (c) scénarios bas/haut attend le Simulateur ; la clé `impact.everything_equal` porte la formulation |
| D3 | `index.js` : règles `needs: ["ads"]` non évaluées sans pub ; `no_ad_source` seulement si des commandes attribuées existent | |
| D4 | (a) fixtures ; (b) liste des commandes en §6 | (c) refusé |
| D8 | `confidence.js` : poids fixes, non applicable hors dénominateur | Sur la boutique « manquante », le manque principal est la pub (20 pt), avant les coûts (15 pt sur 30) : c'est le calcul, pas un choix |
| D9 | (a) résultat affiché, `estimated: true`, `gap: "fixed_costs"`, notes | |
| D11 | poids dans `config.js` | |
| — | **Part des trous** : frais/port non confirmés comptés à 0,25 (précision), coûts inconnus à 1 | Ajusté après un premier calcul qui mettait toute boutique aux frais non confirmés « à vérifier » |
| — | **Pont** : les remboursements n'ont pas d'effet propre (ils sont dans volume/panier via les unités remboursées) ; la règle `refund_pressure` les porte | Documenté dans `bridge.js` ; un effet « remboursements » séparé rendrait le pont non additif |
| — | `cm2_drop` : part expliquée 100 % sur feuilles complètes (formule exacte), donc `confirmed` dès que la référence a 4 périodes et les trous ≤ 10 % | |

## 4. Preuves

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 431 warnings (inchangé : aucun nouveau) |
| `npm test` | 27 lots verts (lot 27 : 94 assertions ; lot 26 : préfixes I0 réservés, `fr = en` sur 410 clés) |
| `node scripts/render_check.mjs` | « Tous les rendus réels OK » (57, aucune surface touchée) |
| `npm run build` | client et serveur construits |
| `git diff --stat` fichiers protégés | vide |

## 5. Ce que l'IA recevra (rappel du contrat, I1)

L'objet briefing tel quel (clés + variables, preuves, statuts), formaté par locale avant envoi ;
reformulation sans calcul ; vérification que tout nombre cité existe dans les entrées ; cache
`ai_explanations` par empreinte.

## 6. Preuve vivante sur la boutique de dev (D4b) : commandes à créer

Toutes les commandes sont créées maintenant (jour boutique courant, fenêtre 30 jours) ; la
référence sera « période précédente » vide → statut « très probable » au mieux, tendance
« une seule période ». Pour obtenir une baisse mesurable, une seconde vague est prévue.

Préparation (écran classique, Suivi des coûts) : trois produits, coûts saisis pour deux :

| Produit | Prix TTC | Coût d'achat saisi | Rôle |
|---|---|---|---|
| A « Tee » | 60 | 22 | produit principal (prix principal = 60 dans les réglages) |
| B « Hoodie » | 90 | 45 | marge correcte |
| C « Cap » | 25 | 20 + port 8 | **vendu à perte** (`product_loss`) |
| D « Poster » | 40 | aucun | **coût manquant** (`cost_coverage`) |

Vague 1 (aujourd'hui, 15 commandes, inclusion brouillons/tests active) :

| # | Contenu | Remise | UTM | Événement |
|---|---|---|---|---|
| 1-6 | A × 1 | 0 | 1, 3, 5 : `utm_source=facebook` | — |
| 7-8 | A × 2 | 0 | 7 : facebook | — |
| 9-10 | B × 1 | 0 | — | — |
| 11-12 | C × 1 | 0 | 11 : facebook | — |
| 13-14 | D × 1 | 0 | — | — |
| 15 | A × 1 + B × 1 | code TEST20 (−20 %) | — | remboursée intégralement (restock) 2 jours après |

Attendu (sans pub connectée) : `cost_coverage` (2 lignes sans coût, D), `product_loss` (C, 2
commandes seulement → « partial » : exige 3 ; en créer une 3e si tu veux le voir),
`aov_vs_main_price` (panier ≈ 66 proche de 60 + 10 %), `no_ad_source` (4 commandes attribuées),
`refund_pressure` selon le montant remboursé (150 sur ~1 000 : 15 % ≥ 5 %). Fiabilité attendue :
coûts ≈ 85 %, frais confirmés selon tes réglages, pas de pub (−20), coûts fixes à saisir.

Vague 2 (dans 7 jours, 12 commandes) : mêmes produits, coût de A passé à 30 dans le Suivi des
coûts avant la vague, 3 remboursements → au passage à 7 jours de période, `cm2_drop` avec cause
« taux de coût produit ».

Preuves à lire ensuite : le briefing sur `?days=7` et `?days=30` (I0-B), l'`insight_log` (I0-C).

## 7. Ce qui reste

1. Ton GO pour le commit unique + push (avec le PDF si `docs/produit/` est alimenté).
2. I0-D : retours de ton sur le français ; I0-B : écrans (Analyse, Vue d'ensemble 9 blocs,
   Indicateurs, nav hybride, Fiabilité, C12) ; I0-C : mémoire des décisions.
