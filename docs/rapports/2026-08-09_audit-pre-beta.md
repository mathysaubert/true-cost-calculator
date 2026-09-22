# Audit pré-bêta — lecture seule stricte

Date : 2026-08-09. Baseline établie AVANT audit : `npm run lint` 0 erreur (345 warnings
prop-types/apostrophes, non bloquants par politique), `npm test` 21/21 lots verts,
`node scripts/render_check.mjs` « Tous les rendus réels OK » (35 scénarios), `npm run build`
succès. Arbre git propre (HEAD 3d93d67), seul fichier non suivi préexistant :
`docsPHASE0_AUDIT_SUIVI.md`. Aucun fichier applicatif modifié par cet audit.

---

## Résumé exécutif

La base est saine : intégrité des marges (snapshots figés, confirmed/imported immuables),
isolation par boutique, purge RGPD exhaustive, machine à états d'alerting et billing (isTest,
trialDays) tiennent tous à la lecture, preuves à l'appui. Trois problèmes concrets menacent
spécifiquement CE bêta-testeur (boutique de production, 500-2000 commandes/30 j) :
(1) **P0** : la synchronisation des commandes n'a AUCUN chemin de code pour télécharger une
opération bulk Shopify déjà terminée — si le bulk 30 j dure plus que le budget de poll de
25 s, chaque tentative relance une nouvelle opération à l'infini et le marchand n'ingère
JAMAIS une commande ; (2) **P1** : le flux « import CSV d'abord » (typique d'un gros
catalogue) crée des lignes de coûts sans `product_id`, ce qui casse silencieusement la
confirmation douanière et le groupement par produit ; (3) **P1** : l'expéditeur email par
défaut est l'adresse de TEST Resend, qui ne délivre pas à un marchand réel.
**Verdict : bêta NON lançable en l'état pour le profil annoncé.** Lançable après correction
du constat 1 (ou mesure prouvant que le bulk de la boutique tient sous 25 s), correction ou
acceptation explicite du constat 2, et vérification des variables Resend en prod (constat 3).

---

## Tableau récapitulatif

| # | Sév. | Constat | Effort |
|---|------|---------|--------|
| 1 | P0 | Sync : une opération bulk COMPLETED n'est jamais téléchargée si elle dépasse le poll de 25 s → relance perpétuelle, zéro ingestion | M |
| 2 | P1 | Import CSV : `variant_costs.product_id` NULL → confirmation douane impossible, groupement par produit éclaté | S/M |
| 3 | P1 | Emails : expéditeur par défaut `onboarding@resend.dev` (test) → livraison au marchand réel non garantie ; dépend de RESEND_FROM/RESEND_API_KEY en prod (invérifiable depuis le dépôt) | S (vérif.) |
| 4 | P1 | Cartes cadeaux : exclues de la liste des coûts mais PAS de l'ingestion → lignes « missing » impossibles à compléter, compteur de fiabilité pollué en permanence | S |
| 5 | P1 | Route app sans `maxDuration` : le poll de 25 s du bouton Synchroniser dépasse le plafond Vercel par défaut selon la config projet | S (vérif.) |
| 6 | P1 | Cron profitability : 60 s pour TOUTES les boutiques en séquentiel, jusqu'à ~25 s de poll chacune → boutiques en fin de liste non traitées dès 2-3 installs | M |
| 7 | P2 | Emails d'alerte : titres produits injectés dans le HTML sans échappement (« & », « < » cassent le rendu) | S |
| 8 | P2 | Audit : l'auto-lancement à l'ouverture de l'onglet consomme le quota 10/j | S |
| 9 | P2 | Upgrade Pro → Expert : nouvel essai complet (7/45 j) accordé sur la nouvelle souscription | S |
| 10 | P2 | Recalc marges : si > 5000 lignes/30 j ET sync KO pendant le recalc, lignes supprimées non restaurées (auto-guéri au sync suivant) | M |
| 11 | P2 | Sync : remboursements plafonnés à 20 pages × 100 commandes remboursées, au-delà ignorés silencieusement | S |
| 12 | P2 | `run_audit` : lecture `variant_costs` sans pagination (~1000 lignes PostgREST) — dette DÉJÀ documentée dans le code | — |
| 13 | P2 | `checkRateLimit` : lecture-puis-écriture non atomique (course bénigne) et fail-open assumé | S |
| 14 | P2 | Fichier égaré `docsPHASE0_AUDIT_SUIVI.md` à la racine (non suivi, nom suggère docs/) | S |

