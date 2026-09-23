# Phase 0 — I0 : le copilote apparaît

Date : 2026-09-23. Lecture seule : ce fichier, son annexe (`2026-09-23_i0_contenu-pedagogique_brouillon.md`)
et la section H de `2026-09-22_decisions.md` sont les seules écritures. Aucune ligne de code,
aucune migration, aucune dépendance.

Source lue en entier : « Synthèse stratégique complète — True Cost Calculator » (30 pages, texte
extrait de `C:\Users\mathy\Downloads\…(1).pdf`, version du 23/09 22:44). **Le dossier
`docs/produit/` n'existe pas dans le dépôt** : le PDF n'y a pas été déposé. À faire de ton côté
(copie du fichier) pour qu'il soit versionné avec ce rapport. Références de code : `app/lib/econ/`
(nœuds, seuils, simulateur), `app/lib/overview.js` (KPI, statuts, séries, calcul), F1
(`alert_rules`, `alert_state`, `ai_explanations`, `purge_shop`), `2026-09-22_refonte-phase0.md` §7.

---

## 0. Résumé exécutif

1. **Ce que le PDF change** : la Vue d'ensemble cesse d'être un catalogue de 12 KPI pour devenir
   un briefing (période, 3 résultats, situation, 3 priorités, opportunité, courbe, cascade,
   fiabilité, indicateurs repliés) ; les 12 tuiles migrent telles quelles dans une page
   Indicateurs. Le produit dit ce qu'il sait ET à quel point il le sait (4 niveaux de confiance).
   Aucun nouveau KPI tant que les existants ne produisent pas trois décisions utiles.
2. **Tout est déjà calculable sans nouveau moteur** : les insights se dérivent des nœuds,
   feuilles, trous et compteurs d'`aggregate()` sur la période courante et la précédente, plus
   `thresholds()` et `simulate()`. I0 ajoute trois modules PURS (narration, fiabilité, décomposition)
   qui ne calculent aucun chiffre hors du moteur : ils lisent, comparent, classent et formulent.
