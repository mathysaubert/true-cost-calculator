# I0-C — Mémoire des décisions : migration, enregistrement silencieux, lot 28 (2026-09-24)

Suite de `2026-09-23_i0-b_implementation.md` (écrans, committés `b973022` et `9557165`). GO I0-C
reçu le 2026-09-24 : tables `insight_log` et `decision_log`, RLS, purge RGPD, rollback, lot 23,
enregistrement silencieux des priorités et de l'opportunité affichées, des simulations retenues et
des corrections de données (D7a). Chaque étape base (test, prod) et le commit attendent un GO.

Statut : **écrit et prouvé localement (gate complète verte). Migration NON appliquée (ni test ni
prod), aucun commit, aucun push.** `app/routes/app._index.jsx`, `app/lib/engine.js`,
`app/lib/econ/*`, `app/lib/sync/*` : 0 diff (`background.server.js` est importé, pas modifié).

## 1. Problème

Le copilote montre des priorités, une opportunité et des règles de données, mais rien n'en garde la
trace : impossible de dire ce qui a été montré, quand, combien de fois, ce que le marchand a retenu,
ni si une correction de donnée a suivi. Le PDF exige une mémoire des décisions (scénario simulé,
action, résultat observé), et I1 (« Demander ») en aura besoin comme contexte.

## 2. Cause

Aucune table ne porte l'affichage ni la décision ; `buildBriefing` est pur et sans effet de bord,
comme voulu en I0-A.

## 3. Solution

### 3.1 Migration `supabase/migrations/20260924_i0_01_decision_memory.sql`

| Objet | Contenu |
|---|---|
| `insight_log` | clé `(shop_domain, fingerprint)` ; `rule_id`, `subject_kind`, `subject_key`, `status`, `rank` (1-3 priorité, 0 opportunité), `window_start/end`, `impact_low/high` (centime), `currency_code`, `payload` JSONB (variables, preuves, impact, cause, CTA, levier, déblocages, score de fiabilité au moment de l'affichage), `first_shown_at`, `last_shown_at`, `shown_count`, `resolved_at` |
| `decision_log` | `id` UUID ; `insight_fingerprint` (nullable), `kind` CHECK ∈ {simulated, accepted, dismissed, data_fixed, action_started, action_done}, `scenario` JSONB, `expected_impact_low/high`, `expected_node`, `horizon_days`, `decided_at`, `review_at`, `observed_impact`, `observed_at`, `note`, `created_at` |
| RLS | `ENABLE ROW LEVEL SECURITY` + `deny_public_access` (DROP IF EXISTS puis CREATE) sur les deux tables |
| Index | `(shop_domain, rule_id, window_end)`, `(shop_domain, last_shown_at DESC)`, `(shop_domain, decided_at DESC)`, `(shop_domain, kind)` |
| `record_insights(p_shop, p_rows jsonb)` | `CREATE OR REPLACE`, `LANGUAGE sql` : `INSERT … ON CONFLICT (shop_domain, fingerprint) DO UPDATE` → statut, rang, impact, payload rafraîchis, `last_shown_at = NOW()`, `shown_count + 1`, `resolved_at = NULL`. Un seul aller-retour par affichage |
| `purge_shop` | `CREATE OR REPLACE` avec le corps F1-23 à l'identique (37 tables, même ordre) + `insight_log` + `decision_log` |

Idempotente (IF NOT EXISTS / OR REPLACE partout), aucune donnée existante touchée, aucune colonne
nominative (agrégats, identifiants de règles, empreintes, gid produit).

### 3.2 Rollback `supabase/rollback/20260924_i0_rollback.sql`

Hors `migrations/`. Retire `record_insights`, les deux tables (CASCADE), puis **rétablit
`purge_shop` à sa définition F1-23** : sans cela la fonction référencerait des tables absentes et
échouerait à l'appel (les fonctions `LANGUAGE sql` ne sont pas retirées par le CASCADE). IF EXISTS
partout, aucune donnée touchée. Ordre si l'on revient avant F1 : rollback I0 puis rollback F1 (le
rollback F1 ne connaît pas les tables I0 ; le lot 23 le vérifie).

### 3.3 Contrat de schéma et lot 23

`app/lib/schema.js` : `I0_TABLES = [insight_log, decision_log]`, `DECISION_KINDS` (6), `ALL_TABLES`
étendue → `PURGE_TABLES` les inclut automatiquement (repli des webhooks RGPD).

