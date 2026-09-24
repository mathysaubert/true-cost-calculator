# Phase 0 — F4-B Graphiques : courbe de contribution, cascade, mini-courbes (2026-09-24)

Lecture seule : aucun fichier modifié. Périmètre : la courbe de contribution (bloc 6 de
« Aujourd'hui », emplacement réservé), la cascade « Où est passé votre argent ? » en graphique
(bloc 7, tableau depuis I0-B), les mini-courbes existantes des tuiles, et la décision technique
React 18 / 19 + bibliothèque (C1, décision 8) avec ses conséquences pour l'écran classique, les
tests et Built for Shopify. Faits vérifiés le 2026-09-24 (npm, doc Shopify) ; règles de
visualisation issues du guide dataviz interne.

## 1. Ce qui existe

| Élément | État | Fichiers |
|---|---|---|
| Mini-courbes des tuiles | SVG maison, une série, aplat dégradé, sans axes ; géométrie pure testée (lot 26) ; jours sans commande interrompent le trait ; `currentColor` = teinte de section ; `<title>` accessible | `app/lib/sparkline.js`, `components/overview/Sparkline.jsx`, `KpiTile.jsx` |
| Séries par jour | `aggregate()` produit `byDay[jour] = { leaves, nodes }` ; `kpiSeries` construit `[{ day, value }]` sur la fenêtre, avec 0 pour les montants sans commande et `null` pour les ratios ; nul si moins de 2 jours définis | `app/lib/econ/aggregate.js` (protégé), `app/lib/overview.js` |
| Période précédente | `loadOverview` agrège la fenêtre précédente et les 4 périodes de référence : les séries « avant » existent déjà, non exposées à l'écran | `app/lib/overview.server.js` |
| Cascade | tableau de 12 lignes (CA HT, − 5 coûts, = CM2, − pub, − commissions, = CM3, − fixes, = résultat) depuis feuilles + nœuds | `components/overview/Briefing.jsx` |
| Emplacement réservé | carte « Évolution de la contribution · Bientôt » (`OVERVIEW_RESERVED`), conteneur de requête sur le parent | `Blocks.jsx`, `sections.js`, `overview.css` |
| Jetons couleur | revenus bleu, marges violet, acquisition orange, bon / mauvais / neutre, en clair **et** sombre (paires AA calculées au lot 26) ; `prefers-reduced-motion` coupe toute animation ; propriétés logiques (RTL) | `app/styles/overview.css` |
| Garde-fous | lot 26 : aucun style inline ni couleur en dur dans les composants, une `@container` ne cible jamais son conteneur, SVG dimensionnés ; `render_check` : rendu SSR réel de chaque composant | `tests/lot26_*`, `scripts/render_check.mjs` |

## 2. Faits vérifiés le 2026-09-24

### 2.1 Bibliothèques (npm)

| Paquet | Dernière version | Pairs React | Remarques |
|---|---|---|---|
| `react` / `react-dom` | 19.3.0 | — | l'app est en 18.3.1 |
| `react-router` | 8.4.0 | `>= 19.2.7` | l'app est en 7.12 : rester en 7 permet React 18 ; passer en 8 **impose** React 19 |
| `@shopify/shopify-app-react-router` | 3.0.0 | `react >= 18`, `react-router ^7.6.2` | l'app est en 1.2.0 ; 3.0 reste compatible React 18 et react-router 7 |
| `@shopify/polaris-viz` | 16.16.0 (publiée le 2025-05-19, aucune version depuis 16 mois) | `^16.14 || ^17 || ^18` **seulement** | dépend de d3 (path, array, color, scale, shape), `@react-spring/web`, `@juggle/resize-observer` ; lit `window` au rendu (client seul, doc Shopify « Build a sales dashboard ») |
| `@visx/shape`, `@visx/scale`, `@visx/axis` | 4.0.0 | `^18 || ^19` | SVG pur, rendu serveur possible, arborescence découpable ; `@visx/xychart` ajoute `@react-spring/web` |

Conclusion de fait : **Polaris Viz est incompatible avec React 19 et n'est plus maintenue** ; la
décision 8 (« Polaris Viz pour les écrans ») repose sur une bibliothèque qui bloquerait React 19
et react-router 8. visx et le SVG maison sont les deux voies compatibles avec 18 et 19.

### 2.2 Built for Shopify (doc « requirements », lue le 2026-09-24)

- Performance admin sur 28 jours et 100 appels minimum : **LCP ≤ 2,5 s, CLS ≤ 0,1, INP ≤ 200 ms**.
- Application intégrée avec la dernière version d'App Bridge (`app-bridge.js` en tête), navigation
  par `s-app-nav`, authentification par jeton d'identité : en place.
- Apparence : « mimic Shopify's core look and feel », conteneurs en cartes, boutons conformes,
  **Contextual Save Bar pour les formulaires**, `s-modal` avec titre et actions. Rien n'est exigé
  sur les graphiques ni sur les bibliothèques tierces.

Conséquences : un graphique rendu **après** hydratation (client seul) crée un décalage de mise en
page (CLS) sauf réservation exacte de hauteur ; un survol qui recalcule tout le graphique pèse sur
INP ; le poids du bundle pèse sur LCP. La Contextual Save Bar concerne Réglages (R1, R2) : à
traiter en R3, hors F4-B.

### 2.3 Règles de visualisation retenues (guide dataviz)

Un seul axe (jamais deux échelles) ; légende dès deux séries et étiquettes directes jusqu'à
quatre ; couleur attachée à l'entité, jamais au rang ; traits de 2 px, marqueurs ≥ 8 px, écarts de
2 px entre barres ; survol avec réticule et infobulle par défaut ; mode sombre choisi (mêmes
jetons), pas inversé ; texte en encre de texte, jamais en couleur de série ; une vue tableau
existe (c'est déjà le cas pour la cascade et « Voir le calcul »).

## 3. Arbitrages

**V1 — React et bibliothèque (C1, décision 8).**

| Option | Ce qu'elle implique |
|---|---|
| (a) **React 18 + SVG maison** (prolonger `sparkline.js` en module `app/lib/charts/` pur : échelles, graduations, tracés avec trous, barres de cascade ; composants `components/charts/`) | 0 dépendance ; rendu serveur complet donc `render_check` prouve chaque état (chargé, vide, sombre, RTL) ; CLS nul ; jetons CSS et `currentColor` ; interaction (réticule, infobulle) = un petit état client sur des éléments natifs, comme le Simulateur ; coût : écrire échelles et graduations (≈ 400 lignes, testées au lot 31) ; écran classique intouché |
| (b) **React 18 + Polaris Viz** | apparence Polaris « officielle » ; mais client seul (`window`) : squelette SSR + rendu après hydratation, `render_check` ne prouve que le squelette, CLS à contenir ; + d3 + react-spring dans le bundle ; **bibliothèque figée depuis mai 2025 et limitée à React 18** : ferme la porte à React 19 et à react-router 8 tant qu'elle est là |
| (c) **React 19 + visx** | aligne l'app sur la doc Polaris WC (champs contrôlés) et sur react-router 8 ; visx en SVG pur, SSR possible, pairs 18 et 19 ; coût : migration React 19 maintenant : `app._index.jsx` (4 100 lignes, protégé jusqu'à F4-D) à re-tester intégralement sous 19, `@shopify/shopify-app-react-router` 1.2 → 3.0 (peer `>= 18`, changements d'API à lire), `react-dom/server` inchangé pour `render_check`, avertissements `prop-types` disparaissent (ESLint à ajuster) ; + `@visx/*` (léger) |
| (d) **(a) maintenant, (c) à F4-D** | graphiques livrés sans dépendance ni migration ; React 19 + visx (Simulateur avancé S2, champs contrôlés) décidés quand l'écran classique tombe et que RR 8 devient nécessaire ; la décision 8 est amendée : **Polaris Viz abandonnée**, SVG maison pour les écrans, visx candidat après React 19 |

Recommandation : **(d)**. Elle respecte C1 (a) déjà décidé pour F4-A / F4-B, ne touche pas
l'écran classique, garde `render_check` comme preuve complète et n'ajoute rien au bundle. (b) est
à écarter sur les faits (maintenance, React 19). (c) est la bonne cible, au bon moment (F4-D).

**V2 — Courbe de contribution (bloc 6).** Séries : CA HT et CM2 par jour (2 séries, légende +
étiquette directe en fin de trait), période précédente en trait fin pointillé neutre (a) ou
absente (b) ; jours sans commande : trait interrompu (comme les mini-courbes) (a) ou zéro (b).
Recommandation : (a) pour les deux : la comparaison est le message ; un trou dit « pas de
donnée », un zéro dit « rien vendu ».

**V3 — Interaction.** (a) Réticule + infobulle au survol et au clavier (flèches), rendus par un
état client sur le SVG, valeurs déjà formatées côté serveur pour chaque jour (aucun calcul au
survol : INP) ; (b) `<title>` natif par point seulement. Recommandation : (a), avec (b) comme
repli accessible.

**V4 — Cascade (bloc 7).** (a) Barres verticales flottantes (CA en tête, coûts en descente,
totaux CM2 / CM3 / résultat ancrés à zéro, étiquettes directes des totaux), tableau conservé sous
un dépliage « Voir le tableau » ; (b) barres horizontales (mieux sur téléphone, 12 lignes) ;
(c) graphique seulement. Recommandation : **(b)** : lisible en une colonne, étiquettes longues
(« Frais de paiement ») à gauche, tableau conservé comme vue accessible.

**V5 — Mini-courbes.** (a) Inchangées ; (b) + trait fantôme de la période précédente et point
final marqué (8 px) ; (c) + infobulle. Recommandation : (b) : cohérent avec la courbe principale,
sans interaction dans une tuile.

**V6 — Couleurs.** Séries : CA HT = bleu revenus, CM2 = violet marges (couleur de donnée, pas de
bouton : C12 respecté), période précédente = neutre ; cascade : coûts en encre neutre, totaux en
violet, résultat en bon / mauvais selon le signe. Validation des paires par le validateur du guide
dataviz (clair et sombre) au lot 31.

**V7 — Où.** Courbe et cascade sur « Aujourd'hui » (blocs 6 et 7) ; la courbe aussi sur
Indicateurs au-dessus de la grille (a) ou seulement sur « Aujourd'hui » (b). Recommandation : (b)
en B1, (a) ensuite si demandé.

**V8 — Seuil d'affichage.** Courbe rendue dès 2 jours définis avec au moins 2 valeurs non nulles
(règle de `kpiSeries`) ; sinon l'emplacement reste une carte « pas encore assez de jours » (état
vide actionnable, jamais un graphique vide).

## 4. Découpe en lots

| Lot | Contenu | Taille | Dépend de |
|---|---|---|---|
| **B0** | Module pur `app/lib/charts/` : échelles linéaire et temporelle, graduations « jolies », tracés ligne / aire avec trous, géométrie de cascade (barres flottantes, totaux), formatage des étiquettes par locale ; lot 31 (géométrie, bornes, trous, RTL par miroir) ; validateur de palette exécuté sur les jetons clair / sombre | S | V1 (d), V6 |
| **B1** | Courbe de contribution : `ContributionChart` (2 séries + période précédente, légende, étiquettes directes, axe unique, réticule + infobulle, clavier), séries exposées par `loadOverview` (courante + précédente), remplacement de l'emplacement réservé, état vide, `render_check` (chargé, vide, sombre, RTL, réduit) | M | B0, V2, V3, V8 |
| **B2** | Cascade graphique : `WaterfallChart` horizontal depuis `WATERFALL_ROWS`, étiquettes directes, tableau sous dépliage, `render_check` | S | B0, V4 |
| **B3** | Mini-courbes : trait fantôme de la période précédente, point final, mêmes règles de trous | S | B0, V5 |
| **B4** | Simulateur : barres avant / après par nœud (optionnel, après S2) | S | B0 |
| **F4-D (rappel)** | React 19 + visx + react-router 8 + `shopify-app-react-router` 3, suppression de l'écran classique et de `calculations` | L | V1 (d) |

Ordre : B0 → B1 → B2 → B3 ; B4 avec S2. Chaque lot : GO d'écriture, gate complète, preuve de
rendu réel, rapport, commit sur GO séparé. Aucune migration.

## 5. Faits à vérifier avant B1

1. `byDay` porte-t-il `cm2` par jour quand certaines lignes sont à coût inconnu (nœud `cm2` = CA
   connu − coûts) : à lire dans `aggregate.js` (lecture seule) pour décider si la courbe CM2
   affiche un trou ou une valeur partielle marquée.
2. Contextual Save Bar (BFS) : composant Polaris WC `s-save-bar` ? existence et usage sans champ
   contrôlé à vérifier (doc), pour R3.
3. Hauteur réservée du bloc 6 (CLS) : fixer une hauteur en `rem` identique entre l'état vide, le
   squelette et le graphique.

## 6. Ce qui reste

Vos arbitrages V1 à V8, puis GO B0.
