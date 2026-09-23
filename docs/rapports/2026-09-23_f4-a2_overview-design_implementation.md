# F4-A2 — Retours clics, design B « Signal », Vue d'ensemble, nav cible : implémentation (2026-09-23)

Suite de `2026-09-23_f4-a_retours-clics_phase0.md` (diagnostics 1 à 5) et du message d'arbitrage
« Retours F4-A : arbitrages, design, navigation — GO d'écriture » (consigné en section G de
`2026-09-22_decisions.md`). Référence lue : `docs/design/references/maquette-overview.png.png`
(maquette GrowthKit, la seule image du dossier ; aucune capture de l'ancien écran n'y figure).

Statut : **écrit et prouvé localement (gate complète verte). Aucun commit, aucun push, aucun
déploiement. Aucune migration nouvelle, rien d'appliqué en base.** `app._index.jsx`, `engine.js`,
`app/lib/econ/*` (hors `adapters.js`), `app/lib/sync/*` : 0 diff (vérifié par `git diff --stat`).

## 1. Problème

Après tes clics sur `/app/dashboard?days=90` : faux « CA net HT 0,00 $ » avec 6 commandes, tuiles
empilées à 1 900 px, sélecteur de période invisible, journée en cours hors fenêtre, rendu plat.
La navigation cible (12 sections) et la maquette « GrowthKit » n'étaient pas encore appliquées.

## 2. Causes (vérifiées, Phase 0)

1. Les 6 commandes de juillet n'ont que des lignes lues par l'ancienne version (sans colonnes F1) :
   le moteur, qui somme des lignes, comptait la commande et 0 de revenu, sans le dire.
2. `s-grid` : deux clauses `@container` là où la doc n'en admet qu'une, et pas de
   `s-query-container` : valeur rejetée, une colonne partout.
3. `s-button-group` ne rend que les enfants `slot="secondary-actions"` de `variant="secondary"`
   (règle lue dans le bundle) : mes boutons n'avaient pas de slot, invisibles.
4. Fenêtre finissant hier par choix de Phase 0, contredisant le texte de l'état vide.
5. Composants 100 % Polaris, aucune zone app-owned stylée.

## 3. Solution

### 3.1 Corrections 1 à 4

| # | Décision | Réalisation |
|---|---|---|
| 1 | Commande sans ligne analysable exclue de tous les KPI, compte compris ; trou « N commandes lues par l'ancienne version, non comptées » | `econ/adapters.js` : `ordersForEngine(rows, { lines })` pose la raison interne `legacy` (jamais écrite en base, hors du CHECK SQL) à toute commande incluse sans ligne v2 non « excluded » ; `overview.js` : `buildGaps` émet `legacy_orders` en premier, hors de la liste des exclusions ; aucun KPI n'affiche une valeur quand `counts.orders = 0` (« encore 1 commande »). Sur la boutique de dev : état vide « 6 commandes de la période sont exclues (6 lues par l'ancienne version) ». |
| 2 | Grille CSS app-owned 4 / 2 / 1 | `.tcc-grid` : `repeat(4, minmax(0, 1fr))`, `@container tcc-group (max-width: 900px)` → 2, `(max-width: 480px)` → 1. Plus aucun `s-grid` (lot 26 le vérifie). |
| 3 | Contrôle segmenté app-owned | `PeriodSelector` : `<nav class="tcc-seg">` de trois `<Link to="?days=…">`, `aria-current="page"` sur l'actif, cibles 44 × 36 px, aucun champ contrôlé. |
| 4 | Journée en cours incluse et partielle | `overviewWindows` : fin = aujourd'hui (jour boutique), `current.partial = true`, précédente contiguë décalée d'autant ; libellé « du 25 août à maintenant (journée en cours) » ; texte de l'état vide « journée en cours comprise ». |

### 3.2 Design B « Signal » sur la Vue d'ensemble

Structure Polaris inchangée (`s-page`, `s-banner`, `s-modal`, `s-app-nav`) ; tout le style maison
vit dans le wrapper `.tcc` (`app/styles/overview.css`, importée par la route, 16,5 Ko dans le build).

- **Jetons `--tcc-*`** définis une fois (clair) + variante sombre (`[data-theme="dark"]` et
  `prefers-color-scheme: dark`, identiques, vérifiées identiques par le lot 26) : encre (3 niveaux),
  surfaces, accent violet-indigo (`#5b4bd6`, réservé à Expert, IA, période active), teintes de
  section (revenus bleu `#2a78d6`, marges violet `#6a56d9`, acquisition orange `#eb6834`), états
  (vert, ambre, rouge, neutre : chacun `fill` / `ink` / `soft`), rayons, ombres, typographie des
  chiffres. **L'état prime sur la teinte de section** (`.is-unknown` → ambre, `.is-insufficient` et
  `.is-unavailable` → neutre). Aucune couleur en dur dans les composants (lot 26).
