# F4 — Coquille Polaris Web Components, i18n, nouveaux écrans : Phase 0

Date : 2026-09-23. Lecture seule : ce fichier est la seule écriture de la session. Aucune ligne
de code, aucune migration, aucune dépendance installée, rien d'irréversible. Fait suite à
`2026-09-22_refonte-phase0.md` (§2, §8, §9 q.14), `2026-09-22_decisions.md` (décisions 8, 11,
13, 14, 18 ; A13-A15 ouverts), `2026-09-22_f3-moteur_implementation.md` (moteur `app/lib/econ/`)
et `2026-09-22_f2-sync_implementation.md` (§4.5 : constats sur la boutique de dev).

État du dépôt : HEAD `0e08ed6`, arbre propre. Sources vérifiées : code du dépôt, `node_modules`
(versions installées), registre npm (versions publiées, lecture seule), documentation Shopify
App Home v1.0 et v1.1 via le MCP Shopify (liens en annexe). Ce que je n'ai pas pu vérifier est
marqué « à confirmer ».

---

## 0. Résumé exécutif

1. **F4 se découpe en quatre tranches ; la première (F4-A) livre un seul écran, le Tableau de
   bord, sur les données réelles de la boutique de dev**, avec la coquille (navigation, locale,
   catalogues) dimensionnée pour tous les écrans suivants mais remplie pour un seul. L'ancien
   écran `app._index.jsx` reste intact et accessible pendant toute la transition ; il n'est
   retiré qu'en F4-D avec la migration de suppression (décision 18).
2. **Trois faits techniques conditionnent les arbitrages** : (a) l'app tourne sous React 18.3
   alors que la documentation Shopify exige React 19 pour les champs Polaris contrôlés ; (b)
   Polaris Viz (décision 8) ne déclare pas React 19 dans ses dépendances ; (c) `AppProvider`
   1.2.0 injecte `polaris.js` sans possibilité d'épingler une version, la 3.0.0 le permet.
   Le Tableau de bord n'a pas de champ contrôlé et pas de graphique en F4-A : on peut livrer
   sans trancher React 19 ni Polaris Viz, à condition de le décider explicitement (C1, C2).
3. **Sur la boutique de dev, le Tableau de bord affichera zéro commande** si rien n'est décidé :
   les 7 commandes présentes sont toutes `excluded_reason = 'draft'` (brouillons) et une
   commande passée au checkout d'une boutique de dev serait `test`. Le moteur les exclut par
   construction (brief §9). Il faut un réglage « inclure les commandes de test et brouillons »
   réservé aux boutiques de développement (C6). Sans coût de variante saisi, les marges
   resteront « inconnues » (jamais 0) : c'est un état à prouver, pas à contourner.
4. **Le moteur F3 ne lit pas directement `order_margins`** : `aggregate()` attend des lignes au
   format `computeLineEconomics` (`revenue_units`, `cogs_units`, `cout_rendu_unit`,
   `tax_per_unit`, `unit_price_ttc`, `unit_price_original_ht`), dont quatre ne sont pas stockés.
   Un adaptateur pur ligne stockée → ligne moteur est nécessaire, avec deux approximations
   documentées (C7). Les 20 lignes legacy de juillet (sans `breakdown_version`) sont hors
   périmètre et comptées comme trou visible.
5. **La langue** : la locale de l'admin arrive dans le paramètre `locale` de la requête initiale
   et dans `shopify.config.locale` côté client. Le rendu est côté serveur : le loader doit
   connaître la locale avant de rendre (C3). Anglais source (décision 11) ; en F4-A seuls les
   catalogues `en` et `fr` sont remplis, l'architecture accepte les 35 (C4).

Onze arbitrages en §7 (C1 à C11). Bloquants pour écrire F4-A : C1, C3, C5, C6, C7, C8.

---

## 1. Périmètre et découpe de F4

### 1.1 Les quatre tranches

| Tranche | Contenu | Taille | Dépend de |
|---|---|---|---|
| **F4-A** | Coquille : `app.jsx` (navigation `s-app-nav`, locale, fournisseur i18n), infrastructure i18n (détection, catalogues `en`/`fr`, formatage `Intl`, lint « aucune chaîne en dur »), route `app.dashboard` (loader Supabase → adaptateur → `aggregate` → 12 KPI + trous de données + `minData`), réglage boutique de dev (C6), lot 26, `render_check` étendu, preuves sur la boutique de dev | M | F2, F3 (faits) |
| F4-B | Graphiques : décision React 19 / Polaris Viz tranchée et appliquée ; courbe CA HT et CM2 par jour sur le Tableau de bord ; `render_check` avec repli SSR | S | F4-A, C1/C2 |
| F4-C | Écrans d'analyse : Produits, Marges (M2), Seuils (M3), Réglages > Coûts (migration du Suivi des coûts), Alertes ; chaque écran = Phase 0 courte + lot + preuve | L | F4-A, F4-B |
| F4-D | Bascule : `app._index` redirige vers le Tableau de bord, retrait de l'ancien écran et de `costsUi`/`customsUi`, migration de suppression (`calculations`, `calculation_annotations`, `margin_alerts`) + `purge_shop` mis à jour + lot 23, catalogues des 35 langues (traduction automatique, relecture des 5 principales), vérification iPhone | M | F4-C |

