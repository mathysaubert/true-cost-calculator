# D2-0 — Préparation de l'étape 7 et API Partner 2026-07 (2026-09-26)

Statut : préparation terminée, rien de lancé. Aucune base modifiée, rien commité.

## 1. API Partner, version 2026-07 (lecture seule)

| Point | Résultat |
|---|---|
| `activeSubscription` en 2026-07 | Présente. Arguments `appId: ID!` et `shopId: ID!` |
| `activeSubscription` en unstable | Présente, avec en plus les requêtes de migration (`migratableAppSubscriptions`, `appSubscriptionMigrationOperation`) |
| Champs renvoyés | `app`, `billingPeriod`, `cancelAtEndOfCycle`, `currentBillingCycle`, `items`, `legacySubscriptionId`, `pendingUpdate`, `shop`, `trialEndsAt` |
| `items` (SubscriptionItem) | `handle` (identifiant du plan), `description`, `price`, `discount`, `usage` |
| Permission | La seule « Gérer les applications » suffit pour lire le schéma ; l'appel réel reste à faire après l'installation |
| Vraie app (364121522177) | Visible |
| App de test (428433932289) | **Introuvable**, en 2026-07 comme en unstable. Elle a été créée dans le Dev Dashboard |

À retenir pour D2-1 : `activeSubscription(appId, shopId)` est le moyen documenté de lire le plan (`items.handle`), la fin de l'essai (`trialEndsAt`) et l'ancien abonnement (`legacySubscriptionId`). Après l'installation, on essaiera l'appel sur l'app de test avec l'identifiant de la boutique, même si `app(id)` ne la voit pas.

## 2. Le piège évité

- `shopify.web.toml` lance `prisma migrate deploy`, puis `react-router dev`.
- **Lecture de la CLI Shopify 3.94.3** (code installé, lu directement) : avec `--config tcc-tarif-test`, elle charge **uniquement** `.env.tcc-tarif-test`. La fonction `Mge` choisit `.env.<config>`, sans repli sur `.env`.
- **Correctif du §8 : ce point était incomplet.** La CLI charge bien `.env.tcc-tarif-test`, mais elle ne le transmet **pas** à la commande de démarrage de l'app.
- **Risque restant : Prisma**, qui gère les sessions et la mise à jour au démarrage. Il complète depuis `.env`, le fichier de production, toute variable **absente**, sans écraser les présentes.
- **Parade :** `.env.tcc-tarif-test` couvre **les 9 clés de `.env`**, avec les valeurs de tcc-test et de l'app de test. `BETA_SHOPS` y est vide, ce qui écarte la liste de production.

## 3. Fichiers préparés

| Fichier | Contenu | Git |
|---|---|---|
| `shopify.app.tcc-tarif-test.toml` | Copie de `shopify.app.toml` avec le client de l'app de test, le nom `tcc-tarification-test`, des adresses d'exemple (remplacées par le tunnel au lancement), le webhook RGPD en chemin relatif et `automatically_update_urls_on_dev = true` **pour l'app de test seulement** | Nouveau, non commité |
| `.env.tcc-tarif-test` | 10 variables (tcc-test et app de test) | Ignoré par git |
| `scripts/d2_0_dev.mjs` | Modes `prepare`, `check` et `run` | Nouveau, non commité |

`shopify.app.toml`, la configuration de la vraie app, est inchangé : sa valeur `automatically_update_urls_on_dev = false` reste en place.

## 4. Garde-fous du lanceur (vérifiés avant chaque `check` et `run`)

- `.env.tcc-tarif-test` est ignoré par git.
- Toutes les clés de `.env` y sont présentes.
- `SUPABASE_URL`, `DATABASE_URL` et `DIRECT_URL` visent tcc-test.
- `SHOPIFY_API_KEY` est celle de l'app de test, différente de celle de la vraie app.
- La configuration vise l'app de test et ne contient pas l'adresse de production.
- `BETA_SHOPS` est vide.

Test négatif : avec `BETA_SHOPS` retirée du fichier, `run` refuse avant tout lancement (« clés de .env absentes… »). La clé a été remise aussitôt.

## 5. Preuve (`node scripts/d2_0_dev.mjs check`, lecture seule)

La sonde tourne dans l'environnement que recevra l'app, depuis la racine du projet, où se trouve `.env`. Elle utilise les deux clients réels de l'app.

| Contrôle | Résultat |
|---|---|
| Prisma : base réellement jointe | **tcc-test**. Identifiant système Postgres égal à celui de tcc-test et différent de celui de la production |
| Supabase : projet joint | **tcc-test**, lecture OK |
| Contenu de tcc-test | 39 tables publiques, 0 session |
| `prisma migrate status` | À jour : la mise à jour au démarrage ne changera rien |

