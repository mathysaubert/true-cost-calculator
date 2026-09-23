# F4-A — Coquille Polaris WC, i18n, Tableau de bord : implémentation (2026-09-23)

Suite de `docs/rapports/2026-09-23_f4-coquille-i18n-dashboard_phase0.md` et des arbitrages C1 à C11
consignés dans `docs/rapports/2026-09-22_decisions.md` (section F).

Statut : **écrit et prouvé localement (gate complet vert) ; migration F4-01 appliquée sur la base de
test (rollback prouvé) puis en prod le 2026-09-23 (§4.4) ; commit et push sur GO.** `app._index.jsx`,
`engine.js`, `app/lib/econ/*` existants et `app/lib/sync/*` : 0 diff (vérifié par `git diff`).

## 1. Problème

L'app n'a qu'un écran de 3 800 lignes, 100 % français en dur, styles inline, sans locale ni
navigation admin ; le moteur F3 et les faits F2 sont en production mais aucun écran ne les lit. Sur
la boutique de dev, toutes les commandes sont exclues (brouillons et tests) : un tableau de bord
naïf serait vide.

## 2. Cause

Pas de coquille (locale, catalogues, navigation) ni d'adaptateur entre les faits stockés
(`order_margins` v2 sans `revenue_units`, `cogs_units`, `cout_rendu_unit`, `tax_per_unit`) et la
forme attendue par `aggregate()`.

## 3. Solution

### 3.1 Fichiers

| Fichier | Lignes | Rôle |
|---|---|---|
| `app/lib/i18n/resolveLocale.js` | 86 | Pur. 36 codes de l'admin, alias (`pt` → `pt-BR`, `zh-Hant` → `zh-TW`…), chaîne C3a (surcharge > `?locale=` > cookie > `Accept-Language` > `en`), cookie `tcc_locale` `SameSite=None; Secure; HttpOnly`, `dir` (RTL : ar, he, ur) |
| `app/lib/i18n/t.js` | 61 | Pur. `createTranslator` à API i18next (`t(key, vars)`, `{{var}}`, pluriels `_one/_other` par `Intl.PluralRules`, repli `en`, clé rendue si absente, `onMissing`) |
| `app/lib/i18n/format.js` | 76 | Pur. Montants, entiers, %, ratios `×`, écarts signés (% ou points), jours boutique, date-heure : tout `Intl`, locale + devise boutique, `MIXED` jamais formaté en devise |
| `app/lib/i18n/context.jsx` | 31 | `I18nProvider` / `useI18n` : `t`, `money`, `pct`, `delta`, `day`… — même locale serveur et client |
| `app/locales/en.js`, `fr.js`, `index.js` | 150 / 147 / 11 | Catalogues plats (144 clés `en`, `fr` identique) ; `catalogsFor(locale)` ne transmet au client que la locale servie + `en` |
| `app/lib/econ/adapters.js` | 90 | Pur. `lineFromOrderMarginsRow` (C7), `ordersForEngine` (port remboursé depuis `refunds`, remappage C6 limité à `draft`/`test`), `applyOrderDiscounts` (C7b : `orders.discounts_amount` → `ca_brut`/`remises` boutique et jour, nœuds ré-évalués, non mutant) |
| `app/lib/dashboard.js` | 144 | Pur. Fenêtres (`days` jours finissant hier dans le fuseau boutique + période précédente contiguë), 12 KPI (décision 14 ; 8 primaires), statuts `ok / insufficient / unknown / unavailable`, écarts (% ou points), entrées « Voir le calcul », notes, trous |
| `app/lib/dashboard.server.js` | 91 | Lectures Supabase bornées à `[prev.start, current.end]`, plafond 5 000 lignes signalé (C8a), lecture unique de `shop.plan.partnerDevelopment` mémorisée dans `shop_settings.is_dev_shop`, bascule `include_test_orders` refusée hors boutique de dev |
| `app/routes/app.jsx` | +56/−8 | Coquille : locale résolue au loader, cookie posé via `data(…, { headers })`, `I18nProvider`, `s-app-nav` (`rel="home"` → `/app`, Tableau de bord, écran classique) |
| `app/routes/app.dashboard.jsx` | 59 | Loader (Supabase + entitlement scope `read_all_orders` lu dans la session), action `toggle_test_orders`, page `s-page inlineSize="large"` |
| `app/components/dashboard/*` | 214 | `KpiTile` (valeur, badge d'écart icône + texte, statut, modale « Voir le calcul » avec formule et entrées), `KpiGrid` (3 sections, `s-grid` `@container`, 4 secondaires masqués sous 480 px derrière « Afficher N indicateurs de plus », C10a), `DataGapsBanner` + `DashboardNotes`, `PeriodSelector` (liens `?days=`), `DashboardEmptyState` (raisons d'exclusion), `DevShopBanner` (`Form` POST, aucun champ contrôlé) |
| `app/root.jsx` | +4/−2 | `lang` et `dir` depuis le loader de `routes/app` (`useRouteLoaderData`) |
| `supabase/migrations/20260923_f4_01_dev_shop_settings.sql` | 12 | `is_dev_shop BOOLEAN` (nullable), `include_test_orders BOOLEAN NOT NULL DEFAULT false` — idempotente, non appliquée |
| `supabase/rollback/20260922_f1_rollback.sql` | +5 | Étape 0b : retire les deux colonnes |
| `tests/lot23_schema.mjs` | +16 | Section 9 : addendum F4 (2 colonnes, défaut false, nullable, rollback) |
| `tests/lot26_dashboard_i18n.mjs` | 246 | 80 assertions (§4.2) |
| `scripts/render_check.mjs` | +89 | 16 scénarios Tableau de bord (§4.3) |
| `package.json` | +1/−1 | lot 26 dans la chaîne |

