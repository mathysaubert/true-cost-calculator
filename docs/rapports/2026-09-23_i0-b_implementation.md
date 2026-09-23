# I0-B — Composant Analyse, Vue d'ensemble en 9 blocs, Indicateurs, Fiabilité, nav hybride, C12 : implémentation (2026-09-23)

Suite de `2026-09-23_i0-a_implementation.md` (couche narrative pure, committée `cf1a00e`). GO I0-B
reçu le 2026-09-23 : « composant Analyse, Vue d'ensemble en 9 blocs, page Indicateurs, nav hybride,
page Fiabilité, états vides actionnables, correctif C12. Aucun commit sans mon GO. »

Statut : **écrit et prouvé localement (gate complète verte). Aucune migration, aucun commit, aucun
push, aucun déploiement.** `app/routes/app._index.jsx`, `app/lib/engine.js`, `app/lib/econ/*`,
`app/lib/sync/*` : 0 diff (vérifié par `git diff --name-only`).

## 1. Problème

I0-A produit un briefing complet (résultats, situation, priorités, opportunité, fiabilité) mais
aucun écran ne l'affiche : la Vue d'ensemble F4-A2 reste une grille de 12 tuiles sous 7
emplacements réservés, la nav est plate à 12 sections dont une seule livrée, et le CTA
`.tcc-cta` est encore un bouton plein violet (C12).

## 2. Cause

La couche narrative a été livrée avant les écrans, exprès (D10 : dépliage natif + modale, aucun
état contrôlé sous React 18). Il manquait le rendu textuel des insights (clés + variables
brutes → phrases traduites) et les composants.

## 3. Solution

### 3.1 Rendu textuel pur : `app/lib/insights/render.js` (75 lignes, aucun React)

`formatVar(name, value, i18n, { titles })` formate chaque variable selon son unité (tables
MONEY / PCT / SIGNED_PCT / POINTS / RATIO / INT) et traduit les identifiants (facteur → `factor.*`,
motif de retour → `reason.*`, règle → `insight.*.name`, manque → `health.rule.*`, écart →
`results.gap.*`, référence → `reference.*` avec le nombre de semaines, produit → titre Admin ou
fin du gid, objet `missing` → « encore N commandes »). `renderInsight` renvoie les huit champs
traduits quand le catalogue les porte (`t.has`), le badge de confiance, le CTA (libellé
`cta.open_section` + `nav.<section>` ou `cta.<kind>`), l'horizon et les preuves libellées
(`evidenceLabel` : entrée de calcul, KPI, `evidence.*`, suffixe `_reference` → « (référence) »).
`renderSituation` traduit les quatre créneaux. Le statut `partial` remplace l'observation par
`insight.<id>.partial` et supprime impact, cause et simulation.

Deux corrections trouvées au rendu réel et faites dans la couche I0-A, sans changer un chiffre :

- `reference.js` : une période sans commande (historique non chargé) n'est plus une période de
  référence (filtre sur `leaves.orders`), sinon la moyenne D1 se diluait avec des zéros.
- `index.js` : chaque insight qui utilise la référence porte `reference: { kind, count,
  periodDays }` pour que la phrase de contexte dise « vs vos 17 dernières semaines ».

### 3.2 Composant Analyse : `app/components/overview/Analysis.jsx` (103 lignes)

Trois niveaux de lecture (D10), aucun état React :

| Niveau | Contenu | Mécanisme |
|---|---|---|
| 5 s | rang, nom, badge de confiance texte, observation, fourchette « Toutes choses égales par ailleurs, environ X à Y » + horizon, une action | en-tête de la carte |
| 30 s | Question / Impact / Action en trois blocs, cause avec barres de contribution (SVG `rect`, largeur = part relative, animation `scaleX` neutralisée par `prefers-reduced-motion`) | `<details>` natif, chevron tourné à l'ouverture |
| complet | contexte, cause, impact, formule déclarée, preuves du moteur libellées, part expliquée, part des trous, simulation, suivi, aide du badge | `s-modal` Polaris `commandFor` / `--show` / `--hide` |

