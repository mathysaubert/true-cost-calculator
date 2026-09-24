# Phase 0 — Réglages et Simulateur : lecture seule, arbitrages, découpe (2026-09-24)

Lecture seule : aucun fichier modifié. Sources : `app/routes/app._index.jsx` (écran classique,
4 100 lignes), `app/lib/econ/*` (simulate, nodes, thresholds), `app/lib/insights/*`, migrations F1
et addenda, la synthèse stratégique (`docs/produit/synthese-strategique-tcc.pdf`), les décisions
(`2026-09-22_decisions.md` §C, D, G, H) et la Phase 0 I0. Inventaire détaillé établi par un agent
de lecture, recoupé sur les points structurants.

## 1. Constats

### 1.1 Réglages : deux sources de vérité qui divergent

- **L'écran classique n'écrit jamais dans `shop_settings`.** Ses réglages boutique (régime de TVA,
  mode d'expédition, pays d'import par défaut, 3 frais Shopify / processeur, seuil de rentabilité,
  CPA courant) vont dans `shop_plans` (upsert, lignes 921-1047). F1-01 a copié `shop_plans` vers
  `shop_settings` **une fois** (`ON CONFLICT DO NOTHING`).
- Depuis, la sync v2 (`sync/normalize.js` : frais), les règles d'insights (`rules.js` : seuil
  `cm2_below_target`) et le moteur lisent `shop_settings` ; le cron d'alerte, le recalcul et le
  loader classique lisent `shop_plans`. **Un frais ou un seuil modifié dans l'écran classique après
  F1 n'est pas vu par la sync v2 ni par le copilote.**
- Les réglages **que le moteur lit et que personne n'écrit** : `gateway_fee_rules` (frais par
  passerelle, décision 16), `shipping_cost_rules` (port marchand par pays, A3),
  `packaging_cost_per_order` (A4), `return_cost_per_return`, `return_window_days`,
  `delivery_promise_days`, `target_margin_after_ads_pct`, `b2b_tag` (décision 9), `history_months`,
  `locale_override` ; et les tables `fixed_costs` (A6), `promo_code_rules`, `partners`,
  `manual_commissions`, `alert_rules`, `integration_connections`. Aujourd'hui les frais sont donc
  « à confirmer » partout, le port marchand vaut 0, les coûts fixes n'existent pas, et le score de
  fiabilité plafonne mécaniquement.
- **Colonne manquante** : `settings.main_product_price` est lue par `aggregate.js` et par la règle
  `aov_vs_main_price`, mais aucune migration ne la crée. En production la règle ne se déclenche
  jamais (elle fonctionne sur les fixtures parce qu'on lui passe l'objet). À corriger par une
  colonne (migration S-01) et un champ Réglages.
- `thresholds()` est appelé avec `fixed_costs_monthly: null` et `marketing_monthly: null`
  (`insights/index.js`) alors que `fixed_costs` existe : point mort toujours « inconnu ». Réglages
  qui alimente `fixed_costs` + passage des extras = le point mort s'allume (décision 5, deux
  versions étiquetées).
- Deux seuils coexistent : `margin_alerts.threshold` (alerte de calcul, écran classique) et
  `profitability_threshold_pct` (rentabilité, mail quotidien, CM2 cible). Déjà consigné en mémoire
  de projet ; Réglages doit les nommer distinctement ou en retirer un.
- Le PDF demande un onboarding qui distingue langue de l'utilisateur, pays de l'entreprise, devise
  de reporting, pays de vente, pays d'expédition, sources d'approvisionnement, régime fiscal,
  langue des rapports. Existent déjà : `locale_override`, `shop_country_code` (écrit par la sync),
  `shop_currency` (idem), `vat_regime`. N'existent pas : pays de vente, pays d'expédition, sources
  d'approvisionnement, langue des rapports.

### 1.2 Simulateur : deux moteurs, aucun écran cible

- **Moteur boutique** `econ/simulate.js` : 7 leviers multiplicatifs (`price_factor`, `cogs_factor`,
  `aov_factor`, `cvr_factor`, `frequency_factor`, `return_rate_factor`, `cac` absolu), chacun avec
  sa clé d'hypothèse (déjà traduite `assumption.*`), `overrides` sur toute feuille ou nœud,
  `simulate` → avant / après / delta sur tous les nœuds + `note: scenario_not_forecast` ;
  `findThreshold` (bissection sur un levier vers une cible) exporté mais **jamais appelé**.
- **Simulateur classique** (onglet `simulate` + `engine.js`) : un produit, une vente, solveur
  inverse « prix de vente minimum pour une marge cible », port forfaitaire par pays, TARIC par
  catégorie, « prix recommandé » = minimum × 1,10 avec un « + 4,5 % » codé en dur, formulaire en
  `localStorage`. La décision 18 le destine à devenir « un cas du simulateur ».