Le brief plaçait Leviers, Simulateur, « ce qui a changé / pourquoi / impact » dans le Tableau de
bord : ces blocs dépendent des règles (I1) et de A13-A15. **F4-A livre la partie « KPI +
comparaison à la période précédente + trous visibles »** ; les blocs d'intelligence s'ajoutent
en I1 sans toucher à la structure (une section de plus).

### 1.2 Ce que F4-A ne fait pas

Aucun graphique (F4-B), aucun formulaire de saisie (les réglages restent dans l'ancien écran),
aucune règle ni IA (I1), aucune suppression de table (F4-D), aucun changement de facturation,
aucune modification d'`engine.js`, d'`app/lib/econ/` (sauf un fichier adaptateur, C7) ni de
`app/lib/sync/`. `app._index.jsx` : zéro diff.

---

## 2. Existant vérifié

### 2.1 Coquille et versions

| Élément | État vérifié | Conséquence |
|---|---|---|
| `app/routes/app.jsx` | `AppProvider embedded` + `s-app-nav` avec un seul lien `Accueil` en français en dur | Devient la coquille i18n ; les liens de navigation sortent des catalogues |
| `AppProvider` (`@shopify/shopify-app-react-router` **1.2.0** installée, 3.0.0 publiée) | Injecte `app-bridge.js` (avec `data-api-key`) et `https://cdn.shopify.com/shopifycloud/polaris.js` ; **aucune prop `polarisUrl`** ; pair `react >= 18` | La doc Shopify recommande le canal stable `polaris-1.js` et l'épinglage par `polarisUrl` (prop du composant + `shopifyApp({ polarisUrl })` pour l'en-tête `Link` de préchargement) : disponible seulement en montant le paquet (C2) |
| `polaris.js` | La page doit charger **exactement un** build Polaris avant le bundle (doc « Migrate from Polaris React », étape 1) | Impossible d'ajouter notre propre balise sans retirer celle d'`AppProvider` |
| React **18.3.1** (19.3.0 publiée) | Doc Polaris WC : « If the app renders Polaris web components through React, upgrade to React 19 before migrating controlled fields. React 18 doesn't provide the custom-element property and event behavior that controlled Polaris web components rely on » | Le Tableau de bord n'a aucun champ contrôlé (un sélecteur de période = lien ou `<form>` natif) : F4-A tient sous React 18 ; F4-C (Réglages) exigera la décision (C1) |
| `@shopify/polaris-viz` 16.16.0 (non installée) | Pairs déclarés : `react ^16.14 || ^17 || ^18` ; lit `window` au rendu (doc « Build a sales dashboard ») : rendu client seulement | Conflit de pairs avec React 19 ; SSR = espace réservé (C1, C2) |
| `@shopify/polaris-types` 1.0.1 (1.1.0 publiée), `@shopify/app-bridge-react` 4.2.10 | Types JSX des `s-*` ; `useAppBridge` | À aligner sur le canal Polaris choisi |
| `entry.server.jsx` | `renderToPipeableStream`, `onShellReady` (bots : `onAllReady`), `streamTimeout` 5 s | Les `s-*` se rendent en SSR comme des balises : le HTML arrive avant `polaris.js`, l'admin affiche le contenu une fois les custom elements définis (FOUC possible, à mesurer au premier rendu réel) |
| `root.jsx` | `<html lang="en">` en dur | `lang` et `dir` doivent suivre la locale (RTL plus tard, décision 13) |
| Formatage | `formatMoney` (`orderHistory.js`), `formatPct`/`formatNum` (`engine.js`), `toLocaleDateString("fr-FR")` : **tout en `fr-FR` codé en dur** | Nouveau module `app/lib/i18n/format.js` paramétré par locale et devise ; les anciens restent pour l'ancien écran |
| Lint chaînes | `lot2_ui_labels` teste des libellés, pas l'absence de chaînes en dur ; `.eslintrc.cjs` : `react/no-unescaped-entities` en warning | Nouveau scan statique limité aux nouveaux fichiers (C9) |
| `render_check.mjs` | Vite SSR + memory router, 35 scénarios sur `costsUi`/`customsUi` | S'étend aux composants du Tableau de bord ; les `s-*` sortent en balises dans `renderToStaticMarkup` |
| `vercel-build` | `lint && test && prisma && build` (pas de `render_check` dans le build Vercel, il reste local avant commit) | Inchangé |
| `s-app-nav` | Doc : le nom de l'app pointe déjà vers `/` ; si l'accueil est `/app`, ajouter `s-link rel="home"` masqué du menu | Aujourd'hui `Accueil` est un lien visible vers `/app` : à remplacer par `rel="home"` |
| `shop_settings.locale_override` | Colonne F1 existante, jamais écrite | Surcharge marchand (C3), écran Réglages > Langue en F4-C |
| `daily_rollups`, `product_daily_rollups` | Tables F1 vides ; F2 ne les alimente pas ; le moteur agrège à la lecture | F4-A lit les faits (C8) |

