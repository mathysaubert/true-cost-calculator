# Phase 0 — Débordement horizontal mobile de l'onglet Suivi des coûts (iOS)

Date : 2026-08-30. Exploration seule : aucun code produit. Contrainte assumée : aucun iOS
disponible dans cette session — tout constat ci-dessous est prouvé PAR LE CODE (fichier:lignes),
et la part qui ne peut l'être que par l'appareil est explicitement marquée « à confirmer par la
capture E1 ». Le desktop est couvert par render_check ; le mobile ne le sera que par E1.

---

## P0.1 — Inventaire des éléments à largeur contrainte, et le coupable principal

### (a) La barre d'onglets : HORS DE CAUSE (prouvée repliable)

`app/routes/app._index.jsx:2994` :

```jsx
<div style={{ display: "flex", gap: "0", marginBottom: "24px", borderBottom: "2px solid #E4E5E7", flexWrap: "wrap" }}>
```

`flexWrap: "wrap"` : les 6 onglets + badge se replient sur plusieurs lignes en dessous de la
largeur nécessaire. Aucun onglet n'a de largeur figée ni de nowrap débordant. Elle peut être
moche sur mobile (3 lignes), mais elle ne PEUT pas élargir le viewport.

### (b) Les tableaux : LES SEULS éléments du tab avec une largeur intrinsèque > viewport mobile

Inventaire exhaustif (grep `minWidth|overflowX|gridTemplateColumns|width: "\d+px"` sur la route
et `app/components/costsUi.jsx`) — l'onglet Suivi des coûts contient exactement TROIS tableaux
à `minWidth` en dur, tous enveloppés dans un wrapper `overflowX: "auto"` :

1. **COUPABLE PRINCIPAL — panneau d'édition des coûts** (`costsUi.jsx:161-162`) :

```jsx
<div style={{ overflowX: "auto" }}>
  <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "820px" }}>
```

   820 px > toute largeur d'iPhone (320-430 px) et même > le breakpoint 768 de la media query
   existante. C'est en plus le PREMIER élément large que rencontre le parcours réel du
   marchand : il tape un produit de la liste pour saisir ses coûts → le panneau se déplie
   (`app._index.jsx:2375-2378` → `renderPanel` → `ProductCostPanel`). Ses `<select>` internes
   ont `minWidth: "150px"` (`costsUi.jsx:148`) : la table ne peut pas se compresser.

2. **Tableau du MarginMonitor** (`app._index.jsx:1971-1972`) : `minWidth: "480px"`,
   `tableLayout: "fixed"`, wrapper `overflowX: "auto"`. Rendu seulement quand l'accordéon
   « Historique de marge réelle » est ouvert (`useState(false)`, `:1810`).

3. **Tableau du dépli par commande** (`app._index.jsx:1780-1781`) : `minWidth: "380px"`,
   wrapper `overflowX: "auto"`. Rendu au dépli d'une ligne du monitor.

### (c) Autres largeurs figées du fichier (inventaire, hors cause ou hors périmètre)

- Modal d'annotation `width: "400px"` (`app._index.jsx:3821`) : déborde de 10-80 px sur
  iPhone, mais vit dans l'onglet Historique (position:fixed, à l'ouverture seulement) —
  HORS périmètre de ce chantier (R6), signalé pour le backlog.
- Tooltip d'info `position: "fixed", width: "260px"` (`:174`) et tooltip sparkline
  (`:266`) : affichés au survol/tap seulement, position fixed (ne participent pas à la
  largeur de layout) — hors cause pour un débordement au chargement.
- Inputs 90-120 px, select pays `width: "auto"`, badges : tous dans des conteneurs
  `flexWrap: "wrap"` (`:2396, :2407, :2438, :2463, :2272, :2304, :2349`) — se replient.
- `CostSummaryBanner`/`ReliabilityCounter`/`ProductCostList` (costsUi) : flex avec wrap,
  `overflow: hidden` + ellipsis sur les titres (`costsUi.jsx:120`), pills nowrap courtes
  (~110-180 px) — la plus large combinaison calculée reste ≈ 350 px de min-content, sous
  les 375 px d'un iPhone mini.