CTA : `fix_data` et `connect` mènent à `/app/data-health` ; `open_section` vers une section
livrée est un lien ; vers une section « Bientôt » ou une simulation, le CTA ouvre la modale
complète (les hypothèses y sont). Aucun `style={{…}}` (lot 26 l'interdit) : les jauges sont des
`<svg viewBox="0 0 100 6">` avec un `<rect width>`.

### 3.3 Blocs du briefing : `Briefing.jsx` (165 lignes)

| Export | Bloc PDF | Rendu |
|---|---|---|
| `Results` | 2 | trois cartes CA net / Contribution (% du CA, « sur X % du CA à coût connu ») / Résultat estimé (« estimation · coûts fixes non renseignés », D9a) ; statut `insufficient` → « Pas encore assez de données : encore N commandes » ; « Voir le calcul » réutilise `CalcBlock` (ca_ht, cm2_pct, net_result) |
| `Situation` | 3 | un paragraphe, phrases des quatre créneaux |
| `Priorities` | 4 | trois `Analysis` classées ; vide → « Aucune priorité à afficher » + corps explicatif ; sous le bloc, `PartialConclusions` (« Signaux en attente de données ») |
| `PartialConclusions` | états vides | par insight partiel : nom, phrase `partial`, « Débloque : … » (libellés KPI ou noms de règles) |
| `Opportunity` | 5 | `Analysis` en statut simulation, avant → après sur le nœud simulé, hypothèses `assumption.*` (7 clés alignées sur `simulate.js`), fourchette par mois |
| `WaterfallTable` | 7 | douze lignes (CA net, − cinq coûts, = CM2, − pub, − commissions, = CM3, − coûts fixes, = résultat net) en tableau ; note « version graphique à la prochaine version » (F4-B) |
| `AllIndicators` | 9 | `<details>` replié : trois mini-lignes (CA net, commandes, CM2 %) + lien « Ouvrir tous les indicateurs » vers `/app/metrics` |

### 3.4 Fiabilité : `DataHealth.jsx` (68 lignes)

`HealthRing` (anneau SVG, `role="img"`, valeur au centre, couleur par niveau ET texte du niveau,
jamais la couleur seule), `DataHealth` compact (3 manques max, « +N pt », « Débloque … », lien
vers la page) ou complet, `HealthRules` (7 règles : points « x / y », jauge, « la fiabilité
atteindrait N », « Non applicable » hors dénominateur).

### 3.5 Pages et routes

| Route | Fichier | Contenu |
|---|---|---|
| `/app/overview` (« Aujourd'hui ») | `app.overview.jsx` réécrit | en-tête (salutation, sync, période), rail, bandeau dev store, devise mixte, puis **9 blocs** : résultats, situation, priorités, opportunité, courbe (emplacement réservé F4-B), cascade en tableau, fiabilité compacte, indicateurs repliés ; état vide actionnable quand 0 commande (raisons d'exclusion + « Ce qui peut déjà être dit ») |
| `/app/metrics` (« Indicateurs ») | `app.metrics.jsx` nouveau | sélecteur de période, trous de données, grille des 12 KPI (F4-A2 inchangée), notes, `MetricsLearn` (12 dépliages « Ce que c'est / Pourquoi / Comment / Surveiller » depuis `learn.kpi.*`), bandeau du moteur (déplacé ici) |
| `/app/data-health` (« Fiabilité des données ») | `app.data-health.jsx` nouveau | anneau complet, 7 règles, trous de données, insights de données et partiels |
| `/app/dashboard` | inchangé | redirige vers `/app/overview` |

Le loader unique `loadOverview` (`overview.server.js`) lit désormais les faits sur la période
courante **et les 4 précédentes** (D1, fenêtres contiguës calculées par `previousWindows`),
agrège chaque période, calcule `dataConfidence`, `buildBriefing`, et résout en une requête Admin
`nodes(ids:)` les titres des produits cités (20 max, jamais bloquante). Retour enrichi :
`confidence`, `briefing`, `titles`, `waterfall`. Le diff contre HEAD ne touche à aucune requête
Supabase existante.

### 3.6 Nav hybride (`sections.js`, `SectionRail.jsx`, `app.jsx`)

Trois groupes : **Piloter** (Aujourd'hui, Décisions, Simulateur, Demander), **Explorer**
(Indicateurs, Profit, Croissance, Clients, Produits, Marketing, Stock), **Système** (Fiabilité des
données, Réglages). 13 sections, 3 livrées (`overview`, `metrics`, `data_health`), 10 « Bientôt »
grisées non cliquables. `s-app-nav` (App Bridge) ne liste que les sections livrées + l'ancien
écran, sans changement de code (`LIVE_SECTIONS`). `Trésorerie` et `Expériences` retirées du
catalogue ; `Intelligence` devient `Décisions` + `Demander`. Emplacements réservés réduits à 2
(courbe, cascade) ; les 5 autres (changements, assistant, produits, marketing, funnel, stock) sont
remplacés par les vrais blocs ou vivent dans leurs sections.

### 3.7 Correctif C12 (CSS)

`.tcc-cta` : surface neutre, encre `--tcc-accent-ink`, bordure fine, variante `--ghost` ; période
active du segmenté : surface + encre, sans aplat violet. Lot 26 vérifie les deux blocs et
l'absence de tout `background: var(--tcc-accent);` dans la feuille. Le violet reste une couleur
de données (série CM2, badge simulation), jamais un bouton.

### 3.8 Catalogues

`en.js` / `fr.js` : 410 → **525 clés**, `fr = en` (lot 26). Nouvelles familles : `nav.group.*`,
`overview.block.*`, `overview.priorities.*`, `overview.opportunity.*`, `overview.empty.partial_title
| unlock`, `overview.all.more`, `overview.waterfall.note`, `results.*`, `analysis.*`,
`assumption.*` (7), `health.*` (titre, niveaux, 7 règles + aide, déblocages, page), `metrics.*`,
`learn.label.*`, `reason.*` (10 codes Shopify), `evidence.*` (17 nœuds de preuve sans entrée de
calcul). Clés retirées : `nav.cash`, `nav.experiments`, `nav.intelligence`, 6
`overview.reserved.*`. `nav.overview` devient « Today » / « Aujourd'hui ».

### 3.9 Fichiers

| Fichier | État | Lignes |
|---|---|---|
| `app/lib/insights/render.js` | nouveau | 75 |
| `app/components/overview/Analysis.jsx` | nouveau | 103 |
| `app/components/overview/Briefing.jsx` | nouveau | 165 |
| `app/components/overview/DataHealth.jsx` | nouveau | 68 |
| `app/components/overview/MetricsLearn.jsx` | nouveau | 29 |
| `app/routes/app.metrics.jsx` | nouveau | 55 |
| `app/routes/app.data-health.jsx` | nouveau | 44 |
| `app/routes/app.overview.jsx` | réécrit | 78 |
| `app/lib/overview.server.js` | étendu (+34) | 149 |
| `app/lib/sections.js` | réécrit | groupes, 13 sections |
| `app/components/overview/SectionRail.jsx`, `Blocks.jsx` | réécrits | rail groupé ; état vide + partiels, `ReservedSlots only` |
| `app/styles/overview.css` | +≈120 lignes | C12, rail, résultats, situation, analyse, QIA, cause, confiance, preuves, priorités, blocs, fiabilité, cascade, repli, pédagogie |
| `app/lib/insights/reference.js`, `index.js` | 2 lignes chacun | filtre période vide ; `reference` porté par l'insight |
| `app/lib/i18n/context.jsx` | +1 | `number()` (décimales localisées, points de %) |
| `app/locales/en.js`, `fr.js` | +115 clés | voir 3.8 |
| `tests/lot26_dashboard_i18n.mjs`, `lot27_insights.mjs`, `scripts/render_check.mjs` | étendus | voir §4 |

## 4. Preuves locales (gate complète, 2026-09-23)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 535 avertissements (tous `react/prop-types`, non bloquants) |
| `npm test` | 27 lots verts ; lot 26 = 123 assertions (+5), lot 27 = 96 (+2) |
| `node scripts/render_check.mjs` | 79 scénarios verts (+22), tous sur composants réels via Vite SSR + memory router |
| `npm run build` | client 381 modules, serveur 114 modules, OK |
| fichiers protégés | 0 diff |

Nouvelles assertions du lot 26 : nav hybride (13 sections, groupes 4 / 7 / 2, 3 livrées avec
leurs routes, libellés imposés en/fr, Trésorerie et Expériences absentes), 2 emplacements
réservés, clés `overview.block.*` et `results.*.label` obligatoires, préfixes I0-B réservés
(`assumption.`, `reason.`, `health.rule.`, `health.unlock.`, `health.level.`, `results.gap.`,
`evidence.`), C12 (deux blocs neutres + aucun fond plein `--tcc-accent`), fichiers F4 étendus
(`app.metrics.jsx`, `app.data-health.jsx`, `render.js`). Le garde-fou « une @container ne cible
jamais son propre conteneur » a attrapé trois fautes (`.tcc-results`, `.tcc-qia`, `.tcc-health`),
corrigées par un parent porteur (`-wrap` / `-host`).

Nouvelles assertions du lot 27 : une période sans commande n'est pas une référence ; 11 fichiers.

Nouveaux scénarios de rendu (22), tous en français puis en anglais quand la phrase diffère :

- Analyse `cm2_drop` : « a baissé de 12,9 points » (plus de « pt points »), fourchette, badge
  Confirmé, « Pourquoi cette conclusion ? », `<details>` Question / Impact / Action, barres de
  cause SVG sans `style=`, modale avec « Marge de contribution 2 (%) (référence) », « 100 % de
  l'écart est expliqué » ; contexte « contre 52,4 % vs vos 17 dernières semaines ».
- Analyse de données `cost_coverage` : carte `is-data`, CTA « Compléter les données » vers
  `/app/data-health`, « Inconnu tant que les coûts ne sont pas saisis », « Aucune cause n'est
  affirmée », preuve libellée « Lignes de commande sans coût produit », aucune fourchette.
- `insight = null` → rien.
- Résultats : boutique saine (3 × ok, 3 modales « Voir le calcul »), boutique manquante
  (« estimation · coûts fixes non renseignés », « sur 50 % du CA à coût connu »), 0 commande
  (« encore 1 commande » × 3, aucun montant).
- Situation en baisse (fr) et manquante (en).
- Priorités : 3 cartes classées 1-2-3 sans règle de données ; vide + partiels → état vide
  actionnable avec « Débloque : Marge de contribution 2. ».
- Opportunité (saine) : badge Simulation, « par mois », avant → après, hypothèse « commandes
  constantes avec un panier plus grand » ; absente → rien.
- Cascade : 12 lignes, 3 totaux, note. Indicateurs repliés : 3 lignes + lien `/app/metrics`.
- Fiabilité compacte : anneau 30 « faible », 3 manques « +20 pt » et « Débloque … », lien ; saine
  en anglais : 100 « high », « Everything the engine needs is in place ».
- Règles : 7 cartes, « 15 / 30 », « 0 / 20 », jauge SVG, « la fiabilité atteindrait », « ROAS de
  point mort » (clé `health.unlock.be_roas` ajoutée après un premier rendu qui affichait la clé
  brute), aucune couleur en dur, aucun `style=`.
- Rail : 3 groupes titrés, « Aujourd'hui » actif, 3 liens, 10 « Bientôt », « Demander » et
  « Décisions » présents, Trésorerie et Expériences absentes.
- État vide actionnable : raisons + « Ce qui peut déjà être dit » avec un partiel.
- Pédagogie : 12 dépliages × 4 champs. Emplacements : 2 cartes, `only=["chart"]` → 1.

Gotcha de rendu : `Intl` en français insère une espace fine insécable (U+202F) avant `%` et comme
séparateur de milliers ; les regex des scénarios utilisent `.` à ces positions.

## 5. Écarts et points ouverts

1. **Fenêtre de lecture élargie.** Le loader lit désormais jusqu'à 5 périodes (par exemple 450
   jours sur la vue 90 jours) sous le même plafond de 5 000 commandes / lignes trié du plus
   récent au plus ancien : sur une grosse boutique, la référence D1 se tronque en silence (le
   drapeau `capped` reste affiché). À lever quand les rollups produit (F1) alimenteront la
   référence, hors I0.
2. **CTA vers une section « Bientôt ».** « Ouvrir Profit » ouvre la modale complète au lieu d'une
   page absente : choix assumé, à revoir quand la section existe.
3. **Cause sur-expliquée.** Sur la boutique en baisse, le taux de coût produit explique 185,8 % de
   l'écart et le panier moyen 48 % (les effets se compensent partiellement, résidu nul). C'est le
   pont additif tel que décidé ; la barre plafonne à 100 %, la phrase dit le vrai. À trancher
   en I0-D si le ton doit plutôt dire « plus que l'écart entier ».
4. **Titres produits.** Résolus via Admin `nodes(ids:)` à chaque chargement (20 max). Un cache
   (colonne `product_title` sur les rollups) évitera la requête plus tard.
5. **`Icon id="soon"`** sert de chevron aux dépliages (icône horloge existante) ; une icône
   chevron dédiée sera ajoutée avec F4-B.
6. **Mémoire des décisions (I0-C)** non commencée : aucun `insight_log` / `decision_log`, aucune
   migration, comme prévu par le GO.

## 6. Preuves à faire sur la boutique de dev (après commit + déploiement)

Seul, après déploiement Vercel (statut lu via l'API GitHub) : chargement HTTP 200 des trois
routes avec la session de dev, absence d'erreur serveur dans les logs de la fonction.

Clics de Mathys :

1. `/app/overview` : les 9 blocs dans l'ordre, salutation, période partielle, rail à 3 groupes,
   « Aujourd'hui » dans `s-app-nav` avec « Indicateurs » et « Fiabilité des données ».
2. Vague de commandes du §6 du rapport I0-A (produits A–D, 15 puis 12 commandes) : les 3
   priorités apparaissent, chaque carte se déplie (Question / Impact / Action, barres) et sa modale
   s'ouvre puis se ferme via `commandFor`.
3. Résultat estimé marqué « estimation · coûts fixes non renseignés » tant qu'aucun coût fixe
   n'est saisi ; disparition du marqueur après saisie.
4. `/app/data-health` : anneau, 7 règles, « la fiabilité atteindrait N » ; le lien « Compléter les
   données » depuis une analyse de données y mène.
5. `/app/metrics` : sélecteur 7 / 30 / 90 conservé, 12 tuiles, dépliages pédagogiques.
6. C12 : aucun bouton violet ; période active neutre ; thème sombre de l'admin (jetons
   `--tcc-*` sombres) ; iPhone portrait (une colonne partout, aucun débordement horizontal).
7. Boutique de dev : bandeau « Inclure brouillons et tests » toujours fonctionnel (POST).
