# Phase 0 — Réouverture : débordement portrait-seulement de l'onglet Suivi des coûts (iOS)

Date : 2026-08-30. Réouverture après échec du fix 7587e43 (tables `tcc-scroll-x`). Exploration
seule, aucun code produit. Intègre le fait nouveau (paysage ~850 px OK, portrait ~390 px KO)
et les 8 réponses de Mathys sur la capture (deux séries de questions ciblées).

---

## Faits établis (code + capture décrite)

Les réponses de Mathys, combinées :

1. TOUT est coupé à droite, dès l'en-tête et le titre — mais la barre d'onglets est REPLIÉE
   sur 2-3 lignes à taille normale, et le texte est partout à taille normale.
2. La page entière se déplace au balayage horizontal, et la bande révélée à droite est
   **du VIDE** (fond blanc/gris, aucun contenu visible).
3. Le dépassement est **petit : moins d'un tiers d'écran (~100 px)**.
4. Le bug est **spécifique à l'onglet Suivi des coûts** (app rouverte en portrait sur le
   Calculateur : correct tant que Suivi des coûts n'est pas visité).
5. Il apparaît **immédiatement** à l'affichage de l'onglet, AVANT le chargement de la liste
   des produits (donc pendant l'état `loading`, `rows === null`).

Mécanisme reconstruit : un élément du rendu IMMÉDIAT de `CostTracker` déborde
d'environ 100 px de façon INVISIBLE (aucune peinture dans la zone débordée) → le WebView
iOS élargit son viewport de layout à ~490 px (largeur du contenu) → tous les blocs à
largeur auto suivent, l'écran de 390 px n'en montre qu'une fenêtre (tout paraît « coupé »,
la page panne, le texte reste à l'échelle 1) → l'élargissement persiste après changement
d'onglet (même document) : la « contamination ». Cohérence totale avec le fait
paysage/portrait : à ~850 px de large, un contenu de ~490 px rentre, rien ne déborde.

Corollaires importants :

- Les tables 820/480/380 px sont **hors de cause pour CE symptôme** (non rendues au
  chargement — panneaux fermés `expandedId=null`, monitor replié `useState(false)`
  `app._index.jsx:1810` — et un coupable de 820 px aurait aussi débordé en paysage).
  Le fix 7587e43 reste correct pour SON cas (panneau ouvert) : on n'y retouche pas (P0.4).
- La ceinture `-webkit-text-size-adjust` est hors sujet ici (le texte est à taille normale
  sur la capture) — sans effet négatif, elle reste.

## P0.1/P0.2 — Inventaire du rendu immédiat : table d'exclusion (preuves)

Ensemble EXACT rendu à l'état initial de l'onglet (panneaux fermés, `loading === true` —
le panneau douane est exclu par construction : `{!loading && <CustomsClassificationPanel…>}`,
`app._index.jsx:2349`) :

| Élément (fichier:ligne) | Largeur rendue | Verdict |
|---|---|---|
| AlertingQuotaBanner (`:2065`) | null pour un shop Expert (`:2066`), sinon blocs texte | exclu |
| Intro + CostSummaryBanner (`costsUi.jsx:21-48`) | flex `flexWrap:"wrap"`, plus large item ~180 px | exclu |
| ReliabilityCounter (`costsUi.jsx:54-93`) | texte + boutons inline, wrap | exclu |
| Bloc sync violet (`:2272-2301`) | `flexWrap:"wrap"`, bouton ~210 px | exclu |
| Bloc recalc gris (`:2306-2333`) | `flexWrap:"wrap"`, bouton ~240 px | exclu |
| En-tête MarginMonitor replié (`:1836`) | `width:"100%"` bouton (border-box UA), min-content ~330 px | exclu |
| Boutons CSV (`:2352-2355`) | `flexWrap:"wrap"` | exclu ; input file `display:"none"` (`:2355`) sans boîte | exclu |
| Boîte « Chargement de vos produits… » (`:2376`) | div width auto, padding 40 sans width → pas de débordement | exclu |
| Réglages : pays/taux/seuil/CPA (`:2396-2486`) | tous `flexWrap:"wrap"`, inputs 90-120 px, `inputStyle` boxSizing border-box (`:2224`, `:115-119`) | exclu |
| AlertBanner au-dessus de la section (`:285-305`) | texte seul, wrap ; et non spécifique costs | exclu |
| Barre d'onglets (`:2994`) | `flexWrap:"wrap"` — confirmé par la capture (repliée) | exclu |

Vérifications transverses : aucun `vw` dans tout `app/**` (grep `100vw|[0-9]+vw` : une seule
occurrence, `100vh` dans auth.session-token) → **hypothèse P0.3 (100vw) RÉFUTÉE** ; aucun
`width` fixe dans la tranche 390-850 rendu au chargement (le modal 400 px `:3824` n'apparaît
qu'à l'ouverture, onglet Historique) ; aucune marge négative hors la barre d'onglets (-2px
vertical) ; aucun transform horizontal ; les `width:"100%"`+padding ont tous border-box
(explicite sur les inputs, défaut UA sur les `<button>`) ; box-shadow/outline ne créent pas
de zone défilable ; les deux tooltips à largeur fixe (260 px fixed `:174`, sparkline absolute
`:266`) n'apparaissent qu'au survol/tap.

