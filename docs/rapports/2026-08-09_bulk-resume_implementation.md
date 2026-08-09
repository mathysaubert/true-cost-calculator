# Reprise des opérations bulk COMPLETED (sync 30 j) + maxDuration route sync — rapport d'implémentation

Date : 2026-08-09. Fait suite à la Phase 0 validée
(`docs/rapports/2026-08-09_bulk-resume_phase0.md`) : option A (reprise à l'entrée, décision
pure, aucun état persisté nouveau), branche par défaut « statut inconnu → busy » ajoutée
(validation point 2). Aucun commit : GO séparé attendu (R1).

---

## Problème

P0 de l'audit pré-bêta : aucun chemin de code ne téléchargeait une opération bulk Shopify
déjà COMPLETED. Si le bulk 30 j dépassait le budget de poll (25 s), chaque invocation
suivante (bouton, cron, recalc) écrasait l'opération terminée par une nouvelle : relance
infinie, zéro commande ingérée pour la boutique concernée. Constat annexe (5) : la route qui
porte l'action de sync n'avait pas de `maxDuration`.

## Cause

La garde d'entrée de `syncShopOrders` ne bloquait que RUNNING/CREATED et ignorait une op
COMPLETED ; le téléchargement (`fetch(op.url)`) n'existait que dans la continuation du poll
du même appel.

## Solution

1. `app/lib/bulkResume.js` (NOUVEAU, pur) : `SYNC_QUERY_MARKERS` + `isOurSyncQuery(query)`
   (reconnaissance de notre requête par marqueurs stables du champ `query`) +
   `decideBulkResume({ op, state })` → `'create' | 'poll' | 'busy' | 'ingest'` — la table
   validée en Phase 0, avec la branche par défaut : tout statut hors des six connus
   (CANCELING, statuts futurs) et toute op sans statut lisible → `'busy'` (inaction).
2. `app/lib/orderSync.server.js` : la garde d'entrée lit désormais
   `currentBulkOperation { id status errorCode url query }`, lit `order_sync_state`
   (colonnes EXISTANTES `bulk_operation_id`/`status`) uniquement quand une op COMPLETED est
   présente, et applique la décision : `busy` → message existant ; `ingest` → reprise (même
   op, téléchargement + ingestion par le chemin existant ; échec de download → op fraîche
   dans la même invocation) ; `poll` → aucune création, entrée directe dans le poll
   existant ; `create` → chemin actuel inchangé. Le bloc téléchargement+ingestion est
   extrait en fonction locale `ingestBulkResult` appelée par le chemin normal ET la reprise
   (aucune logique d'ingestion dupliquée, I2).
3. `app/routes/app._index.jsx` : `export const config = { maxDuration: 60 };` (pattern cron,
   I3) + commentaire d'une ligne.
4. `tests/lot22_bulk_resume.mjs` (NOUVEAU, 33 assertions) branché à la gate (`package.json`).

Zéro nouvelle chaîne visible (les trois messages existants réutilisés), zéro état persisté
nouveau, zéro diff `engine.js`, aucun test existant modifié.

### Écarts de l'extraction « à l'identique » (justification ligne par ligne, validation point 1)

Le bloc téléchargement+ingestion (anciennes lignes 92-189) est déplacé dans
`ingestBulkResult`. Écarts exhaustifs par rapport au déplacement pur :

1. Signature ajoutée : `async function ingestBulkResult({ admin, supabase, shop, op, bulkId, windowStart, shopSettings })`
   — les 7 variables que le bloc consommait déjà, mêmes noms, aucun renommage.
2. `const bulkId = runJson...` → `let bulkId;` déclaré avant le branchement puis
   `bulkId = runJson...` dans la branche création — exigé par la nouvelle branche `poll`
   (`bulkId = cur.id`) ; valeur et usages inchangés.
3. Le bloc de création (mutation + userErrors + upsert `running`) est enveloppé dans
   `else { ... }` (sauté quand `decision === "poll"`) — lignes internes inchangées, seule
   l'indentation bouge (+2 espaces).
4. Branche « COMPLETED sans url » : ajout de `bulk_operation_id: bulkId` à l'upsert
   `completed`. Lacune HÉRITÉE sans conséquence avant la reprise ; avec la reprise, un état
   purgé (désinstallation) + une vieille op zéro-résultat encore COMPLETED auraient été
   repris en boucle sans jamais créer d'op fraîche (« déjà ingérée » exige le couple
   id+completed persisté). Commenté sur place, testé indirectement par T1.
5. L'ancien commentaire de garde (« Une seule bulk op QUERY par boutique à la fois : ne pas
   lancer en double. ») est remplacé par le bloc de commentaires de la reprise.

Aucun autre écart : aucune garde ajoutée dans le corps déplacé, aucun ordre modifié.

### Limites documentées (validées Phase 0 / validation points 4-5)

- Cron séquentiel : une décision `poll` sur une op RUNNING dépense jusqu'au budget de poll
  PAR boutique (maxDuration 60 du cron) — sans enjeu à 2-3 boutiques ; rattaché au P1
  « cron séquentiel » de l'audit (backlog).
- Fenêtre périmée d'une op reprise (jusqu'à ~24 h via le cron) : append idempotent, agrégats
  fenêtrés à la lecture, fenêtre fraîche au sync suivant. En reprise, la fenêtre d'ORIGINE
  de l'op (`order_sync_state.window_start`) est réutilisée pour la requête refunds quand
  elle est connue, sinon la fenêtre courante.
- `partialDataUrl` non consommé (op FAILED partielle) → recréation propre.
- `currentBulkOperation` est déprécié par Shopify (→ `bulkOperations`) : validé fonctionnel
  sur l'API épinglée 2025-10, migration au backlog.

---

## Preuves

### E2 — diff complet (5 fichiers : 3 modifiés + 2 nouveaux)

`git diff --stat` :

```
 app/lib/orderSync.server.js | 78 ++++++++++++++++++++++++++++++++++-----------
 app/routes/app._index.jsx   |  4 +++
 package.json                |  2 +-
 3 files changed, 64 insertions(+), 20 deletions(-)
```

Nouveaux fichiers : `app/lib/bulkResume.js` (46 lignes), `tests/lot22_bulk_resume.mjs`
(139 lignes). I3 : ~109 lignes applicatives nouvelles vs estimation 90-105 → dans la marge
(< +30 %), pas de STOP. Diff intégral en annexe C. R3/V6 : les +4 lignes de
`app._index.jsx` sont l'export `config` + commentaire — aucun JSX touché ; `render_check`
35 scénarios vert dans la gate malgré tout.

### T3 — gate complète (après retrait du patch E1)

`npm run lint` 0 erreur (345 warnings non bloquants) ; `npm test` **22/22 lots verts**
(sortie intégrale en annexe B) ; `node scripts/render_check.mjs` « Tous les rendus réels
OK » ; `npm run build` succès. Aucun test existant modifié ; lot22 : 33 assertions (T1
machine à états complète dont statut inconnu → busy ; T2 idempotence fixtures + scan du
source : upsert `onConflict` + `ignoreDuplicates:true`, aucun UPDATE sur order_margins, un
seul site de création, décision appelée avant toute création, marqueurs présents dans le
bulkQuery réel, maxDuration exporté).

### E1 — preuve empirique sur la boutique dev (4 invocations, logs bruts)

**Montage (tout NON committé, vécu dans le scratchpad de session).** Le token offline local
étant expiré (gotcha connu), le harness appelle le VRAI `syncShopOrders` de l'app avec un
shim `admin.graphql` pointé sur le proxy GraphiQL de `shopify app dev` (port 3457), clé
imposée via la variable CLI documentée `SHOPIFY_FLAG_GRAPHIQL_KEY` (flag officiel
`--graphiql-key`). Patch local temporaire du budget de poll — diff EXACT, retiré avant tout
commit :

```diff
-  while (Date.now() - startedAt < 25000) {
+  while (Date.now() - startedAt < Number(process.env.SYNC_POLL_BUDGET_MS ?? 25000)) { // PATCH E1 LOCAL — NE PAS COMMITTER
```

`SYNC_POLL_BUDGET_MS=0` force ZÉRO itération de poll (le bulk d'un dev store de 20 commandes
se termine en ~2 s, plus vite qu'une itération réelle : le budget nul est le seul moyen local
de laisser une op orpheline). Chaque invocation photographie AVANT/APRÈS : op courante
(`currentBulkOperation`), `order_sync_state`, compte `order_margins`, `usage` du mois.

**Logs bruts (verbatim).**

```
===== INVOCATION INV1-TIMEOUT (SYNC_POLL_BUDGET_MS=0) =====
[INV1-TIMEOUT AVANT] op=gid://shopify/BulkOperation/10136076812454 COMPLETED url:oui | state=aucune | order_margins=0 | usage(2026-08)=0
[INV1-TIMEOUT] retour syncShopOrders: {"success":true,"ingested":20,"orders":20}
[INV1-TIMEOUT APRES] op=gid://shopify/BulkOperation/10136076812454 COMPLETED url:oui | state=completed / gid://shopify/BulkOperation/10136076812454 | order_margins=20 | usage(2026-08)=20

===== INVOCATION INV2-ORPHELIN (SYNC_POLL_BUDGET_MS=0) =====
[INV2-ORPHELIN AVANT] op=gid://shopify/BulkOperation/10136076812454 COMPLETED url:oui | state=completed / gid://shopify/BulkOperation/10136076812454 | order_margins=20 | usage(2026-08)=20
[INV2-ORPHELIN] retour syncShopOrders: {"success":false,"error":"Bulk échoué (? )."}
[INV2-ORPHELIN APRES] op=gid://shopify/BulkOperation/10136080941222 RUNNING url:non | state=failed / gid://shopify/BulkOperation/10136080941222 | order_margins=20 | usage(2026-08)=20

===== INVOCATION INV3-REPRISE (SYNC_POLL_BUDGET_MS=0) =====
[INV3-REPRISE AVANT] op=gid://shopify/BulkOperation/10136080941222 COMPLETED url:oui | state=failed / gid://shopify/BulkOperation/10136080941222 | order_margins=20 | usage(2026-08)=20
[INV3-REPRISE] retour syncShopOrders: {"success":true,"ingested":20,"orders":20}
[INV3-REPRISE APRES] op=gid://shopify/BulkOperation/10136080941222 COMPLETED url:oui | state=completed / gid://shopify/BulkOperation/10136080941222 | order_margins=20 | usage(2026-08)=20

===== INVOCATION INV4-FRAICHE (SYNC_POLL_BUDGET_MS=défaut 25000) =====
[INV4-FRAICHE AVANT] op=gid://shopify/BulkOperation/10136080941222 COMPLETED url:oui | state=completed / gid://shopify/BulkOperation/10136080941222 | order_margins=20 | usage(2026-08)=20
[INV4-FRAICHE] retour syncShopOrders: {"success":true,"ingested":20,"orders":20}
[INV4-FRAICHE APRES] op=gid://shopify/BulkOperation/10136082874534 COMPLETED url:oui | state=completed / gid://shopify/BulkOperation/10136082874534 | order_margins=20 | usage(2026-08)=20
```

**Lecture, mappée sur E1.b (les identifiants abrègent en X=…812454, Y=…941222, Z=…874534).**

1. *Timeout reproduit, op persistée* — INV2 : X reconnue déjà ingérée → création d'une op
   FRAÎCHE Y ; budget nul → aucun poll, Y laissée orpheline (RUNNING, `state failed/Y`).
   C'est l'état EXACT du P0 : avant le fix, l'invocation suivante aurait écrasé Y une fois
   terminée.
