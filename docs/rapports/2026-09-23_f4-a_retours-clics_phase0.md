# F4-A — Retours après tes clics : diagnostic et options (Phase 0, lecture seule)

Date : 2026-09-23. Aucune modification de code, de base ni de dépendance. Fait suite à
`2026-09-23_f4-a_implementation.md` (commit `ff4e520`, Vercel success) et à tes cinq retours sur
`/app/dashboard?days=90` avec inclusion des brouillons. Je n'ai pas eu les captures (le message
ne les contenait pas) : les diagnostics s'appuient sur le code, la base de prod en lecture seule,
le bundle `polaris.js` réellement servi (723 Ko, téléchargé et grepé) et la documentation App
Home v1.0/v1.1.

## 0. Résumé

| # | Retour | Cause (vérifiée) | Recommandation |
|---|---|---|---|
| 1 | « CA net HT 0,00 $ » avec 6 commandes | Les 6 commandes de juillet n'ont que des lignes legacy (sans `breakdown_version`) ; le moteur somme des lignes, une commande sans ligne donne 0 « ok » | (a) exclure du moteur toute commande sans ligne analysable, avec compteur visible ; (b) ré-ingérer juillet sur la boutique de dev (GO : suppression ciblée) |
| 2 | 12 tuiles empilées à 1 900 px | `gridTemplateColumns` avec DEUX clauses `@container` (la doc n'en montre qu'une) et absence de `s-query-container` ; valeur rejetée → une colonne | grille app-owned (CSS grid + container queries), cohérente avec la passe de design |
| 3 | Boutons 7/30/90 invisibles | `s-button-group` ne rend que les boutons portant `slot="secondary-actions"` et de `variant="secondary"` (règle lue dans le bundle) ; les miens n'avaient pas de slot et l'actif était `primary` → non slottés, invisibles | contrôle segmenté app-owned (liens `aria-current`), ou correctif Polaris minimal |
| 4 | Fenêtre arrêtée à la veille, #1022 invisible | Choix de Phase 0 « jour boutique complet » ; contredit le texte de l'état vide | inclure aujourd'hui (journée en cours marquée), période précédente décalée d'autant |
| 5 | Rendu trop plat | Composants 100 % Polaris, aucun style maison | 3 directions en §5 ; recommandée : B « Signal » avec les règles de contraste de A |

Toutes les options sont détaillées ci-dessous ; rien n'est appliqué avant ton GO.

---

## 1. « CA net HT 0,00 $ » avec 6 commandes (principe 5)

### 1.1 Faits (base de prod, lecture seule, boutique de dev)

- `orders` : 7 lignes, toutes `excluded_reason = draft` : #1016 à #1021 du 2026-07-25 et #1022
  du 2026-09-23.
- `order_margins` : 21 lignes ; 1 seule v2 (#1022, coût manquant, 1 remboursée / 0 effective) ;
  20 legacy (`breakdown_version` nul) réparties sur 20 commandes distinctes, dont 6 seulement
  existent dans `orders` (les 14 autres datent de la sync de juillet et sont hors des 60 jours
  du backfill F2).
- `variant_costs` : 0 ligne ; `shop_settings` : `is_dev_shop = true`, `include_test_orders =
  true` (tes clics ont bien écrit les deux, point 3 du §6 prouvé côté données).

Sur `?days=90` (fenêtre 2026-06-25 → 2026-09-22) : 6 commandes incluses, 0 ligne v2 → le
loader filtre `breakdown_version IS NOT NULL` → `aggregate()` reçoit 6 commandes sans aucune
ligne → `ca_brut = 0`, `ca_ht = 0`, nœud « ok » (le garde « aucune commande » ne se déclenche
pas puisque `orders = 6`). Le bandeau des trous dit bien « 20 lignes ingérées avant le nouveau
moteur », mais la tuile affiche 0 comme une valeur : c'est la contradiction que tu as vue.
Cause de fond : le moteur additionne des lignes ; une commande sans ligne est comptée dans
`orders` et pèse 0 partout ailleurs, silencieusement.

### 1.2 Options

**(a) Code — exclusion des commandes non analysables (recommandé, systémique).** Dans
`ordersForEngine` (pur), une commande dont aucune ligne v2 n'existe reçoit une raison interne
`legacy` (jamais écrite en base : le CHECK SQL ne change pas) ; elle sort de tous les KPI et
alimente un nouveau trou « N commandes ingérées avant le nouveau moteur, non comptées » (le
compteur de lignes legacy actuel est remplacé par ce compteur de commandes, plus juste). Si
aucune commande analysable ne reste, l'état vide s'affiche avec cette raison. Lot 26 : cas
« commande sans ligne → exclue, comptée » ; `render_check` : bandeau et état vide. Coût : S.

**(b) Données — ré-ingérer juillet sur la boutique de dev (GO séparé : suppression).** Les 6
lignes legacy des commandes #1016 à #1021 sont supprimées (script ciblé par `order_id`, preview
puis `--delete`, jamais en masse), puis un job `orders_backfill` sur la fenêtre de juillet est
créé et exécuté (dispatcher local comme pour les preuves F2) : les 6 lignes reviennent en v2
(coût manquant → CM inconnues, mais CA HT juste : 729,95 + 5 × 2 629,95). Le recalcul des
marges estimées existant (lot 19) ne convient pas : sa fenêtre est de 30 jours. Coût : S, mais
irréversible pour les 6 snapshots legacy (sans valeur : coûts absents).