- Le PDF exige : prix, panier moyen, CAC, budget pub, conversion, retours, coût fournisseur, fret
  et douane, fulfilment, volume ; chaque scénario avec hypothèses, période de référence, variables
  constantes, fourchette, impact sur CA / contribution / résultat, niveau de confiance ;
  formulation « toutes choses égales par ailleurs » ; jamais présenté comme une prévision ;
  Free « une simulation simple », Pro « simulations principales », Expert « scénarios multiples ».
- Correspondance des leviers du PDF avec l'existant : prix → `price_factor` ; panier →
  `aov_factor` ; CAC → `cac` ; budget pub → override `ad_spend` ; conversion → `cvr_factor` ;
  retours → `return_rate_factor` ; coût fournisseur, fret et douane → `cogs_factor` (le coût rendu
  est dans les COGS) ; fulfilment → overrides `shipping_cost` / `packaging_cost` ; **volume** →
  aucun levier dédié (`cvr_factor` multiplie les volumes à sessions constantes ; un levier
  « volume » = même effet, hypothèse différente). `app/lib/econ/*` est protégé (0 diff) : le
  mappage vit dans un module nouveau, pas dans `simulate.js`.
- **Écart d'horizon** : la décision 4 fixe « mois calendaire, volume constant » ; `impactRange`
  projette sur 30 / jours de la période (mois glissant). À trancher (T4).
- Le CTA `simulate` des analyses ouvre aujourd'hui la modale (I0-B) ; `decision_log` reçoit le
  scénario retenu (I0-C) : le Simulateur a donc déjà son point d'entrée et sa mémoire.

## 2. Arbitrages Réglages (S1 à S10)

**S1 — Source de vérité.** (a) `shop_settings` seule : le nouvel écran écrit `shop_settings` **et
recopie** les colonnes historiques dans `shop_plans` (`vat_regime`, `shipping_model`,
`default_import_country`, 3 frais, seuil) tant que l'écran classique vit ; l'écran classique reste
intact (0 diff) mais ses écritures vers `shop_plans` ne remontent pas. (b) Trigger SQL de
recopie `shop_plans` → `shop_settings` (migration) : les deux écrans restent cohérents sans
toucher au code classique. (c) Laisser diverger jusqu'à F4-D. Recommandation : **(a) + (b)** :
l'app écrit `shop_settings`, le trigger couvre l'écran classique jusqu'à sa suppression, le
rollback retire le trigger. Coût : une migration S-02 (trigger idempotent, lot 23).

**S2 — Structure de la section.** (a) Une page `/app/settings` à sections ancrées. (b) Une route
par groupe : `/app/settings` (index = état des réglages + fiabilité), `/app/settings/costs`
(coûts de commande, frais par passerelle, coûts fixes), `/app/settings/goals` (objectifs et
seuils), `/app/settings/shop` (pays, devise, TVA, B2B, historique, langue), `/app/settings/connections`
(pub, Search Console : lecture seule tant qu'aucun connecteur), `/app/settings/marketing` (codes,
partenaires, commissions manuelles ; l'affichage reste dans Marketing, décision H). Recommandation :
**(b)** : chaque page = un formulaire POST natif, un `intent`, une preuve de rendu ; le rail
secondaire réutilise `SectionRail`.

**S3 — Champs de saisie sous React 18.** C1a interdit les champs Polaris contrôlés. (a) Champs
Polaris WC non contrôlés (`s-text-field`, `s-select`, `s-checkbox` avec `name` et `defaultValue`)
dans un `<form method="post">` : dépend de leur participation aux formulaires natifs (form-associated
custom elements) : **fait à vérifier au premier écran** (validateur Shopify indisponible pendant
cette Phase 0). (b) Champs HTML natifs stylés dans `.tcc` (comme le segmenté de période) : sûr,
moins Polaris. Recommandation : **(a) avec repli (b)** décidé au premier rendu réel.

**S4 — Frais par passerelle (décision 16).** Liste des passerelles vues dans `orders`
(`payment_gateway_names`) sur 90 jours, valeurs courantes pré-remplies (Shopify Payments 1,5 à
2,9 % + fixe selon pays, PayPal, Stripe), chaque ligne « à confirmer » tant que le marchand n'a pas
cliqué « Confirmer » (`confirmed: true`). Option (a) une règle par passerelle ; (b) une règle
globale + surcharges. Recommandation : **(a)**, c'est la forme déjà lue par `aggregate.js`.

**S5 — Coûts fixes (A6).** Lignes `fixed_costs` (libellé, montant mensuel, actif du / au) : ajout,
fin (date), suppression logique par `active_to`. (a) Table simple ; (b) catégories imposées
(loyer, salaires, outils, autres). Recommandation : **(a)** avec un libellé libre ; les extras
`fixed_costs_monthly` / `marketing_monthly` sont ensuite passés à `thresholds()` (point mort).

**S6 — Coûts de commande (A3, A4).** Port marchand : défaut + surcharges par pays, « confirmé » ;
emballage par commande ; coût par retour ; fenêtre de retour (jours) ; promesse de livraison
(jours). Un formulaire. Recommandation : garder les valeurs actuelles comme placeholders, ne jamais
pré-remplir un chiffre non confirmé.

**S7 — Objectifs et seuils (A12).** `profitability_threshold_pct` (CM2 cible, rappel de la bande
40-60), `target_margin_after_ads_pct` (ROAS cible), **`main_product_price`** (nouvelle colonne
S-01, règle `aov_vs_main_price`), seuil d'alerte (`margin_alerts.threshold` : (a) repris tel quel,
(b) fusionné avec le seuil de rentabilité et retiré, (c) déplacé vers `alert_rules`).
Recommandation : (c) plus tard avec la section Décisions ; ici (a) affiché sous son nom exact.
Le CPA courant (`current_cpa`) n'est pas repris (le moteur le calcule).

