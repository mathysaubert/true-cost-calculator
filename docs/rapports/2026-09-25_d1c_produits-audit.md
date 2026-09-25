# D1c — Section Produits, audit Expert, cron sur shop_settings (2026-09-25)

Statut : écrit, gate verte, **non committé** (GO attendu). Arbitrages appliqués : X6 (a) et X7.
S3 est committé (`73158d5`, Vercel success).

## 1. Ce qui change pour le marchand

**Nouvelle section Produits** (`/app/products`), dans le groupe Explorer de la navigation. Elle n'est plus grisée « Bientôt ».

- Sélecteur de période, comme les autres sections.
- Synthèse : nombre de produits vendus et part du CA produits sans coût connu, laissée hors marge.
- Liste par produit : CA HT, CM2, CM2 %, unités, nombre de commandes et statut de coût.
- Tri par CA HT (défaut), CM2, CM2 % ou unités. Une CM2 absente va en fin de liste, jamais comptée 0.
- Filtres par statut de coût, avec compteurs : Tous, Coûts renseignés, À confirmer, En partie manquants, Sans coût.
- Lien vers Réglages > Coûts produits.
- Les 200 produits au plus fort CA sont listés. Au-delà, une phrase le dit.

**Audit du catalogue**, en bas de la section :

- Offre Expert : un taux de retour (le taux observé sur la période est pré-rempli), puis « Lancer l'audit ».
- Autres offres : une explication et un lien « Voir les offres ». Si l'offre n'a pas pu être vérifiée, la page demande de recharger.
- Résultat : marge de contribution 2 unitaire de chaque produit actif à son prix catalogue, en trois groupes. Les groupes sont « à perte », « sous votre objectif » et « à l'objectif ».
- Chaque produit affiche son prix, son coût, sa CM2 et sa CM2 %. Le coût Shopify porte un badge « à confirmer », et une catégorie douanière estimée est signalée.
- Les réglages manquants sont nommés, comptés 0 et reliés à Réglages.

**Alerte e-mail de rentabilité** : le cron lit le seuil dans `shop_settings`, plus dans `shop_plans`.

## 2. Règles de calcul

**Statut de coût** : il vient de la source de coût des lignes vendues sur la période, commandes exclues mises à part.

| Statut | Règle |
|---|---|
| Coûts renseignés | toutes les lignes ont un coût saisi ou importé par le marchand |
| À confirmer | toutes les lignes ont un coût, au moins un vient de Shopify ou d'une estimation |
| En partie manquants | une partie des lignes n'a aucun coût |
| Sans coût | aucune ligne n'a de coût : CM2 et CM2 % affichées « n. d. », jamais 0 |

Sans compteur de lignes, le statut se replie sur l'agrégat, sans jamais conclure « renseigné ». Les CA, CM2, CM2 % et unités sont ceux de l'agrégat du moteur, par produit.

**Audit** : le balayage est le même que sur l'écran classique. Il couvre les produits actifs, la première variante, au plus 10 pages de 50 produits en 7 secondes, avec la même catégorie douanière effective. Le calcul, lui, passe au modèle CM2 :