**(c) Repli sur les colonnes legacy pour le CA (rejeté).** `line_net_revenue` existe sur les
20 lignes ; l'utiliser mélangerait deux moteurs dans un même chiffre (principe « un seul
moteur ») et masquerait le trou au lieu de le montrer.

Recommandation : (a) maintenant, (b) sur GO pour que la boutique de dev montre des chiffres.
Avec (a) seul, le Tableau de bord de la boutique de dev affichera l'état vide « 6 commandes
ingérées avant le nouveau moteur » jusqu'à (b) ou jusqu'à une nouvelle commande.

---

## 2. Grille responsive inopérante (12 tuiles empilées)

### 2.1 Faits

- Ma valeur : `gridTemplateColumns="@container (inline-size <= 480px) 1fr, @container
  (inline-size <= 900px) 1fr 1fr, 1fr 1fr 1fr 1fr"`.
- Documentation (Grid, v1.0 et v1.1) : une seule clause conditionnelle puis la valeur par
  défaut, et l'exemple responsive est enveloppé dans `s-query-container` : `<s-query-container>
  <s-grid gridTemplateColumns="@container (inline-size > 400px) 1fr 1fr 1fr, 1fr">`.
- Bundle `polaris.js` : un tokeniseur de « media type » (`@media` ou `@container`, sinon
  `Invalid media type … starting at position …`) ; le comportement à deux clauses n'est pas
  documenté. Le résultat observé (une colonne partout, même à 1 900 px) est celui d'une valeur
  rejetée ou d'un conteneur de requête absent (mon `div` avec `container-type` n'est pas le
  `s-query-container` que Polaris attend).
- Second facteur : les 4 tuiles secondaires sont enveloppées dans un `div.tcc-secondary`
  (`display: contents`) : enfant non-tuile d'une `s-grid` à shadow DOM, comportement non garanti.

### 2.2 Options

**(a) Rester dans Polaris.** `s-query-container` + une seule clause (`"@container (inline-size >
900px) 1fr 1fr 1fr 1fr, 1fr 1fr"`), ou `s-grid-item` explicites ; les secondaires sans `div`
intermédiaire. Deux points de rupture (1 / 2 / 4 colonnes) ne sont pas exprimables avec une
clause : il faudrait deux grilles imbriquées. Coût S, mais lisibilité limitée et dépendance à
une syntaxe non documentée pour le cas 3 paliers.

**(b) Grille app-owned (recommandé).** Un `div.tcc-kpi-grid` (CSS grid, `grid-template-columns`
en `@container` sur notre propre conteneur, 1 / 2 / 4 colonnes) dans `s-section` ; les tuiles
deviennent des éléments HTML à nous. Aucun shadow DOM entre nous et la mise en page, contrôle
total, et c'est de toute façon le socle de la passe de design (§5). `render_check` vérifie les
classes et l'ordre ; lot 26 vérifie que la feuille de style porte les trois paliers. Coût S,
absorbé par §5.

**(c) `s-grid-item` avec `gridColumn="span N"`.** Ne règle pas le responsive (spans fixes).
Rejeté.

