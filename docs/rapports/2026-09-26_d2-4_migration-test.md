# D2-4 — Étape 1 : migration sur tcc-test, retour arrière prouvé (2026-09-26)

Statut : étape test terminée et prouvée. **Production non touchée.** Rien n'est commité.

## 1. Sauvegardes déplacées

- Les deux fichiers `tcc-production-sauvegarde-2026-09-26_12h07.dump` et `.sql` sont maintenant dans `C:\Users\mathy\Sauvegardes-TCC` (hors OneDrive).
- Ils ne sont plus sur le Bureau. Les empreintes avant et après le déplacement sont identiques.

## 2. Ce que fait la migration

Fichier : `supabase/migrations/20260926_d2_01_drop_legacy.sql`. Elle s'applique en une seule transaction : tout passe, ou rien ne change.

| Ordre | Action | Pourquoi |
|---|---|---|
| 1 | `purge_shop` redéfinie sans les 3 tables retirées | Sans cela, la désinstallation et les demandes RGPD échoueraient sur des tables absentes |
| 2 | Déclencheur `trg_shop_plans_sync_settings` et fonction `sync_shop_plans_to_settings` retirés | Plus aucun écrivain des réglages dans `shop_plans` depuis D2-3 |
| 3 | Tables `calculation_annotations`, `calculations` et `margin_alerts` retirées (sans CASCADE) | Écran classique supprimé en D2-3 (X9, X10) |
| 4 | 9 colonnes de réglages retirées de `shop_plans` ; `plan` gardée | `shop_settings` est la source de vérité ; `plan` sert de cache de l'offre |
| 5 | Objectif CM2 rendu facultatif, sans défaut ; les 0 deviennent NULL | Rappel 4 de la Phase 0 : un objectif effacé reste « non renseigné » |

Aucune autre donnée n'est modifiée.

## 3. Côté app : l'objectif « non renseigné »

- **Réglages → Objectifs.** Un champ vidé est enregistré « non renseigné ». Un 0 saisi reste 0 et s'affiche « 0 ».
- **Mise en route.** « Non renseigné » est compté comme manquant. Un 0 choisi compte comme renseigné.
- **Audit du catalogue.** Sans objectif, le classement est le même qu'avant (perte stricte). La bande du milieu affiche « objectif non renseigné : bande inactive (à définir dans Objectifs) ».
- **Alerte e-mail.** Le calcul est inchangé (à 0 sans objectif). Sans objectif, le texte dit « 1 produit est à perte » et « repassé rentable », jamais « objectif (0 %) ». Avec un objectif, y compris 0 % choisi, le texte ne change pas.
- **Copilote (`insights/rules.js`).** Inchangé, comme convenu : sans objectif, il garde le repère de 40 %.
- **Contrat de schéma (`schema.js`).** Les 3 tables sont passées en `DROPPED_TABLES`. Le lot 23 en tient compte, avec la nouvelle définition de référence de `purge_shop`.

Un point d'ordre compte pour la mise en production. L'app déployée aujourd'hui écrit 0, ce qui reste compatible avec la base migrée. La nouvelle app écrit NULL, ce qui serait refusé par une base non migrée. La base doit donc être migrée **avant** le déploiement.

## 4. Preuve sur tcc-test

Le script `scripts/d2_4_migrate.mjs` refuse de tourner si la base visée ne correspond pas à TARGET. Une tentative en `TARGET=prod` avec la configuration de test a bien été refusée.