Aucune dépendance npm nouvelle (C1a, C2a, C4c).

### 3.2 Arbitrages appliqués et écarts à signaler

- **C1a / C2a** : React 18.3, `AppProvider` 1.2.0 (`polaris.js`) inchangés. Aucun champ contrôlé :
  le sélecteur de période est fait de liens, la bascule est un `<Form method="post">` natif.
- **C3a** : le cookie n'est posé que si la locale vient du paramètre ou d'une surcharge et diffère
  du cookie existant. Phrase pour la politique de confidentialité (§5).
- **C4c** : module maison ; les catalogues sont des **modules JS** (`en.js`, `fr.js`) et non des
  JSON : les attributs d'import JSON (`with { type: "json" }`) ne passent pas le parseur ESLint 8
  du gate de build. Forme plate identique, convertible en JSON pour les traducteurs en F4-D.
- **C5a** : `en` et `fr` ; lint `fr = en` (80 assertions incluent l'égalité des clés de base,
  l'absence d'orphelines et la présence de chaque clé utilisée, familles dynamiques comprises).
- **C6a** : `include_test_orders` n'a d'effet que si `is_dev_shop === true`, vérifié au loader ET
  dans l'action ; `cancelled`, `gift_card_only`, `b2b` ne sont jamais réintégrées (lot 26 §6).
  Tant que la migration n'est pas appliquée, l'écriture de `is_dev_shop` échoue silencieusement
  (avertissement journalisé) et la bascule renvoie `not_dev_shop` : rien ne casse, le bandeau
  s'affiche quand même sur une boutique de dev grâce à la lecture live.
- **C7b** : adaptateur + remise de commande injectée au niveau boutique et jour (jamais par
  produit). Approximations restantes : `cogs_units = effective_qty` (repli A2a) et `remises`
  par ligne nulles ; à lever par l'addendum F2 (C7c) avant l'écran Produits.
- **C8a** : faits lus à chaque chargement, `DASHBOARD_LINES_CAP = 5000`, bandeau « chiffres
  partiels » si dépassé. `daily_rollups` reste vide.