---

## 3. Boutons 7 / 30 / 90 invisibles

### 3.1 Faits (bundle et doc)

- Doc Button group : `<s-button-group gap="none"><s-button slot="secondary-actions">Day…` ;
  slots `primary-action` (un seul) et `secondary-actions`.
- Bundle : `Only Button elements with a variant of secondary are allowed in the
  secondary-actions slot` ; un enfant sans slot n'est rendu par aucun `<slot>` du shadow DOM →
  invisible. Mes trois boutons n'avaient pas de slot, et l'actif était `variant="primary"`.
- Le validateur Shopify avait accepté mon bloc : il vérifie les types TypeScript, pas les
  contraintes de slot à l'exécution.

### 3.2 Options

**(a) Correctif Polaris minimal.** `slot="secondary-actions"` sur les trois, `gap="none"`
(contrôle segmenté), tous `variant="secondary"` ; l'actif ne peut pas être `primary` : marquage
par `disabled` (retiré du focus clavier, doc) ou par un `s-badge` à côté. Coût XS, rendu
standard, actif peu lisible.

**(b) Contrôle segmenté app-owned (recommandé).** Trois liens `<a href="?days=7">` avec
`aria-current="page"` sur l'actif, stylés par la passe de design (pilule glissante animée,
`prefers-reduced-motion` respecté), cibles 44 px. Navigation client via `shopify:navigate` ?
Non : un `<a>` natif dans l'iframe est intercepté par React Router (`<Link>`), donc navigation
sans rechargement. Coût S, absorbé par §5.

**(c) `s-select`.** Champ contrôlé → contredit C1a (React 18). Rejeté.

---

## 4. Fenêtre arrêtée à la veille, #1022 du jour invisible

### 4.1 Faits

`dashboardWindows` : fin = hier dans le fuseau boutique (choix Phase 0 §5.3 « jour boutique
complet »). #1022 est datée du 2026-09-23 (jour courant à New York) → hors fenêtre, alors que
l'état vide promet « les commandes apparaissent ici quelques secondes après leur passage ».
Le rapport F2 avait prouvé l'ingestion en 5 s ; c'est la fenêtre qui la cache.

### 4.2 Options

**(a) Inclure aujourd'hui (recommandé).** Fenêtre = `days` jours finissant aujourd'hui ; le
texte de période dit « du 25 juin au 23 septembre (journée en cours) » ; la période précédente
est de même longueur, finissant la veille du début. Cohérent avec l'attente « je viens de
vendre, je regarde ». Effet : la comparaison porte sur un dernier jour partiel, signalé par le
texte. Lot 26 : fenêtres et libellé ; `render_check` : mention « journée en cours ».

**(b) Garder la veille, montrer le jour.** En-tête « N commandes aujourd'hui, comptées demain »
(compteur lu en base) et texte de l'état vide corrigé. Chiffres stables sur des jours complets,
mais le marchand voit deux compteurs.

**(c) Réglage marchand.** Bascule « inclure la journée en cours » : un champ de plus pour un
choix que presque tout le monde fait dans le même sens. Rejeté en V1.

---

## 5. Passe de design : trois directions

### 5.1 Cadre commun (vrai pour les trois)

- **Structure Polaris conservée** : `s-page`, `s-section`, `s-banner`, `s-modal`, `s-app-nav`,
  `s-button` d'action. **Style maison dans les zones que l'app possède** : tuiles, grille,
  sélecteur de période, chips d'écart, notes. Ces zones deviennent du HTML à nous (`article`,
  `dl`, `a`) dans une feuille `app/styles/dashboard.css` importée par la route (Vite l'inline
  au build ; un `styles.module.css` existe déjà dans `_index/route.jsx`).
- **Jetons** : nos propres `--tcc-*` en `:root`. Les jetons Polaris du bundle sont hachés
  (`--p-color-…-f4125`, 385 noms) et changent à chaque publication : à ne jamais référencer.
- **Typographie** : Inter, déjà chargée depuis le CDN Shopify par `root.jsx` et utilisée par
  Polaris (`--p-font-family-sans` → Inter) : aucune police supplémentaire, LCP préservé. Chiffres
  de tuile en figures proportionnelles (pas `tabular-nums`, réservé aux colonnes alignées),
  graisse 600-700, échelle 28 / 36 / 44 px, `letter-spacing -0.02em` au-delà de 32 px. Un seul
  « chiffre héros » par section (CA HT, CM2, CAC).
