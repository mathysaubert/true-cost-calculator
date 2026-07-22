# scripts/ — outils DEV / DÉMO

Ces scripts sont des **outils de diagnostic et de démonstration**, à lancer **à la main** depuis
un poste de dev. **Ils ne sont JAMAIS exécutés par l'application au runtime** — aucun code de l'app
(loader, action, cron) ne les importe ni ne les appelle.

## Prérequis — inertes sans la clé

Tous requièrent `SUPABASE_SERVICE_KEY` (et `SUPABASE_URL`) lus depuis `.env`, qui **n'est pas
commité**. Sans cette clé de service, les scripts s'arrêtent immédiatement (`❌ … manquants`) :
les commiter **n'expose aucun secret** et ils sont **inertes** tels quels dans le dépôt.

```bash
node --env-file=.env scripts/<script>.mjs [options]
```

---

## `c4a_counter_check.mjs` — LECTURE SEULE

Vérifie le compteur `usage.orders_count` du mois courant (sur-comptage éventuel des re-syncs).
Aucune écriture, aucune suppression.

```bash
node --env-file=.env scripts/c4a_counter_check.mjs
```

## `inject_profitable_state.mjs` — écrit 1 ligne (DÉMO, pas de production)

Force l'état d'**un seul** produit à `profitable` dans `product_profitability_state`, pour provoquer
une transition `profitable → loss` au prochain run du cron profitability — et donc **un email d'alerte
de perte de démonstration**. Cible codée en dur : `true-cost-dev.myshopify.com` + le produit au coût
`2750` (identifié de façon unique) ; **refuse d'écrire si la cible est ambiguë** (jamais en masse).
Outil de démo — ne pas utiliser en production.

```bash
node --env-file=.env scripts/inject_profitable_state.mjs            # PREVIEW (cible + état actuel)
node --env-file=.env scripts/inject_profitable_state.mjs --inject   # écrit last_state='profitable' (1 ligne)
```

## `recalc_estimated_margins.mjs` — teste le cycle de recalcul (Brique 2)

Prouve le **cycle complet** du recalcul des marges (`app/lib/recalcEstimatedMargins.server.js`, = l'action
`recalc_estimated_margins`) **sans envoyer d'email** : capture → DELETE des lignes recalculables
(`estimated`/`missing`) dans la fenêtre 30j → re-sync (recrée avec les coûts actuels) → réconcilie-restaure →
re-baseline **muet** de `product_profitability_state` → résumé « passé à perte ». **Preview par défaut** ;
n'exécute (DELETE + re-sync Shopify réels) qu'avec `--run <shop>`. Après exécution, il **rejoue la détection
du cron** et vérifie qu'**aucun basculement** ne subsiste (donc aucun email au prochain run).

> ⚠ Le re-sync exige un token offline **valide** : si expiré (~quotidien), ouvre l'app dans le dev store
> pour le rafraîchir, puis relance (sinon `admin_unauthorized`).

```bash
node --env-file=.env scripts/recalc_estimated_margins.mjs                        # PREVIEW (recalculables par boutique)
node --env-file=.env scripts/recalc_estimated_margins.mjs --run xxx.myshopify.com   # cycle complet + preuve « aucun email »
```

## `recalc_live_proof.mjs` — PREUVE LIVE que le recalcul CORRIGE (réversible)

Monte un vrai scénario de **marge fausse** sur le dev store et prouve que `recalc_estimated_margins`
la **corrige**, réversiblement. Prend un produit **réellement en perte**, injecte une marge **fausse
(profitable)** dans une de ses lignes (repassée `estimated`) + aligne `product_profitability_state`
sur ce mensonge, puis lance le recalcul et **vérifie** : marge corrigée (fausse→réelle), `lignesRecalculees > 0`,
résumé qui **nomme** le produit passé à perte, **aucun email**, et un cron ultérieur **sans fausse
transition** (avec le contraste : sans re-baseline, il aurait alerté). Backup pristine → `--restore`
annule (auto-restauration en cas d'échec).

> ⚠ Le recalcul re-synchronise Shopify → **token offline valide requis** : si expiré, ouvre l'app
> dans le dev store pour le rafraîchir, puis relance (aucune écriture tant que le token n'est pas validé).

`--setup` injecte la marge fausse **et s'arrête** — pour déclencher la correction **depuis le bouton
de l'app** (parcours réel). `--run` fait tout automatiquement (injecte + recalcule + vérifie).

```bash
node --env-file=.env scripts/recalc_live_proof.mjs             # PREVIEW (cible + marge réelle)
node --env-file=.env scripts/recalc_live_proof.mjs --setup     # injecte la marge fausse, s'arrête (test bouton app)
node --env-file=.env scripts/recalc_live_proof.mjs --run       # cycle complet autonome + toutes les preuves
node --env-file=.env scripts/recalc_live_proof.mjs --restore   # revient à l'exact pristine
```

## `purge_order_margins.mjs` — ⚠ DESTRUCTIF

**Supprime** des lignes en base. Mode **preview par défaut** (aucune suppression tant que `--delete`
n'est pas passé avec un domaine EXACT).

- **Supprime** (pour un `shop_domain` EXACT uniquement) : `order_margins` **et**
  `product_profitability_state`.
- **Préserve** (jamais touchés) : `variant_costs`, `usage`, `shop_plans`, `sessions`.
- **Garde-fous** : domaine exact terminant par `.myshopify.com` obligatoire ; **aucun wildcard**,
  **jamais « toutes les boutiques »** ; s'arrête si rien à supprimer.

Usage prévu : forcer une ré-ingestion propre des commandes (après correction de coûts) — les lignes
se recréent au clic « Synchroniser les commandes » dans l'app.

```bash
node --env-file=.env scripts/purge_order_margins.mjs                         # PREVIEW (comptes par boutique)
node --env-file=.env scripts/purge_order_margins.mjs --delete xxx.myshopify.com   # SUPPRIME pour CE shop
```