- **Calcul** : celui du mode Nouveau produit du Simulateur (S3), avec coût rendu et TVA du moteur econ.
- **Coût** : le coût saisi ou importé par le marchand prime sur le coût Shopify. Sans aucun coût, le produit n'est pas évalué.
- **Réglages** : seuls les réglages confirmés de `shop_settings` sont repris (emballage, port par défaut, frais de paiement, coût par retour, régime de TVA, mode d'expédition).
- **Prix hors taxes** : une boutique aux prix HT est gérée par une option ajoutée au calcul S3.
- **Seuil** : le classement utilise l'objectif de CM2 du marchand. C'est la même frontière que l'alerte e-mail : à 0 %, la bande « sous l'objectif » est vide.
- **Limites d'usage** : lecture seule, aucune écriture, 10 audits par jour. Le compteur est partagé avec l'écran classique.

Écart assumé avec l'audit de l'écran classique : il utilisait des valeurs par défaut codées en dur (8 € de port entrant, Stripe EU, 5 % de retours) et la marge nette sur le prix TTC. Le nouvel audit ne suppose rien. Un réglage absent est signalé et compté 0, et la marge est la CM2 sur le prix HT. Les chiffres des deux audits diffèrent donc pour une même boutique.

## 3. Cron de rentabilité

Seule la lecture du seuil change. Tout le reste du cron est inchangé : synchronisation, agrégat, diff d'état, plafond d'alerting et envoi.

Vérification en lecture seule avant le changement : les 4 boutiques ont une ligne `shop_settings` avec le même seuil que `shop_plans` (0). Le changement ne modifie donc aucune alerte.

## 4. Fichiers

Nouveaux :

- `app/lib/products.js` (pur : statuts, liste, tri, filtre, entrées et classement d'audit)
- `app/lib/audit.server.js` (balayage, calcul, lecture seule)
- `app/lib/rateLimit.server.js` (copie de la limite quotidienne de l'écran classique)
- `app/routes/app.products.jsx`
- `app/components/products/ProductList.jsx`, `CatalogAudit.jsx`
- `tests/lot34_products.mjs` (30 assertions, dont un audit de bout en bout avec Admin et Supabase simulés)

Modifiés :

- `app/lib/overview.server.js` : option `productLimit`, statut de coût par produit, défauts partagés, seuil exposé.
- `app/lib/simulator/newProduct.js` : `unitDefaultsFromSettings` partagé entre S3 et l'audit ; options prix HT et coût rendu saisi.
- `app/routes/app.simulator.jsx` : utilise les défauts partagés, sans changement de comportement.
- `app/lib/sections.js` : Produits en live.
- `app/routes/api.cron.profitability.jsx` : seuil depuis `shop_settings`.
- Catalogues en/fr (57 clés `products.*`), `overview.css`, lot 26, `package.json`, `scripts/render_check.mjs`.

## 5. Gate

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur (716 warnings, prop-types des nouveaux composants) |
| `npm test` | 34 lots verts, dont le lot 34 |
| `node scripts/render_check.mjs` | 136 scénarios OK (7 nouveaux, 2 mis à jour pour le rail) |
| `npm run build` | OK |
| Fichiers protégés | 0 diff |

Nouveaux rendus réels :

- liste chargée : synthèse, filtres, tri, CM2 négative, CM2 « n. d. », trois statuts ;
- liste filtrée vide ;
- audit verrouillé, puis audit avec offre indéterminée ;
- audit Expert au repos, puis avec un résultat en trois groupes ;
- audit en erreur de plafond.

## 6. Preuves à faire sur la boutique de dev après deploy

1. La navigation Shopify et le rail affichent Produits. La liste montre les produits vendus avec leurs statuts, et le tri et les filtres fonctionnent.
2. Boutique de dev en Expert : lancer l'audit, vérifier les trois groupes et les réglages manquants.
3. Cron : au prochain passage, les journaux Vercel ne montrent aucun écart de comportement.

## 7. Points ouverts et rappels

- `recalcEstimatedMargins.server.js` lit encore le seuil dans `shop_plans`. Il n'est appelé que par l'écran classique et disparaît en D2 : à retirer dans le même lot, avant la suppression de la colonne.
- L'audit ne lit que la première variante de chaque produit, comme l'écran classique.
- La liste Produits ne répartit pas la pub ni les coûts fixes par produit, et le texte le dit.
- Rappels : sauvegarde Supabase avant D2 ; réécrire les arguments des offres avant D2 ; arbitrages P1 à P8 de la page Décisions toujours attendus.
- Suite prévue : D0 (React 19, `shopify-app-react-router` 3, Node 22).