- **Écarts** : chip icône + texte + couleur (jamais la couleur seule) ; vert de succès
  `#006300` sur teinte `#e6f4e6`, rouge `#d03b3b` sur `#fbe9e9`, neutre gris ; « bon » dépend de
  la direction (un CAC qui baisse est vert).
- **Mouvement, budget commun** : apparition en cascade (opacité + translation 8 px, 40 ms par
  tuile, 600 ms au total), survol 150 ms (élévation 2 px + ombre), chip qui « pop » (échelle
  0,92 → 1), compteur animé 600 ms optionnel. Uniquement `transform` et `opacity` (CLS 0, INP
  intact) ; le SSR rend toujours la valeur finale (aucun décalage de mise en page) ; tout est
  sous `@media (prefers-reduced-motion: no-preference)`, le reste du temps rien ne bouge.
- **Accessibilité** : texte ≥ 4,5:1, éléments d'interface ≥ 3:1, focus visible 2 px, cibles
  44 px, sens jamais porté par la couleur seule, `aria-current` sur la période active.
- **Mobile** : 1 colonne sous 480 px, 2 jusqu'à 900 px, 4 au-delà ; pas d'effet de survol sur
  écran tactile (`@media (hover: hover)`), ombres et halos réduits, `backdrop-filter` jamais
  sur mobile.
- **Built for Shopify** (App Design Guidelines, lues) : « match the rest of the admin », texte
  majoritairement noir ou gris foncé, vert réservé au succès, jaune à l'attention, contrastes ;
  les couleurs de données sont admises dans le contenu. Les trois directions respectent le
  texte en encre neutre ; elles diffèrent par la quantité de couleur et de surface sombre.
- **Gate** : lot 26 vérifie que toute couleur de la feuille est un jeton `:root`, que le bloc
  `prefers-reduced-motion` existe et neutralise chaque animation, aucun `!important` ; les
  composants restent sans `style={{` ni hex ; `render_check` rend les nouvelles balises avec
  valeurs finales en SSR, `en` et `fr`.
- Palettes passées au validateur du skill dataviz (six contrôles : bande de luminance, chroma,
  séparation daltonienne ΔE, séparation vision normale, contraste) ; résultats cités par direction.

### 5.2 Direction A — « Registre » (précision éditoriale, sobre-premium)

- Palette : cartes blanches, bord filet `rgba(11,11,11,.10)`, rayon 12 px ; encre `#0b0b0b` /
  `#52514e` / `#898781` ; **un accent** indigo `#3b5bdb` (liens, focus, période active, filet
  de section) ; statuts réservés (vert, rouge). Validateur : accent 3 slots avec statuts →
  la paire rouge/vert échoue en protanopie (ΔE 4,6), attendu et couvert par icône + texte ; en
  vision normale ΔE 31,9, contrastes ≥ 3:1.
- Chiffres : Inter 600, 32 px (héros 40 px), label en phrase 13 px gris, unité discrète.
- Cartes : plates, filet + ombre interne 1 px ; survol élévation 2 px, ombre `0 8px 24px
  rgba(0,0,0,.08)` ; barre gauche 3 px indigo sur les héros.
- Animation : cascade + chip pop + compteur ; rien d'autre.
- Built for Shopify : le plus proche de l'admin, aucun risque de lecture « hors admin ».
- Accessibilité : triviale (tout est encre sur blanc) ; mouvement réduit = aucun.
- Mobile : identique, sans survol.
- Effort : S. Limite : reste « propre » plus que « 21st.dev ».

### 5.3 Direction B — « Signal » (chromatique par section, effets maîtrisés) — recommandée