`tests/lot23_schema.mjs` (147 assertions, +18) : la définition **effective** de `purge_shop` est la
dernière dans l'ordre des fichiers (le §4 ne lit plus F1-23 seule) ; la liste F1-23 doit en être un
préfixe exact ; nouveau §10 : une seule migration I0, `I0_TABLES` = tables créées, RLS + politique
sur chacune, ré-exécutabilité, aucune donnée ni table existante touchée hors `purge_shop`, CHECK
SQL de `kind` = `DECISION_KINDS`, forme de `record_insights` (upsert, `shown_count + 1`,
`resolved_at` effacé), clé et index, aucune colonne nominative, rollback : exactement les 2 tables,
`record_insights` retirée, `purge_shop` = F1-23 à l'identique, idempotent, rien d'autre touché,
rollback F1 sans référence aux tables I0.

### 3.4 Module pur `app/lib/decisions.js` (77 lignes)

| Fonction | Rôle |
|---|---|
| `opportunityFingerprint(opp, window)` | `<règle>:opportunity:<sujet>:<début>:<fin>:<impact mensuel arrondi>` (D7 : une ligne par jour affiché, comme les priorités) |
| `insightLogRows({ briefing, window, currency, confidenceScore })` | lignes `insight_log` des priorités (rang 1-3, empreinte du briefing) et de l'opportunité (rang 0, statut `simulation`, scénario dans le payload) |
| `scenarioFromOpportunity(opp)` | `{ rule_id, levers, assumptions, node, before, after }` : ce que le Simulateur rejouera |
| `resolvedDataRules({ open, insights })` | règles de données montrées (lignes ouvertes) qui ne sont plus détectées → une résolution par règle, empreintes groupées, score le plus bas conservé |
| `decisionRow(...)` | ligne `decision_log` validée : `kind` hors liste → erreur, boutique manquante → erreur |
| `simulatedDecision`, `dataFixedDecision` | décisions prêtes : scénario retenu (horizon 30 j, D2b) ; donnée corrigée (score avant / après) |

### 3.5 Serveur `app/lib/decisions.server.js` (36 lignes) et route « Aujourd'hui »

- Loader : après `loadOverview`, `background(recordShownInsights(...))` (`waitUntil` de
  `@vercel/functions`, même mécanisme que la sync) : la réponse ne l'attend jamais ; une erreur est
  journalisée (« migration I0-01 appliquée ? »), jamais rendue. Puis lecture des règles de données
  ouvertes ; celles qui ont disparu deviennent `decision_log` `data_fixed` (scénario : règle,
  empreintes, score avant / après) et leurs lignes passent `resolved_at`.
- Action `intent=simulate` : depuis le bloc Opportunité, un formulaire POST natif « Retenir ce
  scénario » (empreinte + jours). Le serveur **recalcule** l'opportunité (rien n'est lu du
  formulaire hormis l'empreinte) ; si l'empreinte diffère, réponse « périmé » (le scénario a changé
  depuis l'affichage) ; sinon `decision_log` `simulated` avec scénario, fourchette, nœud,
  horizon 30 j. Bandeau `s-banner` succès / avertissement au retour (`DecisionBanner`).
- Les pages Indicateurs et Fiabilité n'enregistrent rien (D7a : seul ce qui est affiché comme
  priorité ou opportunité compte ; « Pourquoi cette conclusion ? » n'est pas journalisé).

### 3.6 Catalogues et style

5 clés `decision.*` en/fr (bouton, aide, enregistré, périmé, échec) ; `.tcc-decision` (ligne de
formulaire). 530 clés, `fr = en`.

### 3.7 Fichiers

| Fichier | État |
|---|---|
| `supabase/migrations/20260924_i0_01_decision_memory.sql` | nouveau |
| `supabase/rollback/20260924_i0_rollback.sql` | nouveau |
| `app/lib/schema.js` | `I0_TABLES`, `DECISION_KINDS`, `ALL_TABLES` |
| `app/lib/decisions.js`, `app/lib/decisions.server.js` | nouveaux |
| `app/routes/app.overview.jsx` | loader (arrière-plan, empreinte), action `simulate`, bandeau |
| `app/components/overview/Briefing.jsx` | `Opportunity` (formulaire), `DecisionBanner` |
| `app/locales/en.js`, `fr.js`, `app/styles/overview.css` | +5 clés, `.tcc-decision` |
| `tests/lot23_schema.mjs`, `tests/lot28_decisions.mjs`, `package.json` | +18 ; nouveau lot (30 assertions) ; chaîne de tests |
| `scripts/render_check.mjs` | +2 scénarios (formulaire avec / sans empreinte ; bandeau succès / périmé / échec / rien) |

## 4. Preuves locales (gate complète, 2026-09-24)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 542 avertissements (`react/prop-types`) |
| `npm test` | 28 lots verts ; lot 23 = 147, lot 28 = 30 |
| `node scripts/render_check.mjs` | 81 scénarios verts |
| `npm run build` | OK |
| fichiers protégés | 0 diff |

Lot 28 : lignes `insight_log` = priorités + opportunité (rangs, empreintes, fenêtre, devise, payload
avec preuves et score, impacts au centime, rien de nominatif, empreintes distinctes) ; empreinte de
l'opportunité par fenêtre ; scénario (nœud, avant < après, leviers, hypothèses) ; règles de données
résolues (encore détectée → non résolue ; disparues → une résolution par règle, score le plus bas) ;
`data_fixed` (score avant / après) ; `simulated` (horizon, nœud, fourchette, empreinte) ; `kind`
inconnu et boutique manquante → erreur ; CHECK SQL = `DECISION_KINDS` ; `I0_TABLES` dans
`ALL_TABLES` et `PURGE_TABLES` ; scans (aucune I/O ni React ni aléa dans le module pur, aucune
phrase en dur, serveur sans `throw`, loader en arrière-plan, action `simulate`, lot dans la chaîne).

## 5. Écarts et points ouverts

1. **Une ligne par jour et par fenêtre.** L'empreinte contient la fenêtre, qui finit aujourd'hui :
   une priorité stable produit une ligne par jour et par vue (7 / 30 / 90). Voulu par D7
   (dédoublonnage par fenêtre) ; compaction « dernier par règle et sujet » à prévoir quand le
   volume le justifiera (index `(shop_domain, rule_id, window_end)` prêt).
2. **`data_fixed` est déduit, pas cliqué.** Sans écran Réglages dans la coquille, la correction est
   reconnue quand une règle de données montrée cesse d'être détectée (coût saisi, frais confirmés,
   pub connectée). Quand Réglages existera, l'enregistrement explicite à la sauvegarde s'ajoutera
   (voir Phase 0 Réglages, arbitrage S10).