3. **Deux points où le PDF corrige l'existant** : le bouton `.tcc-cta` plein violet-indigo
   (défini en CSS, non utilisé à l'écran mais présent) doit disparaître ; le segmenté de période
   en violet plein est un contrôle, pas un bouton principal, mais je propose de le passer en
   neutre pour ne laisser aucun doute au relecteur Built for Shopify (C12).
4. **Mémoire des décisions dès ce lot** : deux tables (`insight_log`, `decision_log`), RLS,
   purge, sans identifiant client ; enregistrement silencieux des priorités affichées, de
   l'opportunité, des simulations lancées et des actions choisies. Modèle compatible avec les
   `experiments`/`scenarios` prévus en V3.
5. **Onze arbitrages** en §8 (D1 à D11) ; bloquants : D1 (historique de référence), D2 (impacts
   en fourchettes), D4 (boutique de dev), D5 (découpe en lots), D6 (nav dans `s-app-nav`).
   Découpe recommandée : I0-A narration + fiabilité + Analyse (pur, testé sur fixtures) ; I0-B
   Vue d'ensemble réorganisée + Indicateurs + nav ; I0-C mémoire des décisions (migration) ;
   I0-D contenu pédagogique relu. Tailles M / M / S / S.

---

## 1. Ce que le PDF fixe, et ce qu'il remplace

| Sujet | Brief / décisions antérieures | PDF (fait foi) | Effet sur I0 |
|---|---|---|---|
| Vue d'ensemble | 12 KPI (décision 14), 8 sur mobile | 9 blocs dans un ordre fixe ; 3 résultats en tête ; « Tous les indicateurs » replié | Les 12 tuiles deviennent la page Indicateurs ; la Vue d'ensemble n'affiche que CA net, contribution, résultat estimé |
| Navigation | 12 sections (décision R7) | Today, Decisions, Simulator, Metrics, Products, Ask, Data Health | Ton message tranche : nav hybride en 3 groupes (§5) ; Expériences dans Décisions ; pas de 12e entrée |
| Insight | règles `{ condition, diagnosticKey, levers, estimateEuro }` (refonte §7.1) | structure fixe à 7 champs + niveau de confiance | Le catalogue de règles produit des insights complets, pas des diagnostics isolés |
| Confiance | `minData` (A11) par nœud | 4 statuts : confirmé, très probable, à vérifier, simulation | `minData` reste la porte d'entrée ; la confiance qualifie la conclusion, pas seulement la donnée |
| Données manquantes | `dataGaps` comptés (principe 5) | score de fiabilité par règles, chaque manque dit ce qu'il débloque | Nouveau module pur `confidence.js` |
| États vides | « il manque N » (A11) | « voici ce qui peut déjà être conclu » + ce que l'action débloque | Chaque état vide porte une conclusion partielle et un déblocage chiffré |
| Simulateur | volume constant (décision 4) | fourchettes, hypothèses visibles, « toutes choses égales par ailleurs » | Impacts en fourchettes (D2) ; le simulateur existant suffit |
| Apprentissage | V3 (`experiments`, `scenarios`) | mémoire des décisions = moat, à construire dès le premier marchand | Tables et enregistrement silencieux dès I0 (§6) |
| Design | direction B « Signal » | Polaris pour le squelette, custom pour cascade/pont/simulateur/score, mouvement explicatif, jamais de bouton principal violet | Confirme B ; correctif C12 ; motion réservée aux relations de cause à effet |
| Expert | IA = Expert (brief) | Expert = profondeur (landed cost, TARIC, causes racines, suivi des décisions), pas « plus d'IA » | Hors I0 (tarification non décidée), mais le journal des décisions est un candidat Expert |
| i18n | 35 langues (décision 13) | onboarding : langue, pays, devise de reporting, pays de vente/expédition, approvisionnement, régime fiscal | À prévoir (hors lot) ; `shop_settings` porte déjà `locale_override`, `shop_country_code`, `shop_currency`, `vat_regime` |

Points du PDF que je signale sans les appliquer : « une quatrième valeur selon le profil
(trésorerie, marge nette, prévision) » → hors I0 ; « Ask True » → I1 ; « Financial Health Check
partageable » → après I0 ; « Regulatory Profit Copilot » → module premium ultérieur.

---

## 2. Correspondance des écrans du brief : option A partout (consignée)

Retours → Profit ; Expédition → Stock (renommé Opérations à terme) ; SEO → Croissance ;
Alertes → Intelligence (état) + Réglages (seuils) ; Leviers → Intelligence ; Conversion →
Croissance ; Réglages des coûts → Réglages > Coûts ; Connexions pub et Search Console →
Réglages > Connexions ; Codes promo et partenaires → Marketing (saisie dans Réglages). Section H
de `2026-09-22_decisions.md`.

---

## 3. Module narratif pur : `app/lib/insights/`

### 3.1 Entrées (toutes existantes)

`aggregate()` sur la période courante et la précédente (`shop.leaves`, `shop.nodes`, `byDay`,
`byProduct`, `byChannel`, `byCountry`, `byCode`, `dataGaps`, `counts`, modules `returns`,
`shipping`, `stock`, `customers`, `marketing`), `thresholds()`, `settings`
(`profitability_threshold_pct`, `target_margin_after_ads_pct`, `return_window_days`), la
fenêtre, la devise, et la sortie du module fiabilité (§4). Aucune lecture de base : le loader
de la Vue d'ensemble appelle `buildBriefing({ current, previous, reference, settings, confidence, window })`.

### 3.2 Forme d'un insight (contrat)

```
{
  id: "cm2_drop",                      // règle
  subject: { kind: "shop" | "product" | "channel" | "code", key },
  status: "confirmed" | "likely" | "to_verify" | "simulation",
  observation:    { key, vars, confidence },   // « Votre CM2 a baissé de 5,4 points »
  context:        { key, vars, confidence },   // vs période précédente, vs objectif, vs référence
  cause:          { key, vars, confidence, contributions: [{ factor, amount, share }] } | null,
  impact:         { amount_low, amount_high, amount_point, currency, horizon, confidence } | null,
  recommendation: { key, vars, cta: { kind: "simulate" | "fix_data" | "open_section" | "connect", target } },
  simulation:     { levers: { … }, node: "cm2", confidence: "simulation" } | null,
  followup:       { key, vars, horizon_days },
  evidence:       [{ node, value, unit, period }],   // « Pourquoi cette conclusion ? »
  gaps:           ["unknown_cost_lines", …],
  score:          { impact, urgency, confidence, ease, reversibility, total },
  fingerprint:    "cm2_drop:shop:2026-09-16:2026-09-23:-5.4"
}
```

Chaque champ texte est une **clé de catalogue + variables** (jamais une phrase) : la traduction
vit dans `app/locales/*.js`, l'IA (I1) reformule à partir du même objet. Les montants viennent
des nœuds (copiés dans `evidence`), jamais recalculés dans le module : un test l'impose (scan
statique : aucune opération arithmétique sur des montants en dehors de l'agrégation des
contributions déjà calculées par le moteur).

