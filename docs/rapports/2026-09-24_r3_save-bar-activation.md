# R3 — Barre de sauvegarde App Bridge, mise en route, manques reliés à Réglages (2026-09-24)

Suite de R2 (`1cf32d9`) et F4-B (`7e092e8`, `9232158`). GO R3 reçu le 2026-09-24 ; aucun commit
sans GO.

Statut : **écrit et prouvé localement (gate complète verte). Aucune migration, aucun commit, aucun
push.** Fichiers protégés : 0 diff.

## 1. Barre de sauvegarde App Bridge (Built for Shopify)

Fait vérifié (doc App Bridge, 2026-09-24) : l'attribut `data-save-bar` sur un `<form>` natif
affiche la barre contextuelle dès qu'un champ change ; « Save » déclenche `submit`, « Discard »
déclenche `reset` ; à ne pas combiner avec `shopify.saveBar`.

Appliqué aux **9 formulaires d'édition** de Réglages (coûts de commande, port par pays, une règle
par passerelle, ajout de coût fixe, objectifs, boutique, partenaire, règle de code, commission
manuelle) : `<Form method="post" data-save-bar="">`. Les formulaires à bouton seul (supprimer,
terminer aujourd'hui) n'en portent pas : ils n'ont aucun champ modifiable. Le bouton de chaque bloc
reste (une page peut porter plusieurs formulaires ; la barre suit celui qui a changé).

## 2. Mise en route (liste de contrôle d'activation, PDF)

`app/lib/activation.js` (pur) : `activationChecklist({ lastSync, confidence, briefing,
ordersInPeriod })` → trois jalons, chacun avec la page qui le débloque :

| Jalon | Fait quand | Sinon |
|---|---|---|
| Shopify synchronisé | une synchronisation terminée existe | → Réglages > Connexions |
| Coûts produits renseignés ou importés | règle `cost_coverage` applicable et part du CA à coût connu ≥ 80 % (`COSTS_DONE_SHARE`) ; le pourcentage courant est affiché | → écran classique (Suivi des coûts), jusqu'à S3 |
| Première situation financière générée | commandes sur la période et situation produite par le briefing | → Aujourd'hui |

`ActivationChecklist` (composant) en tête de la page Fiabilité : badge « n / 3 », « Fait » ou
« Y aller », phrase de clôture quand tout est en place.

## 3. Manques et états vides reliés aux pages Réglages

- `settingsPathForRule(ruleId)` : coûts par variante et coût rendu → écran classique (jusqu'à S3) ;
  publicité → Connexions ; port, frais, coûts fixes → Coûts ; devise → Boutique.
- Fiabilité : chaque manque (bloc compact d'Aujourd'hui et page) a un lien « Compléter » vers sa
  page (`data-fix="<règle>"`) ; la liste des 7 règles aussi.
- État vide d'Aujourd'hui (aucune commande) : « Compléter les réglages » → `/app/settings`,
  l'écran classique passe en lien secondaire.

## 4. Preuves locales (gate complète, 2026-09-24)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur |
| `npm test` | 31 lots verts ; lot 29 = 59 (+9) |
| `node scripts/render_check.mjs` | 114 scénarios verts (+5) |
| `npm run build` | OK |
| fichiers protégés | 0 diff |

Lot 29 (§3c) : 9 formulaires d'édition avec `data-save-bar`, aucun sur les formulaires à bouton
seul ; page par règle (7 règles, repli `/app/settings`) ; activation complète (3 / 3, coûts à
85 %), rien de fait (liens, coûts à 50 % sous le seuil), coûts non applicables sans pourcentage ;
Fiabilité relie chaque manque ; état vide relie Réglages.

Rendus réels (5) : `<form … data-save-bar>` sur l'ajout de coût fixe et pas sur « Supprimer » ;
activation 1 / 3 (sync faite, coûts « Aujourd'hui 50 % du CA a un coût connu » → écran classique,
situation → Aujourd'hui) ; activation complète en anglais ; fiabilité de la boutique manquante avec
3 liens « Compléter » (coûts → écran classique, frais ou port → Coûts) ; état vide avec « Compléter
les réglages ».

## 5. Écarts et points ouverts

1. **La barre de sauvegarde ne se prouve qu'en boutique** : le rendu serveur prouve l'attribut ;
   son affichage, « Save » qui soumet et « Discard » qui remet les champs (`reset` natif sur des
   champs Polaris non contrôlés) sont à voir sur la boutique de dev.
2. **Deux boutons pour sauvegarder** (barre + bouton du bloc) : voulu tant que la barre n'est pas
   prouvée ; le bouton du bloc pourra passer en secondaire ensuite.
3. **Seuil de 80 %** pour « coûts renseignés » : choix documenté, réglable (`COSTS_DONE_SHARE`).
4. **Coûts par variante** : la seule saisie reste l'écran classique jusqu'à S3 (mode Produit).

## 6. Preuves à faire sur la boutique de dev (après GO commit + déploiement)

1. Réglages > Coûts : modifier l'emballage → la barre de sauvegarde apparaît en haut ; « Save »
   enregistre (bandeau « Enregistré », valeur persistante) ; « Discard » remet l'ancienne valeur ;
   « Supprimer » un coût fixe ne fait pas apparaître la barre.
2. Fiabilité : « Mise en route » avec 1 ou 2 jalons faits selon l'état (sync faite, coûts à
   ≈ 86 % → fait, situation → fait avec les 15 commandes) ; les liens « Compléter » ouvrent la bonne
   page ; après saisie d'un coût fixe, la règle « Coûts fixes » disparaît des manques.
3. Aujourd'hui sur 7 jours sans vente : état vide avec « Compléter les réglages ».

## 7. Ce qui reste

GO commit unique + push (statut Vercel via l'API GitHub), preuves ci-dessus, puis S2 selon la
Phase 0 jointe (`2026-09-24_s2_phase0.md`).