---

## Fiches

### 1. P0 — Sync commandes : une opération bulk terminée n'est jamais téléchargée (effort M)

**Preuve.** `app/lib/orderSync.server.js` :

- La garde d'entrée ne bloque QUE les opérations en cours, et IGNORE une opération terminée
  (lignes 36-42) :

```js
const cur = cj.data?.currentBulkOperation;
if (cur && (cur.status === "RUNNING" || cur.status === "CREATED")) {
  return { success: false, error: "Une synchronisation est déjà en cours. Réessayez dans un instant." };
}
```

- Le poll est borné à 25 s (ligne 79) : `while (Date.now() - startedAt < 25000) {`
- Dépassement → retour sans téléchargement (lignes 87-91) : statut `running` persisté,
  message « Synchronisation en cours, relancez dans un instant. »
- Le téléchargement (`fetch(op.url)`, ligne 98) n'existe QUE dans la continuation du poll du
  MÊME appel. Aucun autre chemin du dépôt ne lit `order_sync_state.bulk_operation_id` pour
  reprendre une opération, et aucun webhook `bulk_operations/finish` n'est abonné
  (`shopify.app.toml` lignes 18-31 : uniquement uninstalled, scopes_update, compliance).

**Reproduction pas-à-pas (marchand, boutique dont le bulk 30 j dure plus de 25 s).**
1. Onglet Suivi des coûts → « Synchroniser » : bulk lancé, poll 25 s, opération encore
   RUNNING → « Synchronisation en cours, relancez dans un instant. »
2. Re-clic pendant que l'opération tourne → garde lignes 36-42 → « déjà en cours ».
3. Re-clic une fois l'opération TERMINÉE (COMPLETED, résultats prêts chez Shopify) → la
   garde l'ignore, `bulkOperationRunQuery` écrase l'opération courante par une NOUVELLE →
   retour à l'étape 1. Les résultats terminés ne sont jamais téléchargés.
4. Le cron quotidien (`api.cron.profitability.jsx` → même `syncShopOrders`, même budget
   25 s) suit exactement le même chemin : une tentative par jour, même échec. Aucune
   auto-guérison : la fenêtre est toujours 30 j pleins, donc la durée du bulk ne diminue pas.

**Impact.** Pour une boutique dont le bulk dépasse systématiquement 25 s : zéro commande
ingérée, monitor vide, alerting muet, CPA sans données — le cœur de la proposition de valeur
est mort, sans aucun contournement marchand. Fait de code prouvé ; la CONDITION de
déclenchement (durée réelle du bulk Shopify pour 500-2000 commandes + line items) est
externe et variable — les tests actuels passent car un dev store à faible volume tient dans
le budget. Mesure de levée de doute possible avant installation du testeur : chronométrer un
bulk équivalent sur sa volumétrie.

**Piste (pour information, aucun correctif appliqué).** Au début de `syncShopOrders` : si
`currentBulkOperation` est COMPLETED avec `url` et correspond au `bulk_operation_id` persisté
en `order_sync_state`, télécharger CE résultat au lieu de relancer. Ou s'abonner au webhook
`bulk_operations/finish`.

### 2. P1 — Import CSV : `product_id` NULL casse la confirmation douane et le groupement (effort S/M)

**Preuve (chaîne complète).**
- Le CSV ne contient pas de colonne `product_id` — `app/lib/variantCosts.js:16-20`
  (`CSV_COLUMNS`) — et l'upsert d'import ne le fournit pas — `app/routes/app._index.jsx:1147` :