### 3.3 Niveaux de confiance (règles de décision, pas d'appréciation)

| Statut | Condition (toutes) |
|---|---|
| `confirmed` | nœuds concernés `ok` sur les deux périodes ; `minData` satisfait ; aucun trou touchant ces nœuds (coût inconnu, frais/port non confirmés sur > 10 % du CA) ; décomposition qui explique ≥ 80 % de l'écart |
| `likely` | `minData` satisfait ; trous ≤ 30 % du CA ou décomposition à 50-80 % ; ou une seule période disponible avec référence (D1) |
| `to_verify` | signal présent mais `minData` non satisfait sur un nœud, ou trous > 30 %, ou décomposition < 50 % |
| `simulation` | toute sortie de `simulate()` |

Une cause n'est affichée que si la décomposition (§3.5) la porte ; sinon `cause = null` et
l'insight reste une observation « à vérifier ». Jamais de « parce que » sans contribution
chiffrée.

### 3.4 Catalogue de règles V1 (ce qui se déclenche, avec ou sans pub)

| Règle | Signal | Entrées | Sans pub ? | Impact (moteur) | CTA |
|---|---|---|---|---|---|
| `cm2_below_target` | CM2 % < objectif marchand (ou bande 40-60 en repli) | `cm2_pct`, `profitability_threshold_pct` | oui | (objectif − CM2 %) × CA HT connu | simuler prix / COGS |
| `cm2_drop` | CM2 % baisse de ≥ 2 pt vs période précédente | `cm2_pct` ×2, décomposition | oui | Δ contribution = pont | ouvrir la cause dominante |
| `revenue_vs_contribution` | CA HT monte, CM2 ne suit pas (ou baisse) | `ca_ht`, `cm2` ×2 | oui | écart de contribution | idem |
| `refund_pressure` | remboursements > 5 % du CA brut ou +2 pt vs précédent | `rembours`, `ca_brut`, `returns.reasons` | oui | remboursements − seuil | Profit > retours |
| `discount_weight` | remises > 15 % du CA brut | `remises`, `ca_brut` | oui | remises × (part au-dessus du seuil) | simuler prix |
| `cost_coverage` | lignes sans coût > 0 | `unknown_cost_lines`, `unknown_ca_ht` | oui | CA non analysé | Réglages > Coûts (déblocage : CM1, CM2, résultat, N règles) |
| `fees_unconfirmed` | règle de frais ou de port non confirmée | `dataGaps` | oui | montant des frais estimés | confirmer (déblocage : + X points de fiabilité) |
| `aov_vs_main_price` | panier moyen < prix produit principal + 10 % | `aov`, `main_product_price` | oui | (prix + 10 % − AOV) × commandes × CM2 % | simuler panier (bundle) |
| `provisional_share` | > 40 % du CA encore dans le délai de retour | `provisional_share` | oui | aucun (contexte) | attendre / lire avec prudence |
| `product_concentration` | 1 produit > 60 % du CA | `byProduct` | oui | aucun (risque) | Produits |
| `product_loss` | produit à CM2 < 0 | `byProduct.nodes.cm2` | oui | CM2 négative × 1 | Produits > coûts / prix |
| `cac_above_be` | CAC > BE-CAC | `cac_global`, `be_cac` | non | (CAC − BE-CAC) × nouveaux clients | simuler CAC |
| `roas_below_be` | ROAS UTM ou plateforme < BE-ROAS | `roas_utm`, `be_roas` | non | dépense × (1 − ROAS/BE-ROAS) | Marketing |
| `mer_low` | MER < 3 | `mer` | non | contexte | Marketing |
| `no_ad_source` | aucune pub connectée alors que des commandes viennent de sources payantes (UTM) | `attributed_orders`, sources | oui (c'est le déclencheur) | aucun | connecter (déblocage : CAC, MER, POAS, BE-ROAS, 4 règles) |
| `stock_reorder` / `overstock` | point de commande atteint / couverture > 60 j | `stock` | oui | CA perdu / trésorerie immobilisée | Stock |
| `otd_low` | livraison à l'heure < 95 % | `shipping.otd` | oui | contexte | Stock/Opérations |

Chaque règle déclare `minData` (A11), `subject`, `goodDirection`, la formule d'impact (nom du
nœud), le levier de simulation et le déblocage quand elle ne peut pas conclure.

### 3.5 Décomposition : pont de contribution (pur, additif, honnête)