- **C9b** : le lot 26 scanne tout `app/` hors une liste d'exclusion explicite (ancien écran,
  `costsUi`, `customsUi`, pages d'auth, `privacy`, `debug`, `root` pour son ErrorBoundary hors
  coquille) : 77 fichiers scannés, 0 chaîne en dur. Heuristique : texte JSX littéral après une
  balise, attributs `heading/label/placeholder/accessibilityLabel/title/alt` en dur.
- **C10a** : les 4 KPI secondaires sont **CVR, MER, POAS, LTV/CAC** (et non « POAS, LTV/CAC, taux
  de retour, OTD » cités en exemple dans C10) : la liste des 12 est celle de la décision 14, qui
  ne contient pas l'OTD ; le taux de retour reste primaire. Réversible en changeant `primary`
  dans `KPI_DEFS`.
- **C11a** : `/app/dashboard` ; `/app` inchangé ; `s-link rel="home"` sur `/app`.
- **État vide** : quand aucune commande n'est incluse, tous les KPI sont « insuffisant : encore 1
  commande » (jamais un 0 « ok »), et la page affiche l'état vide avec les raisons d'exclusion.
- **Validation Polaris (outil Shopify, v1.0)** : toute la page valide sauf deux points :
  `accessibilityLabel` n'existe pas sur `s-badge` (retiré : le libellé « vs période précédente »
  est un texte visible à côté du badge) ; `s-app-nav`/`s-link rel` ne sont pas dans les types
  Polaris (composants App Bridge) mais `rel="home"` est la forme documentée par la page App nav.
- **Avertissement pré-existant** : `render_check` affiche `useLayoutEffect does nothing on the
  server` pour chaque scénario (RouterProvider du harnais, déjà présent avant F4-A) ; sans effet.

## 4. Preuves

### 4.1 Gate complet (R4)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 382 warnings (345 avant ; les 37 nouveaux sont tous `react/prop-types` sur les composants du Tableau de bord, politique inchangée) |
| `npm test` | 26 lots verts (lot 1 à lot 26) |
| `node scripts/render_check.mjs` | « Tous les rendus réels OK » : 51 scénarios (35 existants + 16 Tableau de bord) |
| `npm run build` | client et serveur construits sans erreur |
| `git diff --stat` sur `app._index.jsx`, `engine.js`, `econ/aggregate.js`, `sync/` | vide |

### 4.2 Lot 26 (80 assertions)

1. Locale : `fr-CA` → `fr`, `pt`/`pt-BR`/`pt-PT`, `zh` variantes, injection → null, ordre
   surcharge > paramètre > cookie > `Accept-Language` (poids `q`) > `en`, cookie `SameSite=None;
   Secure; HttpOnly`, RTL, 36 codes.
2. `t()` : interpolation, pluriels `fr` (0 et 1 singulier) et `en` (0 pluriel), repli `en`
   signalé, clé absente → clé, variable absente → vide.
