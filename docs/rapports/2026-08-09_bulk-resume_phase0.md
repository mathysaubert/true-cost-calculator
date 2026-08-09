# Phase 0 — Reprise des opérations bulk COMPLETED (sync 30 j) + maxDuration route sync

Date : 2026-08-09. Exploration seule : aucun code produit. Fix ciblé du P0 de l'audit
(`docs/rapports/2026-08-09_audit-pre-beta.md`, constat 1) et du constat 5 (maxDuration),
RIEN d'autre.

---

## P0.1 — Re-preuve du P0 depuis le code

Tout vit dans `app/lib/orderSync.server.js` (`syncShopOrders`). Déroulé exact :

1. **Garde d'entrée** (lignes 35-42) — ne bloque QUE `RUNNING`/`CREATED`, et ne lit ni
   `url` ni `query` :

```js
const cr = await admin.graphql(`{ currentBulkOperation(type: QUERY) { id status } }`);
const cj = await cr.json();
const cur = cj.data?.currentBulkOperation;
if (cur && (cur.status === "RUNNING" || cur.status === "CREATED")) {
  return { success: false, error: "Une synchronisation est déjà en cours. Réessayez dans un instant." };
}
```

2. **Création** (63-74) : `bulkOperationRunQuery` ; si `userErrors` → état `failed` persisté
   et retour « Requête bulk refusée » (68-72) ; sinon upsert `order_sync_state`
   `{ status: "running", bulk_operation_id: bulkId, window_start }` (74).

3. **Poll borné** (79-86) : `while (Date.now() - startedAt < 25000)` puis relecture
   `currentBulkOperation { id status errorCode url objectCount }` toutes les 2 s.

4. **Budget dépassé** (87-91) : l'op est toujours `RUNNING` → upsert état `running`, retour
   `{ success:false, error: "Synchronisation en cours, relancez dans un instant." }`.
   **Le téléchargement (`fetch(op.url)`, ligne 98) n'existe QUE dans la continuation du
   poll du même appel.**

5. **Invocation suivante, op encore RUNNING** : garde (étape 1) → « déjà en cours »,
   aucune création. Correct.

6. **Invocation suivante, op COMPLETED (résultats prêts chez Shopify)** : la garde ne
   matche pas (`COMPLETED` ∉ {RUNNING, CREATED}) → le code enchaîne DIRECTEMENT sur
   `bulkOperationRunQuery` → une NOUVELLE opération est créée (Shopify l'accepte dès
   qu'aucune op n'est en cours) → `currentBulkOperation` pointe désormais la nouvelle op →
   les résultats terminés (url valable ~7 j) sont orphelins À JAMAIS. Retour à l'étape 3 :
   si le bulk de cette boutique dure structurellement > 25 s, la boucle est infinie.

7. **Cas de course** (fenêtre garde → mutation) : si l'op passe à RUNNING entre les étapes
   1 et 2, `bulkOperationRunQuery` renvoie un `userError` (« already in progress ») →
   branche 68-72 : état marqué `failed` (léger mislabel, l'op tourne toujours) + message
   « Requête bulk refusée ». Sans conséquence durable (la prochaine invocation retombe sur
   la garde) — noté pour exhaustivité, PAS traité par ce chantier au-delà de ce que la
   nouvelle garde corrige naturellement.

**Verdict** : le code confirme le rapport d'audit point par point, aucune contradiction.
Le fait prouvé : aucun chemin, dans aucun déclencheur, ne télécharge une op `COMPLETED`
préexistante.

## P0.2 — Tous les déclencheurs convergent

Grep `bulkOperationRunQuery|currentBulkOperation|syncShopOrders` sur `app/**` : les seules
occurrences de bulk sont dans `orderSync.server.js`, et `syncShopOrders` a exactement TROIS
appelants :

```
app\routes\app._index.jsx:1175:   return await syncShopOrders({ admin, supabase, shop: session.shop });   (bouton backfill_orders)
app\routes\api.cron.profitability.jsx:68:  const sync = await syncShopOrders({ admin, supabase, shop });  (cron quotidien)
app\lib\recalcEstimatedMargins.server.js:70:  try { sync = await syncShopOrders({ admin, supabase, shop }); }  (bouton recalc, étape 3)
```

Un fix AU POINT D'ENTRÉE de `syncShopOrders` couvre mécaniquement les trois. Aucun autre
usage de bulk dans le dépôt.

## P0.3 — API : reconnaître NOTRE opération sans état persisté nouveau

Le dépôt n'embarque PAS le schéma Admin (aucun type `BulkOperation` dans `node_modules/@shopify/*` —
grep `partialDataUrl` : zéro fichier ; l'app requête l'Admin API en GraphQL brut). Les
preuves disponibles sont donc : (a) les requêtes DÉJÀ exécutées en production par ce même
fichier (`currentBulkOperation(type: QUERY) { id status }` ligne 36 et
`{ id status errorCode url objectCount }` ligne 81, ApiVersion.October25) ; (b) une
validation de schéma outillée (MCP Shopify officiel, schéma Admin 2025-10) de la requête
enrichie de reprise :