Δ CM2 (période − précédente) se décompose en effets calculés uniquement à partir des feuilles
des deux périodes :

- **Volume** : (commandes − commandes précédentes) × CM2 par commande précédente ;
- **Panier** : commandes × (CA HT/commande − précédent) × CM2 % précédent ;
- **Taux de coût produit** : − CA HT × (COGS/CA HT − précédent) ;
- **Coûts de commande** (port, emballage, paiement, retours) : − CA HT × (taux − précédent) ;
- **Remboursements** : − (rembours − précédent) ;
- **Résidu** : Δ CM2 − Σ effets (affiché, jamais masqué).

Le pont de CM3 ajoute **Publicité** et **Commissions** (variation brute). Le PDF exige de « ne
jamais inventer une décomposition » : si une feuille est `null` sur l'une des périodes, l'effet
est `null` et l'insight tombe à `to_verify`. La part expliquée (1 − |résidu| / |Δ|) alimente le
niveau de confiance (§3.3). Le pont est aussi la donnée du bloc « Où est passé votre argent ? »
(cascade : CA net → coût produit → port entrant + droits + TVA import → paiement → port marchand →
emballage → retours → contribution → pub → commissions → CM3 → frais fixes → résultat), lue
directement dans les feuilles et `cm1_components` : F4-B pour le rendu, I0 pour la donnée.

### 3.6 Fonction de priorité et sélection des 3 priorités

`score = w_i · impact_norm + w_u · urgence + w_c · confiance + w_e · facilité + w_r · réversibilité`,
avec `impact_norm = min(1, |impact| / CA HT de la période)` (ou 0,5 si impact absent mais règle
de données), `urgence` ∈ {1 perte en cours, 0,7 dégradation, 0,4 opportunité, 0,2 contexte},
`confiance` ∈ {confirmed 1, likely 0,7, to_verify 0,3}, `facilité` (données à corriger 1,
simulation 0,7, action opérationnelle 0,4), `réversibilité` (réglage 1, prix 0,6, budget pub
0,8, assortiment 0,3). Poids proposés `0,4 / 0,2 / 0,2 / 0,1 / 0,1` (D11). Règles d'exclusion :
au plus une priorité par sujet, au plus une règle de données parmi les trois (les autres vont
dans Fiabilité), jamais deux règles qui pointent le même levier.

### 3.7 « Votre situation » et opportunité principale

« Votre situation » = 3 à 4 phrases assemblées à partir de clés : (1) résultat estimé et sens
(gagne / perd / inconnu), (2) tendance (CA vs contribution), (3) facteur principal (effet
dominant du pont ou règle de priorité 1), (4) qualité des données (score de fiabilité et
manque principal). Chaque phrase a sa clé et ses variables ; une phrase absente (données
insuffisantes) est remplacée par sa version « ce qu'on peut déjà dire ».

Opportunité principale = la règle d'opportunité (`aov_vs_main_price`, `cm2_below_target` par le
prix, `refund_pressure`, `discount_weight`) au meilleur `impact × confiance`, formulée avec
`simulate()` : « En augmentant le panier moyen de 7 %, la contribution pourrait progresser
d'environ 2 100 à 2 500 € par mois, toutes choses égales par ailleurs ». Le CTA ouvre le
Simulateur pré-chargé (section « Bientôt » tant qu'il n'est pas livré : dans I0, le CTA ouvre la
modale « Pourquoi cette conclusion ? » avec les hypothèses et la fourchette).

---

## 4. Module fiabilité : `app/lib/confidence.js` (pur)

Score 0-100 par règles documentées, chacune avec poids, mesure, seuil et **ce qu'elle débloque** :

| Règle | Mesure (moteur) | Poids proposé | Débloque |
|---|---|---|---|
| Couverture des coûts produits | CA HT à coût connu / CA HT | 30 | CM1, CM2, résultat, produits à perte, 6 règles |
| Frais de paiement confirmés | 1 − commandes `unconfirmed_fees` / commandes | 10 | CM2 exacte, BE-ROAS |
| Coûts logistiques confirmés | 1 − commandes `unconfirmed_shipping` / commandes ; emballage renseigné | 15 | CM2 exacte, coût par commande |
| Publicité connectée | source `ads` présente | 20 | CAC, MER, POAS, BE-ROAS, ROAS cible, 4 règles |
| Coûts fixes renseignés | `fixed_costs` > 0 | 10 | résultat net, point mort |
| Devise cohérente | `currency !== "MIXED"` | 5 | totaux additionnés |
| Coût rendu disponible quand pertinent | si `shop_country_code` ∈ UE et import : lignes avec `cm1_components.droits` renseignés / lignes | 10 | landed cost, TARIC, marge par pays |