**S8 — Onboarding (PDF).** (a) Assistant en étapes au premier lancement. (b) Liste de contrôle
sur Fiabilité (déjà là : score, manques, déblocages) + champs manquants ajoutés à Réglages > Boutique
(pays de vente, pays d'expédition, sources d'approvisionnement, langue des rapports : migration
S-01, colonnes nullables). Recommandation : **(b)** : aucun écran bloquant, l'état vide reste
actionnable ; l'assistant viendra avec les 35 langues.

**S9 — Alertes.** `alert_rules` et les canaux restent hors périmètre (section Décisions / Alertes).
Réglages n'expose que les seuils.

**S10 — Mémoire des décisions.** À chaque sauvegarde qui touche une règle de données (frais
confirmés, port confirmé, coût fixe, coût produit), `decision_log` `data_fixed` **explicite**
(scénario : champ, ancien score, nouveau score) en plus de la déduction I0-C ; les deux ne se
doublonnent pas (empreinte de règle + jour). Recommandation : oui, c'est le seul endroit où
« corriger une donnée » est un geste.

## 3. Arbitrages Simulateur (T1 à T7)

**T1 — Niveau du Simulateur V1.** (a) Boutique seule (feuilles agrégées de la période, `simulate`)
; (b) boutique + produit (prix de vente minimum) dès V1 ; (c) produit seul (porter l'existant).
Recommandation : **(a)** : c'est ce que le copilote sait déjà ouvrir (opportunité, CTA `simulate`,
scénario retenu) ; le mode produit suit (T2).

**T2 — Simulateur produit (décision 18).** (a) Porté comme mode « Produit » du Simulateur :
`computeLandedCost` (engine.js, protégé, appelé tel quel) + `findThreshold` sur `price_factor` au
niveau ligne, sans le « + 4,5 % » codé en dur ; (b) conservé dans l'écran classique jusqu'à F4-D.
Recommandation : **(b) pour le lot S1, (a) au lot S3**, et `calculations` / `calculation_annotations`
tombent avec l'écran classique.

**T3 — Interaction.** Les leviers demandent un état client. (a) Calcul **côté client** avec
`econ/simulate.js` (pur, sans I/O) sur des champs HTML natifs (curseur + nombre) tenus par React
(autorisé : ce sont des champs natifs, pas Polaris), scénario initial lu dans l'URL
(`?rule=…&price_factor=…`) pré-chargée par le CTA ou par `decision_log.scenario` ; (b) recalcul
serveur à chaque changement (formulaire POST) : lent, sans curseurs. Recommandation : **(a)** ; la
page charge les feuilles agrégées de la période (`loadOverview` sans briefing) une fois.

**T4 — Horizon.** (a) Mois calendaire (décision 4) : projeter sur le nombre de jours du mois en
cours ; (b) mois glissant 30 jours (I0-A) ; (c) période de référence choisie (7 / 30 / 90) sans
projection. Recommandation : **(b) pour l'opportunité et le Simulateur** (cohérent avec I0-A,
« environ … par mois »), et amender la décision 4 ; (c) proposé en bascule dans le Simulateur.