```js
const upserts = rows.map(r => ({ shop_domain: session.shop, variant_id: r.variant_id, ...r.value, source: "imported", ... }));
```

- Schéma : `product_id TEXT` nullable (`supabase/migrations/20260622_variant_costs.sql:14`)
  → toute ligne CRÉÉE par l'import naît avec `product_id` NULL.
- À l'affichage, la ligne stockée écrase la valeur Shopify — `app/lib/variantCosts.js:91` :
  `if (existing) return { ...display, ...existing, stored: true };` (`existing.product_id`
  NULL écrase le `display.product_id` venu de la requête produits).
- Conséquence 1 : le panneau de classification douanière saute ces lignes —
  `app/components/customsUi.jsx:58` : `if (!r.product_id) continue;` → le produit n'est
  JAMAIS listé « à confirmer », et `confirmCustomsCategory` ne trouverait de toute façon
  aucune variante (`customsClassification.server.js:39-41` filtre `.eq("product_id", pid)` →
  « Aucune variante à confirmer pour ce produit. »).
- Conséquence 2 : le groupement de la liste des coûts éclate — `app._index.jsx:2236` :
  `const key = r.product_id ?? r.variant_id;` → un produit multi-variantes importé en CSV
  devient N entrées mono-variante, et `marginByProduct.get(null)` (ligne 2242) ne joint plus
  la marge réelle.
- Pas d'auto-réparation : la sauvegarde panneau réécrit le null — `app._index.jsx:2184`
  (`product_id: r.product_id` depuis le rang affiché) et `:1124` (`row.product_id ?? null`).

**Reproduction.** Boutique avec un produit à 3 variantes, AUCUN coût encore saisi →
Suivi des coûts → « Exporter le modèle CSV » → remplir → « Importer » (toutes lignes
valides) → recharger : le produit apparaît en 3 entrées séparées, et la section
« Classification douanière : N produit(s) à confirmer » ne le propose jamais.

**Impact.** Le flux d'onboarding LE PLUS probable pour un catalogue de production (CSV
d'abord) prive le marchand de la confirmation douanière (marges marquées « taux estimé » à
vie, y compris dans l'email d'alerte et l'audit) et dégrade la liste des coûts. Les marges
calculées restent JUSTES (le calcul lit la catégorie, pas `product_id`) — c'est un bris de
parcours, pas de données.

### 3. P1 — Expéditeur email de TEST par défaut ; env Resend à vérifier avant bêta (effort S)

**Preuve.** `app/lib/email.server.js:10-12` :

```js
// Expéditeur de TEST : onboarding@resend.dev (autorisé sans domaine vérifié).
// Prod : remplacer par une adresse d'un domaine vérifié Resend avant envoi à de vrais marchands.
const FROM = process.env.RESEND_FROM || "True Cost Calculator <onboarding@resend.dev>";
```

Le code lui-même documente l'exigence. Resend n'autorise l'expéditeur d'onboarding que vers
l'adresse du compte : un envoi vers l'email du marchand bêta échouerait. L'échec est bien
géré côté état (retour `false` → l'état d'alerting n'avance pas, ré-essai au run suivant,
`profitabilityAlert` G2) mais le marchand ne recevra JAMAIS les alertes — la promesse
affichée dans l'onglet Alertes et le plan Gratuit.

**Reproduction.** Si `RESEND_FROM` est absente de Vercel : premier basculement de produit à
perte → cron 06:00 → `resend.emails.send` renvoie une erreur de domaine → log
`[Alert] envoi KO` → aucune alerte reçue, tous les jours.

**Impact / action.** Invérifiable depuis le dépôt (états des variables Vercel). Pré-vol
obligatoire : vérifier `RESEND_API_KEY` ET `RESEND_FROM` (domaine vérifié Resend) en
production avant l'installation du testeur.

### 4. P1 — Cartes cadeaux ingérées en « missing », impossibles à compléter (effort S)