```graphql
query ResumeProbe { currentBulkOperation(type: QUERY) { id status errorCode url partialDataUrl query completedAt objectCount createdAt } }
```

Résultat : **VALID** (« Successfully validated GraphQL query against schema »), avec un
avertissement : `QueryRoot.currentBulkOperation` est DÉPRÉCIÉ au profit de `bulkOperations`
(filtre par statut). Décision R6 : on RESTE sur `currentBulkOperation` (pattern existant du
fichier, toujours servi par l'API épinglée 2025-10) ; la migration `bulkOperations` est du
backlog, pas de ce chantier.

**Reconnaissance sans nouvel état persisté — OUI, à deux niveaux :**

1. **Champ `query`** : `currentBulkOperation` renvoie le texte de la requête de l'op. Notre
   requête de sync contient des marqueurs qui n'existent dans AUCUNE autre requête du dépôt
   (grep) : `discountedUnitPriceAfterAllDiscountsSet` ET `orders(query: "created_at:>=`.
   Le test « c'est notre requête de sync » = présence de ces marqueurs. (L'égalité stricte
   du texte complet est impossible : `windowStart` est interpolé et change à chaque
   lancement — c'est précisément pourquoi un marqueur stable est le bon outil.)
   `currentBulkOperation` est déjà scopé à NOTRE app sur CE shop, le marqueur ne sert qu'à
   exclure une future autre requête bulk de l'app elle-même.
2. **« Déjà ingérée ? »** : l'état EXISTANT `order_sync_state` porte déjà
   `bulk_operation_id` + `status` (écrits lignes 74, 89, 188). Une op COMPLETED est « déjà
   ingérée » ssi `state.bulk_operation_id === op.id && state.status === "completed"`
   (l'upsert final ligne 188 écrit exactement ce couple après ingestion réussie). AUCUNE
   table, colonne ou migration nouvelle n'est nécessaire. État absent (ligne purgée) →
   défaut sûr : reprendre et ingérer (l'idempotence P0.4 rend la double ingestion neutre).

## P0.4 — Idempotence d'ingestion (préalable) : PROUVÉE

`orderSync.server.js:161-167` :

```js
// ignoreDuplicates : ré-ingestion ne duplique pas et ne mute jamais un snapshot figé.
// .select("order_id") : ON CONFLICT DO NOTHING ... RETURNING ne renvoie QUE les lignes
// RÉELLEMENT insérées (Postgres) → delta exact des commandes nouvelles ce sync (C4a).
const { data: insertedRows, error } = await supabase.from("order_margins")
  .upsert(allRows, { onConflict: "shop_domain,order_id,line_item_id", ignoreDuplicates: true })
  .select("order_id");
```

Mécanisme exact : clé unique `(shop_domain, order_id, line_item_id)` + `ignoreDuplicates:
true` = `INSERT ... ON CONFLICT DO NOTHING` Postgres. `DO NOTHING` ne fait JAMAIS d'UPDATE :
une ligne existante (snapshot figé, y compris `confirmed`/`imported`) est INTOUCHABLE par
une ré-ingestion — c'est l'invariant snapshot par construction, déjà exploité par le recalc
(« DO NOTHING sur les survivantes », `recalcEstimatedMargins.server.js:68`). Le compteur
mensuel est lui aussi idempotent : `countDistinctOrders(insertedRows)` ne compte que les
lignes RÉELLEMENT insérées, et `delta > 0` (ligne 181) court-circuite la RPC quand tout est
en doublon. Double ingestion du même JSONL = zéro écriture `order_margins`, zéro incrément
`usage`. Seule écriture répétée : les métadonnées `order_sync_state` (statut/dates), sans
enjeu. **Non bloquant : la reprise est sûre.**

## P0.5 — maxDuration

Pattern cron existant, à l'identique dans les trois crons (citation
`api.cron.profitability.jsx:20`) :

```js
export const config = { maxDuration: 60 };
```

La route qui porte l'action de sync (`app/routes/app._index.jsx`) n'exporte AUCUN `config`
(grep `maxDuration` : uniquement les trois crons + RECAP). La limite effective par défaut
dépend du plan Vercel et de Fluid Compute — invérifiable depuis le dépôt (déjà acté à
l'audit, constat 5). Alignement minimal proposé : le MÊME export sur
`app/routes/app._index.jsx` avec un commentaire d'une ligne (le poll de sync peut retenir la
requête ~25 s ; 60 s = plafond, pas une réservation ; s'applique au module route entier,
loader compris — sans effet sur les requêtes courtes).

## P0.6 — Matrice de décision

### Option A — reprise à l'entrée de syncShopOrders (RECOMMANDÉE)

Au début de chaque sync, UNE lecture enrichie de `currentBulkOperation` (id, status,
errorCode, url, query), puis décision PURE :

| État courant | Décision |
|---|---|
| aucune op | créer (chemin actuel inchangé) |
| RUNNING/CREATED, notre requête | ne RIEN créer ; entrer dans le poll existant (budget entier) ; à dépassement → message « Synchronisation en cours, relancez dans un instant. » existant |
| RUNNING/CREATED, autre requête | message « Une synchronisation est déjà en cours… » existant (créer échouerait de toute façon) |
| COMPLETED, notre requête, non ingérée (P0.3-2) | télécharger `url` et ingérer par le chemin EXISTANT (extraction du bloc 97-189 en fonction locale partagée — déplacement sans changement de logique, cf. I2) |
| COMPLETED, notre requête, déjà ingérée | créer (flux normal) |
| COMPLETED, autre requête | ne JAMAIS consommer ; créer |
| FAILED/CANCELED/EXPIRED | créer (recréation propre, comportement actuel de fait) |

Avantages : zéro infra, zéro état persisté nouveau, zéro nouvelle chaîne visible (les trois
messages existants suffisent : « en cours », « relancez », « Aucune commande »), les trois
déclencheurs couverts au même endroit, et le cron devient AUTO-GUÉRISSANT : J+1 il reprend
l'op complétée de la veille au lieu d'en relancer une.

Risques listés : (1) fenêtre de l'op reprise plus ancienne que « maintenant » (jusqu'à
~24 h via le cron) → lignes potentiellement à J-31 : append idempotent, sans incidence sur
les agrégats (fenêtrés à la lecture), et la fenêtre fraîche est complétée dès le sync
suivant ; (2) URL expirée (~7 j) ou téléchargement en échec → traité en P0.7 ; (3) champ
`query` volumineux dans la réponse (quelques Ko) → négligeable ; (4) dépréciation
`currentBulkOperation` → documentée, non bloquante sur 2025-10.

### Option B — webhook BULK_OPERATIONS_FINISH (BACKLOG, non retenue)

Prérequis : nouvelle souscription webhook dans `shopify.app.toml` (+ deploy de conf
Partners), nouvelle route de réception, et un déclenchement d'ingestion hors requête
utilisateur (état de corrélation, sécurité du handler). Élimine le poll mais ajoute de
l'infra et une surface web nouvelle pour le même résultat fonctionnel que A. À reconsidérer
si le volume dépasse ce que A absorbe.

**Recommandation : A.**

## P0.7 — États dégradés (comportement proposé, minimal)

- **FAILED / CANCELED / EXPIRED** (notre op ou non) : recréation propre (décision `create`),
  identique au comportement actuel de fait ; l'`errorCode` continue d'alimenter le message
  d'échec existant (« Bulk échoué (STATUS code) ») si la nouvelle op échoue à son tour.
- **COMPLETED avec `url` null** : zéro résultat → branche EXISTANTE réutilisée telle quelle
  (« Aucune commande sur les 30 derniers jours. », lignes 92-95), état `completed` +
  `bulk_operation_id` persistés → l'op est marquée ingérée, pas de reprise en boucle.
- **partialDataUrl présent** (op FAILED partielle) : NON consommé. L'idempotence rendrait
  une ingestion partielle sûre, mais c'est un chemin de données supplémentaire pour un cas
  rare → hors périmètre minimal, documenté ici, l'op est recréée.
- **Échec du téléchargement en reprise** (URL expirée ~7 j, réseau) : la reprise est
  enveloppée ; en échec, on N'ingère rien et on retombe sur la création d'une op FRAÎCHE
  dans la même invocation (jamais de boucle « retélécharger une URL morte ») ; en cas
  d'échec de la création aussi, messages d'erreur existants.
- Aucun nouvel élément d'UI, aucune nouvelle chaîne : tous les retours passent par les
  messages existants de `syncShopOrders`.

## P0.8 — Fichiers touchés + diff estimé

| Fichier | Nature | Estimé |
|---|---|---|
| `app/lib/bulkResume.js` (NOUVEAU, pur) | marqueurs de requête (`isOurSyncQuery`) + `decideBulkResume({ op, state })` → `'create' | 'poll' | 'busy' | 'ingest'` (la table P0.6, testable sans I/O) | ~45 lignes |
| `app/lib/orderSync.server.js` | (1) garde d'entrée remplacée par lecture enrichie + décision ; (2) extraction du bloc téléchargement+ingestion (97-189) en fonction locale appelée par le chemin normal ET la reprise (déplacement à l'identique, I2) ; (3) branchements | ~40-55 lignes nouvelles (+ ~90 déplacées sans modification) |
| `app/routes/app._index.jsx` | `export const config = { maxDuration: 60 };` + 1 ligne de commentaire (pattern cron) | ~3 lignes |
| `tests/lot22_bulk_resume.mjs` (NOUVEAU) | T1 : les 7 lignes de la table P0.6 sur `decideBulkResume` + marqueurs (une op d'une autre requête n'est jamais consommée) ; T2 : idempotence — même JSONL parsé/construit deux fois → clés `(order_id, line_item_id)` identiques (le dédoublonnage repose dessus) + scan du source assertant `onConflict: "shop_domain,order_id,line_item_id"` ET `ignoreDuplicates: true` présents dans l'upsert (le contrat DO NOTHING est I/O Postgres : le test verrouille le code qui l'invoque, le rapport cite le mécanisme) | ~130-170 lignes |
| `package.json` | + lot22 dans la chaîne `test` | 1 ligne |