**T5 — Fourchette D2(c).** Scénarios bas / haut : volume −10 % / +10 % autour du scénario (le
levier « volume » = `cvr_factor` avec l'hypothèse « sessions constantes ») ; fourchette affichée
sur CA, CM2, résultat ; niveau de confiance = « Simulation » + score de fiabilité. Recommandation :
oui, c'est ce que D2 prévoyait « quand le simulateur est livré ».

**T6 — Persistance et offres.** Scénario = `decision_log` `simulated` (I0-C) ; liste « Mes
scénarios » = `decision_log WHERE kind = 'simulated'` avec rejeu ; comparaison de 2 à 3 scénarios
(Expert « scénarios multiples ») ; Free « une simulation simple » = un seul levier à la fois.
Facturation intouchée : lecture du plan via `plan.js` seulement. Recommandation : **aucune
restriction au lot S1**, restrictions au lot S2 quand la tarification sera décidée.

**T7 — Mode objectif.** « Quel prix pour une CM2 de 55 % ? » = `findThreshold` (levier
`price_factor`, nœud `cm2_pct`, cible) ; « Quel CAC maximal ? » = `be_cac` déjà calculé.
Recommandation : lot S2, un seul levier à la fois (monotonie supposée par la bissection).

## 4. Découpe en lots

| Lot | Contenu | Taille | Dépend de |
|---|---|---|---|
| **R0** | Migrations S-01 (`main_product_price`, pays de vente / expédition, sources d'appro, langue des rapports : colonnes nullables sur `shop_settings`) et S-02 (trigger de recopie `shop_plans` → `shop_settings`, idempotent), rollback, lot 23 ; test → rollback prouvé → prod | S | GO base |
| **R1** | Réglages socle : `/app/settings` (index + état), `/app/settings/costs` (port par pays, emballage, retour, fenêtre, promesse ; frais par passerelle avec « Confirmer » ; coûts fixes), `/app/settings/goals` ; écriture `shop_settings` + recopie `shop_plans` ; `data_fixed` explicite ; `thresholds()` alimenté (point mort) ; nav : Réglages devient « live » | M | R0, S3 tranché au premier rendu |
| **R2** | `/app/settings/shop` (pays, devise, TVA, B2B, historique, langue de l'admin et des rapports), `/app/settings/marketing` (codes, partenaires, commissions manuelles), `/app/settings/connections` (état, sans connecteur) | M | R1 |
| **R3** | Liste de contrôle d'activation sur Fiabilité (PDF : synchronisé, COGS, première situation) et états vides reliés aux pages Réglages | S | R1 |
| **S1** | Simulateur boutique : module pur `app/lib/simulator/` (mappage PDF → leviers / overrides, scénarios bas / haut, fourchette, hypothèses, période de référence), `/app/simulator` pré-chargé par URL, calcul client sur champs natifs, résultat avant / après / delta sur CA, CM2, CM3, résultat, BE-ROAS, tableau des hypothèses, « Retenir ce scénario » ; les CTA `simulate` des analyses y mènent ; nav : Simulateur « live » | M | I0-C appliqué (mémoire), T3/T4/T5 tranchés |
| **S2** | Mes scénarios (rejeu depuis `decision_log`), comparaison 2-3 scénarios, mode objectif (`findThreshold`), résultat observé (`observed_impact` à J+30), restrictions d'offre si décidées | M | S1 |
| **S3** | Mode Produit (prix de vente minimum, coût rendu, TARIC) porté depuis l'écran classique, sans le « + 4,5 % » ; suppression de `calculations` / `calculation_annotations` avec F4-D | M | S1, F4-D |
| **F4-B** | Graphiques (courbe, cascade, visx pour le Simulateur, décision 8) | M | React 19 / Polaris Viz tranchés |

Ordre recommandé : R0 → R1 → S1 → R2 → R3 → S2 → S3, F4-B en parallèle dès que C1 (React 19) est
tranché. Chaque lot : Phase d'écriture sur GO, gate complète, preuve de rendu, rapport, commit sur
GO séparé, migrations sur GO base par base.

## 5. Faits à vérifier avant R1 et S1

1. Participation des composants Polaris WC aux formulaires natifs (`name` + soumission) : à
   prouver au premier rendu réel, sinon repli sur champs HTML (S3).
2. `orders.payment_gateway_names` (ou équivalent) est-il stocké par la sync v2 pour lister les
   passerelles (S4) ? À lire dans `sync/normalize.js` / F1-02 avant R1.
3. Volume et coût des feuilles agrégées envoyées au client pour le calcul (T3) : la période 90 j
   tient dans une réponse de loader (agrégats seulement, jamais les lignes).
4. Décision 4 (horizon) à amender ou confirmer (T4).

## 6. Ce qui reste

Vos arbitrages S1-S10 et T1-T7, puis GO R0 (migrations sur test), ou GO S1 si vous préférez livrer
le Simulateur avant Réglages (S1 ne dépend que de I0-C appliqué ; sans R1 les coûts fixes et
frais restent « à confirmer » et le Simulateur le dira).