Score = Σ poids × mesure. La sortie : `{ score, level: "high" | "medium" | "low", rules: [{ id,
measure, points, max, unlocks: [...], cta }], top_gap }`. Le PDF veut « confirmez cette règle
pour passer de 68 % à 87 % » : chaque règle expose `points_if_fixed`. Les poids sont un
arbitrage (D8) ; la mesure est déterministe et testée.

---

## 5. Écrans et navigation

### 5.1 Composant « Analyse » (réutilisable)

Trois niveaux de lecture d'un même insight : **5 s** = observation + impact + confiance (une
ligne, un badge, un bouton) ; **30 s** = + contexte, cause (contributions en barres), recommandation ;
**complet** = + simulation (hypothèses, fourchette), suivi, « Pourquoi cette conclusion ? »
(preuves : nœuds, périodes, trous). Blocs **Question / Impact / Action** : la question posée
(« Pourquoi ma contribution baisse-t-elle ? »), l'impact en fourchette, l'action unique. Rendu :
carte app-owned (style B), badge de confiance (texte + icône, jamais couleur seule), `s-modal`
pour le niveau complet ou dépliage en place (D10). Le mouvement : la barre de contribution qui
se remplit, la recommandation qui passe « détectée → simulée → adoptée », le score qui progresse.

### 5.2 Vue d'ensemble réorganisée (9 blocs)

1. Période et statut de synchronisation (existant, en-tête conservé, salutation conservée).
2. Trois résultats : CA net HT, contribution (CM2 en € et %), résultat estimé (= CM3 − coûts
   fixes ; sans coûts fixes : « estimé, coûts fixes non renseignés », confiance `likely` ; sans
   pub : CM3 = CM2 signalé). Chaque valeur garde « Voir le calcul » et la sous-ligne
   remboursements (option A).
3. Votre situation (§3.7).
4. Trois priorités (composant Analyse, niveau 5 s, dépliable à 30 s).
5. Opportunité principale (Analyse, avec fourchette).
6. Emplacement courbe de contribution (F4-B, existant).
7. Emplacement cascade « Où est passé votre argent ? » (F4-B pour le rendu ; I0 fournit la donnée
   et une version tableau accessible dès I0 : lignes et montants, « = » en gras, comme la modale).
8. Fiabilité des données : score, 3 manques principaux avec déblocage et CTA.
9. « Tous les indicateurs » replié : 3 mini-lignes (CA, commandes, CM2 %) + lien vers Indicateurs.

États vides actionnables : chaque bloc a une version « voici ce qui peut déjà être conclu »
(ex. : 1 commande → « Avec 1 commande, la contribution par commande est mesurable, la tendance
non ; encore 9 commandes pour le panier moyen ») et le déblocage chiffré (« Connectez Meta pour
calculer votre seuil de CAC et 3 indicateurs »). Le bandeau du moteur et les emplacements
réservés actuels (Top produits, Marketing, Funnel, Stock) sortent de la Vue d'ensemble et
rejoignent leurs sections « Bientôt » (le PDF : « page trop longue sur mobile »).

### 5.3 Page Indicateurs

`/app/metrics` : les 12 tuiles actuelles (3 sections, sélecteur de période, sous-lignes, modales
de calcul, mini-courbes) + pour chaque KPI le contenu pédagogique (§7) accessible par un
« En savoir plus » (dépliage). Aucun changement du modèle : `buildKpis` reste.

### 5.4 Navigation hybride : libellés et rendu

| Groupe | en | fr | Route | Statut I0 |
|---|---|---|---|---|
| Piloter / Steer | Today | Aujourd'hui | `/app/overview` (alias `/app/today` ?) | live |
| | Decisions | Décisions | `/app/decisions` | soon (I1) |
| | Simulator | Simulateur | `/app/simulator` | soon |
| | Ask | Demander | `/app/ask` | soon (I1) |
| Explorer / Explore | Metrics | Indicateurs | `/app/metrics` | live (I0-B) |
| | Profit | Profit | | soon |
| | Growth | Croissance | | soon |
| | Customers | Clients | | soon |
| | Products | Produits | | soon |
| | Marketing | Marketing | | soon |
| | Inventory | Stock | | soon |
| Système / System | Data health | Fiabilité des données | `/app/data-health` | live (I0-B : le score et les manques en page pleine) ou bloc 8 seul (D6) |
| | Settings | Réglages | | soon (écran classique en attendant) |