2. *Reprise du MÊME id, zéro création, ingestion réelle* — INV1 : X était orpheline
   (COMPLETED, état absent — purgé) → décision `ingest` → MÊME id X avant/après, aucune
   création, aucun poll (budget nul : la reprise n'en a pas besoin), ingestion RÉELLE
   `order_margins` 0→20 et `usage` 0→20. INV3 : même preuve sur Y (`state failed/Y` →
   reprise, même id, `state completed/Y`) avec en plus l'idempotence : 20→20 partout,
   zéro doublon, zéro incrément de compteur.
3. *Op reconnue déjà ingérée → op fraîche, delta 0, aucune marge modifiée* — INV2 (X →
   création de Y, compteurs inchangés) et INV4 : Y reconnue ingérée → création de Z ≠ Y,
   poll normal, ré-ingestion toute-doublon : `order_margins` 20→20, `usage` 20→20.

Note de lecture : le champ `ingested` du retour est le nombre de lignes CONSTRUITES
(comportement existant, inchangé) ; la preuve « zéro écriture » est portée par les compteurs
DB (`order_margins`, `usage`), qui ne bougent pas en INV3/INV4 (`ON CONFLICT DO NOTHING` +
compteur sur lignes réellement insérées, cf. Phase 0 P0.4).

**E1.c — preuve de retrait.** Patch retiré avant la gate finale :
`Select-String orderSync.server.js -Pattern "SYNC_POLL_BUDGET_MS"` → **0 occurrence** ; le
diff pré-commit (annexe C) ne contient ni `SYNC_POLL_BUDGET_MS`, ni harness, ni clé
GraphiQL. Le harness (`harness_e1.mjs`, `reset_e1.mjs`, hooks de résolution) vit dans le
scratchpad de session, hors dépôt.

**État laissé sur la boutique dev.** 20 lignes `order_margins` (les 20 vraies commandes
30 j du dev store, ingérées par le chemin normal de l'app), `usage` 2026-08 = 20,
`order_sync_state` completed/Z — l'état naturel d'une boutique synchronisée. Les données de
la première expérimentation (avant remise à zéro documentée par `reset_e1.mjs`) avaient été
supprimées pour rejouer la preuve depuis 0.

---

## Annexe L2 — brouillon d'entrée pour docs/CHANTIERS_DETAIL.md (NON committé, à recopier)

### Reprise des opérations bulk COMPLETED (sync 30 j) + maxDuration route sync

- **Problème** : aucune reprise d'une op bulk terminée → si le bulk 30 j dépassait le budget
  de poll (25 s), bouton ET cron relançaient une nouvelle op à l'infini, zéro commande
  ingérée (P0 audit pré-bêta).
- **Cause racine** : garde d'entrée limitée à RUNNING/CREATED ; téléchargement uniquement
  dans la continuation du poll du même appel.
- **Solution** : décision pure `decideBulkResume` (app/lib/bulkResume.js) à l'ENTRÉE de
  `syncShopOrders` — RUNNING nôtre → poll sans création ; COMPLETED nôtre non ingérée
  (couple id+status DÉJÀ persisté dans order_sync_state) → reprise par le chemin
  d'ingestion existant (extrait en `ingestBulkResult`, partagé) ; COMPLETED d'une autre
  requête → jamais consommée ; statut inconnu → busy (défaut sûr). Reconnaissance par
  marqueurs du champ `query` (verrouillés par lot22 contre le bulkQuery réel). Échec de
  download (URL expirée) → op fraîche dans la même invocation. `maxDuration: 60` sur la
  route app (pattern cron). Preuve empirique 4 invocations sur le dev store (orphelinage,
  reprise même id 0→20, reprise idempotente 20→20, création fraîche delta 0).
- **Limites** : partialDataUrl non consommé ; fenêtre d'une op reprise potentiellement
  périmée de ~24 h (append idempotent) ; cron séquentiel dépense le budget de poll par
  boutique (P1 audit, backlog) ; currentBulkOperation déprécié (migration bulkOperations au
  backlog).

---

## Annexes B (npm test intégral, 22 lots) et C (git diff intégral)

Ajoutées ci-dessous, verbatim et non tronquées. Les caractères de cadre de l'annexe B sont
émis par le harnais de tests du dépôt, cités en bloc de code.

### Annexe B — sortie integrale de npm test (22 lots)

```text
node.exe : npm warn Unknown project config "shamefully-hoist". This will stop working in the next major version of 
npm. See `npm help npmrc` for supported config options.
Au caractère Ligne:1 : 1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (npm warn Unknow...config options.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 

> test
> node tests/lot1_customs.mjs && node tests/lot2_ui_labels.mjs && node tests/lot3_cpa_roas.mjs && node tests/invariants.mjs && node tests/lot4_display_guardrails.mjs && node tests/lot5_variant_costs.mjs && node tests/lot6_order_ingest.mjs && node tests/lot7_order_history.mjs && node tests/lot8_breakdown_backfill.mjs && node tests/lot9_profitability_alert.mjs && node tests/lot10_loss_alert_email.mjs && node tests/lot11_dunning_decision.mjs && node tests/lot12_dunning_email.mjs && node tests/lot13_dunning_status.mjs && node tests/lot14_session_reaper.mjs && node tests/lot15_cpa_targets.mjs && node tests/lot16_plan_entitlement.mjs && node tests/lot17_alerting_decision.mjs && node tests/lot18_audit_classify.mjs && node tests/lot19_recalc_margins.mjs && node tests/lot20_customs_classification.mjs && node tests/lot21_beta_shops.mjs && node tests/lot22_bulk_resume.mjs


── TEST 1 : Stock qty=1 — douane sur CIF plein, plus de seuil ──
  droitsDouane = (40+8) × 5% = 2.4000 € | attendu 2.4000 €
  ✓ Stock qty=1 Sport : droits = 2.4000 € (attendu 2.4000 €)
  ✓ Aucun de minimis en mode stock — droits > 0

── TEST 2 : Stock qty=100 — port divisé, droits sur CIF/unité ──
  shippingPerUnit = 8/100 = 0.0800 €
  droitsDouane = (40+0.08) × 5% = 2.0040 € | attendu 2.0040 €
  ✓ Stock qty=100 : droits = 2.0040 €

── TEST 3 : Dropshipping PRÉ-réforme → 0€ (de minimis) ──
  now=2026-06-16, supplier 2,44€ ≤ 150€ → droitsDouane = 0.0000 €
  ✓ Dropshipping pré-réforme : droits = 0€ (de minimis) | obtenu 0.0000 €

── TEST 4 : Dropshipping POST-réforme → forfait 3€ ──
  now=2026-07-01, supplier 2,44€ ≤ 150€ → droitsDouane = 3.0000 €
  ✓ Dropshipping post-réforme : droits = 3€ | obtenu 3.0000 €

── TEST 5 : Dropshipping haute valeur (200€ > 150€) → tarif % plein, pas 3€ ──
  supplier 200€ > ceiling 150€ → tarif normal : (200+8)×5% = 10.4000 €
  ✓ Haute valeur : droits = 10.4000 € ≠ 3€ forfait
  ✓ Haute valeur : PAS le forfait 3€

── TEST 6 : Cohérence croisée — 4 modules, 0,00€ d'écart ──
  ✓ stock    qty=1  pré | calcNetMargin=25.0167 € audit=25.0167 € écart=0.000000€
  ✓ stock    qty=100 pré | calcNetMargin=33.3327 € audit=33.3327 € écart=0.000000€
  ✓ dropship qty=1  pré | calcNetMargin=27.4167 € audit=27.4167 € écart=0.000000€
  ✓ dropship qty=1  post | calcNetMargin=24.4167 € audit=24.4167 € écart=0.000000€

── TEST 7 : Sanity chaussettes dropshipping post-réforme (~−7,7€) ──
  coutRendu = 2.44 + 8 (qty=1 forcé) + 3€ forfait = 13.4400 €
  revenu HT = 7.9 / 1.20 = 6.5833 €
  marge nette = -7.7123 €
  ✓ Marge chaussettes dropshipping post-réforme -7.7123 € < −7€
  ✓ droitsDouane = 3.0000 € (forfait 3€)
  ✓ coutRendu = coût(2.44) + port(8) + forfait(3) = 13.4400 €

── TEST 8 : Dropshipping ignore qty — fret jamais divisé ──
  ✓ Dropshipping qty=1 et qty=100 donnent même coutRendu (10.4400 € = 10.4400 €)

── TEST 9 : Régression franchise — comportement TVA préservé ──
  ✓ Douane Alimentation stock 200€ = 31.2000 €
  ✓ TVA import 5.5% = 13.1560 €
  ✓ coutRendu franchise = 252.3560 €

══════════════════════════════════════════════════════════════════
 BILAN LOT 1 : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════


── T1 : Threading shippingModel — dropshipping ≠ stock post-réforme ──
  stock marge=25.02 € | dropshipping marge=24.42 € (écart=0.60 €)
  ✓ Dropshipping post-réforme marge < stock (3€ forfait > 2.40€ % sur colis faible valeur)

── T2 : Défauts initiaux = dropshipping ──
  ✓ form.shippingModel initial = dropshipping
  ✓ simForm.shippingModel initial = dropshipping
  ✓ auditParams.shipping_model initial = dropshipping

── T3 : Labels dynamiques prompt IA ──
  ✓ Dropship 40€ pré (faible val) : " (faible valeur, exonéré jusqu'au 30/06/2026)"
  ✓ Dropship 200€ post (haute val) : " (haute valeur, tarif % plein)"
  ✓ Dropship 2.44€ pré: " (faible valeur, exonéré jusqu'au 30/06/2026)"
  ✓ Dropship 2.44€ post (forfait UE) : " (faible valeur, forfait douanier UE depuis le 01/07/2026)"
  ✓ Stock post : label vide ""
  ✓ Notes IA douane : 0 tiret cadratin, 0 « CIF »

── T4 : Labels dynamiques ventilation UI ──
  ✓ Dropship faible val pré : "+ Droits de douane (gratuit jusqu'au 30/06/2026)"
  ✓ Dropship faible val post : "+ Droits de douane (forfait de 3 € par article, réforme UE)"
  ✓ Dropship haute val post : "+ Droits de douane (5 % sur le produit + port)"
  ✓ Stock pré : "+ Droits de douane (5 % sur le produit + port)"
  ✓ Libellés ventilation douane : 0 'de minimis'/'150'/'CIF'/tiret cadratin

── T5 : Non-régression — résultats Lot 1 identiques ──
  ✓ Pré-réforme droits = 0€
  ✓ Pré-réforme marge -4.71 € < 0 (port 8€ dépasse la vente 7,90€)
  ✓ Pré-réforme moins négative que post (-4.71 € > -7.71 €)
  ✓ Post-réforme marge -7.71 € < −7€

══════════════════════════════════════════════════════════════════
 BILAN LOT 2 : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════


── TEST 1 : Cas réel — valeurs de l'énoncé ──
  revenu HT     = 41.6583 € (49.99 / 1.20)
  CPA max AVANT = 10.7600 € (bug — TTC)
  CPA max APRÈS = 2.4283 € (fix — HT)
  ROAS AVANT    = 4.65x | ROAS APRÈS = 20.59x
  ✓ CPA max bug = 10.76€ (reproduit) | obtenu 10.7600 €
  ✓ CPA max fix = 2.43€ (corrigé)   | obtenu 2.4283 €
  ✓ ROAS fix = ~20.6x               | obtenu 20.59x
  ✓ ROAS bug = ~4.65x (reproduit)   | obtenu 4.65x
  ✓ Écart CPA = TVA collectée (8.3317 €) ← signature du bug

── TEST 2 : Réconciliation CPA max = margeNette (ads=0) ──
  Sport/Chine/assujetti/stock | margeNette=5.1758 € cpaMax=5.1758 € diff=0.000000€
  ✓ Sport/Chine/assujetti/stock : CPA max = margeNette au centime
  Textile/Chine/assujetti/dropship | margeNette=3.5758 € cpaMax=3.5758 € diff=0.000000€
  ✓ Textile/Chine/assujetti/dropship : CPA max = margeNette au centime
  Alimentation/Chine/franchise/stock | margeNette=8.5198 € cpaMax=8.5198 € diff=0.000000€
  ✓ Alimentation/Chine/franchise/stock : CPA max = margeNette au centime
  Sport/Chine/assujetti/taxesIncl=F | margeNette=13.0909 € cpaMax=13.0909 € diff=0.000000€
  ✓ Sport/Chine/assujetti/taxesIncl=F : CPA max = margeNette au centime

── TEST 3 : Frais TTC inchangés — seul revenu passe en HT ──
  ✓ Shopify 2% = 2.00€ sur TTC (2.0000 €)
  ✓ Stripe 1.5%+0.25 = 1.75€ sur TTC (1.7500 €)
  ✓ revenu (83.3333 €) < prixVente TTC (100.0000 €)
  ✓ revenu = prixVente/1.20 (83.3333 €)

── TEST 4 : ROAS = prixVente (TTC) / CPA_max ──
  ✓ ROAS = prixVente(TTC) / CPA_max = 100/50.1833 € = 1.99x
  ✓ ROAS TTC (1.99x) > ROAS HT (1.66x) — TTC dénominateur standard

── TEST 5 : Non-régression Lot 1 + Lot 2 — marges inchangées ──
  ✓ Assujetti stock : margeNette finie et positive (25.0167 €)
  ✓ Franchise stock : margeNette finie (30.7700 €)
  assujetti stock margeNette=25.0167 € | franchise stock margeNette=30.7700 €
  ✓ Lot 1 dropship pré    : margeNette=27.4167 € (attendu ~27.42€)
  ✓ Lot 1 dropship post < pré (3€ forfait) : 24.4167 € < 27.4167 €
  ✓ CPA=margeNette assujetti stock : 25.0167 € = 25.0167 €
  ✓ CPA=margeNette franchise : 30.7700 € = 30.7700 €
  ✓ CPA=margeNette dropship pré : 27.4167 € = 27.4167 €
  ✓ CPA=margeNette dropship post : 24.4167 € = 24.4167 €

══════════════════════════════════════════════════════════════════
 BILAN LOT 3 (CPA) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════


── A1 : Cohérence computeMargin = calcNetMargin = computeScenarios.current (PRE + POST) ──
  ✓ [PRE] assujetti/stock/Sport : canon=22.0167 € calc=22.0167 € scen=22.0167 €
  ✓ [PRE] assujetti/stock/Alimentation : canon=28.0974 € calc=28.0974 € scen=28.0974 €
  ✓ [PRE] assujetti/stock/Autre : canon=22.9767 € calc=22.9767 € scen=22.9767 €
  ✓ [PRE] assujetti/stock/Textile : canon=18.6567 € calc=18.6567 € scen=18.6567 €
  ✓ [PRE] assujetti/dropshipping/Sport : canon=24.4167 € calc=24.4167 € scen=24.4167 €
  ✓ [PRE] assujetti/dropshipping/Alimentation : canon=35.2974 € calc=35.2974 € scen=35.2974 €
  ✓ [PRE] assujetti/dropshipping/Autre : canon=24.4167 € calc=24.4167 € scen=24.4167 €
  ✓ [PRE] assujetti/dropshipping/Textile : canon=24.4167 € calc=24.4167 € scen=24.4167 €
  ✓ [PRE] franchise/stock/Sport : canon=27.7700 € calc=27.7700 € scen=27.7700 €
  ✓ [PRE] franchise/stock/Alimentation : canon=30.0140 € calc=30.0140 € scen=30.0140 €
  ✓ [PRE] franchise/stock/Autre : canon=28.9220 € calc=28.9220 € scen=28.9220 €
  ✓ [PRE] franchise/stock/Textile : canon=23.7380 € calc=23.7380 € scen=23.7380 €
  ✓ [PRE] franchise/dropshipping/Sport : canon=30.6500 € calc=30.6500 € scen=30.6500 €
  ✓ [PRE] franchise/dropshipping/Alimentation : canon=37.6100 € calc=37.6100 € scen=37.6100 €
  ✓ [PRE] franchise/dropshipping/Autre : canon=30.6500 € calc=30.6500 € scen=30.6500 €
  ✓ [PRE] franchise/dropshipping/Textile : canon=30.6500 € calc=30.6500 € scen=30.6500 €
  ✓ [POST] assujetti/stock/Sport : canon=22.0167 € calc=22.0167 € scen=22.0167 €
  ✓ [POST] assujetti/stock/Alimentation : canon=28.0974 € calc=28.0974 € scen=28.0974 €
  ✓ [POST] assujetti/stock/Autre : canon=22.9767 € calc=22.9767 € scen=22.9767 €
  ✓ [POST] assujetti/stock/Textile : canon=18.6567 € calc=18.6567 € scen=18.6567 €
  ✓ [POST] assujetti/dropshipping/Sport : canon=21.4167 € calc=21.4167 € scen=21.4167 €
  ✓ [POST] assujetti/dropshipping/Alimentation : canon=32.2974 € calc=32.2974 € scen=32.2974 €
  ✓ [POST] assujetti/dropshipping/Autre : canon=21.4167 € calc=21.4167 € scen=21.4167 €
  ✓ [POST] assujetti/dropshipping/Textile : canon=21.4167 € calc=21.4167 € scen=21.4167 €
  ✓ [POST] franchise/stock/Sport : canon=27.7700 € calc=27.7700 € scen=27.7700 €
  ✓ [POST] franchise/stock/Alimentation : canon=30.0140 € calc=30.0140 € scen=30.0140 €
  ✓ [POST] franchise/stock/Autre : canon=28.9220 € calc=28.9220 € scen=28.9220 €
  ✓ [POST] franchise/stock/Textile : canon=23.7380 € calc=23.7380 € scen=23.7380 €
  ✓ [POST] franchise/dropshipping/Sport : canon=27.0500 € calc=27.0500 € scen=27.0500 €
  ✓ [POST] franchise/dropshipping/Alimentation : canon=34.4450 € calc=34.4450 € scen=34.4450 €
  ✓ [POST] franchise/dropshipping/Autre : canon=27.0500 € calc=27.0500 € scen=27.0500 €
  ✓ [POST] franchise/dropshipping/Textile : canon=27.0500 € calc=27.0500 € scen=27.0500 €

── A2 : CPA max = marge nette quand ads=0 ──
  ✓ assujetti/stock : CPA=22.0167 € margeNette=22.0167 €
  ✓ assujetti/dropshipping : CPA=21.4167 € margeNette=21.4167 €
  ✓ franchise/stock : CPA=27.7700 € margeNette=27.7700 €
  ✓ franchise/dropshipping : CPA=27.0500 € margeNette=27.0500 €
  ✓ ads=10% : margeNette(12.0167 €) = CPA(22.0167 €) − adsCost(10.0000 €)

── A3 : marge assujetti+TTC < marge franchise (toutes choses égales) ──
  ✓ Sport : assujetti 22.0167 € < franchise 27.7700 €
  ✓ Alimentation : assujetti 28.0974 € < franchise 30.0140 €
  ✓ Autre : assujetti 22.9767 € < franchise 28.9220 €
  ✓ Textile : assujetti 18.6567 € < franchise 23.7380 €

── A4 : dropshipping — douane post-réforme ≥ pré-réforme ──
  ✓ Sport/2.44€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Sport/40€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Sport/200€ : douane pré=10.4000 € → post=10.4000 €
  ✓ Alimentation/2.44€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Alimentation/40€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Alimentation/200€ : douane pré=31.2000 € → post=31.2000 €
  ✓ Autre/2.44€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Autre/40€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Autre/200€ : douane pré=6.2400 € → post=6.2400 €
  ✓ Textile/2.44€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Textile/40€ : douane pré=0.0000 € → post=3.0000 €
  ✓ Textile/200€ : douane pré=24.9600 € → post=24.9600 €

── A5 : stock — coût rendu/unité non-croissant en qty ──
  ✓ Sport : coutRendu qty 1≥10≥100 = 50.4000 € ≥ 42.8400 € ≥ 42.0840 €
  ✓ Alimentation : coutRendu qty 1≥10≥100 = 55.2000 € ≥ 46.9200 € ≥ 46.0920 €
  ✓ Autre : coutRendu qty 1≥10≥100 = 49.4400 € ≥ 42.0240 € ≥ 41.2824 €
  ✓ Textile : coutRendu qty 1≥10≥100 = 53.7600 € ≥ 45.6960 € ≥ 44.8896 €

── A6 : aucune sortie NaN/Infinity (cas dégénérés inclus) ──
  ✓ cas dégénéré #1 (qty=0, pa=40, pv=100) → toutes sorties finies
  ✓ cas dégénéré #2 (qty="", pa=40, pv=100) → toutes sorties finies
  ✓ cas dégénéré #3 (qty="abc", pa=40, pv=100) → toutes sorties finies
  ✓ cas dégénéré #4 (qty=undefined, pa=0, pv=100) → toutes sorties finies
  ✓ cas dégénéré #5 (qty=undefined, pa=40, pv=0) → toutes sorties finies
  ✓ cas dégénéré #6 (qty=undefined, pa=0, pv=0) → toutes sorties finies
  ✓ cas dégénéré #7 (qty=0, pa=40, pv=100) → toutes sorties finies

── B : Ancres chiffrées ──
  ✓ B1 stock/assujetti = 25.0167 € (ancre 25.02)
  ✓ B2 stock/franchise = 30.7700 € (ancre 30.77)
  ✓ B3 dropship/post = -7.7123 € (ancre -7.71)
  ✓ B3 douane = forfait 3.0000 €
     coutRendu=24.6288 € revenu=41.6583 € shopify=0.9998 € stripe=0.9999 €
  ✓ B4 coutRendu = 24.6288 € (attendu 24,63)
  ✓ B4 margeNette = 2.4299 € (ancre 2.43)
  ✓ B4 CPA max = 2.4299 € (ancre 2.43)
  ✓ B4 ROAS = 20.57x (ancre 20.6x)

── Transitif : adaptateur audit == canonique (mêmes intrants logiques) ──
  ✓ assujetti/stock : canon=25.0167 € audit=25.0167 €
  ✓ assujetti/dropshipping : canon=24.4167 € audit=24.4167 €
  ✓ franchise/stock : canon=30.7700 € audit=30.7700 €
  ✓ franchise/dropshipping : canon=30.0500 € audit=30.0500 €

══════════════════════════════════════════════════════════════════
 INVARIANTS : ✓ 76 assertions OK
══════════════════════════════════════════════════════════════════


── BUG 2 : cpaAdvice ne nomme aucune plateforme Difficile (balayage ROAS) ──
  ✓ aucun conseil ne nomme une plateforme Difficile sur 116 ROAS testés
  ✓ roasPhrase ne nomme jamais une plateforme Difficile sur 116 ROAS testés
  ✓ le balayage couvre les trois verdicts (Difficile, Limite, Viable)

── BUG 1 : marge brute du payload IA = m.margeBrute (assujetti + taxesIncluded) ──
  ✓ pré-condition : base HT ≠ base TTC (sinon le test ne prouve rien) — HT 32,93 € vs TTC 49,60 €
  ✓ le payload cite la marge brute moteur 32,93 €
  ✓ le payload ne contient PAS la valeur re-dérivée TTC 49,60 €
  ✓ franchise/stock : marge brute citée = moteur (28,87 €)
  ✓ assujetti/non-TTC : marge brute citée = moteur (32,39 €)
  ✓ assujetti/dropship : marge brute citée = moteur (22,66 €)
  ✓ défaut = EUR (rétro-compat : identique à formatEur)
  ✓ devise USD → montants en $, aucun € dans la ligne de marges du prompt

── cpaColor : assert croisé couleur ⟺ conseil (balayage ROAS) ──
  ✓ vert ⟺ le conseil nomme ≥ 1 plateforme (donc non-vert ⟺ organique)
  ✓ rouge ⟺ 3× Difficile ou ROAS irréaliste

── Cohérence des 4 surfaces ROAS (couleur chiffre / label / phrase / cpaColor) ──
  ✓ couleur chiffre, label et phrase dérivent tous du même verdict agrégé

── Typo : 0 tiret cadratin/demi-cadratin dans conseils & phrases ROAS ──
  ✓ aucun tiret cadratin dans conseil/phrase ROAS sur 116 ROAS

── Bascules cpaColor (PV=100€ pour mémoire) ──
  ROAS  | Meta/TikTok/Google           | couleur | conseil
  1.5   | Meta:V TikTok:V Google:V     | VERT   | nomme plateformes
  2     | Meta:V TikTok:L Google:V     | VERT   | nomme plateformes
  2.6   | Meta:L TikTok:D Google:V     | VERT   | nomme plateformes
  2.9   | Meta:L TikTok:D Google:V     | VERT   | nomme plateformes
  3     | Meta:L TikTok:D Google:L     | ORANGE | organique ◄ bascule
  4     | Meta:D TikTok:D Google:L     | ORANGE | organique
  5     | Meta:D TikTok:D Google:L     | ORANGE | organique
  5.1   | Meta:D TikTok:D Google:D     | ROUGE  | organique ◄ bascule
  6.7   | Meta:D TikTok:D Google:D     | ROUGE  | organique
  11    | Meta:D TikTok:D Google:D     | ROUGE  | organique

══════════════════════════════════════════════════════════════════
 BILAN LOT 4 (garde-fous affichage) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── Estimation auto ──
  ✓ prix_achat = unitCost réel (12.5)
  ✓ port = SHIPPING_ESTIMATES[Chine] (8)
  ✓ catégorie mappée depuis productType (Textile)
  ✓ vat/shipping = réglages boutique
  ✓ défauts neutres qty=1, emballage=0
  ✓ source = estimated (jamais présenté comme confirmé)
  ✓ unitCost absent → prix_achat 0
  ✓ type non reconnu → catégorie Autre
  ✓ pays invalide → fallback Chine

── Validation ──
  ✓ ligne valide acceptée
  ✓ qty_par_lot parsé en entier
  ✓ ligne invalide rejetée (value null)
  ✓ 7 erreurs distinctes remontées — prix/port/qty/vat/shipping/pays/catégorie (7)
  ✓ prix négatif refusé (message dédié)
  ✓ qty non entière refusée
  ✓ pays hors domaine refusé
  ✓ prix d'achat 0 → ligne refusée (coût fictif)
  ✓ prix 0 → message « Indiquez le prix d'achat fournisseur »
  ✓ prix d'achat > 0 (0,01) accepté
  ✓ enums vat/shipping fermés
  ✓ domaines pays/catégorie = clés moteur

── CSV import / export ──
  ✓ en-tête = CSV_COLUMNS
  ✓ titre avec virgule échappé entre guillemets
  ✓ round-trip : 1 ligne valide, 0 erreur
  ✓ variant_id préservé
  ✓ valeurs persistées correctes
  ✓ 1 ligne valide retenue
  ✓ 2 lignes en erreur rapportées (2)
  ✓ numéros de ligne corrects (3 et 4)
  ✓ en-tête incomplet → erreur claire, rien importé

── buildCostRowsForDisplay : suggestion display-only vs ligne stockée ──
  ✓ toutes les variantes rendues pour l'affichage
  ✓ sans ligne stockée → stored:false (suggestion, jamais offerte à la confirmation douane)
  ✓ suggestion display-only marquée source estimated
  ✓ suggestion : prix_achat reflète le unitCost Shopify
  ✓ ligne stockée → stored:true, valeurs marchand préservées
  ✓ variante non stockée du même produit → stored:false
  ✓ pur : appels répétés identiques (aucun effet de bord, aucune écriture)

── productCostStatus : complet / partiel / à compléter ──
  ✓ toutes confirmées/importées → complete
  ✓ toutes estimées (suggestion) → à compléter
  ✓ estimée seule / aucune variante → à compléter
  ✓ 1 confirmée sur 3 → « Partiel : 1 variante sur 3 »
  ✓ pluriel « 2 variantes »

══════════════════════════════════════════════════════════════════
 BILAN LOT 5 (coûts par variante) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── F1 : mono-ligne, preuve au centime ──
  ✓ 1 ligne produite
  ✓ unit_net_margin = ancre (216.50 = 216.50)
  ✓ line_net_margin AU CENTIME = ancre (649.25 = 649.25)
  ✓ fixe entier sur mono-ligne (0.25)
  ✓ line_net_revenue = 600×3 (1800.00)
  ✓ effective_qty 3, source confirmed

── F2 : multi-ligne, prorata fixe + remises AfterAll seul ──
  ✓ L2a revenu = AfterAll seul = 45 (45.00), pas 50 ni 40
  ✓ Σ fixe ligne = fixe commande 0.25 (0.25)
  ✓ prorata correct (0.19 / 0.06)
  ✓ L2a line_net_margin AU CENTIME (51.26)
  ✓ L2b line_net_margin AU CENTIME (13.29)

── F3 : refund partiel settled ──
  ✓ refund settled → refunded 1, effective 2 (1/2)
  ✓ line_net_margin sur 2 unités effectives AU CENTIME (432.75)

── F4 : refund non settled → ignoré ──
  ✓ refund PENDING ignoré → effective 3 (3)

── F5 : coûts manquants ──
  ✓ cost_source = missing
  ✓ marges/revenu null (jamais de marge fausse)
  ✓ fixe non imputé sur ligne missing

── F6 : fallback D1 (AfterAll null) ──
  ✓ fallback déclenché quand AfterAll null
  ✓ fallback = original − Σalloc/qty = 45 (45.00)
  ✓ AfterAll présent → 45, pas de fallback, pas d'ajout d'alloc

── Re-stitch (ordre inversé) ──
  ✓ order ← lineItem re-stitché
  ✓ refund ← refundLineItems + transactions re-stitchés
  ✓ effectiveRefundedQty lit l'arbre re-stitché

── Idempotence ──
  ✓ clé (order_id|line_item_id) stable
  ✓ deux ingestions → ligne identique (snapshot figé, zéro diff)

── Clamp effective_qty ≥ 0 ──
  ✓ effective_qty clampé à 0 (0)
  ✓ revenu 0 et marge 0 (fixe prorata 0 car Σrevenu=0)

── C4a : countDistinctOrders ──
  ✓ tableau vide → 0
  ✓ null → 0 (pas de crash)
  ✓ undefined → 0 (pas de crash)
  ✓ non-tableau → 0
  ✓ 3 lignes MÊME order_id → 1 commande (dédup)
  ✓ 3 lignes 3 order_id → 3 commandes
  ✓ mélange (A,A,B) → 2 commandes distinctes
  ✓ order_id null/vide/absent IGNORÉ → 2 (A,B) — jamais de sur-comptage

══════════════════════════════════════════════════════════════════
 BILAN LOT 6 (ingestion commandes) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── [A] agrégat par produit (1 commande à perte n'invalide pas le produit) ──
  ✓ Σ marge P1 = 60 (60)
  ✓ 3 commandes distinctes (3)
  ✓ P1 NON marqué à perte (jugé par produit, pas par ligne)
  ✓ 0 produit à perte

── [A] produit globalement à perte ──
  ✓ P2 Σ marge -25 → à perte (-25)
  ✓ compteur = 1 produit à perte

── [C] coûts manquants exclus des sommes ──
  ✓ 1 ligne missing isolée
  ✓ P3 (missing) absent des agrégats
  ✓ seul P1 agrégé
  ✓ Σ marge = 40 (missing non compté)

── [B] agrégat par jour (UTC) ──
  ✓ 2 jours (2)
  ✓ 10/06 : CA 150, marge 50 (150/50)
  ✓ 11/06 : CA 80, marge 20
  ✓ byDay trié chronologiquement

── [edge] effective_qty=0 ──
  ✓ qty 0, marge 0
  ✓ marge 0 → PAS à perte (pas de perte inventée)

── [edge] CA net = 0 → % marge — ──
  ✓ marginPct null quand CA net = 0

── [edge] product_id null ──
  ✓ produit null regroupé sans crash

── [LISTE] multi-devises signalé ──
  ✓ multiCurrency=true (USD,EUR)

── [DEVISE] format selon la vraie devise ──
  ✓ USD → symbole court $ sans "US" (1 200,00 $)
  ✓ EUR → € (1 200,00 €)
  ✓ GBP → £ (1 200,00 £)
  ✓ devises formatées distinctement
  ✓ montant préservé au centime (729,27)
  ✓ devise nulle/mixte → pas de faux symbole €
  ✓ devise inconnue 'XYZ' ne casse pas (50,00 XYZ)

── [edge] entrée vide ──
  ✓ tout vide, aucun crash

── [BREAKDOWN] dépli ligne #1001 réconcilie au centime ──
  ✓ marge : unit×eq − fixe = line (729.27 = 729.27)
  ✓ cible line_net_margin = 729,27 (stockée)
  ✓ revenu : nur×eq = line (1200.00 = 1200)
  ✓ mécanique D4 : 1 remboursé → eq 2 (pas un poste €)
  ✓ snapshot figé exposé en contexte (intrants saisis)

── [F2] multi-snapshots : dépli par ligne, jamais fondu ──
  ✓ 2 lignes dépliables (2)
  ✓ chaque ligne garde SON snapshot (10 ≠ 12)
  ✓ chaque ligne réconcilie au centime indépendamment
  ✓ Σ marge produit = somme des lignes (13.85)

── [F4] CTA complétude en variantes (jamais 1 sur 1) ──
  ✓ numérateur = 1 variante à confirmer (1)
  ✓ dénominateur = 2 variantes avec commandes (2)
  ✓ → '1 sur 2', JAMAIS '1 sur 1'

── [F3] CTA : variante 'missing' comptée au numérateur ET dénominateur ──
  ✓ dénominateur inclut la variante missing (2)
  ✓ numérateur = la variante missing (1)
  ✓ ligne missing toujours isolée des agrégats

── [F9] graphe < 2 points (donnée) ──
  ✓ 1 seule journée → byDay length 1 (déclenche le message F9) (1)

── [K] agrégation des postes de coût (BUG 1 : somme de valeurs stockées) ──
  ✓ douane agrégée = 3×2 + 3×1 = 9 (poste_unité × effective_qty)
  ✓ shopifyCost agrégé = 3
  ✓ coutRendu agrégé = 20×3 = 60
  ✓ breakdownAvailable true (les lignes ont un détail)
  ✓ aucun breakdown → breakdownAvailable false, postes à 0

── [GROUP] regroupement par décomposition identique ──
  ✓ 3 commandes identiques → 1 groupe (1)
  ✓ le groupe compte ses 3 commandes
  ✓ p.lines brut conservé (3) — le regroupement n'écrase pas le détail
  ✓ commandes triées récentes d'abord (2026-06-12,2026-06-11,2026-06-10)
  ✓ ce qui VARIE (qté) reste listé par commande
  ✓ le représentant porte la marge unitaire commune (5) — affichée une fois

── [GROUP] snapshots différents → groupes séparés ──
  ✓ coûts figés différents (10 vs 12) → 2 groupes (2)
  ✓ chaque groupe = 1 commande (décompositions distinctes non fondues)

── [GROUP] sérialisation stable (ordre des clés indifférent) ──
  ✓ mêmes valeurs, clés dans un ordre différent → une seule empreinte (1 groupe)

── [GROUP] exhaustivité du regroupement ──
  ✓ Σ commandes des groupes = 3 lignes en entrée (3)
  ✓ USD×2 groupées, EUR séparée (devise dans l'empreinte) → 2 groupes
  ✓ groupes triés par commande la plus récente d'abord

── [CENTIME] somme des produits = total, à 3 niveaux ──
  ✓ niveau 1 : Σ lignes dépli = marge produit PΣ (30.03)
  ✓ PΣ = 3 × 10,006 arrondis à la ligne = 30,03, pas 30,02 (30.03)
  ✓ niveau 2 : Σ produits = total marge (40.05)
  ✓ total = 30,03 + 10,02 = 40,05 (40.05)
  ✓ niveau 3 : Σ produits = total CA net (40.05)

── [R] computeCostReliability : X %, missing à part, top-3 par unités ──
  ✓ X % = 50 (100 sûrs / 200 chiffrés) — reçu 50
  ✓ dénominateur = chiffré (200), numérateur = confirmé+importé (100)
  ✓ missing compté à part (P4), jamais dans le %
  ✓ top à compléter = seulement estimated+missing (P3, P4)
  ✓ 1er = P4 (9 unités), status missing (marge inconnue)
  ✓ 2e = P3 (3 unités), status estimated
  ✓ tout-missing → reliabilityPct null (pas de division 0/0)
  ✓ tout-missing → 2 produits à renseigner, ventes présentes
  ✓ 100 % → aucun produit à compléter
  ✓ aucune vente → null, hasSales false

══════════════════════════════════════════════════════════════════
 BILAN LOT 7 (historique monitor) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── REF #1001 : Σ postes = unit_net_margin 364,76 ──
  ✓ Σ postes = 364,76 (364.76)
  ✓ store US → shop_taxes_included = false (pas de TVA collectée)
  ✓ douane/tvaImport exposés séparément dans le JSON

── NATIF : breakdown figé à l'ingestion, réconcilie ──
  ✓ margin_breakdown_json peuplé nativement
  ✓ Σ postes = unit_net_margin stocké (364.76 = 364.76)
  ✓ total #1001 reproduit = 364,76 (364.76)
  ✓ shop_taxes_included false figé (store US)

── NATIF FR : shop_taxes_included true, revenu HT ──
  ✓ shop_taxes_included = true figé (boutique FR TTC)
  ✓ revenu = HT < 60 TTC (50.00) — TVA collectée hors marge
  ✓ Σ postes = unit_net_margin (30.60 = 30.60)

── MISSING : pas de breakdown ──
  ✓ ligne missing → margin_breakdown_json null

── RE-RUN auto-validant : OK quand rien n'a dérivé ──
  ✓ re-run OK (réglages inchangés)
  ✓ breakdown rejoué réconcilie au unit_net_margin stocké (364.76 = 364.76)
  ✓ ligne d'entrée NON mutée (lecture pure)

── RE-RUN auto-validant : SKIP quand un taux a dérivé ──
  ✓ SKIP reconcile_mismatch (rejoué 346.76 ≠ stocké 364.76)

── RE-RUN : ligne sans coût figé → no_snapshot ──
  ✓ no_snapshot (rien à rejouer)

── Déterminisme du re-run ──
  ✓ deux re-runs → breakdown identique (déterministe)

── WATERFALL #1001 : Σ niveau 1 = unit_net_margin, tvaImport non déduit ──
  ✓ Σ niveau 1 = 364,76 (364.76)
  ✓ aucune TVA en déduction niveau 1 (W1)
  ✓ tvaImport informatif 42,85 (avancée puis récupérée)
  ✓ sous-détail coutRendu : douane seule (tvaNetCost=0 → pas de TVA non récupérable)
  ✓ note TVA collectée ABSENTE (store US, shop_taxes_included=false)
  ✓ libellé revenu neutre (pas 'HT' sur boutique sans TVA)
  ✓ adsCost jamais en déduction (pas de 'pub 0 €')

── WATERFALL W1 (franchise) : tvaImport DANS coutRendu, jamais doublé ──
  ✓ Σ niveau 1 = unit_net_margin 26,50 SANS ajouter tvaImport (26.50)
  ✓ tvaImport PAS une déduction niveau 1 (déjà dans coutRendu)
  ✓ sous-détail : TVA import non récupérable 14 € (dans coutRendu)
  ✓ PAS de libellé 'récupérée' en franchise (ne ment pas au marchand)

── WATERFALL W3 : gate note TVA collectée ──
  ✓ assujetti + taxesIncluded=true → note présente + libellé HT
  ✓ taxesIncluded=false → note absente (#1001)
  ✓ franchise → note absente (pas de TVA collectée)
  ✓ W4 : breakdown null (ligne pré-B) → pas de waterfall, pas de note

══════════════════════════════════════════════════════════════════
 BILAN LOT 8 (persistance breakdown) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── rentable → perte ──
  ✓ 1 basculement
  ✓ from profitable → to loss
  ✓ product_id + margin portés
  ✓ ni seed ni maj

── perte → rentable ──
  ✓ loss → profitable

── inchangé (les deux signes) ──
  ✓ aucun basculement
  ✓ 2 maj normales
  ✓ aucun seed

── nouveau produit → seed silencieux ──
  ✓ P5 en seed (state loss)
  ✓ pas d'alerte sur un produit jamais vu

── premier passage : prevStateMap vide ──
  ✓ tous seedés, aucun mail au premier run
  ✓ seeds portent product_id (pas id brut)

── exclusion multi-devises (MIXED) ──
  ✓ produit MIXED absent des 3 listes

── exclusion product_id null ──
  ✓ product_id null ignoré

── mélange réaliste ──
  ✓ A bascule (rentable→perte)
  ✓ B inchangé
  ✓ C seedé (nouveau)
  ✓ D (MIXED) exclu partout

── produit absent de current (état stocké conservé, zéro alerte) ──
  ✓ aucun basculement (pas de fausse alerte rentable)
  ✓ ni seed ni maj — l'état stocké est laissé tel quel par l'appelant

── seuil 15 % : marge 20 % > seuil → profitable ──
  ✓ aucun basculement (20 % ≥ 15 %)
  ✓ état profitable conservé

── seuil 15 % : marge 8 % (>0) < seuil → bascule loss ──
  ✓ bascule profitable → loss bien que marge > 0
  ✓ margin + marginPct portés (pour le mail)

── seuil 15 % : marge < 0 → loss ──
  ✓ marge négative → loss

── frontière stricte : marge == (T/100)×CA ──
  ✓ marge = 15 % pile = seuil → profitable (comparaison stricte <)

── CA = 0 & marge < 0, seuil 15 % → loss (pas de /0) ──
  ✓ CA=0 & marge<0 → loss
  ✓ marginPct null quand CA=0 (jamais NaN/Infinity)

── NON-RÉGRESSION : seuil = 0 == perte stricte legacy ──
  ✓ seuil 0 : marge 8 % reste profitable (perte STRICTE)
  ✓ param par défaut ≡ thresholdPct=0 (bit pour bit)
  ✓ comportement legacy intact (X rentable→perte, Y inchangé)

══════════════════════════════════════════════════════════════════
 BILAN LOT 9 (alerting diff état) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── ligne 1 imposée + objet ──
  ✓ objet mène avec la perte (demo.myshopify.com : 1 produit vendu à perte)
  ✓ objet FACTUEL sans emoji (anti-spam)
  ✓ objet : singulier correct
  ✓ ligne 1 imposée présente en HTML ET texte
  ✓ section retours au-dessus de l'objectif présente
  ✓ titres produits affichés
  ✓ plus de jargon 'marge nette cumulée'
  ✓ typo : le gabarit n'ajoute aucun tiret cadratin/demi-cadratin

── liste par produit : marge + écart vs objectif ──
  ✓ ligne 1 : pluriel « 2 produits sont »
  ✓ Tasse (perte) : préfixe « vendu à perte » + marge + % + écart 24 points
  ✓ Carnet : marge + % + écart 7 points
  ✓ produits présents en HTML

── poste de coût dominant + suffixe douane ──
  ✓ ligne perte : préfixe « vendu à perte » + marge
  ✓ poste dominant réinjecté (achat/port + surcharge)
  ✓ suffixe « (taux de douane estimé) » présent (texte + HTML, parité)

── suffixe douane : conditions négatives ──
  ✓ douane confirmée → aucun suffixe
  ✓ poste dominant ≠ douane → aucun suffixe (même si estimé)

── fallback : détail de coûts absent ──
  ✓ note fallback présente (explique l'absence + remède)
  ✓ aucune ligne de poste dominant (topCost absent)
  ✓ note fallback aussi en HTML (parité)
  ✓ breakdown dispo → aucune note fallback

── cause + contrat de déclenchement ──
  ✓ cause en une ligne présente (HTML + texte)
  ✓ la cause cite VOLONTAIREMENT la fenêtre 30 jours (contrat de calcul)
  ✓ contrat de déclenchement : la condition présente (HTML + texte)
  ✓ contrat : l'instruction de mise à jour des coûts présente
  ✓ aucun verbe d'action sur la marge (constat, pas conseil)
  ✓ aucune causalité inventée

── retours au-dessus de l'objectif, seuls ──
  ✓ ligne 1 adaptée : repassé au-dessus
  ✓ aucune mention « sous l'objectif » quand il n'y a que des retours

── pertes seules ──
  ✓ sous objectif seul, pas de section retours

── fallback nom produit ──
  ✓ titre absent → 'Produit 4242'

── devise par produit ──
  ✓ EUR formaté en €

── marge % absente ──
  ✓ marge % absente → montant seul, aucun écart inventé

── texte brut ≡ HTML : mêmes chiffres ──
  ✓ html ET texte non vides (jamais HTML-only)
  ✓ « -4,05 » présent dans le HTML ET le texte
  ✓ « -3,0 » présent dans le HTML ET le texte
  ✓ « 729,27 » présent dans le HTML ET le texte
  ✓ « 60,8 » présent dans le HTML ET le texte
  ✓ « 19,2 points » présent dans le HTML ET le texte

── dark mode : fond + texte explicites, bouton contrasté ──
  ✓ conteneur : fond blanc EXPLICITE (jamais inversé en dark)
  ✓ corps : couleur de texte foncée EXPLICITE avec !important
  ✓ bouton : fond plein + texte blanc EXPLICITES
  ✓ lien de repli : couleur EXPLICITE (jamais un bleu illisible en dark)

── lien app : parité HTML/texte + envoi jamais bloqué ──
  ✓ appUrl fourni → lien dans le HTML ET le texte (parité)
  ✓ libellé de bouton « Voir le suivi de marge » (HTML, inchangé)
  ✓ libellé + lien en texte brut
  ✓ appUrl absent → aucun lien d'app (ni HTML ni texte)
  ✓ email rendu QUAND MÊME sans lien (envoi jamais bloqué)

══════════════════════════════════════════════════════════════════
 BILAN LOT 10 (mail alerte) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── frozen, sous plafond, cadence écoulée ──
  ✓ 1re relance (jamais relancé) → send_dunning
  ✓ count 2, dernier envoi il y a 3 j → send_dunning
  ✓ count 4 (< plafond) → send_dunning

── frozen, cadence pas écoulée ──
  ✓ dernier envoi il y a 2 j (<3) → nothing
  ✓ envoyé aujourd'hui → nothing

── PIÈGE plafond : frozen, count >= 5 ──
  ✓ count 5 = plafond → nothing (même très espacé)
  ✓ count 9 > plafond → nothing
  ✓ constantes : plafond 5 / espacement 3 j

── active après relances → resolved ──
  ✓ paiement régularisé pendant le dunning → send_resolved
  ✓ résolu même au plafond → send_resolved

── PIÈGE : active jamais relancé → silence ──
  ✓ active sain (count 0) → nothing, jamais de mail intempestif

── PIÈGE : cancelled → stop définitif ──
  ✓ cancelled pendant dunning → stop_cancelled (pas send_dunning)
  ✓ cancelled → stop_cancelled

── statuts neutres (pending, expired, inconnu) ──
  ✓ pending (charge en attente d'approbation) → nothing
  ✓ expired → nothing
  ✓ statut inconnu → nothing

── frontière cadence : exactement 3 jours ──
  ✓ pile 3 j → send_dunning (comparaison ≥)
  ✓ 3 j moins 1 s → nothing

── robustesse entrées ──
  ✓ state absent → traité comme count 0, jamais relancé → send_dunning
  ✓ state vide → send_dunning

══════════════════════════════════════════════════════════════════
 BILAN LOT 11 (décision dunning) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── relance : lien de régularisation présent ──
  ✓ lien présent dans le HTML (bouton + lien copiable)
  ✓ lien présent dans le texte brut
  ✓ lien cliquable (href)
  ✓ sujet factuel : paiement échoué (Le paiement de votre abonnement True Cost Calculator a échoué)
  ✓ plan nommé (le bon plan)

── accès maintenu, coupure à venir, honnête, aucun dark pattern ──
  ✓ aucune affirmation de verrouillage actuel (faux : rien n'est coupé en grâce)
  ✓ ne prétend pas que l'abonnement/accès est déjà inactif
  ✓ vérité : l'accès continue pendant la grâce
  ✓ coupure présentée comme conditionnelle / à venir, pas actuelle
  ✓ rassurance données conservées (pas de dark pattern par peur)
  ✓ pas d'attribution fausse à Shopify (frozen ≠ coupure Shopify)
  ✓ échéance honnête (délai selon Shopify), aucune fausse date inventée
  ✓ aucun terme dark-pattern (trouvés: aucun)
  ✓ aucun mot en CAPITALES

── Chantier B suite : mail conditionnel à l'âge du gel ──
  ✓ gel 5 j (grâce en cours) → 'accès continue', pas de suspension
  ✓ gel 30 j (grâce expirée) → ABSENCE de 'votre accès continue' (fin de la contre-vérité)
  ✓ gel 30 j → 'est maintenant suspendu' (état réel)
  ✓ gel 30 j → rétablissement dès régularisation (aidant)
  ✓ gel 30 j → confirmationUrl TOUJOURS présent (action principale)
  ✓ gel 30 j → aucun terme dark-pattern
  ✓ gel 30 j → pas de fausse attribution à Shopify
  ✓ gel 30 j → aucun mot en CAPITALES
  ✓ pile à 28 j → borne INCLUSIVE = encore en grâce (comme la borne d'entitlement D2)
  ✓ frozenSince null → défaut SÛR 'accès continue' (jamais annoncer une suspension à tort)
  ✓ parité branche grâce : fragment dans HTML ET texte
  ✓ parité branche suspension : « est maintenant suspendu… » dans HTML ET texte
  ✓ parité branche suspension : « rétabli dès que votre pa… » dans HTML ET texte
  ✓ parité branche suspension : « https://demo.myshopify.c… » dans HTML ET texte

── resolved : sobre ──
  ✓ sujet : c'est réglé / accès rétabli (C'est réglé : votre accès est rétabli)
  ✓ corps : abonnement réactivé + merci
  ✓ pas de lien de charge dans le 'resolved' (rien à régulariser)

── plan absent (fallback neutre) ──
  ✓ fallback 'votre abonnement' + lien conservé

── texte brut ≡ HTML ──
  ✓ relance : html ET texte non vides (jamais HTML-only)
  ✓ « https://demo.myshopify.com/a… » dans le HTML ET le texte
  ✓ « True Cost Calculator Pro… » dans le HTML ET le texte
  ✓ « votre accès à True Cost Calc… » dans le HTML ET le texte
  ✓ « Vos données sont conservées… » dans le HTML ET le texte
  ✓ resolved : html ET texte non vides, 'réactivé' dans les deux

── typo : 0 tiret cadratin dans les mails dunning ──
  ✓ relance/grâce : 0 tiret cadratin (sujet/html/texte)
  ✓ relance/suspension : 0 tiret cadratin (sujet/html/texte)
  ✓ resolved : 0 tiret cadratin (sujet/html/texte)

══════════════════════════════════════════════════════════════════
 BILAN LOT 12 (mail dunning) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── frozen au milieu de l'historique bruité ──
  ✓ statut = frozen malgré 5 lignes de bruit
  ✓ frozenNode = le sub gelé (bon plan capturé)

── précédence : ACTIVE > FROZEN ──
  ✓ ACTIVE présent → active (gagne sur frozen)
  ✓ pas de frozenNode quand active

── précédence : FROZEN > PENDING ──
  ✓ frozen + pending → frozen (la cadence ≥3j gère l'anti-spam)

── pending seul ──
  ✓ pending + expired → pending

── plus rien d'actif → cancelled ──
  ✓ cancelled/expired/declined → cancelled
  ✓ historique vide → cancelled
  ✓ argument absent → cancelled (robustesse)

── recurringLineItems : même prix/intervalle ──
  ✓ 1 line item récurrent reconstruit
  ✓ amount = 15 (Number, pas string)
  ✓ devise + intervalle préservés

── recurringLineItems : filtrage & robustesse ──
  ✓ pricing non récurrent (usage) ignoré
  ✓ lineItems absent → []
  ✓ node null → [] (pas de crash)

══════════════════════════════════════════════════════════════════
 BILAN LOT 13 (statut + line items dunning) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── nextSessionHealth : succès remet à zéro ──
  ✓ compteur remis à 0
  ✓ first_failure_at effacé (série close)
  ✓ last_success_at = now

── nextSessionHealth : premier échec ──
  ✓ compteur = 1
  ✓ first_failure_at fixé à now
  ✓ last_failure_at = now

── nextSessionHealth : échec suivant ──
  ✓ compteur incrémenté (3 → 4)
  ✓ first_failure_at préservé (pas réécrit)

── shouldReap : pas assez d'échecs ──
  ✓ 9 échecs (< 10) même très ancien → pas de suppression

── shouldReap : trop récent ──
  ✓ 50 échecs mais série vieille de 20 j (< 21) → pas de suppression

── shouldReap : les deux seuils atteints ──
  ✓ 10 échecs ET 21 j → suppression
  ✓ largement au-delà → suppression

── frontières (≥) ──
  ✓ pile 10 / pile 21 j → true
  ✓ 21 j moins 1 s → false

── robustesse ──
  ✓ 99 échecs mais first_failure_at absent → false (ancienneté inconnue)
  ✓ health vide → false
  ✓ aucun argument → false
  ✓ constantes : 10 échecs / 21 j

══════════════════════════════════════════════════════════════════
 BILAN LOT 14 (reaper sessions) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── seuil=0 : marge dispo/unité = net_margin/qty ──
  ✓ 100/4 = 25,00, state 'ok'
  ✓ availableForAds(seuil=0) == net_margin

── seuil 10 % : réserve retirée ──
  ✓ (100 − 10%×200)/4 = 20,00

── machine à 5 états : un cas nommé chacun ──
  ✓ ok : margeDispoUnite > 0
  ✓ no_acquisition : margeDispoUnite < 0 (vend mais marge ≤ 0)
  ✓ value_destroyed : qty=0 & net_margin<0 (remboursé à perte)
  ✓ no_units : qty=0 & net_margin≥0 (remboursement neutre)
  ✓ mixed_currency : devise MIXED

── frontière : availableUnit == 0 → no_acquisition (verrou anti-refactor ≤/<) ──
  ✓ marge dispo/unité pile 0,00 (net_margin == requiredProfit)
  ✓ 0 € de budget = AUCUNE acquisition possible → no_acquisition (≤ 0, pas 'ok')

── exhaustivité : aucun état inattendu ──
  ✓ seuil 0% : tous les états ∈ {5 prévus}
  ✓ seuil 0% : montant ⇔ (ok|no_acquisition), null sinon
  ✓ seuil 10% : tous les états ∈ {5 prévus}
  ✓ seuil 10% : montant ⇔ (ok|no_acquisition), null sinon
  ✓ seuil 50% : tous les états ∈ {5 prévus}
  ✓ seuil 50% : montant ⇔ (ok|no_acquisition), null sinon
  ✓ seuil 100% : tous les états ∈ {5 prévus}
  ✓ seuil 100% : montant ⇔ (ok|no_acquisition), null sinon

── noAcqCount inconditionnel : les deux réalités, un compteur ──
  ✓ noAcqCount = 3 (A no_acquisition + C,D value_destroyed) — un compteur, libellé honnête ; la colonne les distingue
  ✓ catalogue sain → 0 (aucune bannière)
  ✓ value_destroyed seul → compté (jamais sous-estimé)

── A2 : CA=0 & qty>0 → seuil inopérant, capté ──
  ✓ requiredProfit=50%×0=0 (inopérant) ; −6/2=−3 → no_acquisition

── A3 : blended positif mais A saigne ──
  ✓ blended = 100/10 = 10,00 (positif, tentant)
  ✓ A en no_acquisition, compté → bannière inconditionnelle

── blended ──
  ✓ 300/10 = 30,00
  ✓ (300 − 15%×1000)/10 = 15,00
  ✓ multi-devises → null
  ✓ A6 : orders=0 → null (pas de NaN)

── noBudget : plafond blended ≤ 0 (miroir de no_acquisition) ──
  ✓ marge globale négative → cpaMax<0, noBudget true
  ✓ (100 − 20%×1000)/10 = −10 → noBudget true (marge absorbée par le seuil)
  ✓ plafond positif (30) → noBudget false
  ✓ cpaMax exactement 0 → noBudget true (frontière ≤ 0, cohérente margeDispoUnite)

── A7 : seuil 100 % → no_acquisition partout ──
  ✓ (50 − 100%×200)/5 = −30 : conséquence logique d'un seuil absurde

── écart : gapLabel/gapAmount serveur, 0 ≠ null ──
  ✓ déclaré 20 < 30 → 'Marge de manœuvre' 10 (magnitude serveur)
  ✓ déclaré 45 > 30 → 'Dépassement' 15 (magnitude POSITIVE, aucun Math.abs client)
  ✓ A4 : currentCpa=0 (déclaré) → écart plein (30)
  ✓ A4 : currentCpa=null (jamais saisi) → écart null (l'action DOIT mapper '' → null)

── blended : base exposée + lowSample (< 30 commandes) ──
  ✓ orders exposé (1)
  ✓ avgBasket = 2 unités/commande (le plafond par commande en dépend)
  ✓ 1 commande < 30 → lowSample (plafond indicatif, pas fiable)
  ✓ avgBasket = 17 unités / 10 commandes = 1,7 (arrondi serveur)
  ✓ 10 < 30 → lowSample
  ✓ pile 30 commandes → fiable (lowSample false)

── multi-devises → blended ET écart null (même avec CPA déclaré) ──
  ✓ devise ambiguë → pas de plafond ni d'écart (l'UI ne compare pas dans le vide)

── écart.stale : fraîcheur du CPA déclaré ──
  ✓ déclaré il y a 5 j (< 30) → frais
  ✓ déclaré il y a 40 j (≥ 30) → stale (grisé)
  ✓ pile 30 j → stale (≥)
  ✓ date absente → stale (fraîcheur invérifiable)

══════════════════════════════════════════════════════════════════
 BILAN LOT 15 (CPA prescriptif) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── ACTIVE ──
  ✓ Pro ACTIVE → isPro, pas Expert
  ✓ Expert ACTIVE → isPro ET isExpert

── FROZEN : accès maintenu dans la grâce ──
  ✓ Pro FROZEN (grâce en cours) → isPro = true (plus de rétrogradation au 1er échec)
  ✓ Pro FROZEN → pas Expert
  ✓ Expert FROZEN → isPro ET isExpert

── D2 : borne de la grâce FROZEN ──
  ✓ FROZEN depuis 10 j (< 28) → encore isPro
  ✓ FROZEN pile à 28 j → encore isPro (borne inclusive)
  ✓ FROZEN depuis 33 j → grâce expirée → free
  ✓ FROZEN sans frozen_since → grâce accordée

── D3 : alias de noms (robustesse au renommage) ──
  ✓ sub sous ancien nom + alias conservé → toujours isPro
  ✓ nom inconnu (hors ensemble) → free

── statuts NON entitlants → free ──
  ✓ Pro CANCELLED → free (ni isPro ni isExpert)
  ✓ Pro EXPIRED → free (ni isPro ni isExpert)
  ✓ Pro DECLINED → free (ni isPro ni isExpert)
  ✓ Pro PENDING → free (ni isPro ni isExpert)
  ✓ aucun abonnement → free

── FROZEN noyé dans le bruit d'historique ──
  ✓ FROZEN Pro compté malgré CANCELLED/EXPIRED/DECLINED autour
  ✓ Expert ACTIVE + vieux Pro CANCELLED → isExpert

── D1 : repli sur dernier plan connu ──
  ✓ cache 'expert' → isPro + isExpert
  ✓ cache 'pro' → isPro seul
  ✓ cache 'free' → free
  ✓ cache absent (null/undefined) → free

── Q1 : échec live + cache vide → indéterminé, pas free ──
  ✓ GraphQL échoué + cache vide → source 'indeterminate'
  ✓ … distinct de 'cache'/'live' : PAS un free dégradé silencieux
  ✓ … n'accorde rien (géré par retry/ErrorBoundary côté appelant, pas rendu free)
  ✓ cache illisible (undefined) → 'indeterminate' aussi
  ✓ cache 'free' CONNU → 'cache' (réellement gratuit), distinct de l'indéterminé
  ✓ cache 'pro' connu → 'cache' + isPro (D1)
  ✓ cache 'expert' connu → 'cache' + isExpert (D1)

── Q3 : boucle de retry bornée (refetch mocké) ──
  ✓ échoue 2× : refetch appelé exactement 2 fois (retries épuisés)
  ✓ … toujours non-live → resolveEntitlement rendra 'indeterminate'
  ✓ … soit bien la branche 'indeterminate' (pas un free dégradé)
  ✓ 1 échec puis succès : refetch appelé 2 fois, s'arrête au succès
  ✓ … enveloppe live obtenue → resolveEntitlement résout en 'live'
  ✓ refetch qui rejette → non-live (pas de crash) → 'indeterminate'
  ✓ budget 500ms / delay 200ms → coupé à 2 tentatives (pas 5) malgré retries=5 (obtenu 2)
  ✓ … budget épuisé → non-live → 'indeterminate' (jamais bloquant)

── D5 : réponse GraphQL réelle → billingIsPro ──
  ✓ extraction : 3 nœuds sortis de l'enveloppe réelle (garde-fou de forme)
  ✓ 1er nœud (reverse:true) = Pro FROZEN courant
  ✓ réponse RÉELLE (Pro FROZEN) → billingIsPro = true de bout en bout
  ✓ … et pas Expert (l'Expert de l'historique est CANCELLED)

── robustesse ──
  ✓ nodes undefined → free (pas de crash)
  ✓ nœuds partiels (name/status manquants) → free
  ✓ réponse null → 0 nœud (pas de crash)
  ✓ enveloppe vide → 0 nœud

── C4a : planToOrderCap + alertingEnabled ──
  ✓ Gratuit → 200 commandes/mois
  ✓ Pro → 1000 commandes/mois
  ✓ Expert → illimité (Infinity)
  ✓ entrée vide (défaut) → 200 (traité comme gratuit)
  ✓ 150 ≤ 200 (sous le palier) → alerting activé
  ✓ 200 == 200 (pile au palier, borne inclusive) → encore activé
  ✓ 201 > 200 (dépassé au mois M) → alerting coupé (M+1)
  ✓ Expert (cap Infinity) → toujours activé quel que soit le volume
  ✓ juillet 2026 → '2026-06' (mois normal)
  ✓ janvier 2026 → '2025-12' (rollover année)
  ✓ décembre 2026 → '2026-11'
  ✓ 31 mars → '2026-02' (jour d'entrée indifférent, pas de débordement)

══════════════════════════════════════════════════════════════════
 BILAN LOT 16 (droit au plan) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── decideAlertAction ──
  ✓ pas de basculement → 'nothing' (même ON + email)
  ✓ pas de basculement → 'nothing' (même OFF, sans email)
  ✓ basculement + OFF (+ email) → 'suppress'
  ✓ basculement + OFF (sans email) → 'suppress'
  ✓ basculement + ON + pas d'email → 'advance_only' (G3)
  ✓ basculement + ON + email → 'send'
  ✓ aucun argument (défaut) → 'nothing'

── shouldAdvanceState (invariant G2) ──
  ✓ 'nothing' → pas d'avance
  ✓ 'suppress' → JAMAIS avancer pendant OFF (zéro alerte perdue, rafale à la reprise)
  ✓ 'advance_only' → avance (G3 : pas d'email mais on avance)
  ✓ 'send' + envoi réussi → avance
  ✓ 'send' + échec envoi → PAS d'avance (réessai demain, invariant G2)
  ✓ 'send' sans sendOk (défaut false) → pas d'avance
  ✓ 'suppress' même avec sendOk=true → pas d'avance (OFF prime)
  ✓ 'advance_only' ignore sendOk → avance quand même

══════════════════════════════════════════════════════════════════
 BILAN LOT 17 (décision alerting) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── auditCategory : frontières au seuil 25 % ──
  ✓ 25 % pile au seuil → winner (borne inclusive, cohérente B7 ≥)
  ✓ 24,99 % → risky (rentable mais sous l'objectif)
  ✓ LE BUG CORRIGÉ : 20 % avec seuil 25 → risky, PAS Top Performer
  ✓ 0 % → risky (rentable au sens strict, sous l'objectif)
  ✓ -0,01 % → loser (perte réelle)
  ✓ 60 % → winner

── seuil 0 : bande risky structurellement vide ──
  ✓ 0 % avec seuil 0 → winner (≥ 0, pas une perte)
  ✓ 0,01 % → winner
  ✓ -0,01 % → loser
  ✓ seuil 0 → aucun produit « à risque » (0 ≤ x < 0 impossible)
  ✓ seuil 0 → tout rentable = winner, seule la perte réelle = loser

── classifyAudit : partition + ordre ──
  ✓ winners = a,d (≥25) dans l'ordre d'entrée
  ✓ risky = b,e (0≤x<25)
  ✓ losers = c (<0)
  ✓ partition exhaustive (aucun produit perdu ni compté deux fois)

── netPct manquant / non fini ──
  ✓ undefined → loser (pas winner par défaut)
  ✓ NaN → loser
  ✓ seuil absent (→0) : 10 % → winner
  ✓ seuil négatif normalisé à 0 : 10 % → winner

── auditLabels : cohérence libellé ≡ calcul ──
  ✓ winners → « marge ≥ 25 % » (pas « > 15 % »)
  ✓ risky → « marge 0 à 25 % »
  ✓ losers → « marge < 0 % »
  ✓ seuil 0 : libellé risky lisible, pas « marge 0 à 0 % » absurde (seuil à 0 %, bande inactive)
  ✓ seuil 0 : winners → « marge ≥ 0 % »
  ✓ seuil décimal formaté FR : « marge ≥ 25,5 % »

══════════════════════════════════════════════════════════════════
 BILAN LOT 18 (classification audit) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── isRecalcableCostSource : recalculable ⇔ estimated|missing ──
  ✓ estimated → recalculable
  ✓ missing → recalculable
  ✓ confirmed → IMMUABLE (autorité marchand)
  ✓ imported → IMMUABLE (CSV marchand)
  ✓ valeur inconnue → IMMUABLE (défaut sûr)
  ✓ null → IMMUABLE
  ✓ undefined → IMMUABLE

── selectDeletableLines : recalculable ∧ fenêtre order_created_at ──
  ✓ ne supprime QUE o1,o2 (recalculables ∧ dans la fenêtre)
  ✓ retourne les LIGNES COMPLÈTES (pour capture/restauration)
  ✓ confirmed/imported/hors-fenêtre/sans-date : tous préservés
  ✓ isDeletableLine : estimated récent → supprimable
  ✓ isDeletableLine : hors fenêtre (order_created_at) → NON supprimable (perte évitée)
  ✓ isDeletableLine : confirmed → jamais supprimable
  ✓ isDeletableLine : sans order_created_at → on garde
  ✓ horloge invalide ⇒ ne rien supprimer
  ✓ rows null ⇒ [] (null-safe)
  ✓ fenêtre 0j ⇒ rien de re-synchronisable
  ✓ fenêtre 60j ⇒ o3 rentre aussi

── touchedProductIds : produits impactés ──
  ✓ p1 (dédupé) + p2 ; product_id null exclu
  ✓ null-safe → set vide

── missingLines : réconciliation capture ↔ présent ──
  ✓ restaure o2,o3 (absentes après sync), pas o1 (recréée)
  ✓ lineKey déterministe
  ✓ lineKey sans collision de concaténation
  ✓ sync KO (rien de présent) → toutes restaurées = rollback complet
  ✓ aucune capture → rien à restaurer

── formatProductNames : troncature 5 ──
  ✓ aucun nom → chaîne vide (l'UI masque la ligne)
  ✓ ≤ 5 → liste simple
  ✓ pile 5 → pas de troncature
  ✓ 6 → 5 + « et 1 autre » (singulier)
  ✓ 8 → 5 + « et 3 autres » (pluriel)
  ✓ vides / non-string ignorés

── buildRecalcSummary : aucun changement ──
  ✓ états identiques → aucun passé à perte
  ✓ états identiques → aucun redevenu rentable
  ✓ lignesRecalculees = lignes de l'état après

── buildRecalcSummary : produits passés à perte ──
  ✓ Tapis + Lampe passés à perte (ordre = apres)
  ✓ Chaise déjà en perte → PAS un basculement
  ✓ resume texte des passés à perte

── buildRecalcSummary : > 5 produits à perte ──
  ✓ les 7 basculements sont bien tous listés (tableau complet)
  ✓ resume tronqué à 5 + « et 2 autres »

── buildRecalcSummary : redevenus rentables ──
  ✓ Tapis redevenu rentable (perte → ≥ 0)
  ✓ aucun passé à perte

── buildRecalcSummary : mix + états inconnus ──
  ✓ seul Tapis bascule en perte (basculement connu-connu)
  ✓ seul Lampe redevient rentable
  ✓ états inconnus (avant absent/non fini) exclus de tout basculement

── buildRecalcSummary : repli de nom + entrées vides ──
  ✓ nom absent → repli « Produit <id> »
  ✓ états vides ⇒ résumé neutre (null-safe)

══════════════════════════════════════════════════════════════════
 BILAN LOT 19 (recalcul marges — décisions pures) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── classificationStatus : true ⇔ confirmée, tout le reste ⇒ estimée ──
  ✓ true → confirmée
  ✓ false → estimée
  ✓ null (miss de jointure) → estimée
  ✓ undefined (legacy) → estimée
  ✓ valeur non-booléenne 1 → estimée (pas de coercition)

── customsRateForCategory : taux TARIC + repli ──
  ✓ Textile → 12 %
  ✓ Sport → 5 %
  ✓ Jouets → 0 %
  ✓ catégorie inconnue → repli 3 %
  ✓ undefined → repli 3 %

── customsRateChanged : basé sur le taux ──
  ✓ Textile 12 % → Sport 5 % : changement
  ✓ Sport → Sport : identique, pas de changement
  ✓ Jouets 0 % → Livres 0 % : MÊME taux → PAS de changement (pas de recalcul à tort)
  ✓ Textile 12 % → Jouets 0 % : changement

── customsIndicator : confirmée ⇒ null ──
  ✓ confirmée → null (aucun indicateur)
  ✓ estimée → libellé « à confirmer »
  ✓ adossé à la nomenclature TARIC (pas de chapitre inventé)

── resolveCustomsConfirmedOnWrite : catégorie changée ⇒ false, identique ⇒ préserve ──
  ✓ changée depuis un flag confirmé → false (le cas import CSV qui écrase)
  ✓ changée depuis estimé → false
  ✓ identique + confirmé → PRÉSERVE true (réécrire la même valeur n'invalide pas)
  ✓ identique + estimé → reste estimé
  ✓ flag absent → estimé
  ✓ newCat undefined + confirmé → PRÉSERVE true (pas de dé-confirmation silencieuse)
  ✓ newCat null + confirmé → PRÉSERVE true
  ✓ newCat undefined + estimé → reste estimé

── resolveAuditCategory : confirmé ⇒ catégorie adoptée + aucun indicateur ──
  ✓ variante confirmée → ADOPTE 'Sport' (≠ mapping 'Textile'), aucun indicateur
  ✓ variante non confirmée → mapping 'Textile' + indicateur
  ✓ variante SANS ligne (trou) → estimé (jamais d'optimisme)
  ✓ vc undefined → estimé
  ✓ produit confirmé : audit et tableau de coûts s'accordent sur la catégorie

── invalidation appliquée par chemin (costs_save / costs_import_csv) ──
  ✓ costs_save : catégorie éditée → classification repasse estimée
  ✓ costs_save : catégorie inchangée → classification préservée
  ✓ costs_import_csv : même catégorie → préservée
  ✓ costs_import_csv : catégorie écrasée → estimée

── frozenClassificationStatus : lecture du champ figé ──
  ✓ snapshot flag true → confirmée
  ✓ snapshot flag false → estimée
  ✓ champ absent (legacy) → estimée
  ✓ snapshot null (missing/legacy) → estimée

── composition : rateChanged ⇒ recalcul ne touche PAS les lignes confirmed ──
  ✓ prérequis : la correction change bien le taux
  ✓ le recalcul ne supprimerait QUE o1 (estimated) + o3 (missing) — o2 confirmed intacte

── email : suffixe douane estimé (pire cas, parité texte/HTML) ──
  ✓ customsEstimated + douane dominante → suffixe présent (texte)
  ✓ … présent aussi en HTML (parité)
  ✓ customsEstimated=false → aucun suffixe
  ✓ poste dominant ≠ douane → aucun suffixe (même si estimé)

── cron : décision de basculement inchangée par customsEstimated ──
  ✓ basculements IDENTIQUES avec/sans customsEstimated (champ inerte)
  ✓ fixture golden : p1→loss, p2→profitable
  ✓ p3 = seed (nouveau) — écriture d'état inchangée

── confirmCustomsCategory : validation + aucune écriture si invalide ──
  ✓ catégorie hors CATEGORIE_KEYS → error explicite, ZÉRO écriture (DB non touchée)
  ✓ productId absent → error, ZÉRO écriture
  ✓ catégorie vide → error, ZÉRO écriture

── applyCustomsInvalidation : chunk 100 + invalidation à cheval ──
  ✓ lookup chunké : 100+50 (pas un seul .in() de 150 GIDs)
  ✓ v0 (chunk 1) catégorie identique → flag PRÉSERVÉ true
  ✓ v149 (chunk 2) catégorie changée → flag false (invalidation correcte à cheval)
  ✓ v5 (chunk 1) sans ligne stockée → estimé (false)

── mergeCustomsFeedback : nudge rateChanged collant ──
  ✓ succès(rc=true) puis succès(rc=false) → rc RESTE true (collant)
  ✓ erreur puis succès(rc=false) → rc=false (l'erreur n'apportait pas de rc)
  ✓ succès(rc=true) puis erreur → erreur affichée (rc perdu, l'erreur prime)
  ✓ next absent → prev conservé
  ✓ chaîne de succès reste un succès

══════════════════════════════════════════════════════════════════
 BILAN LOT 20 (classification douanière) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── T1 : match exact ──
  ✓ liste à une entrée, domaine identique → match
  ✓ liste multiple, entrée au milieu → match
  ✓ liste multiple, entrée en fin → match
  ✓ domaine hors liste → false

── T1 : insensibilité à la casse ──
  ✓ entrée env en majuscules → match
  ✓ domaine session en majuscules → match
  ✓ casse mixte des deux côtés → match

── T1 : espaces parasites ──
  ✓ entrée entourée d'espaces → match
  ✓ espaces autour des virgules → match
  ✓ domaine session avec espaces → match (trim des deux côtés)

── T1 : variable absente, vide, malformée ──
  ✓ BETA_SHOPS absente (undefined) → false, pas de crash
  ✓ BETA_SHOPS null → false
  ✓ BETA_SHOPS vide → false
  ✓ BETA_SHOPS espaces seuls → false
  ✓ virgules seules (entrées vides) → false
  ✓ entrées vides mêlées à une entrée valide → la valide matche
  ✓ entrée malformée (pas un domaine) → inerte par égalité stricte
  ✓ BETA_SHOPS non-string (42) → false
  ✓ BETA_SHOPS non-string (tableau) → false
  ✓ domaine session undefined → false
  ✓ domaine session vide → false
  ✓ domaine session espaces vs entrée vide → false (le vide ne matche jamais le vide)

── T1 : doublons ──
  ✓ entrée dupliquée → match, pas de crash
  ✓ doublons sans le domaine cherché → false

── T1 : jamais de match par suffixe, préfixe ou sous-domaine ──
  ✓ « evil-shop.… » vs entrée « shop.… » → false
  ✓ « shop.… » vs entrée « evil-shop.… » → false (sens inverse)
  ✓ « evilshop.… » (suffixe sans tiret) vs « shop.… » → false
  ✓ entrée tronquée « myshopify.com » ne matche aucun shop complet
  ✓ sous-domaine vs domaine → false
  ✓ domaine vs sous-domaine → false (sens inverse)
  ✓ préfixe (domaine rallongé à droite) → false
  ✓ entrée rallongée à droite → false (sens inverse)
  ✓ troncature d'un caractère → false (égalité stricte)

── T2 : betaTrialOverride (objet étalé dans billing.request) ──
  ✓ BETA_TRIAL_DAYS = 45 (constante unique)
  ✓ shop bêta + Expert → override exactement { trialDays: BETA_TRIAL_DAYS }
  ✓ shop normal + Expert → override {} : l'objet passé à billing.request est INCHANGÉ
  ✓ BETA_SHOPS absente → override {} pour tout shop (défaut sûr prod)
  ✓ fusion config+override : bêta → 45
  ✓ fusion config+override : normal → 7 (config)

── T2/V3 : périmètre du câblage dans le source ──
  ✓ app._index.jsx : exactement UN appel betaTrialOverride (le handler subscribe_expert)
  ✓ les deux handlers subscribe sont localisés dans le source
  ✓ handler Pro : AUCUN override, aucun trialDays → shop bêta + Pro reçoit 7 j (O4)
  ✓ handler Expert : override branché sur session.shop + process.env.BETA_SHOPS (env lue au site d'appel, O2)
  ✓ handler Expert : la ligne isTest est INTACTE (O8 — bêta réelle → test:false)
  ✓ app._index.jsx : aucun trialDays numérique en dur
  ✓ shopify.server.js : la config nominale trialDays: 7 des DEUX plans est intacte
  ✓ shopify.server.js : aucune logique bêta (la config nominale ne bouge pas)
  ✓ betaShops.js : aucune lecture de process.env dans le code (helper PUR, O2)
  ✓ betaShops.js : la valeur 45 n'apparaît qu'une fois dans le code (la constante BETA_TRIAL_DAYS)

══════════════════════════════════════════════════════════════════
 BILAN LOT 21 (allowlist bêta) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════

── T1 : reconnaissance de notre requête ──
  ✓ requête portant les deux marqueurs → nôtre
  ✓ requête d'une autre feature → pas la nôtre
  ✓ query null/vide → pas la nôtre (pas de crash)
  ✓ UN seul marqueur ne suffit pas (les deux exigés)

── T1 : aucune op → create ──
  ✓ aucune op courante → create
  ✓ argument vide → create (chemin actuel)
  ✓ aucun argument → create (pas de crash)

── T1 : RUNNING/CREATED → poll (nôtre) ou busy (autre), JAMAIS de création ──
  ✓ RUNNING nôtre → poll (aucune création)
  ✓ CREATED nôtre → poll
  ✓ RUNNING d'une autre requête → busy (message existant)

── T1 : COMPLETED — reprise, jamais de double ingestion, jamais l'op d'un autre ──
  ✓ COMPLETED nôtre, aucun état → ingest (défaut sûr : idempotent)
  ✓ COMPLETED nôtre, état 'running' (lancée mais jamais téléchargée) → ingest : LE cas P0
  ✓ COMPLETED nôtre, état d'une AUTRE op → ingest (celle-ci n'a pas été ingérée)
  ✓ COMPLETED nôtre DÉJÀ ingérée (même id + status completed) → create, aucune double ingestion
  ✓ COMPLETED d'une AUTRE requête → jamais consommée → create

── T1 : échecs → recréation propre ──
  ✓ FAILED → create (recréation propre, comportement actuel)
  ✓ CANCELED → create (recréation propre, comportement actuel)
  ✓ EXPIRED → create (recréation propre, comportement actuel)

── T1 : statut inconnu → busy (défaut sûr = inaction) ──
  ✓ CANCELING → busy (ni création ni download)
  ✓ statut futur inconnu → busy
  ✓ op sans statut lisible → busy (l'inaction, jamais une création par-dessus)

── T2 : idempotence d'ingestion (fixtures) ──
  ✓ même JSONL → même nombre de lignes aux deux passes
  ✓ clés (order_id, line_item_id) IDENTIQUES aux deux passes → le dédoublonnage Postgres s'applique
  ✓ aucune collision de clé au sein d'une passe
  ✓ marges identiques aux deux passes (déterminisme du moteur)

── T2 : contrat d'idempotence + câblage de la reprise (scan du source) ──
  ✓ upsert order_margins : onConflict (clé unique) + ignoreDuplicates:true → ON CONFLICT DO NOTHING (snapshots jamais mutés)
  ✓ orderSync : aucun UPDATE sur order_margins (aucun chemin de mutation de snapshot)
  ✓ une SEULE création d'op (un unique site de mutation bulkOperationRunQuery)
  ✓ la décision de reprise est appelée à l'ENTRÉE, avant toute création
  ✓ marqueur « orders(query: "created_at:>=… » présent dans le bulkQuery réel (la reconnaissance ne peut pas dériver en silence)
  ✓ marqueur « discountedUnitPriceAfterAllDis… » présent dans le bulkQuery réel (la reconnaissance ne peut pas dériver en silence)
  ✓ route sync : maxDuration 60 (pattern cron) exporté

══════════════════════════════════════════════════════════════════
 BILAN LOT 22 (reprise bulk) : ✓ Tous les tests passent
══════════════════════════════════════════════════════════════════
```

### Annexe C — git diff integral (fichiers suivis)

```diff
diff --git a/app/lib/orderSync.server.js b/app/lib/orderSync.server.js
index aa9d3e0..dc551aa 100644
--- a/app/lib/orderSync.server.js
+++ b/app/lib/orderSync.server.js
@@ -9,6 +9,7 @@
 // Entrées : { admin } (client Admin GraphQL, online OU offline), supabase (service role),
 //            shop (shop_domain). Sortie : { success, ingested?, orders?, message?, error? }.
 import { parseBulkJsonl, buildOrderHistoryRows, countDistinctOrders } from "./orderIngest.js";
+import { decideBulkResume } from "./bulkResume.js";
 
 export async function syncShopOrders({ admin, supabase, shop }) {
   // Fenêtre J-30 en UTC, ISO 8601 explicite (filtre Shopify created_at en UTC).
@@ -31,15 +32,37 @@ export async function syncShopOrders({ admin, supabase, shop }) {
     processorFixedFee: plan?.processor_fixed_fee ?? 0.25,
   };
 
-  // Une seule bulk op QUERY par boutique à la fois : ne pas lancer en double.
+  // ── Reprise (P0 audit) : lire l'op courante AVANT toute création — decideBulkResume (pur, lot22).
+  // Ne JAMAIS créer par-dessus une op RUNNING ; reprendre une op COMPLETED de NOTRE requête non
+  // encore ingérée au lieu de l'écraser (sinon : relance infinie dès que le bulk dépasse le budget
+  // de poll). Lecture d'état KO → cur null → 'create' (comportement d'avant : on tente la création).
+  let cur = null;
   try {
-    const cr = await admin.graphql(`{ currentBulkOperation(type: QUERY) { id status } }`);
-    const cj = await cr.json();
-    const cur = cj.data?.currentBulkOperation;
-    if (cur && (cur.status === "RUNNING" || cur.status === "CREATED")) {
-      return { success: false, error: "Une synchronisation est déjà en cours. Réessayez dans un instant." };
-    }
+    const cr = await admin.graphql(`{ currentBulkOperation(type: QUERY) { id status errorCode url query } }`);
+    cur = (await cr.json()).data?.currentBulkOperation ?? null;
   } catch (e) { console.error("[Backfill] currentBulkOperation:", e?.message); }
+  // « Déjà ingérée ? » : couple (bulk_operation_id, status) DÉJÀ persisté par ce module — lu
+  // seulement quand une op COMPLETED est là (aucune requête ajoutée sur le chemin courant).
+  let syncState = null;
+  if (cur?.status === "COMPLETED") {
+    const { data } = await supabase.from("order_sync_state")
+      .select("bulk_operation_id, status, window_start").eq("shop_domain", shop).maybeSingle();
+    syncState = data ?? null;
+  }
+  const decision = decideBulkResume({ op: cur, state: syncState });
+  if (decision === "busy") {
+    return { success: false, error: "Une synchronisation est déjà en cours. Réessayez dans un instant." };
+  }
+  if (decision === "ingest") {
+    // Reprise : fenêtre d'ORIGINE de l'op si connue (refunds cohérents avec ses commandes),
+    // sinon fenêtre courante. Échec de téléchargement (URL expirée ~7 j, réseau) → op FRAÎCHE
+    // dans la même invocation (P0.7) : jamais de boucle sur une URL morte.
+    try {
+      return await ingestBulkResult({ admin, supabase, shop, op: cur, bulkId: cur.id, windowStart: syncState?.window_start ?? windowStart, shopSettings });
+    } catch (e) {
+      console.error(`[Backfill] reprise op ${cur.id} KO, création d'une op fraîche:`, e?.message);
+    }
+  }
 
   // Connexions SANS first: (le bulk paginera) ; __typename pour le re-stitch.
   // Bulk = orders + lineItems UNIQUEMENT. refunds est une LISTE contenant des