Conclusion : l'app de test lancée par ce lanceur ne voit que tcc-test.

## 6. Étape 7 (à faire par Mathys)

Commande : `node scripts/d2_0_dev.mjs run`. Elle lance `shopify app dev --config tcc-tarif-test --store tcc-tarif-test.myshopify.com` après les garde-fous. Elle demande la connexion Shopify, ce que je ne peux pas faire à ta place.

## 7. Premier lancement en échec, puis correctif

- **Symptôme.** La CLI a bien pris la configuration de test (organisation Sprintweb, app TCC Tarification test, boutique tcc-tarif-test, adresses mises à jour). Elle a ensuite échoué de façon répétée : « This app is not approved to subscribe to webhook topics containing protected customer data », puis « Failed to start dev preview ». Rien n'a été installé.
- **Cause.** L'app de test n'a pas d'approbation pour les données client protégées. Or la configuration copiée l'abonnait aux webhooks qui en contiennent : commandes, remboursements, retours, expéditions.
- **Correctif, sur la configuration de test seulement.** La génération (`prepare`) retire ces 4 abonnements. Elle garde `app/uninstalled`, `app/scopes_update`, `bulk_operations/finish` (sans données client) et les 3 webhooks de conformité. Les accès demandés (scopes) sont inchangés. `shopify.app.toml` n'est pas touché.
- **Nouveau garde-fou.** Le lanceur refuse de démarrer si la configuration de test contient un webhook à données protégées, ou s'il y manque les webhooks de base ou de conformité.
- **Vérification.** `check` refait après le correctif : garde-fous OK, Prisma et Supabase sur tcc-test, migrations à jour.

## 8. Incident à la relance : le démarrage a lu la production (sans rien écrire)

### Ce qui s'est passé

- **Constat de Mathys.** À la relance, Prisma affiche « Environment variables loaded from .env », puis « Datasource … at "aws-0-eu-west-1…:5432" », puis « No pending migrations to apply ». Or la production est en eu-west-1 et tcc-test en eu-central-1. Mathys a quitté avec `q` sans ouvrir l'aperçu.
- **Vérification des fichiers (région seulement).** `.env` : eu-west-1. `.env.test` et `.env.tcc-tarif-test` : eu-central-1. L'hôte affiché par Prisma est donc celui de la production : `prisma migrate deploy` s'y est connecté.
- **Cause, lue dans la CLI 3.94.3.** La commande de démarrage (fonction `VKi`) reçoit l'environnement de la CLI **plus** `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `HOST`, `SCOPES` et les ports (execa, `extendEnv: true`). Elle ne reçoit pas le fichier `.env.<config>`. Prisma, puis React Router (via Vite `loadEnv`), ont alors complété les variables absentes depuis `.env`.
- **Mon erreur.** La preuve `check` simulait un environnement que `run` ne transmettait pas en réalité.

### La production : rien d'écrit (lecture seule)

| Contrôle | Résultat |
|---|---|
| `_prisma_migrations` | Inchangée : seule entrée, `create_session_table`, du 2026-05-17 |
| Table `Session` | 2 lignes, aucune pour tcc-tarif-test |
| Lignes de tcc-tarif-test dans les 36 tables à `shop_domain` | Aucune |
| Lignes créées ou modifiées depuis 13:40 UTC (15:40 à Paris), toutes tables à `created_at` ou `updated_at` | Aucune |
| Connexions Prisma encore ouvertes | 0 |

Sans migration en attente, `migrate deploy` s'est contenté de lire la liste des migrations. L'app n'a pas été installée et l'aperçu n'a pas été ouvert : aucune requête n'a pu écrire.

### Correctif du lanceur

- **Un seul constructeur d'environnement.** `run` transmet lui-même à la CLI toutes les variables de tcc-test et de l'app de test. La CLI les passe à l'app, et Vite comme Prisma ne complètent plus rien depuis `.env`, puisque tout est présent.
- **`check` simule exactement le démarrage réel :** l'environnement de la CLI, ses variables, puis le chargement de `.env` par React Router. Il vérifie aussi l'hôte réellement visé par `prisma migrate`.
- **Témoin négatif.** Sans les variables du lanceur, la même sonde vise la production. L'incident est donc reproduit, en lecture seule, et la cause confirmée.
- **`run` refait toute la preuve avant chaque lancement,** et refuse de démarrer si elle échoue.
- **Test négatif.** Avec l'adresse de production placée dans `.env.tcc-tarif-test`, `run` refuse (« DIRECT_URL vise la base PRODUCTION »). Le fichier a été restauré aussitôt.

### Preuve