| Étape | Résultat |
|---|---|
| Données fictives (`d24-proof-a/b.myshopify.com`) | Objectifs 0 et 12,5 ; lignes dans les 3 tables et dans les 9 colonnes |
| Empreinte avant | structure `09c3fc441c5892e3`, données `9ef46adf482fe2eb` |
| Préparation du retour arrière | Généré depuis la base elle-même : pg_dump des 3 tables (structure, données, index, politiques, droits), fonction et déclencheur, colonnes et valeurs de `shop_plans`, ancienne `purge_shop`, défaut et valeurs de l'objectif |
| Migration | OK, transaction validée. Tables absentes, `shop_plans` réduite à 4 colonnes, déclencheur absent, objectif 12,5 gardé, 0 devenu NULL |
| Retour arrière | OK, transaction validée |
| Comparaison avant / après retour | Structure identique : seul l'ordre des colonnes de `shop_plans` diffère (colonnes réajoutées en fin de table, sans effet). Données identiques (`9ef46adf482fe2eb`) |
| Nouvelle préparation puis migration | OK |
| Contrôle de purge | `purge_shop` sur les boutiques fictives : OK, plus aucune ligne |
| État final de tcc-test | Migrée, structure `7ca6f15dca10602c` |

## 5. Gate

| Contrôle | Résultat |
|---|---|
| `npm run lint` | 0 erreur (24 avertissements, inchangés) |
| `npm test` | Vert (36 lots, dont le lot 40 D2-4, 31 contrôles) |
| `node scripts/render_check.mjs` | Tout OK, dont 4 nouveaux rendus : objectif 0 affiché « 0 » ; objectif non renseigné et état vide ; audit sans objectif ; audit à 0 % |
| `node scripts/render_routes.mjs` | 41 rendus OK |
| `npm run check:browser` | 4 preuves Edge OK |
| `npm run check:server` | OK |
| `npm run build` | OK |
| Fichiers protégés (engine, econ, sync) | 0 diff |

## 6. Plan pour la production (sur ton GO seulement)

État actuel de la production : 3 calculs, 0 annotation, 2 seuils d'alerte, 4 lignes `shop_plans` à 13 colonnes. Objectif : trois boutiques à 0 et une à 45.

1. Nouvelle préparation du retour arrière depuis la production, rangée dans `C:\Users\mathy\Sauvegardes-TCC\d2-4-rollback-prod` (hors dépôt, à côté de la sauvegarde complète de 12h07).
2. Empreinte avant.
3. Migration en une transaction.
4. Empreinte après et vérifications :
   - tables absentes ;
   - `shop_plans` à 4 colonnes, 4 lignes, plans intacts ;
   - objectif : 45 gardé, les trois 0 deviennent « non renseigné » ;
   - `purge_shop` sans les tables retirées.
5. Rapport de l'étape 2.
6. Ensuite, sur un GO séparé : commit unique, push, puis statut Vercel via l'API GitHub.

Si une étape échoue, la transaction est annulée et la base reste inchangée. Si un problème apparaît après coup, deux filets existent : le retour arrière préparé, et la sauvegarde complète.

À savoir : les 3 calculs et les 2 seuils d'alerte de l'écran classique en production seront supprimés. Ils restent dans le retour arrière et dans la sauvegarde.

## 7. Fichiers

- **Nouveaux :**
  - `supabase/migrations/20260926_d2_01_drop_legacy.sql` ;
  - `scripts/d2_4_migrate.mjs`, `scripts/d2_4_snapshot.mjs` et `scripts/d2_4_compare.mjs` ;
  - `tests/lot40_d2_4_legacy_drop.mjs` ;
  - `docs/rapports/2026-09-26_sauvegarde-production.md` ;
  - ce rapport.
- **Modifiés :**
  - `app/lib/schema.js`, `app/lib/settings.js`, `app/lib/audit.server.js`, `app/lib/overview.server.js` et `app/lib/profitabilityAlert.js` ;
  - `app/routes/app.settings.goals.jsx`, `app/routes/app.products.jsx` et `app/routes/api.cron.profitability.jsx` ;
  - `app/components/settings/GoalsForm.jsx` et `app/components/products/CatalogAudit.jsx` ;
  - `app/locales/fr.js` et `app/locales/en.js` ;
  - `tests/lot23_schema.mjs` et `tests/lot29_*.mjs` ;
  - `scripts/render_check.mjs` et `package.json`.