3. Catalogues : `fr` = `en` (clés de base), aucune valeur vide, toute clé littérale et chaque
   membre des familles dynamiques (12 KPI × label/help, entrées de calcul, sections, raisons
   d'exclusion, sources, `minData`, notes, trous) présents, aucune orpheline.
4. Lint : 77 fichiers `app/` scannés, 0 chaîne en dur ; aucun `style={{` ni couleur hex dans le
   Tableau de bord ; aucun import d'`engine.js`/`orderHistory.js` ni `fr-FR` dans les fichiers
   F4 ; la locale rendue ne vient jamais d'App Bridge.
5. Adaptateur : #1022 (remboursée, coût manquant) → 0 unité comptée, CM1 null ; legacy → null et
   compté ; taxes 40 sur 2 unités → 20/unité, TTC 120, coût rendu 16,80 ; carte cadeau exclue.
6. C6 : désactivé → seule la commande normale ; activé → `draft` et `test` réintégrées ;
   `cancelled`/`b2b` jamais.
7. C7b : CA HT 104 (100 produit + 4 port client) inchangé, remises 5 injectées boutique et jour,
   non mutant, fenêtre sans remise → même objet.
8. Fenêtres : 30 jours finissant hier dans le fuseau New York (22 → 21) et précédente contiguë ;
   7 jours UTC ; `?days=` hors liste → 30.
9. Trois états de la boutique de dev : vide (12 KPI « encore 1 commande ») ; coûts manquants (CA
   HT 604 et 3 commandes « ok », panier « encore 7 commandes », CM2 % « encore 10 commandes à
   coût connu », CM3 « inconnu, 1 ligne sans coût », CVR sessions non connectées, CAC/MER/POAS/
   LTV-CAC pub non connectée, retours insuffisants) ; coûts saisis (CM2 60 %, CM3 720, écart CA
   +50 %, CM2 +10 pt) ; notes et trous (1 sans coût, 20 legacy, plafond, 2 exclues).
10. Format : `fr` ≠ `en`, `MIXED`/devise absente neutre, devise inconnue → code, %, écarts signés,
    ratio `×`, jour boutique sans décalage, non numérique → null.

### 4.3 Rendu réel (16 scénarios Tableau de bord, données / null / insuffisant / vide, `en` et `fr`)

`KpiTile` : ok + écart (+50,0 %, badge `arrow-up` `success`, modale avec « Gross revenue ») ; même
KPI en `fr` (« CA net HT », `200,00`, « Voir le calcul », « vs période précédente ») ; CM2 % en
points (+10,0 pt) ; coût manquant (« Unknown: 1 line without a product cost. », aucune valeur
rendue) ; insuffisant `en`/`fr` (« 9 more orders » / « encore 9 commandes ») ; source non
connectée ; `kpi=null` → null. `KpiGrid` : 12 modales, 3 sections, `gridTemplateColumns="@container…"`,
4 `.tcc-secondary`, « Show 4 more indicators » ; liste vide → rien. `DataGapsBanner` : 4 trous
traduits ; vide → null ; notes `fr`. `PeriodSelector` : liens `?days=7/90`, 30 actif
`primary disabled`, plage « Aug 24, 2026 to Sep 22, 2026 ». `DashboardEmptyState` : 7 brouillons,
lien `/app` ; sans exclusion. `DevShopBanner` : OFF (form POST `value="1"`), ON (`fr`), boutique
marchande → null, `null` → null.

### 4.4 Application de la migration F4-01 et preuve du rollback (2026-09-23, GO reçu)

Outils : mêmes scripts scratchpad que F1/F3 (application fichier par fichier via `prisma db
execute`, URLs masquées, vérifications en lecture seule dans un shell frais), plus un script de
vérification des 2 colonnes (type, nullabilité, défaut, valeurs neutres sur les lignes existantes,
colonnes de l'addendum F3 intactes).

| Étape | Base | Résultat |
|---|---|---|
| 1. Application de F4-01 seule | test (eu-central-1) | 1/1 OK ; 2 colonnes conformes ; 0 ligne |
| 2. Rollback complet (étape 0b puis F1) | test | OK ; F4 absente ; absence F1 complète (10 contrôles : 26 tables, fonctions, colonnes et index F1 retirés, historique intact) |
| 3. Réapplication des 24 fichiers F1 puis de F4-01 | test | 24/24 puis 1/1 OK ; schéma conforme au contrat (38 tables, RLS, fonctions) ; addendum F3 conforme ; F4-01 conforme |
| 4. Application de F4-01 seule, filtre `20260923_f4_01*` | **prod (eu-west-1)** | 1/1 OK ; 2 colonnes conformes ; 4 lignes `shop_settings` toutes `is_dev_shop NULL`, `include_test_orders false` ; schéma conforme au contrat |

Rien recalculé, aucune donnée modifiée.

## 5. Politique de confidentialité — phrase à ajouter (C3a)

Français : « L'application dépose un cookie fonctionnel nommé `tcc_locale` (durée : 12 mois)
qui mémorise la langue d'affichage choisie dans votre admin Shopify. Il ne contient aucune donnée
personnelle, n'est utilisé à aucune fin de mesure d'audience ni de publicité, et n'est jamais
partagé. »

English: "The app sets a functional cookie named `tcc_locale` (12 months) that remembers the
display language of your Shopify admin. It contains no personal data, is not used for analytics
or advertising, and is never shared."

## 6. À prouver sur la boutique de dev après déploiement (GO séparés)

Prérequis : GO d'application de la migration F4-01 (base de test puis prod, preuve de rollback
comme F1/F3), GO commit + push (Vercel déploie), aucun `shopify app deploy` nécessaire (TOML
inchangé).

1. **Navigation** : ouvrir l'app → le menu admin montre « Tableau de bord » et « Écran
   classique » ; `/app` reste l'ancien écran ; le nom de l'app renvoie sur `/app`.
2. **Locale** : admin en français → page en français ; passer l'admin en anglais et rouvrir
   l'app → page en anglais ; en-tête de réponse `Set-Cookie: tcc_locale=…; SameSite=None;
   Secure` observé une fois, puis navigation client sans `?locale=` toujours dans la bonne
   langue ; `<html lang="fr" dir="ltr">`.
3. **État 1** (bascule OFF, défaut) : état vide « Aucune commande à analyser » avec
   « 7 commandes … exclues (7 brouillon) » sur 90 jours ; bandeau bleu « Boutique de
   développement » présent (lecture `partnerDevelopment = true`) ; `shop_settings.is_dev_shop =
   true` écrit.
4. **État 2** : clic « Inclure les commandes brouillon et de test » → `include_test_orders =
   true` ; 12 tuiles : CA HT, commandes, panier moyen chiffrés en USD au format de la locale ;
   CM2 %/CM3/résultat « inconnu, N lignes sans coût » ; CVR, CAC, MER, POAS, LTV/CAC « non
   connecté » ; bandeau des trous : lignes sans coût, « 20 lignes … avant le nouveau moteur »,
   « N commandes exclues (annulée / B2B) » le cas échéant.
5. **État 3** : saisir un coût sur l'écran classique (Suivi des coûts) pour le produit de #1022,
   lancer « Recalculer les marges estimées » → CM2 % « encore 9 commandes à coût connu »,
   modale « Voir le calcul » de CM3 avec `cogs` non nul ; aucun 0 silencieux.
6. **Période** : `?days=7 / 30 / 90` → plages affichées cohérentes avec le fuseau
   `America/New_York` (jour boutique) ; comparaison à la période précédente.
7. **Sécurité de la bascule** : POST `toggle_test_orders` sur une boutique dont
   `is_dev_shop` n'est pas true → `not_dev_shop`, rien écrit (à rejouer avec la boutique de revue
   si sa session est valide, sinon test unitaire lot 26 §6 seul).
8. **Web Vitals** : `meta name="shopify-debug" content="web-vitals"` en local ou lecture du
   Partner Dashboard après quelques chargements : LCP ≤ 2,5 s, CLS ≤ 0,1.
9. **Mobile** : capture iPhone portrait du Tableau de bord ; sous 480 px de conteneur, 8 tuiles
   puis « Afficher 4 indicateurs de plus » ; aucun débordement horizontal (point mobile en
   mémoire).
10. **Ancien écran** : `/app` fonctionne à l'identique (zéro diff), y compris `?tab=costs` des
    e-mails d'alerte.

## 7. Ce qui reste (sur GO séparés)

1. Application de la migration `20260923_f4_01_dev_shop_settings.sql` : base de test, rollback
   prouvé, puis prod (mêmes scripts scratchpad que F1/F3).
2. Commit unique + push, statut Vercel via l'API GitHub.
3. Preuves §6, puis rapport de preuves.
4. F4-B (Phase 0 courte : React 19 / Polaris Viz / `polarisUrl`), addendum F2 (C7c :
   `restocked_qty`, `unit_price_original_ht`, `unit_price_ttc`, `tax_per_unit`).