| Contrôle | Résultat |
|---|---|
| App démarrée (environnement de la CLI + `.env` chargé par React Router) : Prisma | tcc-test (identifiant système Postgres) |
| Même environnement : Supabase | tcc-test, lecture OK |
| Clé de l'app | Celle de l'app de test |
| `BETA_SHOPS` | Vide |
| `prisma migrate`, hôte visé | tcc-test, à jour, rien à appliquer |
| Témoin sans le correctif | Prisma et Supabase visent la PRODUCTION (reproduction de l'incident) |

À la prochaine relance, Prisma affichera sans doute encore « Environment variables loaded from .env ». Ce message apparaît dès que le fichier existe, même s'il n'écrase rien. Le contrôle qui compte est la ligne « Datasource » : elle doit contenir **eu-central-1**.

## 9. Relance réussie, puis page bloquée par Vite

- **Constat de Mathys.**
  - La preuve est passée, la ligne « Datasource » affiche eu-central-1, puis « No pending migrations » et « Ready ».
  - La CLI a accordé les accès d'office (« Access scopes auto-granted ») et installé l'app sur tcc-tarif-test, sans écran d'installation.
  - La page de l'app affiche « Blocked request. This host (…trycloudflare.com) is not allowed ».
- **Cause.** Le lanceur transmettait `SHOPIFY_APP_URL=https://example.com`. Or `vite.config.js` ne remplace `SHOPIFY_APP_URL` par l'adresse du tunnel (`HOST`, fournie par la CLI) que si elle est vide. Vite n'autorisait donc que `example.com`.
- **Rien d'écrit (lecture seule).**
  - Production : aucune session, aucune ligne pour tcc-tarif-test, aucune ligne créée ou modifiée depuis 13:40 UTC.
  - tcc-test : même résultat, 0 session.
  - La requête ayant été bloquée par Vite, aucun code de l'app n'a tourné.
- **Correctif, sur le lanceur de test seulement.** `vite.config.js` et la vraie app ne sont pas touchés.
  - `SHOPIFY_APP_URL` n'est plus transmise, et le garde-fou exige son absence.
  - `vite.config.js` la pose depuis le tunnel avant le chargement de `.env` par React Router, qui ne l'écrase donc pas.
  - Seul Prisma, qui ne s'en sert pas, peut encore la lire dans `.env`.
- **Preuve complétée.**
  - La sonde rejoue la logique de `vite.config.js` avec une adresse de tunnel fictive : hôte autorisé = tunnel, `SHOPIFY_APP_URL` = tunnel.
  - Toutes les preuves tcc-test restent vertes : Prisma, Supabase, hôte de `prisma migrate`, et le témoin négatif.

## 10. Troisième lancement : authentification réussie, puis arrêt brutal du serveur

- **Constat de Mathys.**
  - Datasource sur eu-central-1. À l'ouverture de l'app : « No valid session found », puis « Creating new session {shop: tcc-tarif-test, isOnline: false} ».
  - Vite pré-regroupe ensuite de nouvelles dépendances (« new dependencies optimized », « reloading »).
  - Le proxy signale « ECONNRESET … /app/overview », puis « react-router dev — exit code 3221226505 », et la CLI s'arrête.
- **Écritures (lecture seule).**
  - tcc-test : 1 session hors ligne pour tcc-tarif-test (jeton et accès présents), et la ligne `shop_settings` que l'app crée à l'ouverture.
  - Production : aucune session, aucune ligne pour tcc-tarif-test, aucune ligne créée ou modifiée depuis 13:40 UTC.
- **Cause de l'arrêt.**
  - **Le code.** 3221226505 = `0xC0000409`. C'est un arrêt brutal, natif, du processus Node qui fait tourner `react-router dev` (Node 24.15.0), et non une erreur JavaScript de l'app.
  - **Ce qui est écarté.** Le moteur Prisma est ici un exécutable séparé (`query-engine-windows.exe`) et ne tourne pas dans ce processus.
  - **Moment de l'arrêt.** Pendant la première requête `/app/overview`, au moment où Vite découvrait et pré-regroupait 7 nouvelles dépendances (@prisma/client, adaptateurs Shopify, Supabase, @vercel/functions…).
  - **Explication la plus probable (non prouvée).** Un arrêt natif déclenché par ce premier pré-regroupement, fait en pleine requête. Le cache de Vite est maintenant écrit : 15 dépendances dans `node_modules/.vite/deps`, à 16:09. Une relance ne repasse donc plus par ce chemin.
- **Ajout au lanceur (diagnostic seulement).** `run` passe à Node les options `--report-on-fatalerror` et `--report-uncaught-exception`. Si l'arrêt se reproduit, Node laissera un rapport dans `node_modules/.cache/d2_0-reports`. La preuve tcc-test est refaite et reste verte.