3. **« Retenir ce scénario » recalcule le briefing** (un chargement complet) : acceptable pour un
   clic ; le Simulateur rejouera le scénario depuis `decision_log.scenario` sans ce détour.
4. **Rien n'est encore relu.** Aucune page n'affiche la mémoire (liste des scénarios retenus,
   décisions, résultat observé) : c'est le Simulateur (scénarios) et, plus tard, Décisions.
5. `background` vient de `app/lib/sync/` (fichier protégé, importé tel quel).

## 6. Étapes suivantes, chacune sur GO séparé

1. **Base de test** : `apply_migrations.ps1 -EnvFile .env.test -Filter 20260924_i0_* -SkipPrisma`,
   puis `verify_i0.mjs present e2e` (tables, colonnes, RLS, politiques, index, CHECK, fonctions,
   `purge_shop` à 39 tables ; aller-retour sur une boutique fictive : `record_insights` × 2 →
   `shown_count` 2, `decision_log` insert, `kind` inconnu refusé, `purge_shop` → 0 ligne).
2. **Preuve du rollback sur test** : rollback I0 → `verify_i0.mjs absent` (tables et fonction
   absentes, `purge_shop` à 37 tables) → réapplication → `present` conforme.
3. **Prod** : même filtre, `verify_i0.mjs present` (sans e2e).
4. **Commit unique + push**, statut Vercel via l'API GitHub.
5. Preuves vivantes sur la boutique de dev : ouvrir « Aujourd'hui » deux fois → `shown_count` 2 ;
   « Retenir ce scénario » → ligne `simulated` et bandeau ; saisir un coût manquant → ligne
   `data_fixed` au chargement suivant.

## 7. Preuves base (2026-09-24, GO du même jour)

| Étape | Cible | Résultat |
|---|---|---|
| Application I0-01 | test (`eu-central-1`) | 1 fichier OK |
| Vérification `present e2e` | test | 16 / 16 : 2 tables (17 et 15 colonnes), RLS + politique seule, `record_insights`, `purge_shop` à 39 tables, 4 index, CHECK ; boutique fictive : deux appels → 1 ligne `shown_count` 2, `kind` inconnu refusé, 1 décision, `purge_shop` → 0 ligne |
| Rollback I0 | test | 1 fichier OK |
| Vérification `absent` | test | 4 / 4 : tables et `record_insights` absentes, `purge_shop` rétablie à 37 tables |
| Réapplication + `present e2e` | test | 16 / 16 conforme |
| Application I0-01 (filtre `20260924_i0_01*`) | prod (`eu-west-1`) | 1 fichier OK |
| Vérification `present` | prod | 12 / 12 conforme ; 0 ligne dans les deux tables |

Aucune donnée existante modifiée ; aucune URL ni clé affichée.