**Preuve.** L'exclusion des cartes cadeaux existe UNIQUEMENT dans la liste des coûts —
`app/routes/app._index.jsx:1083-1084` :

```js
if (node.isGiftCard === true) { giftCardCount++; continue; }
```

L'ingestion des commandes, elle, n'a aucun filtre : la requête bulk
(`orderSync.server.js:49-62`) remonte tous les line items, et
`buildOrderHistoryRows` (`orderIngest.js:277-286`) n'écarte que les lignes sans variante NI
produit. Une vente de carte cadeau (qui a produit + variante) donne donc `costRow` null →
`cost_source: "missing"` (`orderIngest.js:213-216`). Le compteur de fiabilité expose ensuite
ces lignes dans « à renseigner » (lot7 : « missing compté à part », « top à compléter =
estimated+missing ») — or la variante est absente de la liste des coûts : aucun moyen de la
compléter.

**Reproduction.** Boutique vendant des cartes cadeaux → Synchroniser → le compteur de
fiabilité affiche en permanence « 1 produit à renseigner (marge inconnue) » pointant la
carte cadeau ; le clic mène à une liste où elle n'existe pas (ligne discrète « 1 carte
cadeau ignorée »).

**Impact.** Incohérence visible et non résoluble par le marchand ; fausse en légère baisse
la lecture de complétude. Les marges des vrais produits restent justes (lignes missing
isolées des agrégats, lot7).

### 5. P1 — Pas de `maxDuration` sur la route app : le poll de 25 s dépend du défaut Vercel (effort S, vérification)

**Preuve.** Grep `maxDuration` : seuls les trois crons le fixent
(`api.cron.dunning.jsx:15`, `api.cron.profitability.jsx:20`, `api.cron.session_reaper.jsx:18`,
tous à 60). La route qui porte l'action `backfill_orders` (bouton Synchroniser,
`app._index.jsx:1171-1176`) n'exporte aucun `config` — elle hérite du défaut projet Vercel.
Or `syncShopOrders` peut retenir la requête ~25 s (poll) + requêtes refunds + upserts.

