# S3 — Simulateur, mode Produit (2026-09-25)

Statut : écrit, gate verte, **non committé** (GO attendu). Arbitrage appliqué : X5 (a).

## 1. Ce qui change pour le marchand

Le Simulateur a désormais trois modes, choisis par une barre en tête de page :

- **Toute la boutique** : le Simulateur S1/S2 inchangé (mode par défaut, URL inchangée).
- **Produit existant** : un sélecteur liste les 50 produits au plus fort CA HT de la période, avec leur CA et leur nombre de commandes. Les leviers du Simulateur s'appliquent aux commandes réelles de ce produit seul. Une phrase rappelle que les coûts de boutique (pub, coûts fixes) ne sont pas répartis par produit.
- **Nouveau produit** : un produit pas encore vendu. Le marchand saisit prix de vente TTC, prix d'achat, port fournisseur, quantité par lot, droits (hors UE), emballage, port, frais de paiement, taux et coût de retour, régime de TVA, mode d'expédition et catégorie douanière. La page affiche la marge unitaire en cascade (prix HT, coût rendu, CM1, emballage, port, frais de paiement, retours attendus, CM2) et la CM2 en % du prix HT. Un bloc « Prix minimum pour un objectif » donne le prix TTC minimal pour une CM2 % visée.

Les réglages confirmés servent de valeurs de départ du nouveau produit : emballage par commande, port par défaut s'il est confirmé, première règle de frais de paiement confirmée, coût par retour, régime de TVA et mode d'expédition. Une valeur non confirmée n'est jamais pré-remplie.

## 2. Calcul du nouveau produit

- Coût rendu : `landedCostUnit` du moteur `econ/line.js` (douane UE par taux TARIC de la catégorie et TVA d'import, droits génériques hors UE, ou saisie directe). Aucun « + 4,5 % » ni facteur codé en dur.
- TVA de vente : `vatRateFor` du moteur ; franchise = 0 ; hors UE = 0 dans le modèle.
- Frais de paiement = prix TTC × taux + fixe.
- Retours attendus = taux × (prix HT + coût par retour), hypothèse prudente : le produit retourné est perdu.
- Une commande = une unité.
- Prix manquant ou prix d'achat nul : pas de calcul, les champs manquants sont nommés. Jamais de coût fictif.
- Prix minimum : bissection au centime. Réponses possibles : prix trouvé, objectif hors de portée, cible invalide (100 % ou plus), prix d'achat manquant.

Exemple vérifié (marchand FR, textile, 60 € TTC, achat 22 €, lot de 10 avec 40 € de port) :

| Ligne | Montant |
|---|---|
| Prix HT | 50,00 € |
| Coût produit rendu | 29,12 € |
| CM1 | 20,88 € |
| Emballage, port, frais, retours | 8,30 € |
| CM2 | 12,58 € (25,2 %) |
| Prix minimum pour 40 % de CM2 | 76,74 € TTC |

## 3. Enregistrement et mémoire des décisions

- **Produit existant** : « Retenir ce scénario » recalcule côté serveur sur les feuilles du produit, puis écrit `decision_log` avec `mode`, `product_id` et `product_title` dans le scénario, fourchette attendue et date de revue comme S2.
- **Observé à J+30 d'une décision produit** : mesuré sur la CM2 de ce produit seul dans les deux fenêtres, jamais sur la boutique entière. Correctif fait pendant ce lot : sans lui, une décision produit aurait été jugée sur toute la boutique.
- **Nouveau produit** : recalculé côté serveur depuis les champs, enregistré avec ses données et son résultat, sans fourchette ni date de revue. Un produit hypothétique n'a pas d'observé.
- Mémoire : une ligne nouveau produit affiche sa CM2 unitaire et son %, sans « Rejouer » ni « Comparer ». Une ligne produit affiche le titre, et « Rejouer » rouvre le mode Produit sur le même produit. Les nouveaux produits sont exclus de la comparaison.

Aucune mutation de schéma : `scenario` est déjà un JSON libre.

## 4. Fichiers

Nouveaux :

- `app/lib/simulator/newProduct.js` (calcul pur)
- `app/components/simulator/NewProduct.jsx` (champs natifs tenus par React, C1a)
- `app/components/simulator/ModeBar.jsx` (modes par liens, produit par formulaire GET)
- `tests/lot33_simulator_product.mjs` (24 assertions)

Modifiés :

- `app/lib/overview.server.js` : options `withProducts` (liste et feuilles des 50 premiers produits, sans le produit inconnu) et `observeProduct` (nœuds d'un produit dans les deux fenêtres) ; limite paramétrable sur les titres.
- `app/lib/decisions.server.js` : revue J+30 par produit.
- `app/lib/simulator/scenario.js` : `scenarioSearch` garde mode et produit.
- `app/routes/app.simulator.jsx` : modes, valeurs de départ, intent `keep_new`.
- `app/components/simulator/Simulator.jsx` : mode et produit dans « Retenir », phrase de périmètre, lignes mémoire.
- Catalogues en/fr : environ 50 clés `sim.mode.*`, `sim.product.*`, `sim.new.*`, `sim.memory.new_product`, `sim.memory.product`.
- `app/styles/overview.css`, lot 26 (`F4_FILES`), `package.json`, `scripts/render_check.mjs`.

## 5. Gate

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur (698 warnings, inchangés en nature) |
| `npm test` | 33 lots verts, dont le lot 33 |
| `node scripts/render_check.mjs` | 129 scénarios OK (5 nouveaux) |
| `npm run build` | OK |
| Fichiers protégés | 0 diff |

Nouveaux rendus réels : barre de modes et sélecteur de produit ; Simulateur en mode produit (périmètre, champs cachés) ; nouveau produit rempli (14 champs, 8 lignes, TVA 20,0 %, douane UE, prix minimum, formulaire) ; nouveau produit vide en anglais (champs manquants nommés, bouton désactivé) ; mémoire avec une ligne nouveau produit et une ligne produit.

## 6. Preuves à faire sur la boutique de dev après deploy

1. Mode Produit existant : choisir un produit, « Charger », bouger le prix, vérifier que l'avant correspond à la CM2 du produit, puis « Retenir ».
2. Mode Nouveau produit : vérifier les valeurs de départ issues des réglages, saisir un produit, lancer le prix minimum, puis « Retenir ».
3. Mémoire : les deux lignes s'affichent. « Rejouer » de la ligne produit rouvre le bon produit.

## 7. Limites et points ouverts

- Les produits sans ventes sur la période n'apparaissent pas dans le mode Produit existant ; pour eux, le mode Nouveau produit s'applique.
- Le produit existant ne porte que ses coûts variables ; pub et coûts fixes restent au niveau boutique (le texte le dit).
- Le nouveau produit ne propose pas de saisie directe du coût rendu : il part toujours du prix d'achat.
- Rappels déjà consignés : sauvegarde Supabase avant D2 ; réécrire les arguments des offres avant D2.
- Suite prévue : D1c (Produits et audit Expert).