- Palette : une teinte par section, identité fixe : revenus bleu `#2a78d6`, marges violet
  `#4a3aa7`, acquisition orange `#eb6834`. Validateur (surface blanche) : **toutes vérifications
  passent** (pire paire violet/bleu ΔE 13,0 daltonien, 16,3 normal, contrastes ≥ 3:1). L'aqua
  a été écarté (2,82:1 sur blanc, et trop proche du vert « succès » de l'admin) ; le vert reste
  réservé au succès.
- Cartes : blanc, rayon 14 px, **barre supérieure dégradée** (teinte → teinte à 40 %),
  **teinte radiale** 6 % dans l'angle, filet `rgba(11,11,11,.08)` ; survol : halo `0 0 0 1px
  teinte à 40 %, 0 12px 32px teinte à 18 %` + élévation 2 px. Les 3 tuiles héros : **bord
  conique animé** (rotation 8 s, un seul tour, en pause sous mouvement réduit), chiffre 44 px.
- Chiffres : Inter 700, 36 px / héros 44 px, `-0.02em` ; label 13 px encre secondaire avec
  point coloré de section (8 px) + nom de section en texte : la teinte n'est jamais seule.
- Chips d'écart : icône + texte, teinte statut ; pop à l'apparition.
- Mouvement : cascade, compteur, chip pop, conique sur 3 tuiles, **squelette miroitant**
  pendant une navigation (`shopify.loading(true)` + squelette app-owned, `prefers-reduced-motion`
  → squelette fixe). Rien au-delà : chaque effet supplémentaire coûte de l'INP sur mobile.
- Option F4-B : mini-courbe 12 points par tuile dans la teinte de section (SVG inline, sans
  librairie ; `aggregate.byDay` existe déjà) : à décider avec Polaris Viz.
- Built for Shopify : couleurs dans le contenu, texte en encre, sémantique admin respectée ;
  point de vigilance : le halo et la barre dégradée doivent rester subtils (sinon « avoid using
  green/yellow to entice » s'applique par analogie). Risque faible.
- Accessibilité : texte toujours en encre (jamais de texte dégradé), teintes ≥ 3:1 en
  éléments d'interface, mouvement réduit = cascade, conique et miroitement désactivés.
- Mobile : halo remplacé par un filet teinté, pas de conique (économie GPU), 1 colonne.
- Effort : M. C'est le niveau « 21st.dev » sans sortir de l'admin.

### 5.4 Direction C — « Verre sombre » (cartes sombres, glassmorphism, accents lumineux)

- Palette : cartes `#0f1419` sur la page claire de l'admin, verre `backdrop-filter: blur(12px)`
  sur un dégradé maillé en tête, accents **assombris pour passer** : aqua `#199e70`, violet
  `#9085e9`, ambre `#c98500` (validateur sur `#0f1419` : toutes vérifications passent). Les
  néons « 21st.dev » littéraux (`#2dd4bf`, `#a78bfa`, `#fbbf24`) **échouent** la bande de
  luminance (0,71 à 0,84) : trop clairs pour porter un chiffre.
- Chiffres : blanc `#ffffff` 40 px, labels `#c3c2b7`.
- Effets : halo néon, bord dégradé, verre, grain léger.
- Built for Shopify : **risque réel**. « Match the rest of the Shopify admin » et « feel
  jarring » (Visual design) visent exactement des panneaux sombres dans un admin clair ; l'admin
  n'a pas de thème sombre que l'app pourrait suivre (à confirmer à la date de la revue).
- Accessibilité : blanc sur sombre ≥ 4,5:1 ; les accents en texte (ambre) restent < 4,5:1 →
  texte en blanc seulement ; éblouissement clair/sombre au défilement.
- Mobile : `backdrop-filter` coûteux (Safari iOS), à couper ; halos réduits.
- Effort : M-L. Non recommandée tant que Built for Shopify est un objectif.

### 5.5 Recommandation et découpe

B « Signal », avec le cadre commun (§5.1) et les règles d'encre de A. Découpe proposée, chaque
lot avec lot 26 + `render_check` + build + capture :

1. **Correctifs de fond** : points 1 (a), 2 (b), 3 (b), 4 (a) — la grille et le sélecteur
   app-owned posent le socle. Coût S.
2. **Design B** : feuille de style, tuiles et chips, cascade et survol, squelette. Coût M.
3. **Données de la boutique de dev** : point 1 (b) sur GO séparé (suppression ciblée + backfill).
4. Preuves §6 restantes, capture iPhone.

Ce que je te demande de trancher : point 1 (a seul, ou a + b), point 2 (b), point 3 (b), point
4 (a), direction (A / B / C), et si la mini-courbe par tuile entre dans ce lot ou attend F4-B.