Total applicatif hors tests : ~90-105 lignes nouvelles. I3 : réel > estimation +30 % → STOP.

## Preuve empirique E1 (préparation, exécution à l'implémentation)

Mécanisme temporaire NON committé proposé : lire le budget de poll depuis
`SYNC_POLL_BUDGET_MS` avec défaut 25000 (patch local retiré avant commit, documenté dans le
rapport final), poser `SYNC_POLL_BUDGET_MS=1000` dans l'environnement du dev local, lancer
une sync sur la boutique dev → 1re invocation : timeout reproduit (« Synchronisation en
cours ») avec `bulk_operation_id` X persisté ; 2e invocation : logs montrant la REPRISE de
l'op X (même id, aucune création) et l'ingestion des commandes. Nécessitera un
`shopify app dev` fonctionnel (noter : le parcours app passe par la prod épinglée — la
preuve E1 sera produite en appelant `syncShopOrders` via le serveur local ou un harness
Node local sur la boutique dev, à préciser à l'implémentation selon ce que le poste permet ;
si aucun chemin local ne le permet, STOP et rapport avant de livrer).

---

## STOP — décisions attendues avant toute ligne de code

1. Valider l'option A (reprise à l'entrée, décision pure, aucun état persisté nouveau,
   `currentBulkOperation` conservé malgré la dépréciation).
2. Valider les comportements dégradés P0.7 (partialDataUrl non consommé ; échec de
   téléchargement → op fraîche dans la même invocation).
3. Valider le périmètre P0.8 (5 fichiers, ~90-105 lignes applicatives) et le mécanisme E1
   (variable d'env de test non committée).