**Limite honnête** : après cette table, AUCUN élément du DOM applicatif au chargement
n'explique statiquement ~490 px. Les suspects restants sont (a) un élément dont la largeur
réelle ne se voit qu'en layout (interaction fine flex/min-content/UA iOS invisible au grep),
(b) l'habillage `s-page`/`s-section`/`s-app-nav` App Bridge (hors dépôt, non auditables —
mais identiques sur tous les onglets, ce que le caractère costs-only rend improbable sans
être impossible : leur layout peut réagir au CONTENU du tab). Deviner plus loin serait de la
supposition — exactement ce que ce chantier interdit. La mesure ci-dessous tranche en 2 min.

## Mesure décisive (à faire par Mathys, desktop, AVANT tout code)

La prod exécute déjà 7587e43 = le code exact de ta capture iPhone. Le mécanisme (contenu
plus large que 390 px au chargement) est mesurable dans n'importe quel moteur de layout :

1. Desktop Chrome → admin Shopify → ouvrir l'app → DevTools (F12) → icône « device
   toolbar » (Ctrl+Maj+M) → préréglage iPhone 12 Pro (390×844) → RECHARGER la page →
   onglet Suivi des coûts.
2. Dans la console, sélectionner d'abord le CONTEXTE de l'iframe de l'app (menu déroulant
   en haut de la console, choisir le frame `…vercel.app` au lieu de `top`).
3. Coller :

```js
document.documentElement.scrollWidth
```

   → si la valeur dépasse ~395, le débordement est reproduit (attendu ~490).
4. Coller ensuite (liste les éléments qui dépassent le bord droit, du plus profond au plus
   large) :

```js
[...document.querySelectorAll("*")]
  .map(e => ({ e, r: e.getBoundingClientRect() }))
  .filter(x => x.r.right > document.documentElement.clientWidth + 1)
  .sort((a, b) => b.r.right - a.r.right)
  .slice(0, 15)
  .map(x => `${Math.round(x.r.right)}px  <${x.e.tagName.toLowerCase()}${x.e.className ? " ." + x.e.className : ""}>  ${x.e.outerHTML.slice(0, 90)}`)
  .join("\n")
```

5. Me coller la sortie telle quelle : elle NOMME le coupable (l'entrée la plus PROFONDE
   avec le plus grand `right` — les ancêtres listés ne font que le contenir).

Si le débordement ne se reproduit PAS à 390 px sur desktop, c'est un comportement UA
spécifique à iOS (rendu natif d'un contrôle de formulaire, par exemple) — je fournirai
alors un snippet équivalent à exécuter dans Safari iOS via le débogage distant, ou on
passe directement à l'option B.

## P0.4 — Correctif : deux options

**Option A (RECOMMANDÉE) — fix ciblé après mesure.** Une fois le coupable nommé par la
sortie de l'étape 4, correctif minimal sur CET élément (largeur/wrap/contention), mobile
seulement si l'élément est partagé avec le desktop. Diff attendu : 1-5 lignes. C'est la
seule option qui laisse la cause CONNUE et documentée.

**Option B — ceinture de contention (aveugle mais garantie côté app).** Dans la media query
mobile existante : `body { overflow-x: clip; }`. `clip` (≠ `hidden`) supprime la zone
défilable horizontale sans créer de conteneur de défilement ni affecter les tooltips en
position fixed : le WebView n'a plus de contenu plus large que l'écran à épouser, le
viewport ne s'élargit plus, quel que soit le coupable — Y COMPRIS s'il vit dans `s-page`/
`s-section` (body est l'ancêtre de tout). Coût : la cause reste inconnue (un contenu
légitime qui déborderait un jour serait coupé au lieu de défiler) ; support iOS 16+.
Diff : 1-2 lignes. Utilisable seule si la mesure est impossible, ou EN PLUS de A.

Ni A ni B ne retouchent les tables `tcc-scroll-x` (hors de cause pour ce symptôme, conforme
à ta directive P0.4).

## P0.5 — Fichiers + estimation

| Option | Fichiers | Lignes |
|---|---|---|
| A | selon le coupable mesuré (probablement `app._index.jsx` ou `costsUi.jsx`) | 1-5 (re-chiffré précisément après mesure ; I3 s'applique sur ce chiffre) |
| B | `app._index.jsx` (media query existante) | 1-2 |
| A+B | les deux | 2-7 |

E1 inchangée : seule ta capture iOS portrait post-déploiement livre le chantier, quelle que
soit l'option.

---

## STOP — décisions attendues

1. **Faire la mesure desktop** (procédure ci-dessus) et me coller la sortie de l'étape 4 —
   c'est la voie recommandée (option A, cause connue).
2. À défaut, ou en complément : GO option B (ceinture `body { overflow-x: clip; }`),
   en acceptant que la cause reste non identifiée.
3. Confirmer qu'aucun re-diff des tables tcc-scroll-x n'est attendu dans ce chantier.