**Impact.** Si le défaut projet est inférieur (10-15 s selon plan/Fluid Compute), la requête
du bouton est tuée en plein poll → erreur réseau côté UI (le bulk continue chez Shopify ;
l'état retombe sur le chemin du constat 1). Invérifiable depuis le dépôt : vérifier la
config Vercel (Fluid Compute/durée par défaut) ou fixer `maxDuration` sur la route.

### 6. P1 — Cron profitability : budget 60 s pour toutes les boutiques en séquentiel (effort M)

**Preuve.** `api.cron.profitability.jsx:20` (`maxDuration: 60`), boucle séquentielle
lignes 174-178 (`for (const shop of shops) { results.push(await runForShop(shop)); }`),
chaque `runForShop` commence par `syncShopOrders` (poll jusqu'à 25 s) puis agrégat, décision,
emails. À 2-3 boutiques dont une volumineuse, 60 s sont dépassées → Vercel tue la fonction →
les boutiques en fin de liste ne sont ni synchronisées ni alertées ce jour-là (l'état
n'avance pas : aucune alerte perdue, mais reportée).

**Impact bêta.** À 1-2 boutiques installées, tolérable. À surveiller dès la 3e install ;
le tri des boutiques n'étant pas déterministe (ordre Prisma), la « victime » varie.

### 7. P2 — Titres produits non échappés dans le HTML des emails (effort S)

**Preuve.** `app/lib/profitabilityAlert.js:132-135` : `underLine(b)` (qui inclut
`productName(b)`, le titre Shopify brut) est interpolé dans `<li ...>${render(b)}</li>` sans
échappement HTML. Un titre « Sacs & Cie » produit un `&` nu (toléré par la plupart des
clients mail), « Lot <3 pièces> » avale du texte. La version TEXTE reste intacte (parité par
chaînes, mais parité rompue au RENDU dans ce cas). Reproduction : produit dont le titre
contient `<`, basculement à perte → email dont la ligne est tronquée.

### 8. P2 — L'auto-lancement de l'audit consomme le quota 10/j (effort S)

**Preuve.** `app._index.jsx:2624-2628` : à l'ouverture de l'onglet Audit (Expert), si aucun
résultat en mémoire, `run_audit` est soumis automatiquement ; chaque exécution passe
`checkRateLimit(shop, "run_audit", 10)` (`:1263`). Chaque rechargement de l'app + visite de
l'onglet = 1 audit décompté. Un marchand qui navigue beaucoup voit « Limite atteinte :
10 audits par jour » sans avoir cliqué une seule fois « Relancer ».

### 9. P2 — Upgrade Pro → Expert : nouvel essai complet (effort S)

**Preuve.** Les deux plans portent `trialDays` en config (`shopify.server.js:32/:42`) ; le
handler `subscribe_expert` (`app._index.jsx:885-893`) appelle `appSubscriptionCreate` sans
`replacementBehavior` ni réduction d'essai : un abonné Pro qui passe Expert reçoit une
nouvelle souscription avec un NOUVEL essai (7 j, ou 45 j si bêta). Impact : revenu
uniquement (jours gratuits), aucune donnée faussée. Comportement peut-être voulu pour la
bêta ; à trancher, pas à corriger d'office.

### 10. P2 — Recalc : perte transitoire possible au-delà de 5000 lignes/30 j (effort M)

**Preuve.** `recalcEstimatedMargins.server.js` : la CAPTURE lit au plus 5000 lignes
(`readMargins`, `:24-28`) alors que le DELETE est non borné
(`:64-65` — tous `estimated|missing` de la fenêtre). Si plus de 5000 lignes existent sur
30 j, des lignes supprimées ne sont pas capturées ; si le sync de recréation échoue au même
moment (`:83-85`), la restauration (`:76-82`) ne couvre que le capturé → lignes perdues
jusqu'au prochain sync réussi (bouton ou cron quotidien, même fenêtre → recréation avec les
coûts actuels — l'intention du recalc). Bouton branché à l'UI (`app._index.jsx:2302`),
rate-limité à 3/j. Double condition rare au volume bêta ; à borner plus tard (DELETE sur les
clés capturées uniquement).

### 11. P2 — Remboursements : plafond silencieux de 20 pages (effort S)

**Preuve.** `orderSync.server.js:107-108` : `while (rHasNext && rPages < 20)` sur des pages
de 100 commandes remboursées. Au-delà de 2000 commandes remboursées/30 j, les refunds
excédentaires sont ignorés sans signal → quantités effectives surestimées pour ces
commandes. Volume très au-delà de l'ICP bêta.

### 12. P2 — `run_audit` : lecture `variant_costs` non paginée (dette déjà documentée)

**Preuve.** `app._index.jsx:1323-1328` — le commentaire du code documente lui-même la borne
PostgREST (~1000 lignes) et son effet (variantes confirmées traitées « estimées » au-delà).
Signalé ici uniquement pour complétude ; rien de nouveau à décider pour la bêta (petit
catalogue).

### 13. P2 — `checkRateLimit` : non atomique et fail-open (effort S)

**Preuve.** `app._index.jsx:824-844` : lecture du compteur puis upsert `count+1` (deux
requêtes séparées → deux appels concurrents peuvent compter 1 seul) ; toute exception rend
`true` (« Fail open »). Assumé en commentaire. Impact : quotas 10/50/3 par jour légèrement
contournables par concurrence — sans enjeu de données.

### 14. P2 — Fichier égaré à la racine (effort S)

`docsPHASE0_AUDIT_SUIVI.md` (non suivi, présent avant cet audit) : le nom suggère
`docs/PHASE0_AUDIT_SUIVI.md`. À classer ou supprimer — décision à part, rien fait ici.

---

## Zones non auditées

L'honnêteté de couverture prime : les affirmations du rapport ne portent QUE sur le code lu.

- `app/lib/engine.js` (moteur de calcul) : non relu dans cet audit — couvert par les lots
  1-4 et 20 de la suite (verts en baseline), et protégé par la règle R2 (0 diff).
- Libs pures non relues intégralement ici (couvertes par leurs lots verts) :
  `orderHistory.js` (lot 7), `cpaTargets.js` (lot 15), `roas.js` (lot 3),
  `auditClassify.js` (lot 18), `dunning.js` (lots 11-13), `customsClassification.js`
  (lot 20), `sessionReaper.js` (lot 14), `emailLayout.js` (lots 10/12).
- Le JSX de rendu de `app._index.jsx` (~2500 lignes de composants) : parcouru par
  échantillons ciblés + validé par `render_check` (35 scénarios) — pas relu ligne à ligne.
- Rendu des emails de dunning (`renderDunningEmail`) : non relu (lot 12 vert).
- Pages publiques `_index/route.jsx` (landing) et `privacy.jsx` : non lues.
- `auth.login/error.server.jsx`, `auth.session-token.jsx` : non lus.
- Migrations SQL : seule `20260622_variant_costs.sql` lue en entier ;
  `20260611_rls_policies.sql` et le corps de `increment_usage_orders`
  (`20260716_usage_orders_count.sql`) non lus — l'existence de la RPC est vérifiée, pas son
  atomicité.
- `instrument.server.mjs`, `sentry.server.js`, `prisma/schema.prisma` : non lus.
- Tout l'état RUNTIME hors dépôt : variables Vercel (RESEND_*, CRON_SECRET, BETA_SHOPS…),
  plan/Fluid Compute Vercel (durée par défaut des fonctions), durée réelle des opérations
  bulk Shopify sur la volumétrie du testeur, déclaration Protected Customer Data dans le
  Partner Dashboard (exigence notée en commentaire de `shopify.app.toml:12-15`).

## Invariants vérifiés sains

Contrôlés sur pièces pendant cet audit (fichier:lignes cités au fil des fiches) :

1. **Baseline** : lint 0 erreur, 21/21 lots, render_check 35 scénarios, build — tout vert.
2. **Billing isTest** : décision unique `isDevStore` (`app._index.jsx:851-859`), défaut
   FALSE sur toute incertitude → boutique réelle = facturation réelle ; le dunning recrée
   dans le mode du sub d'origine (`api.cron.dunning.jsx:94-98`), le doute ne donne jamais un
   test.
3. **Classe « missing trialDays »** : config nominale `trialDays: 7` intacte sur les deux
   plans + un SEUL site d'override (`betaTrialOverride`, Expert uniquement) — verrouillé en
   continu par lot21 (scan du source : aucun trialDays numérique en dur dans la route,
   config des deux plans présente).
4. **Allowlist bêta** : égalité stricte sur domaine complet normalisé, env absente = aucun
   shop bêta (lot21 : 51 assertions, suffixe/préfixe/sous-domaine des deux sens).
5. **Isolation par boutique** : toutes les requêtes Supabase lues dans
   `app._index.jsx` (loader + 15 actions), `orderSync.server.js`,
   `recalcEstimatedMargins.server.js`, `customsClassification.server.js`, les 3 crons et les
   2 webhooks sont filtrées `shop_domain` (ou par id issu d'un select scopé —
   `backfill_breakdowns`) ; `save_annotation` vérifie la propriété du calcul avant écriture
   (`:1244-1250`). Aucun chemin cross-shop trouvé en cherchant activement.
6. **Purge désinstallation/RGPD** : inventaire par grep = 12 tables Supabase utilisées dans
   l'app ; les DEUX listes de purge (`webhooks.app.uninstalled.jsx:17-28`,
   `webhooks.compliance.jsx:30-41`) couvrent exactement ces 12 tables, + sessions Prisma ;
   HMAC vérifié par `authenticate.webhook` dans les deux handlers.
7. **Ère XV (« plus jamais de pré-rempli »)** : unique occurrence de `source: "estimated"`
   dans une écriture potentielle = `estimateVariantCost` (suggestion display-only,
   `stored:false`, jamais persistée) ; `costs_list` sans chemin d'écriture ;
   `costs_confirm_all` inerte ; `costs_save` force `confirmed`, l'import force `imported` ;
   prix ≤ 0 refusé avec message unifié (`variantCosts.js:150-152`).
8. **Snapshots immuables** : sync `ignoreDuplicates` (jamais de mutation d'une ligne
   existante) ; recalc DELETE limité à `estimated|missing` (confirmed/imported immuables par
   défaut sûr, `recalcMargins.js:22-24`) ; `backfill_breakdowns` auto-validant au centime et
   n'update QUE `margin_breakdown_json`.
9. **Quota d'alerting** : coupure en M+1 uniquement (compteur du mois PRÉCÉDENT,
   `alertingEnabled` borne inclusive), jamais en cours de mois ; défaut ON sur tout doute de
   plan ; `suppress` n'avance jamais l'état (aucune alerte perdue).
10. **Anti-spam alerting** : alertes sur TRANSITIONS uniquement, premiers passages en seeds
    silencieux, état avancé SSI envoi réussi (G2), MIXED et product_id null jamais suivis.
11. **Crons** : Bearer `CRON_SECRET` vérifié sur les trois routes (401 sinon, y compris
    secret absent) ; itération sur TOUTES les sessions offline dédupliquées ; les trois
    crons sont déclarés dans `vercel.json`.
12. **Devise** : `shop.currencyCode` source primaire, secours devise des commandes, EUR en
    dernier recours ; emails et monitor formatent dans la devise du produit ; l'IA reçoit la
    devise boutique et interdiction d'en changer.
13. **Fuseau** : date de déclaration CPA formatée dans `ianaTimezone` de la boutique, repli
    UTC explicite ; fenêtre de sync en UTC ISO (cohérente avec `created_at` Shopify).
14. **Boutique à 0 commande** : bulk COMPLETED sans `url` → succès « Aucune commande sur les
    30 derniers jours » (`orderSync.server.js:92-95`) ; états vides couverts par
    render_check.
15. **Classe « i is not iterable »** : garde `rows ?? []` documentée au point exact du crash
    historique (`customsUi.jsx:55-57`) ; render_check rend chaque surface sur données
    chargées ET état initial null — 35/35 OK en baseline.
16. **Chaînes rendues** : zéro tiret cadratin, zéro « CIF »/« de minimis »/« intrant » dans
    le HTML réellement rendu (scan de la sortie render_check ; les seuls tirets trouvés
    appartiennent aux libellés du harnais) ; libellés verrouillés par lot2.
17. **Secrets** : aucun secret en dur (grep motifs sk-ant/shpss_/shpat_/re_/JWT : seuls des
    exemples d'usage) ; `.env` non suivi ; `debug.jsx` renvoie 404 en production et masque
    partiellement même en dev ; clé service Supabase serveur uniquement, RLS deny-all posée
    (vérifiée sur `variant_costs`).
18. **Validation des entrées** : CSV parsé RFC4180 avec erreurs ligne à ligne jamais
    avalées ; enums pays/catégorie/régimes ; bornes dures sur les taux qui ENTRENT dans un
    calcul (fees 0-100/0-10, seuil 0-100) et bornes techniques seules sur le déclaratif
    (CPA) ; `sanitizeForPrompt` sur toute chaîne marchande injectée au prompt IA ; lookups
    `.in()` chunkés par 100.
19. **Plan indéterminé** : jamais de free dégradé — loader 503 transitoire rendu par
    l'ErrorBoundary dédiée, action → message de retry ; repli cache D1 ; retry borné en
    temps (jamais de page blanche).
20. **OAuth/install prod** : callback `/api/auth` fait le vrai échange de code (fix
    historique cité en commentaire, `api.auth.jsx:3-7`) ; `scopes_update` maintient la
    session ; scopes minimaux lecture seule (`read_products,read_inventory,read_orders`).

---

STOP. Aucun correctif appliqué ; tout correctif exige un GO séparé.
