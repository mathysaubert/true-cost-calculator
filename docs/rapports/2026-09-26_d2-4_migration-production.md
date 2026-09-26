# D2-4 — Étape 2 : migration de la production (2026-09-26)

Statut : migration appliquée en production et vérifiée. Ordre respecté : base d'abord, déploiement ensuite (commit et push faits après ce rapport).

## 1. Retour arrière préparé

- Dossier : `C:\Users\mathy\Sauvegardes-TCC\d2-4-rollback-prod` (hors dépôt et hors OneDrive).
- `rollback.sql` fait 18 Ko et a été généré depuis la production juste avant l'application. Il contient :
  - les 3 tables avec leurs données (3 calculs, 0 annotation, 2 seuils) ;
  - les 9 colonnes et les valeurs des 4 lignes de `shop_plans` ;
  - la fonction de recopie et le déclencheur ;
  - l'ancienne `purge_shop` ;
  - l'objectif des 4 boutiques.
- Le dossier contient aussi les empreintes `snapshot_avant.json` et `snapshot_apres.json`.
- Deuxième filet : la sauvegarde complète de 12h07, dans le même dossier parent.
- Commande de retour arrière, si besoin : `TARGET=prod PGBIN=<psql 17> BUNDLE=<ce dossier> node --env-file=.env scripts/d2_4_migrate.mjs rollback`. Elle ne doit être lancée qu'après un GO.

## 2. Application

| Étape | Résultat |
|---|---|
| Empreinte avant | structure `9c2998c926b1f12b`, identique à la lecture faite pendant l'étape test |
| Migration (une transaction) | OK, transaction validée |
| Empreinte après | structure `ea5194c804c7f33f`, données `3d49eb219b7ac4a0` |

## 3. Vérifications après coup

| Point demandé | Résultat |
|---|---|
| Tables retirées | `calculations`, `calculation_annotations` et `margin_alerts` sont absentes |
| Colonnes retirées | `shop_plans` passe à 4 colonnes (id, plan, shop_domain, updated_at), avec 4 lignes |
| Offres conservées | 4 boutiques, offres identiques à la sauvegarde (expert, pro, free, expert) |
| Recopie retirée | Déclencheur et fonction absents |
| Objectif 45 | Conservé, sur la même boutique qu'avant |
| Les 0 | Les 3 sont devenus « non renseigné » (NULL). Aucun écart avec la sauvegarde |
| Colonne objectif | Facultative, sans défaut |
| `purge_shop` à jour | 36 tables vidées, aucune table retirée citée |
| Autres données (contrôle) | shop_settings 4, variant_costs 28, orders 24 |

## 4. App en ligne (371d18b, avant déploiement)

- **Code déployé.** Aucune lecture ni écriture des tables ou colonnes retirées : `shop_plans` n'est lu et écrit que pour `plan`, et les frais viennent de `shop_settings`. L'enregistrement d'un objectif vide écrit 0, ce que la base migrée accepte.
- **Réponse HTTP.** Accueil 200, `/app` 302 (redirection normale vers l'authentification Shopify), page de connexion 200.
- **Désinstallation, seul écart temporaire.** Le webhook de l'ancien code tente aussi de vider les 3 tables retirées. Ces trois tentatives échouent sans rien bloquer (`Promise.allSettled`), et les autres tables sont bien vidées. Le déploiement de D2-4 retire ces trois noms de la liste.

## 5. Suite

- Commit unique et push de D2-4, puis statut Vercel lu via l'API GitHub (résultat dans le terminal).
- À tester en boutique après le déploiement :
  1. Réglages → Objectifs : vider l'objectif et enregistrer. Le champ reste vide, et la mise en route l'indique « Manquant ».
  2. Saisir 0 et enregistrer : le champ affiche « 0 ».
  3. Produits → audit (Expert) sans objectif : la bande du milieu affiche « objectif non renseigné ».