### 2.2 Données disponibles sur la boutique de dev (`true-cost-dev.myshopify.com`, base de prod)

D'après le rapport F2 §4.5 (2026-09-23) :

- `shop_settings` : fuseau `America/New_York`, devise `USD`, pays `US` (hors UE : formule
  générique de droits, A9) ; aucun coût de variante saisi (`variant_costs` vide pour cette
  boutique) ; aucune règle de port ni d'emballage.
- `orders` : 7 commandes (6 brouillons juillet + #1022), **toutes `excluded_reason = 'draft'`**.
- `order_margins` : 20 lignes legacy de juillet (colonnes F1 vides, `breakdown_version` nul) +
  1 ligne v2 (#1022 : `cost_source = 'missing'`, `refunded_qty = 1`, `effective_qty = 0`).
- `refunds` (1, réglé, restock `return`), `returns` (1, `DEFECTIVE`, `CLOSED`), `fulfillments`
  (1, livrée), `inventory_daily` (26 variantes, coût vide), `customers_agg` vide, `order_fees`
  vide (pas de Shopify Payments), `ad_spend` et `sessions_daily` vides.

Ce que le Tableau de bord montrera donc, dans l'ordre des décisions :

1. Sans C6 : 0 commande incluse, 7 exclues → état vide « aucune commande analysable » avec le
   compteur des exclusions (trou visible, principe 5).
2. Avec C6 (brouillons et tests inclus sur boutique de dev) : commandes, unités, CA HT, panier
   moyen calculés ; CM1/CM2/CM3 « inconnus » (aucun coût) avec le compteur de lignes sans coût.
3. Après saisie de coûts par Mathys sur l'ancien écran (Suivi des coûts) et recalcul des marges
   estimées (`recalc_estimated_margins`, lot 19) : CM1/CM2 chiffrés sur les lignes v2 ; les 20
   lignes legacy restent « hors moteur » (comptées). `minData` : sous 10 commandes à coût
   connu, `cm2_pct`, `be_roas`, `target_roas` affichent « il manque N commandes ».

Les trois états sont les trois preuves de F4-A (§6.3).

---

## 3. Architecture cible de la coquille

### 3.1 Routes (`flatRoutes`, inchangé)

| Route | F4-A | Fin de F4 |
|---|---|---|
| `app.jsx` | Coquille : `AppProvider`, `s-app-nav` (liens traduits, `rel="home"`), fournisseur de locale et de catalogue (contexte React) ; loader : entitlement (existant), locale (C3), devise/fuseau depuis `shop_settings` | idem, tous les liens |
| `app._index.jsx` | **Intact** (ancien écran, toujours `/app`) | Redirection vers `app.dashboard` puis suppression (F4-D) |
| `app.dashboard.jsx` | Nouveau : loader Supabase seul, aucun appel Admin GraphQL (LCP), `s-page inlineSize="large"` | inchangé |
| `app.products`, `app.margins`, `app.thresholds`, `app.alerts`, `app.settings.*` | absents | F4-C |

Composants : `app/components/dashboard/` (KpiGrid, KpiTile, DataGapsBanner, PeriodSelector,
EmptyState), tous purs et rendus par `render_check` avec données, vide et `null`. Aucun `style`
inline de couleur : jetons Polaris via les props (`tone`, `background`) ; gain/perte jamais par
la couleur seule (badge avec icône + texte, doc Metrics card : `s-badge tone="success"
icon="arrow-up"`).

### 3.2 Gabarit du Tableau de bord (composition « Metrics card » + « Empty state » de la doc)

```
s-page heading={t("dashboard.title")} inlineSize="large"
  s-button slot="secondary-actions"   → période 7 / 30 / 90 jours (liens ?days=, pas d'état contrôlé)
  s-banner (si trous : coûts manquants, frais non confirmés, port non confirmé, commandes exclues)
  s-section heading="Revenus"      → s-grid responsive (@container) : CA HT, commandes, panier moyen, unités
  s-section heading="Marges"       → CM2 %, CM2 par commande, CM3, résultat net
  s-section heading="Acquisition"  → CAC, MER, POAS, LTV/CAC (tous « non connecté » tant que ad_spend est vide)
  s-section heading="Opérations"   → taux de retour, OTD (12e KPI ; 8 sur mobile via s-query-container, C10)
  s-section slot="aside"           → dernière synchronisation (sync_jobs), profondeur d'historique, langue
```

Chaque tuile : valeur formatée (`Intl`, locale + devise boutique), écart vs période précédente
(badge), ou l'un des trois états non chiffrés du moteur : `insufficient` (« il manque N »),
`unknown` (« coût manquant sur X lignes »), `unavailable` (« connectez une source pub »). Un
lien « Voir le calcul » par tuile pointe vers l'écran d'analyse (F4-C) ; en F4-A il ouvre un
`s-modal` avec les feuilles du nœud (entrées et formule lues dans `nodes.js`), ce qui remplit le
principe 1 sans attendre les écrans.

### 3.3 Chargement et responsive

- `s-grid gridTemplateColumns="@container (inline-size <= 400px) 1fr, 1fr 1fr 1fr 1fr"` (syntaxe
  documentée) ; `s-table` non nécessaire en F4-A.
- États de chargement : `shopify.loading(true/false)` sur navigation (App Bridge), pas de
  spinner maison.
- Mobile : contention `body { overflow-x: clip }` de l'ancien écran vit dans le `<style>` de
  `app._index.jsx` : le Tableau de bord ne l'hérite pas. À revérifier sur iPhone après
  déploiement (mémoire projet : capture portrait attendue) ; on ne réintroduit la contention
  que si le débordement réapparaît avec Polaris WC.

---

## 4. Architecture i18n

### 4.1 Détection de la locale (C3)

Faits vérifiés : « apps rendered in the Shopify admin receive the app user's chosen locale in
the `locale` request parameter in Shopify's GET requests to the app » (doc « Localize your
app ») ; `shopify.config.locale` (ex. `en-US`) côté client (Config API). Le rendu étant côté
serveur, la locale doit être connue dans le loader de `app.jsx` :

1. `shop_settings.locale_override` si non nul (surcharge marchand, décision de F1) ;
2. sinon `?locale=` de la requête (présent au chargement initial depuis l'admin) ;
3. sinon un cookie `tcc_locale` (posé par le loader quand `?locale=` est présent, pour les
   navigations client suivantes qui ne portent plus le paramètre) ;
4. sinon `Accept-Language` ; sinon `en`.

Résolution : `resolveLocale(candidates, SUPPORTED)` pure (`fr-CA` → `fr`, `pt-BR` gardé distinct,
`zh-CN`/`zh-TW` distincts, conformément aux 38 langues de l'admin). Côté client, si
`shopify.config.locale` diffère de la locale rendue, on ne re-rend pas (pas de mismatch
d'hydratation) : on pose le cookie et la prochaine navigation suit.

### 4.2 Bibliothèque (C4)

| Option | Version publiée | Pour | Contre |
|---|---|---|---|
| (a) `i18next` + `react-i18next` (+ ICU via `i18next-icu`) | 26.4.2 / 17.0.15 | écosystème, pluriels ICU, extraction | 2 à 3 paquets, configuration SSR (instance par requête) |
| (b) `@shopify/react-i18n` | 7.14.0 | aligné admin, `formatCurrency` | moins actif, pluriels limités, orienté React de Shopify |
| (c) Module maison `app/lib/i18n/` : `t(key, vars)` pur sur catalogues JSON plats, pluriel par `Intl.PluralRules`, contexte React de 30 lignes | 0 dépendance | testable dans les lots, aucun coût SSR, aucune dépendance | pas d'ICU complet (format `{count, plural, …}` absent), à faire évoluer si les phrases se complexifient |

Recommandation : **(c) en F4-A** (12 KPI, une trentaine de clés, pluriels simples), avec une
API `t()` identique à celle d'i18next pour basculer vers (a) en F4-C si les écrans de saisie
exigent des messages composés. Les catalogues JSON ne dépendent pas de la bibliothèque.

### 4.3 Catalogues, formatage, gouvernance

- `app/locales/<locale>.json`, clés = identifiants (`dashboard.kpi.ca_ht.label`), jamais la
  phrase source ; `en.json` source, `fr.json` relu par Mathys ; les 33 autres = fichiers
  absents en F4-A, repli `en` (C5).
- Les nœuds du moteur portent déjà un `i18nKey` implicite (leur `id`) : libellé
  `nodes.<id>.label`, aide `nodes.<id>.help`, unité `nodes.<id>.unit`.
- `app/lib/i18n/format.js` : `money(v, locale, currency)`, `pct`, `int`, `date`, `delta`, tous
  sur `Intl` avec la locale rendue et la devise boutique (`shop_settings.shop_currency`,
  jamais une devise de présentation) ; `MIXED` → jamais sommé (invariant lot 7 conservé).
- Lint (C9) : `tests/lot26_i18n.mjs` scanne les fichiers F4 (liste explicite) : aucun texte
  JSX littéral hors espaces et ponctuation, aucune chaîne dans `heading=`/`label=`/`aria-*`
  sans `t(`, toute clé utilisée existe dans `en.json`, `fr.json` a exactement les clés de `en`,
  aucune clé orpheline.
- `lang` et `dir` posés sur `<html>` depuis la locale (`dir="rtl"` pour `ar`, `he`, `ur`,
  inactif tant que ces catalogues n'existent pas, décision 13).

---

## 5. Le Tableau de bord : données et calcul

### 5.1 Loader (`app.dashboard.jsx`)

Lectures Supabase, toutes filtrées `shop_domain`, fenêtre = `day_local` entre `start` et `end`
(période choisie) et la période précédente de même longueur pour la comparaison :

| Table | Colonnes | Rôle |
|---|---|---|
| `shop_settings` | tout | devise, fuseau, règles de frais/port/emballage, pays, seuil, `return_window_days`, réglage C6 |
| `orders` | tout sauf UTM inutiles | faits par commande, `excluded_reason`, `customer_order_index` |
| `order_margins` | lignes des commandes lues, `breakdown_version = 2` | snapshots par ligne (adaptateur C7) ; les lignes sans `breakdown_version` sont comptées `legacy_lines` |
| `refunds` | `order_id`, `shipping_refunded`, `settled` | `shipping_refunded` par commande (absent d'`orders`) |
| `order_fees`, `returns`, `fulfillments` | par commande | frais réels, retours, OTD |
| `variant_costs` | `variant_id`, `supplier_lead_days`, `buffer_days`, `cout_emballage` | stock, surcharge emballage |
| `promo_code_rules`, `manual_commissions`, `fixed_costs`, `ad_spend`, `sessions_daily`, `inventory_daily` (dernier jour), `customers_agg` | | entrées d'`aggregate` (vides sur la boutique de dev, doivent produire `unavailable`, jamais 0) |
| `sync_jobs` | dernier job terminé | « dernière synchronisation » |

Plafond : `DASHBOARD_LINES_CAP` (5 000 lignes, comme `ORDER_MARGINS_CAP`) avec signal visible si
dépassé (jamais de troncature silencieuse), en attendant les rollups (C8).

### 5.2 Adaptateur ligne stockée → ligne moteur (C7)

`aggregate()` consomme la forme de `computeLineEconomics`. Colonnes stockées dans `order_margins`
v2 : `quantity`, `refunded_qty`, `effective_qty`, `unit_price_ht`, `tax_lines`, `cm1_unit`,
`cm1_components`, `cm2_alloc`, `cost_source`, `is_gift_card`, `product_id`, `variant_id`,
`currency_code`, `day_local`. Champs attendus et absents :

| Attendu | Dérivation proposée | Approximation |
|---|---|---|
| `revenue_units` | `effective_qty` | exacte (même définition D4) |
| `cogs_units` | `effective_qty` | **repli A2 (a)** : `restocked_qty` n'est pas stocké ; une unité remboursée non restockée est comptée comme restockée (coût neutralisé). Exact dès que F2 stocke `restocked_qty` (colonne à ajouter, addendum F1, hors F4-A) |
| `cout_rendu_unit` | `unit_price_ht − cm1_unit` | exacte (définition de `cm1_unit`) |
| `tax_per_unit` | somme des `tax_lines[].amount` ÷ `quantity` | exacte pour les lignes ingérées par F2 (montants figés) |
| `unit_price_ttc` | `unit_price_ht + tax_per_unit` | exacte |
| `unit_price_original_ht` | `null` | **`remises = 0`** dans les feuilles : le nœud `ca_brut` égale `ca_net` ; la remise par commande existe dans `orders.discounts_amount` et peut compléter au niveau commande (variante (b) de C7) |

Fonction pure `lineFromOrderMarginsRow(row)` dans `app/lib/econ/adapters.js` (nouveau fichier,
aucun fichier F3 modifié), testée dans le lot 26 sur la fixture de #1022 et sur une ligne
legacy (→ rejetée, comptée).

### 5.3 Périodes et comparaison

Période par défaut 30 jours glissants finissant hier (jour boutique complet), options 7 et 90 ;
la période précédente est de même longueur (A13 : glissant, réversible). Profondeur réelle =
max(60 jours, installation de F2) : le sélecteur 90 jours affiche « historique disponible
depuis le JJ/MM » tant que `read_all_orders` n'est pas accordé (`history_months`, plan de
backfill de `sync_jobs`).

### 5.4 Exclusions et boutique de dev (C6)

`aggregate()` ignore toute commande dont `excluded_reason` est non nul. Pour une boutique de
développement, il faut inclure `draft` et `test` sans changer le moteur : le loader remappe
`excluded_reason` à `null` pour ces deux valeurs quand le réglage est actif, et affiche un
bandeau permanent « données de test incluses (boutique de développement) ». Détection de la
boutique de dev : `shop { plan { partnerDevelopment } }` (Admin API) lu une fois et mémorisé
dans `shop_settings` (colonne à créer, C6a), ou allowlist par variable d'environnement comme
`betaShops.js` (C6b). Jamais actif sur une boutique marchande.

### 5.5 Découpage par plan

Aucun gate en F4-A : le Tableau de bord est visible pour tous les plans (la tarification de la
refonte n'est pas décidée ; la carte de capacités `planCapabilities` proposée au rapport de
refonte §1.5 sera introduite avec le premier écran gaté, F4-C). L'entitlement continue d'être
résolu par `app.jsx` pour l'ancien écran et le bandeau d'abonnement.

---

## 6. Preuves prévues

### 6.1 `tests/lot26_dashboard_i18n.mjs` (pur)

1. `resolveLocale` : `?locale=fr-CA` → `fr` ; `pt-BR` → `pt-BR` ; `zh-TW` distinct de `zh-CN` ;
   inconnu → `en` ; surcharge > paramètre > cookie > `Accept-Language`.
2. `t()` : clé présente, variable interpolée, pluriel 0/1/N (`Intl.PluralRules`), clé absente
   → repli `en` puis la clé elle-même (jamais une chaîne vide), aucun `undefined` rendu.
3. Catalogues : `fr.json` et `en.json` ont le même ensemble de clés ; aucune clé inutilisée ;
   aucune clé utilisée absente (scan des fichiers F4).
4. Lint : aucune chaîne en dur dans les fichiers F4 (§4.3) ; aucune couleur hexadécimale ni
   `style={{` dans `app/components/dashboard/` ; aucun import d'`engine.js` ni de
   `orderHistory.formatMoney` dans les fichiers F4.
5. `lineFromOrderMarginsRow` : ligne v2 de #1022 (600 USD, remboursée, coût manquant) → ligne
   moteur cohérente (`revenue_units 0`, `cost_source missing`) ; ligne legacy → `null` et
   compteur ; `tax_per_unit` depuis `tax_lines` avec et sans taxes.
6. Remappage C6 : brouillon inclus si et seulement si le réglage est actif ; `cancelled`,
   `gift_card_only`, `b2b` jamais inclus.
7. Fenêtres : période courante et précédente contiguës, jamais dans le futur, profondeur
   affichée.
8. Formatage : `money(1234.5, "fr", "USD")` et `("en", "USD")` diffèrent, `MIXED` jamais formaté
   comme une devise, `delta` signé.

### 6.2 `render_check.mjs` étendu

Rendu réel des composants du Tableau de bord : (a) données chargées (KPI chiffrés + badges
d'écart) ; (b) `nodes` à `null` partout (coûts manquants : « inconnu » et compteur, aucun 0) ;
(c) `insufficient` (« il manque 12 commandes ») ; (d) `aggregate` vide (état vide avec
compteur d'exclusions) ; (e) locale `en` puis `fr` sur le même état (libellés différents,
mêmes chiffres, format monétaire différent) ; (f) trous (`unconfirmed_fees`,
`unconfirmed_shipping`, `no_packaging_cost`) → bandeau. Vérification que les `s-*` sortent en
balises avec les attributs camelCase attendus.

Gate complet avant tout commit : `npm run lint`, `npm test` (26 lots), `node
scripts/render_check.mjs`, `npm run build`.

### 6.3 Après déploiement, sur la boutique de dev (GO séparés)

1. Ouvrir l'app → le lien « Tableau de bord » apparaît dans la navigation admin ; `/app` reste
   l'ancien écran ; la locale de l'admin (français) est reflétée ; passer l'admin en anglais
   change la langue à la navigation suivante.
2. État 1 (C6 inactif) : état vide avec « 7 commandes exclues (brouillon) ».
3. État 2 (C6 actif) : commandes, CA HT (en USD, format de la locale), panier moyen chiffrés ;
   CM1/CM2/CM3 « inconnus », compteur « 1 ligne sans coût », « 20 lignes hors moteur ».
4. État 3 : Mathys saisit un coût sur l'ancien écran, recalcul des marges estimées → CM1/CM2
   chiffrés sur #1022 ; `minData` « il manque 9 commandes » sur CM2 %.
5. Web Vitals : `meta name="shopify-debug" content="web-vitals"` en local pour lire LCP/CLS du
   Tableau de bord (cible Built for Shopify : LCP ≤ 2,5 s, CLS ≤ 0,1, INP ≤ 200 ms).
6. iPhone portrait : capture du Tableau de bord (clôture aussi du point mobile en mémoire).

---

## 7. Arbitrages (options et implications)

**C1 (bloquant) — React 18 ou 19.**
(a) Rester en 18.3 pour F4-A et F4-B : aucun champ contrôlé sur le Tableau de bord ; Polaris Viz
compatible ; décision reportée à F4-C (Réglages = formulaires). Risque : découvrir en F4-C
qu'un pattern choisi en F4-A ne tient pas sous 19 (faible : les composants d'affichage sont
identiques). (b) Passer à React 19.3 dès F4-A : conforme à la doc Polaris WC pour toute la
refonte ; `react-router` 7, `@shopify/shopify-app-react-router` (`>= 18`), `app-bridge-react`
(`*`) acceptent 19 ; mais Polaris Viz déclare `^18` au plus (installation avec
`--legacy-peer-deps` ou attente d'une version), et l'ancien écran de 3 800 lignes doit être
re-testé sous 19 (gate + rendu réel). (c) 19 en F4-A avec graphiques sans Polaris Viz (visx ou
SVG maison, déjà pratiqué dans `SparklineChart`) : cohérent avec « visx pour le simulateur »
(décision 8) mais contredit « Polaris Viz pour les écrans ». Recommandation : **(a)**, avec la
décision (b)/(c) prise en Phase 0 de F4-B après vérification de la compatibilité React 19 de
Polaris Viz à cette date.

**C2 — Canal Polaris et version du paquet.** (a) Garder `@shopify/shopify-app-react-router`
1.2.0 : `polaris.js` non épinglable ; simple ; la doc parle de `polaris-1.js` comme canal
stable et de `polaris-1.1-rc.js` : `polaris.js` est le nom historique du canal courant (à
confirmer : son contenu exact n'est pas documenté). (b) Monter en 3.0.0 : `polarisUrl` sur
`AppProvider` et dans `shopifyApp()` (en-tête `Link` de préchargement, meilleur LCP) ; changelog
1.2 → 3.0 non lu (majeures = ruptures possibles sur `authenticate`, billing, session : à
vérifier avant). Recommandation : (a) en F4-A, (b) en F4-B avec le lot 22 et le lot 16 comme
filet (ils exécutent les chemins `authenticate` et billing).

**C3 (bloquant) — Source de la locale côté serveur.** (a) Chaîne §4.1 (surcharge > `?locale=`
> cookie > `Accept-Language` > `en`) : correcte au premier chargement et stable ensuite ;
exige un cookie (`SameSite=None; Secure`, iframe) : à déclarer dans la politique de
confidentialité comme cookie fonctionnel. (b) `Accept-Language` seul : sans cookie, mais la
langue du navigateur n'est pas celle de l'admin (un marchand allemand avec un navigateur en
anglais verrait l'app en anglais alors que son admin est en allemand). (c) Locale figée dans
`shop_settings` à la première ouverture depuis `?locale=` : pas de cookie, mais une boutique à
plusieurs utilisateurs de langues différentes verrait une seule langue. Recommandation : (a).

**C4 — Bibliothèque i18n.** (a) i18next + react-i18next (+ ICU) ; (b) `@shopify/react-i18n` ;
(c) module maison à API compatible i18next (§4.2). Recommandation : (c) en F4-A, réévalué en
F4-C.

**C5 (bloquant) — Langues remplies en F4-A.** (a) `en` + `fr` seulement, 33 catalogues absents
avec repli `en`, traduction automatique et relecture en un seul lot en F4-D (une passe de
traduction sur l'ensemble des écrans, plutôt qu'une par écran) ; le lint impose seulement
`fr` = `en`. (b) Les 35 dès F4-A : 35 fichiers à régénérer à chaque écran, relecture répétée.
(c) `en` seul : le français, langue de Mathys et de la bêta, ne serait pas prouvé.
Recommandation : (a).

**C6 (bloquant) — Commandes de test et brouillons sur la boutique de dev.** (a) Colonne
`shop_settings.include_test_orders BOOLEAN NOT NULL DEFAULT false` (addendum F1, migration
idempotente + rollback + lot 23 mis à jour), activable seulement si `shop.plan.partnerDevelopment`
est vrai (lu et mémorisé dans `shop_settings.is_dev_shop`, seconde colonne) ; bascule depuis
le Tableau de bord (`s-switch` non contrôlé + `<form>` natif) : deux colonnes, une migration,
zéro configuration hors dépôt. (b) Allowlist `DEV_SHOPS` en variable d'environnement (pattern
`betaShops.js`) : aucune migration, mais un réglage Vercel de plus et pas de bascule marchand.
(c) Paramètre d'URL `?include_test=1` sans persistance : le plus simple, mais invisible au
marchand-testeur et facile à oublier dans les preuves. Recommandation : (a) ; les commandes
`cancelled`, `gift_card_only`, `b2b` restent exclues quoi qu'il arrive.

**C7 (bloquant) — Adaptateur ligne stockée → ligne moteur.** (a) Adaptateur pur avec les deux
approximations (§5.2) et compteur de lignes legacy ; aucun changement de schéma ni de F2.
(b) (a) + `orders.discounts_amount` injecté comme remise de commande dans les feuilles
(`remises` non nul au niveau boutique, nul par produit) : `ca_brut` redevient juste au niveau
boutique. (c) Ajouter `restocked_qty`, `unit_price_original_ht`, `unit_price_ttc`,
`tax_per_unit` à `order_margins` (addendum F1) et les écrire en F2 : exact, mais touche F2 et
n'améliore que les lignes ingérées après. Recommandation : (b) en F4-A, (c) noté pour un
addendum F2 avant les écrans Produits (où la remise par produit compte).

**C8 — Rollups ou faits.** (a) Faits lus à chaque chargement, plafond 5 000 lignes signalé,
rollups plus tard (quand une boutique dépasse le plafond ou que le LCP l'exige). (b) Cron
quotidien qui remplit `daily_rollups` et loader qui les lit : plus rapide, mais un jour de
retard et un chantier de plus (invalidation à chaque webhook ou recalcul quotidien). (c) Les
deux : faits pour la période courante, rollups pour la comparaison. Recommandation : (a) en
F4-A ; le cache `daily_rollups` n'est jamais une source (F1), donc (b) reste possible sans
changer le Tableau de bord.

**C9 — Périmètre du lint « aucune chaîne en dur ».** (a) Liste explicite des fichiers F4,
étendue à chaque écran ; l'ancien code n'est jamais scanné. (b) Tout `app/` sauf une liste
d'exclusion (`app._index.jsx`, `costsUi`, `customsUi`, emails) : attrape un nouveau fichier
oublié. Recommandation : (b), la liste d'exclusion se vide en F4-D.

**C10 — 12 KPI sur ordinateur, 8 sur mobile (décision 14).** (a) `s-query-container` +
`s-grid` responsive : les 4 KPI secondaires (POAS, LTV/CAC, taux de retour, OTD) passent sous
un `s-button` « Voir plus » sur conteneur étroit ; (b) tous les 12 empilés sur mobile (plus
long, plus simple) ; (c) 8 partout. Recommandation : (a), en vérifiant sur iPhone.

**C11 — Emplacement du Tableau de bord pendant la transition.** (a) `/app/dashboard` nouveau,
`/app` = ancien écran (aucune régression possible pour un marchand bêta) ; à la fin de F4,
`/app` redirige. (b) Le Tableau de bord prend `/app` tout de suite et l'ancien écran passe en
`/app/legacy` : la première impression change dès F4-A, mais l'ancien écran garde ses
`?tab=` d'e-mails d'alerte (liens à réécrire) et `s-link rel="home"` devient inutile.
Recommandation : (a).

Non arbitré ici, tranché par les faits : `lang`/`dir` sur `<html>` depuis la locale ; aucun
gate de plan en F4-A ; aucun graphique en F4-A ; `app._index.jsx` à zéro diff.

---

## 8. Fichiers, taille, dépendances, risques

Nouveaux : `app/routes/app.dashboard.jsx` (loader + page), `app/components/dashboard/`
(5 composants purs), `app/lib/i18n/` (`resolveLocale.js`, `t.js`, `format.js`, `context.jsx`),
`app/locales/en.json`, `app/locales/fr.json`, `app/lib/econ/adapters.js`,
`app/lib/dashboard.server.js` (lectures Supabase → `aggregate`), `tests/lot26_dashboard_i18n.mjs`,
migration `20260923_f1_25_dev_shop_settings.sql` + rollback (C6a), fixture `tests/fixtures/order_1022.json`.
Modifiés : `app/routes/app.jsx` (coquille), `app/root.jsx` (`lang`/`dir`), `app/lib/schema.js`
(aucune table nouvelle ; colonnes seulement), `tests/lot23_schema.mjs` (25 fichiers F1),
`scripts/render_check.mjs`, `package.json` (lot 26). Aucune dépendance npm nouvelle si C1 (a),
C2 (a), C4 (c). `app._index.jsx`, `engine.js`, `app/lib/econ/*` existants, `app/lib/sync/*` :
0 diff.

Taille F4-A : **M** (loader et adaptateur 1 jour, i18n 0,5, composants et rendu 1, lot et
preuves 0,5). Dépendances : F2 déployée (fait), C1/C3/C5/C6/C7/C8 tranchés.

Risques : (1) hydratation : tout texte rendu dépend de la locale du loader, jamais de
`shopify.config.locale`, sinon mismatch ; (2) FOUC des custom elements avant `polaris.js`
(mesurer, puis C2 (b) pour le préchargement) ; (3) attributs camelCase des `s-*` sous React 18
en SSR (React 18 émet l'attribut tel quel ; le parseur HTML le met en minuscules ; Polaris lit
les attributs sans casse : à prouver au premier rendu réel, `render_check` le montre) ;
(4) boutique de dev sans coûts : les preuves d'état 3 dépendent d'une saisie manuelle de
Mathys ; (5) plafond 5 000 lignes : suffisant pour la bêta, à surveiller.

---

## STOP — décisions attendues

Bloquantes pour écrire F4-A : C1 (React), C3 (locale), C5 (langues remplies), C6 (boutique de
dev), C7 (adaptateur), C8 (faits ou rollups). Acceptent la recommandation par défaut : C2, C4,
C9, C10, C11. Puis GO d'écriture (fichiers écrits, rien appliqué, rien committé) ; second GO
pour appliquer la migration C6a (test puis prod, avec preuve de rollback comme F1/F3) ;
troisième GO pour committer, puis déploiement et preuves §6.3.