@@ -60,18 +83,24 @@ export async function syncShopOrders({ admin, supabase, shop }) {
       } }
     }
   }`;
-  const runResp = await admin.graphql(
-    `mutation Run($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id status } userErrors { field message } } }`,
-    { variables: { q: bulkQuery } }
-  );
-  const runJson = await runResp.json();
-  const userErrors = runJson.data?.bulkOperationRunQuery?.userErrors ?? [];
-  if (userErrors.length) {
-    await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: "failed", window_start: windowStart, last_backfill_at: new Date().toISOString() }, { onConflict: "shop_domain" });
-    return { success: false, error: "Requête bulk refusée : " + userErrors.map(e => e.message).join(" ; ") };
+  let bulkId;
+  if (decision === "poll") {
+    // Notre op tourne déjà (reprise) : AUCUNE création — on entre directement dans le poll.
+    bulkId = cur.id;
+  } else {
+    const runResp = await admin.graphql(
+      `mutation Run($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id status } userErrors { field message } } }`,
+      { variables: { q: bulkQuery } }
+    );
+    const runJson = await runResp.json();
+    const userErrors = runJson.data?.bulkOperationRunQuery?.userErrors ?? [];
+    if (userErrors.length) {
+      await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: "failed", window_start: windowStart, last_backfill_at: new Date().toISOString() }, { onConflict: "shop_domain" });
+      return { success: false, error: "Requête bulk refusée : " + userErrors.map(e => e.message).join(" ; ") };
+    }
+    bulkId = runJson.data?.bulkOperationRunQuery?.bulkOperation?.id ?? null;
+    await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: "running", window_start: windowStart, bulk_operation_id: bulkId }, { onConflict: "shop_domain" });
   }
-  const bulkId = runJson.data?.bulkOperationRunQuery?.bulkOperation?.id ?? null;
-  await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: "running", window_start: windowStart, bulk_operation_id: bulkId }, { onConflict: "shop_domain" });
 
   // Poll jusqu'à COMPLETED (budget temps ; en local/dev pas de timeout serverless).
   let op = null;
@@ -89,8 +118,19 @@ export async function syncShopOrders({ admin, supabase, shop }) {
     await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: st, bulk_operation_id: bulkId, last_backfill_at: new Date().toISOString() }, { onConflict: "shop_domain" });
     return { success: false, error: st === "running" ? "Synchronisation en cours, relancez dans un instant." : `Bulk échoué (${op?.status ?? "?"} ${op?.errorCode ?? ""}).` };
   }
+  return await ingestBulkResult({ admin, supabase, shop, op, bulkId, windowStart, shopSettings });
+}
+
+// ── Téléchargement + ingestion d'une op COMPLETED — extraction À L'IDENTIQUE de la fin de
+// syncShopOrders (Phase 0 I2) : le chemin normal (post-poll) ET la reprise passent ici — aucune
+// logique d'ingestion dupliquée. Corps inchangé ; seuls la signature et l'en-tête ajoutés par
+// l'extraction. Peut THROW (fetch du download) : l'appelant « reprise » catch → op fraîche.
+async function ingestBulkResult({ admin, supabase, shop, op, bulkId, windowStart, shopSettings }) {
   if (!op.url) { // COMPLETED sans url = zéro résultat
-    await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: "completed", window_start: windowStart, last_backfill_at: new Date().toISOString() }, { onConflict: "shop_domain" });
+    // ÉCART d'extraction assumé (rapport) : bulk_operation_id ajouté — sans lui, un état purgé
+    // (désinstallation) + une vieille op zéro-résultat encore COMPLETED = reprise en boucle sans
+    // jamais créer d'op fraîche (« déjà ingérée » exige le couple id+completed persisté).
+    await supabase.from("order_sync_state").upsert({ shop_domain: shop, status: "completed", window_start: windowStart, bulk_operation_id: bulkId, last_backfill_at: new Date().toISOString() }, { onConflict: "shop_domain" });
     return { success: true, ingested: 0, orders: 0, message: "Aucune commande sur les 30 derniers jours." };
   }
 
diff --git a/app/routes/app._index.jsx b/app/routes/app._index.jsx
index 187291e..c88784e 100644
--- a/app/routes/app._index.jsx
+++ b/app/routes/app._index.jsx
@@ -34,6 +34,10 @@ import { resolveEntitlement } from "../lib/plan.server";
 import { planToOrderCap, alertingEnabled, previousMonth } from "../lib/plan.js";
 import { betaTrialOverride } from "../lib/betaShops.js";
 
+// Même pattern que les crons : l'action de sync (backfill_orders) peut retenir la requête ~25 s
+// (poll bulk) — 60 s est un plafond, pas une réservation (sans effet sur les requêtes courtes).
+export const config = { maxDuration: 60 };
+
 // ── Constants ─────────────────────────────────────────────────────────────────
 
 const DEFAULT_ALERT_THRESHOLD = 25;
diff --git a/package.json b/package.json
index 30f583c..5139a58 100644
--- a/package.json
+++ b/package.json
@@ -3,7 +3,7 @@
   "private": true,
   "scripts": {
     "build": "react-router build",
-    "test": "node tests/lot1_customs.mjs && node tests/lot2_ui_labels.mjs && node tests/lot3_cpa_roas.mjs && node tests/invariants.mjs && node tests/lot4_display_guardrails.mjs && node tests/lot5_variant_costs.mjs && node tests/lot6_order_ingest.mjs && node tests/lot7_order_history.mjs && node tests/lot8_breakdown_backfill.mjs && node tests/lot9_profitability_alert.mjs && node tests/lot10_loss_alert_email.mjs && node tests/lot11_dunning_decision.mjs && node tests/lot12_dunning_email.mjs && node tests/lot13_dunning_status.mjs && node tests/lot14_session_reaper.mjs && node tests/lot15_cpa_targets.mjs && node tests/lot16_plan_entitlement.mjs && node tests/lot17_alerting_decision.mjs && node tests/lot18_audit_classify.mjs && node tests/lot19_recalc_margins.mjs && node tests/lot20_customs_classification.mjs && node tests/lot21_beta_shops.mjs",
+    "test": "node tests/lot1_customs.mjs && node tests/lot2_ui_labels.mjs && node tests/lot3_cpa_roas.mjs && node tests/invariants.mjs && node tests/lot4_display_guardrails.mjs && node tests/lot5_variant_costs.mjs && node tests/lot6_order_ingest.mjs && node tests/lot7_order_history.mjs && node tests/lot8_breakdown_backfill.mjs && node tests/lot9_profitability_alert.mjs && node tests/lot10_loss_alert_email.mjs && node tests/lot11_dunning_decision.mjs && node tests/lot12_dunning_email.mjs && node tests/lot13_dunning_status.mjs && node tests/lot14_session_reaper.mjs && node tests/lot15_cpa_targets.mjs && node tests/lot16_plan_entitlement.mjs && node tests/lot17_alerting_decision.mjs && node tests/lot18_audit_classify.mjs && node tests/lot19_recalc_margins.mjs && node tests/lot20_customs_classification.mjs && node tests/lot21_beta_shops.mjs && node tests/lot22_bulk_resume.mjs",
     "vercel-build": "npm run lint && npm test && prisma generate && prisma migrate deploy && react-router build",
     "dev": "shopify app dev",
     "config:link": "shopify app config link",
```