- `DualLineChart` : SVG `viewBox` + `width: "100%"` (`:1623`) — responsive par construction.

### Verdict P0.1 et point d'honnêteté sur « au chargement »

Le coupable principal est le tableau 820 px du panneau d'édition (n° 1), les n° 2 et 3 étant
la même classe de bug en plus petit. Point d'honnêteté : au chargement STRICT de l'onglet
(aucun produit déplié, monitor replié — états initiaux prouvés : `expandedId` null
`:2158`-zone, `open` false `:1810`), AUCUN élément du code n'a une largeur intrinsèque
supérieure à ~350 px. Deux lectures compatibles avec le screenshot : (1) la capture a été
prise avec un panneau déplié (un seul tap de navigation naturelle) ; (2) une fois le viewport
élargi par un dépli antérieur, iOS CONSERVE le zoom arrière après repli/changement d'onglet —
ce qui explique aussi « le viewport élargi contamine ensuite les autres vues » (les onglets
sont du state client, même document : l'élargissement survit au démontage du composant). La
capture E1 arbitrera ; le correctif proposé neutralise de toute façon LA classe entière (les
trois wrappers), donc la distinction n'affecte pas le périmètre du fix.

## P0.2 — Meta viewport et font-size des inputs

- **Meta viewport : présente et correcte.** `app/root.jsx:8` :
  `<meta name="viewport" content="width=device-width,initial-scale=1" />`. Pas en cause.
- **Auto-zoom iOS (inputs < 16 px) : DÉJÀ traité.** Les inputs de l'app sont à 12 px en
  inline (`app._index.jsx:2227`, `costsUi.jsx:147`), MAIS la media query mobile existante
  force `input, select, textarea { font-size: 16px !important; }` (`app._index.jsx:2905`,
  bloc `@media (max-width: 768px)` :2871-2906, feuille light-DOM globale au document donc
  elle atteint aussi les composants costsUi). L'auto-zoom au focus n'est donc pas la cause,
  et I2 est SANS OBJET (rien à faire).
- **« Texte surdimensionné » au chargement** : symptôme cohérent avec le text autosizing
  iOS (`-webkit-text-size-adjust` par défaut) qui gonfle les polices quand le viewport de
  layout est plus large que l'écran — conséquence du débordement (b), pas cause distincte.
  Attendu : il disparaît avec le fix. Ceinture optionnelle possible
  (`html { -webkit-text-size-adjust: 100%; }`, 1 ligne, sans effet quand rien ne déborde) —
  proposée en option en P0.4, décision à toi.

## P0.3 — Polaris / App Bridge et non-régression desktop

La section n'utilise AUCUN composant Polaris stylé maison : l'app rend ses propres divs en
styles inline dans `<s-page>`/`<s-section>` (web components App Bridge, `app._index.jsx:2869`,
`:2983`, `:3816`) et n'écrase aucun CSS Polaris (aucun sélecteur ciblant `s-*` ou `.Polaris-*`
dans le dépôt). Le pattern responsive EXISTANT du fichier est une media query
`@media (max-width: 768px)` avec des classes `tcc-*` et `!important` (`:2871-2906`) couvrant
Calculateur, Simulation, Historique, Alertes, Audit… et **aucune règle pour l'onglet Suivi des
coûts** — c'est le trou factuel. Le correctif suivra ce même pattern : media query mobile
uniquement → le desktop est inchangé PAR CONSTRUCTION (aucune règle ne s'applique > 768 px),
et render_check (desktop) le prouvera en gate.

Pourquoi `overflowX: "auto"` seul a pu échouer sur iOS (à confirmer par la capture) : un
wrapper de défilement sans contrainte de largeur propre contribue son min-content (celui de la
table, 820 px) au dimensionnement intrinsèque de ses ancêtres ; si un ancêtre (layout interne
de `s-section`, hors de notre contrôle) dimensionne sa piste au contenu, le wrapper reçoit
820 px de large et ne scrolle jamais — c'est la page qui déborde. Le fix choisi neutralise
précisément cette propagation.

## P0.4 — Correctif minimal proposé

**Option retenue : contenir les trois wrappers de tableau, en mobile seulement, par le
pattern CSS « width: 0 + min-width: 100% ».** Sur un scroll-wrapper, `width: 0` annule sa
contribution min-content vers les ancêtres (la chaîne peut se resserrer à la largeur du
viewport) et `min-width: 100%` le ré-étire à la largeur — désormais bornée — de son parent :
la table garde son `minWidth` et défile À L'INTÉRIEUR, la page ne s'élargit plus, quel que
soit le comportement des conteneurs `s-section`.

Concrètement :

1. Ajouter `className="tcc-scroll-x"` aux trois wrappers existants (`costsUi.jsx:161`,
   `app._index.jsx:1780`, `:1971`) — 3 lignes touchées, aucun style inline modifié.
2. Dans le bloc media query existant (`:2871-2906`), ajouter une sous-section « Suivi des
   coûts » :

```css
.tcc-scroll-x { width: 0 !important; min-width: 100% !important; max-width: 100% !important; }
```

3. OPTION (ceinture, à valider ou refuser explicitement) :
   `html { -webkit-text-size-adjust: 100%; }` hors media query — supprime le gonflement de
   texte iOS même si un élément imprévu déborde un jour ; strictement sans effet visuel
   quand rien ne déborde ni sur desktop. Hors pattern existant (pas dans la media query) :
   je ne l'inclus PAS d'office, décision à toi.

Options écartées : barre d'onglets scrollable (elle wrap déjà, rien à corriger) ; réduction
des `minWidth` des tables (écraserait les champs de saisie, changerait le desktop si faite en
inline) ; `overflow-x: hidden` sur la racine de l'onglet (masquerait le symptôme sans garantir
le resserrement du conteneur élargi) ; refonte responsive du tableau en cartes (hors R6).