Groupes : en « Steer / Explore / System », fr « Piloter / Explorer / Système ». Rendu :

- **Rail app-owned** (page) : trois groupes titrés (petites capitales), chips comme aujourd'hui,
  « Bientôt » grisés ; défilement horizontal sur mobile avec le groupe courant en premier.
- **`s-app-nav`** (admin) : liste plate sans titres de groupe (App Bridge n'offre ni séparateur
  ni entête). Options en D6 : (a) sections livrées seulement, dans l'ordre des groupes
  (Aujourd'hui, Indicateurs, Fiabilité des données, Écran classique) ; (b) idem + un lien par
  groupe vers une page d'index « Explorer » qui liste ses sections avec « Bientôt » ; (c) tout
  lister (cliquable, contraire à la décision R7). Recommandation : (a) en I0, (b) quand un
  groupe compte ≥ 2 sections livrées.

---

## 6. Mémoire des décisions : modèle de données

Deux tables F1-compatibles (`shop_domain`, RLS deny-all, `purge_shop` étendue), aucune donnée
nominative (agrégats et identifiants de règles seulement) :

| Table | Clé | Colonnes | Écriture |
|---|---|---|---|
| `insight_log` | `(shop_domain, fingerprint)` | `rule_id`, `subject_kind`, `subject_key`, `status` (confiance), `rank` (1-3, 0 = opportunité, null = non retenu), `window_start`, `window_end`, `impact_low`, `impact_high`, `currency_code`, `payload` JSONB (l'insight complet, agrégats seulement), `first_shown_at`, `last_shown_at`, `shown_count` | silencieuse : à chaque rendu de la Vue d'ensemble, upsert des priorités et de l'opportunité (dédoublonnage par empreinte règle + sujet + fenêtre + valeur arrondie ; D7) |
| `decision_log` | `id` UUID | `shop_domain`, `insight_fingerprint` (nullable), `kind` (`simulated` \| `accepted` \| `dismissed` \| `data_fixed` \| `action_started` \| `action_done`), `scenario` JSONB (leviers, hypothèses, avant/après), `expected_impact_low/high`, `expected_node`, `horizon_days`, `decided_at`, `review_at`, `observed_impact`, `observed_at`, `note`, `created_at` | à chaque simulation lancée (I0 : depuis la modale d'opportunité), acceptation, rejet, correction de donnée (Fiabilité), et plus tard action/mesure |

`scenarios` et `experiments` (V3) deviennent des vues ou des `kind` de `decision_log` :
`experiments = decision_log WHERE kind IN ('accepted','action_started')` avec `review_at`.
Rétention : durée de vie de l'installation (purgée à la désinstallation) ; `insight_log` peut
être compacté (garder le dernier par empreinte). Migration : `20260924_i0_01_decision_memory.sql`
(2 tables, RLS, index `(shop_domain, decided_at DESC)`, `(shop_domain, rule_id, window_end)`),
`purge_shop` remplacée par `CREATE OR REPLACE` avec les 2 lignes de plus, rollback dédié.
Contrat `schema.js` : nouvelle liste `I0_TABLES` ; lot 23 à adapter (ses contrôles « tables des
fichiers `20260922_f1_*` » et « 24 fichiers » sont figés sur F1 : ajouter un contrôle par
famille de préfixe). La mesure d'`observed_impact` (comparer prévu/réel à `review_at`) est la
Phase 4 du PDF : la colonne existe, le calcul viendra avec Décisions.

---

## 7. Contenu pédagogique (en/fr, à relire)

Structure : par KPI, quatre champs courts (`learn.kpi.<id>.what`, `.why`, `.how`, `.watch`) ; par
règle, sept gabarits d'insight (`insight.<rule>.observation|context|cause|impact|recommendation|
simulation|followup`) avec variables, et une version « ce qu'on peut déjà conclure »
(`insight.<rule>.partial`). Brouillon complet des 12 KPI et des 17 règles en annexe
`2026-09-23_i0_contenu-pedagogique_brouillon.md` (rédigé à partir du brief §10 et du PDF, sans
chiffre inventé : les repères cités sont ceux de `config.js`). À relire par toi avant l'écriture
des catalogues ; l'anglais est la source (décision 11), le français la version relue.

---

## 8. Branchement de l'IA (I1, « Demander »)

Contrat : l'IA reçoit l'objet insight (§3.2) et le briefing (situation, priorités, opportunité,
fiabilité) **sérialisés avec les nombres déjà formatés par locale**, le lexique financier de la
langue, et une consigne « reformuler, personnaliser, ne jamais calculer ni introduire un chiffre
absent des entrées ». Sortie JSON contrainte (`text`, `cited_numbers[]`) ; vérification : chaque
nombre cité existe dans les entrées (rejet → texte déterministe des catalogues). Cache
`ai_explanations` par empreinte + locale (F1-22 existe) ; quota `checkRateLimit` (existant) ;
`sanitizeForPrompt` (existant). Le module narratif reste la source ; l'IA n'est qu'une couche de
rédaction : sans IA, les catalogues suffisent (c'est ce que I0 livre). L'appel existant
`ai_recommend` (`claude-sonnet-4-6`, calculateur) est le gabarit à généraliser en I1, avec un
modèle à jour.

---

## 9. Arbitrages (options et implications)

**D1 (bloquant) — Référence pour « votre moyenne » et les comparaisons.** Aujourd'hui : période
précédente de même longueur, 60 jours d'historique au plus (sans `read_all_orders`).
(a) Référence = période précédente seulement ; « moyenne 6 mois » n'apparaît que lorsque
≥ 26 semaines de commandes existent (après approbation), sinon le texte dit « vs les 30 jours
précédents ». (b) Référence glissante = moyenne des 4 dernières périodes de même longueur
disponibles (≥ 2 exigées), étiquetée « vs vos 8 dernières semaines » ; passe à 6 mois quand
l'historique le permet. (c) Objectif marchand seul (seuil de rentabilité) sans comparaison
temporelle. Recommandation : (b), avec (a) comme repli quand une seule période précédente
existe ; la confiance passe à `likely` quand la référence a moins de 4 périodes.

**D2 (bloquant) — Estimation des impacts.** (a) Horizon = période affichée, volume constant,
fourchette = point × (1 ± u) où u dépend de la fiabilité (score ≥ 80 : ± 10 % ; 60-80 : ± 20 % ;
< 60 : ± 35 %) et de la part expliquée du pont. (b) Horizon mensuel (× 30 / jours de la période)
pour l'opportunité, période pour les priorités (le PDF donne « par mois » pour l'opportunité et
« sur la période » pour les écarts). (c) Fourchette par scénarios bas/haut (volume −10 % / +10 %)
au lieu d'une incertitude fixe. Recommandation : (b) pour les horizons, (a) pour la fourchette ;
(c) quand le simulateur est livré. Formulation imposée par le PDF : « toutes choses égales par
ailleurs, environ … ».

**D3 — Sans données pub.** (a) Les règles marketing sont absentes (pas de faux vide) et une seule
règle `no_ad_source` apparaît, en priorité seulement si des commandes attribuées existent (UTM),
sinon dans Fiabilité. (b) Les règles marketing apparaissent en `to_verify` avec le déblocage.
Recommandation : (a) : le PDF veut trois priorités utiles, pas trois « connectez ».

**D4 (bloquant) — Ce que la boutique de dev montrera et comment le prouver.** État réel : 1
commande analysable (#1022, remboursée), 0 coût, 0 pub. (a) Fixtures pures (lot 27) : 3 boutiques
synthétiques (saine, contribution en baisse, données manquantes) qui traversent `aggregate` →
insights → briefing ; `render_check` rend les 9 blocs sur ces fixtures ; la boutique de dev
montre l'état « ce qui peut déjà être conclu » avec 1 commande. (b) Jeu de démonstration en base
(commandes de test créées par toi : ~15 commandes sur 2 périodes, 3 produits, coûts saisis,
2 remboursements) : preuve vivante, mais des clics et un jour de saisie. (c) Mode « données
d'exemple » dans l'app (bandeau, jamais mélangé aux vraies données) pour les boutiques sous
`minData` : montrable en démo, mais code de plus et risque de confusion. Recommandation : (a)
maintenant, (b) pour la preuve post-déploiement (je te fournis la liste exacte des commandes à
créer), (c) refusé en V1.

**D5 (bloquant) — Découpe en lots.**

| Lot | Contenu | Taille |
|---|---|---|
| I0-A | `app/lib/insights/` (catalogue de 17 règles, statuts, pont, priorité, situation, opportunité), `app/lib/confidence.js`, lot 27 (fixtures des 3 boutiques, invariants : aucun chiffre hors moteur, aucune cause sans contribution, résidu affiché), catalogues `insight.*`/`learn.*` en/fr (après ta relecture, I0-D) | M |
| I0-B | Composant Analyse (3 niveaux, Question/Impact/Action), Vue d'ensemble 9 blocs, page Indicateurs, nav hybride (rail 3 groupes + `s-app-nav`), Fiabilité (bloc + page), états vides actionnables, cascade en tableau, correctif C12 ; `render_check` étendu | M |
| I0-C | Migration mémoire des décisions (2 tables, purge, rollback, lot 23), enregistrement silencieux (loader : `insight_log` ; action : `decision_log` pour la simulation d'opportunité et les corrections de données) | S |
| I0-D | Relecture et intégration du contenu pédagogique, « En savoir plus » sur Indicateurs, « Pourquoi cette conclusion ? » | S |

Ordre : I0-A → I0-D (relecture en parallèle) → I0-B → I0-C. Chaque lot : Phase 0 courte si un
écart apparaît, gate complète, preuve.

**D6 — `s-app-nav`** : options (a) / (b) / (c) en §5.4. Recommandation : (a).

**D7 — Ce que la mémoire enregistre en I0.** (a) Priorités et opportunité affichées (upsert par
empreinte), simulations lancées, corrections de données (règle de frais confirmée, coût saisi
depuis un CTA de Fiabilité) ; (b) (a) + chaque ouverture de « Pourquoi cette conclusion ? » ;
(c) (a) + chaque chargement de page (volume inutile). Recommandation : (a).

**D8 — Poids du score de fiabilité** : ceux de §4 (coûts 30, pub 20, logistique 15, paiement 10,
fixes 10, coût rendu 10, devise 5), ou pondération dynamique (pub à 0 quand aucune commande
attribuée). Recommandation : poids fixes documentés, avec une règle « non applicable » (retirée
du dénominateur) pour la pub sans commande attribuée et le coût rendu hors import.

**D9 — Définition de « résultat estimé » sans coûts fixes.** (a) Afficher CM3 avec la mention
« coûts fixes non renseignés » (confiance `likely`) ; (b) ne rien afficher (« inconnu ») tant
que les coûts fixes manquent. Le PDF veut trois résultats en tête : (a), avec le déblocage
« renseignez vos coûts fixes pour un résultat net ».

**D10 — Niveau complet de l'Analyse** : `s-modal` (Polaris, cohérent avec « Voir le calcul ») ou
dépliage en place (moins de rupture, plus long sur mobile). Recommandation : dépliage pour 30 s,
modale pour le niveau complet et « Pourquoi cette conclusion ? ».

**D11 — Poids de la fonction de priorité** : `0,4 / 0,2 / 0,2 / 0,1 / 0,1` (impact, urgence,
confiance, facilité, réversibilité), ou impact et confiance à égalité (`0,3 / 0,2 / 0,3 / 0,1 /
0,1`) pour éviter qu'un gros impact « à vérifier » passe devant un impact moyen confirmé.
Recommandation : la seconde ; les poids vivent dans `config.js` comme `MIN_DATA`.

**C12 (correctif, à faire dans I0-B)** — `.tcc-cta` plein violet-indigo à supprimer (aucun bouton
principal violet ; le bouton principal reste `s-button variant="primary"`, apparence Shopify) ;
segmenté de période : actif en encre sur surface (neutre) plutôt qu'en violet plein ; l'accent
violet reste réservé au badge Expert, au copilote et aux liens.

---

## 10. Preuves prévues

- Lot 27 (pur) : 3 fixtures de boutique (saine / contribution en baisse / données manquantes)
  × 2 périodes ; pour chaque règle : déclenchement attendu ou non, statut de confiance, impact
  dans la fourchette, CTA ; pont : Σ effets + résidu = Δ exact, `null` propagé ; priorité : ordre,
  exclusions ; situation : phrases attendues par clé ; fiabilité : score, `points_if_fixed`,
  déblocages ; scans statiques : aucune arithmétique sur montants hors moteur dans `insights/`,
  aucune phrase en dur, catalogues `fr = en`.
- `render_check` : les 9 blocs sur les 3 fixtures, en `en` et `fr`, chaque état vide actionnable,
  composant Analyse aux 3 niveaux, rail à 3 groupes, page Indicateurs.
- Boutique de dev (après déploiement) : état « 1 commande » avec conclusions partielles et
  déblocages ; puis, si D4 (b), le jeu de 15 commandes et les 3 priorités réelles.

STOP. Rien n'est écrit hors de ces trois fichiers ; j'attends tes arbitrages D1 à D11, C12 et ta
relecture de l'annexe avant tout code.
