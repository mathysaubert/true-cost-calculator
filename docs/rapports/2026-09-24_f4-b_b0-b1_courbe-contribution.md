# F4-B — B0 module de graphiques pur, B1 courbe de contribution (2026-09-24)

Suite de `2026-09-24_f4-b_graphiques_phase0.md` ; arbitrages V1-V8 consignés dans
`2026-09-22_decisions.md` §J (décision 8 amendée : SVG maison, Polaris Viz abandonnée). GO B0 puis
B1 reçus le 2026-09-24 ; aucun commit sans GO.

Statut : **écrit et prouvé localement (gate complète verte). Aucune dépendance npm ajoutée, aucune
migration, aucun commit, aucun push.** Fichiers protégés : 0 diff (`econ/aggregate.js` lu tel quel).

## 1. Faits du §5 de la Phase 0, vérifiés

1. **CM2 par jour avec lignes à coût inconnu.** `finalize()` met `known_ca_ht`, `cogs` et les coûts
   à `null` pour un jour sans commande à coût connu → nœud `cm2` nul ce jour-là. Un jour mixte donne
   la CM2 des lignes connues, comme au niveau boutique. Traduction dans la courbe : trait
   interrompu (V2), note « La contribution ne compte que les lignes à coût connu » dès qu'une ligne
   de la période est à coût inconnu.
2. **Barre de sauvegarde (Built for Shopify).** App Bridge : attribut `data-save-bar` sur un
   `<form>` natif, « displays automatically when there are unsaved changes », `submit` = Save,
   `reset` = Discard, `data-discard-confirmation` optionnel, à ne pas combiner avec
   `shopify.saveBar`. Utilisable sans état React sur nos formulaires Réglages → lot R3.
3. **Hauteur réservée.** L'emplacement faisait 140 px ; la courbe et sa carte vide partagent
   `block-size: 16rem` (CLS nul, vérifié par le lot 31).

## 2. B0 — module pur `app/lib/charts/` (4 fichiers, 130 lignes)

| Fichier | Contenu |
|---|---|
| `scale.js` | `niceStep` (1 / 2 / 5 × 10^k), `niceDomain` (0 toujours inclus pour les montants, graduations multiples du pas), `linearScale` (avec inversion), `indexScale` (jours équidistants, plus proche index borné), `labelIndices` (premier, dernier, au plus 6 intermédiaires) |
| `line.js` | `seriesExtent`, `linePath` (ligne + aire, **trous respectés**, vrai zéro sur la base), `seriesCounts` (règle V8), `buildLineChart` : modèle complet (boîte 600 × 200, séries dont fantômes sans aire, dernier point, graduations en %, index le plus proche depuis un % de largeur) |
| `waterfall.js` | `waterfallGeometry` : cascade horizontale (départ, coûts flottants, coût manquant, totaux ancrés à 0, total négatif marqué), bornes et positions en % (pour B2) |
| `index.js` | exports + `CHART_COLORS` (valeurs validées, voir §4) |

## 3. B1 — courbe de contribution

- `app/lib/overview.js` : `buildChartSeries({ current, previous, window, previousWindow })` →
  séries CA HT et CM2 par jour, courante et précédente alignées par index, `enough` (V8 : 2 jours
  définis et 2 valeurs non nulles sur le CA HT), `partialCm2`. Un jour sans commande vaut 0 sur
  le CA HT (rien vendu) ; un jour avec commandes mais sans ligne connue vaut `null` sur la CM2.
- `app/lib/overview.server.js` : `chart` exposé par `loadOverview` (la période précédente était
  déjà agrégée).
- `app/components/charts/ContributionChart.jsx` (112 lignes) : SVG `preserveAspectRatio="none"`
  sans texte interne (traits non déformés par `vector-effect`), axes et étiquettes en HTML,
  légende (CA net, CM2, période précédente en pointillé neutre), aires légères, marqueurs de fin
  avec valeur (texte en encre, point coloré), réticule + infobulle au survol (`role="status"`),
  **curseur de jour natif** `<input type="range">` pour le clavier (flèches, Début / Fin, valeur
  annoncée par `aria-valuetext`), zone image nommée par `aria-label`, RTL par miroir du SVG,
  aucune animation. Positions par variables CSS de géométrie (`--x`, `--y`, `--pct`) et attributs
  `data-*` : aucune couleur ni propriété de style inline.
- État vide V8 : carte « Pas encore assez de jours » de même hauteur, icône, phrase avec la
  période ; `chart = null` → rien.
- « Aujourd'hui » : la courbe remplace l'emplacement réservé ; `OVERVIEW_RESERVED` ne garde que la
  cascade (B2).
- Catalogues : 9 clés `overview.chart.*` en/fr (756 au total, `fr = en`) ; `overview.reserved.chart`
  retirée.
- CSS : jetons `--tcc-chart-revenue`, `--tcc-chart-cm2`, `--tcc-chart-previous` (clair et les deux
  portées sombres), `.tcc-legend*`, `.tcc-chart*` (grille axe Y / tracé / curseur / axe X,
  `block-size: 16rem`, focus visible, `[dir="rtl"]` miroir).

## 4. Couleurs validées (validateur du guide dataviz, 2026-09-24)