Alternatives desktop intactes : la règle vit sous `@media (max-width: 768px)` → render_check
35 scénarios (desktop, aucune media query mobile active) doit rester STRICTEMENT identique.

## P0.5 — Fichiers touchés + estimation

| Fichier | Nature | Lignes |
|---|---|---|
| `app/components/costsUi.jsx` | `className="tcc-scroll-x"` sur le wrapper du tableau 820 px | 1 |
| `app/routes/app._index.jsx` | même classe sur les wrappers 380 px et 480 px (2 lignes) + règle CSS dans la media query existante (+ 2-3 lignes avec commentaire) | ~5 |
| (option ceinture si validée) | `html { -webkit-text-size-adjust: 100%; }` dans le même `<style>` | +1 |

Total : **~6-7 lignes** (7-8 avec l'option). Aucun nouveau fichier, aucune nouvelle chaîne
visible (zéro texte), aucun test structurel existant à modifier — T2 : la vérification mobile
est EMPIRIQUE (E1 par toi), documentée comme telle. I3 : réel > +30 % → STOP.

Préparation E1 (exécution post-implémentation) : l'URL d'app étant épinglée sur la prod
(constat V4/V5 du chantier BETA_SHOPS), la capture mobile passera par un déploiement — après
le GO commit, Vercel redéploie, puis admin Shopify iOS → app → onglet Suivi des coûts →
déplier un produit → vérifier : pas de coupe à droite, texte à taille normale, la table des
coûts défile horizontalement SEULE (au doigt), et les autres onglets restent à la bonne
échelle après passage. Le chantier reste NON livrable tant que ta capture ne le confirme pas.

---

## STOP — décisions attendues avant toute ligne de code

1. Valider le diagnostic P0.1 (coupable principal : table 820 px du panneau d'édition ;
   classe complète = les 3 wrappers) et la lecture « chargement vs dépli » soumise à E1.
2. Valider l'option P0.4 (classe `tcc-scroll-x` + règle `width: 0 / min-width: 100%` dans la
   media query existante, mobile uniquement).
3. Trancher l'option ceinture `-webkit-text-size-adjust: 100%` (incluse ou non).