- **Contrastes** : 25 paires encre/fond calculées par le lot 26 en clair et en sombre, toutes
  ≥ 4,5:1 (AA) ; teintes de section et d'état ≥ 3:1 sur la surface. L'ambre de remplissage a été
  assombri (`#b47c00`) après un premier calcul à 2,23:1.
- **En-tête** : marque (icône + nom + sous-titre), « Bonjour {prénom} 👋 » (prénom = premier mot de
  `shop.shopOwnerName`, repli nom de boutique, repli « Bonjour 👋 »), « Données synchronisées ·
  Dernière mise à jour il y a 2 h » (`Intl.RelativeTimeFormat`), sélecteur segmenté, plage
  partielle et comparaison.
- **Rail des sections** : les 12 sections dans l'ordre décidé ; Vue d'ensemble = lien
  `aria-current` ; les 11 autres grisées, `aria-disabled`, badge « Bientôt » avec icône.
- **Tuiles KPI** : icône SVG maison dans un carré teinté, libellé court, gros chiffre (Inter,
  `tabular-nums`, 28 px ; 36 px pour les trois héros CA HT / CM2 / CAC), badge d'écart (flèche +
  ton + « vs période précédente » ; pour le CAC et le taux de retour une baisse est favorable),
  **mini-courbe SVG** (une série, aplat dégradé `currentColor`, sans axes, `<title>` accessible,
  jamais rendue sous deux jours non nuls), statuts explicites (insuffisant / inconnu avec la
  raison / non connecté avec l'action), « Voir le calcul » → `s-modal` avec bloc maison : formule
  en clair, lignes d'entrées avec opérateur, montants alignés à droite, ligne « = » en gras, note
  de méthode. Barre supérieure dégradée, teinte radiale, survol élévation + halo, cascade
  d'entrée (opacité + translation, 40 ms par tuile).
- **Bandeaux** : trous (`s-banner` warning), boutique de dev (`s-banner` info + `<Form>` POST),
  devises mixtes ; notes de contexte en liste discrète.
- **État vide** : carte app-owned, raisons d'exclusion (legacy compris), lien écran classique.
- **Emplacements réservés** (7, jamais un chiffre) : courbe (« Disponible à la prochaine
  version »), 3 changements et assistant (« Disponible avec Intelligence »), Top produits,
  Marketing, Funnel (« Disponible avec Croissance »), Stock (« Disponible avec Stock »), chacun
  avec badge « Bientôt » ; disposition de la maquette (2/3 + 1/3, puis 4 quarts).
- **Bandeau du moteur** : 5 étapes numérotées, 3 puces chacune, pied « Tout est connecté »,
  entièrement traduit.
- **Mouvement** : `transform` / `opacity` / couleurs seulement, 160 ms ; `prefers-reduced-motion`
  neutralise animations et transitions (seul endroit avec `!important`, vérifié).
- **Mobile** : 8 tuiles puis « Afficher 4 indicateurs de plus » (bouton natif) sous 480 px de
  conteneur ; grille 1 colonne ; pas d'effet de survol sur écran tactile (`hover: hover`) ; aucune
  largeur fixe → aucun débordement horizontal (à confirmer sur iPhone, §6).
- **RTL-ready** : propriétés logiques uniquement (`inset-inline`, `padding-inline`, `text-align:
  end`…), vérifié par le lot 26 (aucun `left` / `right`).

### 3.3 Renommage et navigation

- Route `app.overview.jsx` (`/app/overview`) ; `app.dashboard.jsx` redirige vers
  `/app/overview` en conservant `?days=`. Modules `app/lib/overview.js` et `overview.server.js` ;
  composants `app/components/overview/` ; clés `overview.*` (plus aucune clé `dashboard.*`).
- `app/lib/sections.js` : registre des 12 sections (`live` / `soon`), `LIVE_SECTIONS`,
  emplacements réservés. `s-app-nav` : `rel="home"` → `/app`, sections livrées seulement (Vue
  d'ensemble), « Écran classique ».
- Catalogues : 202 clés `en`, `fr` identique (lot 26) ; libellés de nav imposés (en : Overview,
  Profit, Growth, Customers, Products, Inventory, Marketing, Cash, Intelligence, Simulator,
  Experiments, Settings, Coming soon ; fr : Vue d'ensemble, Profit, Croissance, Clients, Produits,
  Stock, Marketing, Trésorerie, Intelligence, Simulateur, Expériences, Réglages, Bientôt).

### 3.4 Fichiers

| Fichier | Lignes | Rôle |
|---|---|---|
| `app/lib/overview.js` | 180 | Pur : fenêtres (journée partielle), 12 KPI (`goodDirection`, `series`, `calc`), statuts, écarts avec ton, séries journalières, lignes de calcul, notes, trous (`legacy_orders`) |
| `app/lib/overview.server.js` | 105 | Lectures Supabase bornées, identité boutique (nom, prénom du propriétaire) en parallèle, plafond 5 000 signalé, bascule C6 |
| `app/lib/sections.js` | 31 | Nav cible et emplacements réservés |
| `app/lib/sparkline.js` | 23 | Géométrie SVG de la mini-courbe (pure, testée) |
| `app/lib/econ/adapters.js` | +14 | Raison interne `legacy` (retour 1) |
| `app/lib/i18n/format.js`, `context.jsx` | +14 | `formatRelative` (« il y a 2 h ») |
| `app/styles/overview.css` | 329 | Jetons clair/sombre, primitives, en-tête, segmenté, rail, grille, tuiles, calcul, état vide, emplacements, moteur, mouvement réduit |
| `app/components/overview/` | 393 | `OverviewHeader` (+ `PeriodSelector`), `SectionRail`, `KpiGrid`, `KpiTile` (+ `CalcBlock`), `Sparkline`, `Icons`, `Banners` (trous, notes, dev), `Blocks` (état vide, emplacements, moteur) |
| `app/routes/app.overview.jsx`, `app.dashboard.jsx`, `app.jsx` | 60 / 8 / mod. | Page, redirection, coquille (nav livrée) |
| `app/locales/en.js`, `fr.js` | 208 / 205 | 202 clés |
| `tests/lot26_dashboard_i18n.mjs` | 314 | 109 assertions (§4.2) |
| `scripts/render_check.mjs` | +93 | 20 scénarios Vue d'ensemble (§4.3) |
| Supprimés | | `app/components/dashboard/*` (6), `app/lib/dashboard.js`, `dashboard.server.js` |

Aucune dépendance npm nouvelle. Incident de poste : `node_modules` avait disparu en cours de
session (aucune commande de suppression lancée par moi ; à confirmer de ton côté) ; réinstallé
par `npm ci` depuis `package-lock.json`, inchangé (`git diff` vide sur les deux fichiers).

## 4. Preuves

### 4.1 Gate complète (R4)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 422 warnings (382 avant ; sur les fichiers F4 : 77 warnings, tous `react/prop-types`, politique inchangée) |
| `npm test` | 26 lots verts (lot 26 : 109 assertions) |
| `node scripts/render_check.mjs` | « Tous les rendus réels OK » : 55 scénarios (35 existants + 20 Vue d'ensemble) |
| `npm run build` | client et serveur construits ; `overview.css` (16,55 Ko) dans le bundle |
| `git diff --stat` sur `app._index.jsx`, `engine.js`, `econ/*` hors adaptateurs, `sync/` | vide |

### 4.2 Lot 26 (109 assertions)

Locale et `t()` (inchangés) ; catalogues (`fr = en`, 202 clés, plus aucune clé `dashboard.*`,
libellés de nav imposés, membres des familles dynamiques présents dont les 12 sections, les 7
emplacements et les 20 clés du moteur, aucune orpheline) ; lint (77 fichiers `app/` scannés, 0
chaîne en dur ; aucune couleur hex/rgb ni `style={{` dans les composants de l'Overview ; plus
aucun `s-grid` ni `s-button-group` ; sélecteur avec `aria-current`) ; **CSS** (33 jetons de
couleur, sombre = clair en noms, bloc média = bloc `data-theme`, 25 paires ≥ 4,5:1 en clair et en
sombre, teintes ≥ 3:1, mouvement réduit, `!important` confiné, propriétés logiques, transitions
limitées, `tabular-nums` + Inter, grille 4/2/1) ; adaptateur (inchangé) ; `ordersForEngine` (C6 +
**retour 1** : avec les lignes fournies, o1 et o2 sans ligne v2 → `legacy` (2), o5 comptée ; une
ligne « excluded » ne rend pas la commande analysable) ; remises (C7b) ; **fenêtres** (30 jours
finissant aujourd'hui à New York, journée partielle, précédente contiguë ; 7 jours UTC avec
#1022 du jour incluse) ; **KPI** (6 commandes sans ligne → 0 comptée et trou « 6 lues par
l'ancienne version » ; état 2 : o1 seule analysable ; état 3 : CM2 60 %, CM3 720, écarts +50 % et
+10 pt avec ton favorable, CAC : baisse favorable ; séries : 30 points dont 12 > 0 pour le CA,
jours non définis pour CM2 %, aucune série pour le CAC, une seule journée → pas de courbe ; lignes
de calcul CA HT (5, « = » en gras) et CM2 % (unités par ligne)) ; mini-courbe (chemins, interruption) ;
sections (12 dans l'ordre, une livrée, « Bientôt » sans route, 7 emplacements rattachés) ;
formatage (+ relatif « 2 hours ago » / « il y a 2 h »).

### 4.3 Rendu réel (20 scénarios Vue d'ensemble, `en` et `fr`)

Tuile ok + écart + courbe (classe `is-ok is-hero`, `$1,200.00`, badge favorable `+50.0%`, `<svg
class="tcc-spark">` avec titre traduit, modale à 5 lignes dont « = » en gras) ; même tuile en
`fr` ; CM2 % (+10.0 pt, courbe interrompue) ; CAC non connecté (`is-unavailable`, action, aucune
courbe ni valeur) ; coût manquant (`is-unknown`, raison) ; insuffisant `en`/`fr` ; tuile sans
courbe ; **thème sombre** (`data-theme="dark"` rendu, valeurs identiques) ; `kpi=null` ; aucune
couleur ni `style=` dans le HTML des 12 tuiles ; grille (3 sections, 3 `.tcc-grid`, 4
`is-secondary`, bouton natif « Show 4 more indicators », aucun `s-grid`) ; grille vide ;
en-tête (marque, « Hello Mathys 👋 », « Data synced », « Last update 2 hours ago », « Aug 25, 2026
to now (today is partial) ») ; en-tête sans prénom ni sync ; sélecteur (3 liens, un seul
`aria-current`) ; rail (Vue d'ensemble active, 11 « Bientôt » `aria-disabled`) ; trous (6 legacy,
1 sans coût, plafond, 2 exclues) ; bandeau vide → rien ; notes `fr` ; état vide avec 6 legacy ;
boutique de dev ON/OFF/marchande ; 7 emplacements sans aucun chiffre ; bandeau du moteur (5
étapes, 15 puces).

### 4.4 Écarts par rapport à la maquette et au message, avec justification

1. **Nav admin « Bientôt »** : `s-app-nav` (App Bridge) n'offre ni badge ni état désactivé, et
   ses liens sont tous cliquables. Le menu admin ne liste donc que les sections livrées ; la nav
   complète grisée avec « Bientôt » est le rail app-owned en tête de page. Alternative si tu la
   préfères : lister les 12 dans `s-app-nav` avec une page « Bientôt » traduite par section (mais
   cliquables, contraire au message).
2. **Prénom** : l'API User d'App Bridge ne renvoie en admin que le niveau d'accès (vérifié) ;
   la salutation utilise le prénom du propriétaire de la boutique (`shop.shopOwnerName`), pas celui
   du membre connecté. Repli : nom de boutique, puis « Bonjour 👋 ».
3. **Une rangée de 5 tuiles** (maquette) contre **12 tuiles en 3 sections** (décision 14, C10) :
   les trois héros (CA HT, CM2, CAC) sont agrandis ; la rangée unique reviendra si tu réduis la
   liste.
4. **Sélecteur de dates** (calendrier, maquette) → segmenté 7 / 30 / 90 (message §1.3).
5. **Grande courbe, IA, 3 changements, Top produits, Marketing, Funnel, Stock** : emplacements
   réservés sans faux contenu (message §2.3).
6. **Thème sombre** : l'admin Shopify n'expose pas de thème sombre documenté (Polaris 2.0 à
   venir) ; les jetons sombres suivent `prefers-color-scheme` et `data-theme="dark"`, vérifiés
   par calcul et rendu ; à regarder en vrai quand l'admin en proposera un.
7. **Compteur animé** non réalisé : les valeurs finales sont rendues en SSR (aucun décalage) et
   le budget de mouvement se limite à la cascade et au survol ; à décider en F4-B avec la courbe.

## 5. Correspondance à trancher : écrans du brief sans section nommée

| Écran du brief | Option A (recommandée) | Option B | Implication |
|---|---|---|---|
| Retours (10.9) | **Profit** (coût des retours dans CM2, taux et motifs) | Products (motifs par produit) | A garde la lecture P&L ; B éclate le module. |
| Expédition (10.10) | **Inventory** renommé « Opérations » à terme (stock + expédition) | Profit (port marchand) | A regroupe la logistique ; B dilue. |
| SEO (10.12) | **Growth** (entonnoir organique, à côté des sessions) | Marketing (avec la pub) | A colle à « croissance » ; B mélange payant et organique. |
| Alertes (10) | **Intelligence** (état d'alerte par type) + réglage des seuils dans Réglages | Section propre « Alertes » (13e) | A tient les 12 sections ; B ajoute une entrée. |
| Leviers | **Intelligence** (priorisation des leviers, « ce qui a changé ») | Simulator | Décidé par le message (Intelligence : priorisation des leviers). |
| Conversion (10.7) | **Growth** (sessions, CVR, entonnoir) | — | Déjà dans la définition de Growth. |
| Réglages des coûts (Suivi des coûts) | **Settings > Coûts** (par produit et variante) | Products (onglet Coûts) | A sépare saisie et analyse ; B rapproche la saisie du produit. |
| Connexions pub / Search Console | **Settings > Connexions** | Marketing (bouton « Connecter ») | A centralise ; B contextualise (le bouton peut aussi vivre dans Marketing en renvoyant vers Settings). |
| Codes promo et partenaires (10.6) | **Marketing** (commissions par code) + saisie dans Settings | Customers | A suit le CAC partenaires. |
| Clients (cohortes) | Customers | — | Déjà nommé. |

Rien de ceci n'est codé : `sections.js` ne porte que les 12 sections et leur statut.

## 6. Preuves à faire sur la boutique de dev (après GO commit + push, déploiement Vercel)

Ordinateur (admin en français puis en anglais) :

1. `/app/overview` : en-tête (marque, « Bonjour {prénom} 👋 », « Données synchronisées · Dernière
   mise à jour il y a … »), segmenté 7 / 30 / 90 visible, rail des 12 sections avec 11 « Bientôt »
   grisées non cliquables ; menu admin : Vue d'ensemble, Écran classique.
2. `?days=90` avec inclusion : **état vide** « Aucune commande à analyser… 6 commandes de la
   période sont exclues (6 lues par l'ancienne version) » et bandeau des trous ; plus aucun
   « 0,00 $ ». Sans inclusion : « 7 brouillon » (six de juillet + #1022 : #1022 est désormais dans
   la fenêtre).
3. Nouvelle commande de test créée par toi (jour courant) avec inclusion : 12 tuiles en 4 colonnes
   à 1 900 px, CA HT et commandes chiffrés, CM « inconnu : N lignes sans coût », CAC/MER/POAS
   « connectez un compte publicitaire », courbe absente (une seule journée) ; « Voir le calcul »
   ouvre la modale avec les lignes et le « = » en gras.
4. `/app/dashboard?days=7` redirige vers `/app/overview?days=7`.
5. Réduction de la fenêtre du navigateur : 2 colonnes vers 900 px, 1 colonne et « Afficher 4
   indicateurs de plus » sous 480 px, aucun défilement horizontal.
6. Web Vitals (`meta name="shopify-debug" content="web-vitals"`) : LCP ≤ 2,5 s, CLS ≤ 0,1.

Thème sombre : forcer `prefers-color-scheme: dark` (DevTools → Rendering) sur `/app/overview` →
cartes sombres, textes lisibles, badges contrastés, capture.

iPhone portrait : capture de `/app/overview` (8 tuiles, bouton « Afficher 4 indicateurs de plus »,
rail défilant, aucun débordement) ; capture de la modale « Voir le calcul ».

## 7. Ce qui reste

1. Ton GO pour commit unique + push (statut Vercel via l'API GitHub, sans session Vercel).
2. Preuves §6, puis rapport de preuves.
3. Arbitrages §5 (correspondance des écrans) et §4.4 point 1 (nav admin).
4. F4-B : grande courbe (Polaris Viz / React 19 / `polarisUrl`), compteur animé éventuel.