| Contexte | Paire testée | Résultat |
|---|---|---|
| Clair sur `#ffffff` | revenus `#2a78d6` + marges `#6a56d9` (jeton de section) | **refusée** : ΔE normal 9,9 (< 15), CVD 3,1 |
| Clair | revenus `#2a78d6` + **`#4a3aa7`** (encre des marges) | **acceptée** : ΔE normal 16,3, CVD 13,0, contraste ≥ 3:1 |
| Sombre sur `#171a20` | revenus `#3987e5` + marges `#9085e9` | **refusée** : ΔE normal 9,8, CVD 1,9 ; aucun violet bleuté ne passe (6 candidats, ΔE ≤ 11,5) |
| Sombre | revenus `#3987e5` + **`#c05ac8`** (violet magenta) | **acceptée** : ΔE normal 20,1, CVD 6,7 (bande 6-8 : légale avec encodage secondaire, ici légende, étiquettes directes et aire) |
| Période précédente | `#8a8f9a` | hors palette catégorielle par construction (sous le plancher de chroma) : référence neutre encodée aussi par le pointillé |

Le violet des marges reste la couleur de section (tuiles, badges) ; la série CM2 utilise un jeton
de donnée dédié. Le lot 31 vérifie que la feuille porte exactement `CHART_COLORS`.

## 5. Preuves locales (gate complète, 2026-09-24)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 641 avertissements (`react/prop-types`) ; les deux erreurs `jsx-a11y` du premier jet (gestionnaires clavier sur une image) ont conduit au curseur natif |
| `npm test` | 31 lots verts ; lot 31 (nouveau) = 32 assertions |
| `node scripts/render_check.mjs` | 103 scénarios verts (+4) |
| `npm run build` | OK |
| fichiers protégés | 0 diff |

Lot 31 : pas joli, domaines (0 inclus, négatif, plat, 5 et 6 graduations), échelle linéaire et
inversion, échelle d'index bornée, étiquettes de jours ; trous (2 segments, aire fermée, vrai zéro
sur la base), étendue, comptes V8, modèle (fantôme sans aire, dernier point, graduation 0, positions
en %), modèle vide ; cascade (départ, coût flottant, coût manquant, totaux, total négatif, bornes,
largeurs) ; séries (30 jours alignés, Σ CA HT par jour = CA HT de la période au centime, CM2
partielle sur la boutique manquante, aucune commande, un seul jour) ; jetons = couleurs validées
sous les deux portées sombres, CM2 ≠ violet des marges ; scans (module sans dépendance ni DOM,
composant sans texte SVG, curseur natif, infobulle annoncée, aucune couleur ni style inline hors
variables de géométrie, hauteur 16 rem partagée, lot dans la chaîne).

Rendus réels (4) : saine (légende à 3 entrées, 2 fantômes + 2 séries avec aire, base 0, « 0 € »
sur l'axe, 2 marqueurs de fin, ≤ 7 étiquettes, aucune infobulle ni curseur au rendu serveur, image
nommée « CA net et contribution sur 30 jours, du … », curseur natif 0-29, aucun `<text>`, aucune
couleur en dur) ; manquante (note « lignes à coût connu », CM2 en plusieurs segments) ; pas assez
de jours (carte de même classe et hauteur, aucune courbe ; `null` → rien) ; anglais.

## 6. Écarts et points ouverts

1. **Infobulle et réticule sont client seuls** (état React sur survol / curseur) : le rendu
   serveur les prouve absents ; leur comportement se prouve sur la boutique de dev.
2. **Le curseur de jour est visible** (fine piste sous le tracé) : c'est le contrôle clavier
   idiomatique ; s'il gêne visuellement, il peut passer en « visuellement masqué mais focalisable ».
3. **Étiquettes de l'axe des jours** : au plus 7, format court de la locale ; sur téléphone très
   étroit elles peuvent se chevaucher (à regarder à la preuve iPhone ; masquage d'une sur deux sous
   360 px possible via `@container`).
4. **Cascade** : géométrie prête (B0), rendu en B2.

## 7. Preuves à faire sur la boutique de dev (après GO commit + déploiement)

1. « Aujourd'hui » sur 30 jours : la courbe s'affiche à la place de « Bientôt », deux séries et le
   pointillé de la période précédente, marqueurs de fin avec les valeurs du jour ; sur 7 jours
   avec moins de deux jours de ventes : carte « Pas encore assez de jours ».
2. Survol : réticule + infobulle avec le jour, CA net, CM2 et la valeur précédente ; flèches
   sur le curseur : même infobulle, jour annoncé au lecteur d'écran.
3. Jour de la commande #1038 (remise TEST20) : CA net du jour cohérent avec la tuile ; jour de
   #1022 (remboursée) : point à 0 ou trou sur la CM2 (ligne sans coût).
4. Thème sombre : bleu et violet magenta distincts, pointillé neutre lisible ; iPhone portrait :
   axe Y, tracé et curseur en une colonne, sans débordement ; `prefers-reduced-motion` sans effet
   (aucune animation).
5. Mesures Built for Shopify : aucun décalage de mise en page au chargement (hauteur réservée).

## 8. Ce qui reste

GO commit unique + push (statut Vercel via l'API GitHub), preuves ci-dessus, puis B2 (cascade
horizontale, tableau sous dépliage) et B3 (mini-courbes avec fantôme), R3 (barre de sauvegarde,
liste de contrôle d'activation).
