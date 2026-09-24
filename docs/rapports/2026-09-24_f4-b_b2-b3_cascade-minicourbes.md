# F4-B — B2 cascade horizontale, B3 mini-courbes avec période précédente (2026-09-24)

Suite de `2026-09-24_f4-b_b0-b1_courbe-contribution.md` (B0/B1 committés `29b333c`). GO B2 et B3
reçus le 2026-09-24 ; aucun commit sans GO.

Statut : **écrit et prouvé localement (gate complète verte). Aucune dépendance npm, aucune
migration, aucun commit, aucun push.** Fichiers protégés : 0 diff.

## 1. B2 — cascade « Où est passé votre argent ? » (V4, V6)

- `app/lib/charts/waterfall.js` : `WATERFALL_SPEC` (12 lignes : départ CA HT, 8 coûts, totaux CM2,
  CM3, résultat) partagée par le graphique et le tableau ; un coût à 0 vaut 0 (jamais « −0,00 »).
- `app/components/charts/WaterfallChart.jsx` : barres **horizontales** flottantes en HTML + CSS
  (aucun SVG) : chaque coût part là où le total courant s'arrête, les totaux sont ancrés à zéro,
  la ligne du zéro est marquée, étiquettes longues à gauche, montants directs à droite (coûts
  négatifs), image nommée « Cascade du CA net … au résultat net … ». Couleurs de données seulement :
  départ bleu revenus, coûts en neutre, totaux en violet de donnée, résultat vert / rouge selon le
  signe, total négatif en rouge. Un coût sans valeur : aucune barre, « non renseigné » en ambre.
  Le tableau reste la vue accessible, sous un dépliage « Voir le tableau » (`WaterfallTable bare`).
- « Aujourd'hui » : le graphique remplace le tableau nu ; `OVERVIEW_RESERVED` est vide (courbe et
  cascade livrées) ; les clés « réservé » de la cascade sont retirées, la note du tableau explique
  la lecture.
- CSS : `.tcc-wf*` (grille libellé / piste / montant, zéro par `--zero`, barre par `--left` et
  `--width`, une colonne sous 480 px via le parent `.tcc-wf-host`).

## 2. B3 — mini-courbes des tuiles (V5)

- `app/lib/sparkline.js` : `sparklinePaths(points, previous)` → `{ line, area, ghost, last }` :
  la période précédente (alignée par index) est tracée sur la **même échelle** (0 inclus), sans
  aire ; `last` = dernier point défini de la série courante. Précédent absent, désaligné ou à un
  seul point → aucun fantôme.
- `Sparkline.jsx` : trait fantôme pointillé neutre, point final = trait de longueur nulle à bouts
  ronds en `non-scaling-stroke` (disque de 8 px quel que soit l'étirement du SVG).
- `buildKpis({ …, previousWindow })` fournit `previousSeries` ; le loader passe la fenêtre
  précédente ; `KpiTile` transmet `previous`.

## 3. Preuves locales (gate complète, 2026-09-24)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 646 avertissements (`react/prop-types`) |
| `npm test` | 31 lots verts ; lot 31 = 35 (+3), lot 26 = 126 (+3) |
| `node scripts/render_check.mjs` | 108 scénarios verts (+5) |
| `npm run build` | OK |
| fichiers protégés | 0 diff |

Lot 31 : spécification (12 lignes, départ, 8 coûts, 3 totaux), **boutique saine : CA HT − 5 coûts =
CM2 du moteur au centime, totaux = nœuds**, cascade en HTML avec variables de géométrie et image
nommée, mini-courbe avec fantôme et point de 8 px. Lot 26 : fantôme sur échelle commune (20 de la
période précédente en haut), trait sans aire, point final, aucun fantôme si précédent absent,
désaligné ou à un seul point ; plus aucun emplacement réservé.

Rendus réels : cascade en baisse (12 barres, départ revenus, 3 totaux dont résultat, zéro marqué,
coûts négatifs, image nommée, tableau sous dépliage à 12 lignes, aucune couleur inline) ; coûts
manquants et résultat négatif (port et coûts fixes « non renseigné » sans barre, retours à 0
affichés « 0,00 € », CM3 et résultat `is-negative`) ; anglais (« See the table », « not set ») ;
tuile CA net avec période précédente (fantôme pointillé + point final de 8 px) et sans (point seul).

## 4. Écarts et points ouverts

1. **Largeur minimale des barres** : 0,4 % pour qu'un petit coût reste visible ; un coût nul montre
   une barre de 0,4 % (repère) et « 0,00 € ».
2. **Fantôme des tuiles hors ratios** : `kpiSeries` ne produit des séries que pour les KPI en
   mode « jour » ; les ratios sans série n'ont ni courbe ni fantôme (inchangé).
3. **Pas d'infobulle sur la cascade ni sur les mini-courbes** (V4, V5 : sans interaction) ; le
   tableau accessible donne les valeurs exactes.
4. `ReservedSlot` / `ReservedSlots` restent dans `Blocks.jsx` pour un futur bloc ; la liste est vide.

## 5. Preuves à faire sur la boutique de dev (après GO commit + déploiement)

1. « Aujourd'hui » : cascade sous la courbe, départ bleu, coûts gris, CM2 / CM3 / résultat en
   violet, résultat en vert (ou rouge), « Coûts fixes : non renseigné » tant qu'aucun coût fixe
   n'est saisi puis barre et montant après saisie dans Réglages > Coûts ; « Voir le tableau » ouvre
   les 12 lignes avec les mêmes montants.
2. Tuiles : trait pointillé de la période précédente sur les tuiles à courbe (CA net, commandes,
   CM2 %…) et point final de 8 px ; sur 7 jours sans période précédente chargée, point seul.
3. Thème sombre : violet magenta des totaux, fantôme neutre lisible ; iPhone portrait : cascade en
   une colonne (piste sous le libellé), aucun débordement.

## 6. Ce qui reste

GO commit unique + push (statut Vercel via l'API GitHub), preuves ci-dessus, puis R3 (barre de
sauvegarde App Bridge `data-save-bar`, liste de contrôle d'activation, états vides reliés à
Réglages) et S2 (mode objectif, comparaison de scénarios, résultat observé).
