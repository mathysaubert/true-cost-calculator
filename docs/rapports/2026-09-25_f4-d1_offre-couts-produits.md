# F4-D1b Offre et F4-D1a Coûts produits : nouvelles maisons, sous React 18 (2026-09-25)

Suite de `2026-09-25_s3-f4-d_phase0.md` ; arbitrages X1-X10 consignés dans
`2026-09-22_decisions.md` §L. GO D1b puis D1a reçus le 2026-09-25 ; aucun commit sans GO.

Statut : **écrit et prouvé localement (gate complète verte). Aucune migration, aucun commit, aucun
push.** Écran classique, `engine.js`, `econ/*`, `sync/*`, et les modules portés (`costsUi.jsx`,
`customsUi.jsx`, `variantCosts.js`, `customsClassification*.js`, `plan.js`, `plan.server.js`,
`shopify.server.js`) : 0 diff. L'écran classique reste la roue de secours jusqu'à D2.

## 1. Vérifications demandées (lecture seule en prod, 2026-09-25)

**X8, abonnés Pro réels : aucun marchand réel abonné.** `shop_plans` porte 4 lignes : 2 « expert »,
1 « pro », 1 « free ». Elles se répartissent ainsi :
- la boutique de développement, en « expert » par facturation de test ;
- la boutique de revue Shopify, en « pro » ;
- une boutique en « expert » sans session installée depuis juin 2026, donc désinstallée ;
- une boutique en « free ».

Il n'y a que 2 sessions offline (dev et revue) et aucune ligne de relance de paiement. Limite :
`shop_plans` est un cache écrit à chaque résolution réussie ; l'état de facturation chez Shopify ne
peut être lu qu'avec un jeton de boutique.

**X10, calculs enregistrés : 3 lignes** dans `calculations`, une par boutique, toutes non marchandes.
`calculation_annotations` est vide et `margin_alerts` a 2 lignes. Recommandation : (a), suppression
sans export, à reconfirmer en lecture juste avant D2.

**Rappel X9 :** faites la sauvegarde Supabase avant D2.

## 2. D1b — Réglages > Offre (`/app/settings/plan`)

- `app/lib/billing.server.js` porte le code **déplacé à l'identique** :
  - `isDevStore` (défaut sûr : au moindre doute, facturation réelle) ;
  - la requête `allSubscriptions` ;
  - `loadEntitlement`, avec le même résolveur `resolveEntitlement` (fail-safe D1, FROZEN D2, indéterminé Q1) ;
  - `requestSubscription`, avec les deux `billing.request` Pro et Expert : mêmes plans, même `isTest`, même `returnUrl`, même essai bêta de 45 jours.
- Le lot 32 compare les blocs de l'écran classique et du module déplacé, texte normalisé : ils sont
  identiques.
- `app/lib/plans.js` (pur) couvre les offres affichées. Prix et essais sont égaux à la configuration
  de `shopify.server.js`, ce que le lot 32 vérifie. Seules les montées sont proposées, jamais de
  rétrogradation. Un plan indéterminé n'est jamais affiché gratuit et n'offre aucun bouton.
- `PlanCards` affiche l'offre courante (avec la mention « dernière offre connue » si Shopify n'a pas
  répondu) et trois cartes : prix par mois, essai (45 jours pour une boutique bêta), arguments traduits.
- L'abonnement passe par un formulaire POST natif (`subscribe_pro` / `subscribe_expert`). Des bandeaux
  signalent la boutique de développement (facturation de test), le plan indéterminé et le retour
  d'abonnement.
- **`returnUrl` inchangé** : il mène à la racine de l'app `?subscribed=true`, c'est-à-dire l'écran
  classique jusqu'à D2. Il sera réorienté en D2.

## 3. D1a — Réglages > Coûts produits (`/app/settings/products`)

- `app/lib/productCosts.js` (pur) :
  - groupe les produits (statuts « à compléter », « partiel », « complet » ; douane à confirmer sur les seules variantes stockées) ;
  - fournit compteurs et filtres ;
  - lit le formulaire d'un produit ;
  - traduit les messages techniques de `validateCostRow` et du CSV en champs.
- `app/lib/productCosts.server.js` reprend le même chemin que l'écran classique :
  - même requête de variantes (budget de 8 s, 20 pages, cartes cadeaux exclues) ;
  - suggestions `buildCostRowsForDisplay`, **aucune écriture à l'ouverture** (règle d'intégrité) ;
  - enregistrement en source « confirmed », import CSV en source « imported », invalidation douane sur les deux ;
  - confirmation par `confirmCustomsCategory`.
- Réglages par défaut lus dans `shop_settings` (source de vérité S1, synchronisée par le trigger
  R0-02).
- Un champ de coût laissé vide laisse la variante à compléter (arbitrage c, §7) ; quantité par lot
  vide = 1. Un prix d'achat nul ou négatif reste refusé.
- La page contient :
  - des filtres par statut en liens ;
  - la liste par produit, avec « Saisir les coûts » qui ouvre le panneau (`?product=`) ;
  - un panneau par variante : formulaire natif avec barre de sauvegarde, 4 nombres, 4 listes traduites (pays, catégories, régime de TVA, mode d'expédition), suggestions en exemples et jamais en valeurs, champs en erreur signalés ;
  - la classification douanière par produit ;
  - l'export CSV (lien de téléchargement du modèle pré-rempli) et l'import CSV (fichier natif, lignes rejetées listées avec les champs traduits).
- Chaque enregistrement de coûts ou confirmation douane laisse une trace « donnée corrigée » dans
  `decision_log` (`cost_coverage`, `landed_cost`), une par jour (S10).
- Raccordements : la mise en route (jalon « coûts ») et les liens « Compléter » de la fiabilité
  (`cost_coverage`, `landed_cost`) pointent désormais vers `/app/settings/products`, et non plus vers
  l'écran classique.

La sous-navigation Réglages passe à 8 sujets : accueil, Coûts, **Coûts produits**, Objectifs,
Boutique, Marketing, Connexions, **Offre**. Les catalogues gagnent 134 clés (909 au total, fr = en).

## 4. Preuves locales (gate complète, 2026-09-25)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur |
| `npm test` | 32 lots verts ; lot 32 (nouveau) = 32 assertions après l'arbitrage (c) ; lot 29 = 59 |
| `node scripts/render_check.mjs` | 124 scénarios verts (+7) |
| `npm run build` | OK |
| fichiers protégés et modules portés | 0 diff |

Contenu du lot 32 :
- **Facturation identique à l'écran classique** : Pro, Expert, `isDevStore`, requête des abonnements, résolveur. La route n'appelle la facturation que par le module déplacé.
- **Offres = configuration** : prix, essais et devise ; montées autorisées ; indéterminé sans bouton ; arguments traduits.
- **Coûts produits** :
  - groupement, tri et statuts ; douane sur les variantes stockées et divergence ; compteurs et filtres ;
  - formulaire : virgule, champ vide qui reprend la suggestion serveur, selects, produit rattaché ;
  - erreurs : prix ≤ 0, texte, quantité, régime ; messages techniques traduits en champs ; erreurs CSV.
- **Intégrité** : aucune écriture à l'ouverture ; sources « confirmed » et « imported » ; invalidation douane ; réglages lus dans `shop_settings` ; `data_fixed` ; aucun état React ; traductions ; aucune dépendance à l'écran classique.

Rendus réels :
- **Offre gratuite sur boutique de dev** : bandeau test, 3 cartes, essai de 7 jours, badges, deux boutons d'abonnement.
- **Offre Pro, boutique bêta** : « Current », essai de 45 jours, seul Expert proposé.
- **Offre Expert et plan indéterminé** : aucun bouton.
- **Liste des coûts produits** : filtres avec compteurs, statuts, douane à confirmer.
- **Panneau ouvert** : barre de sauvegarde, valeurs réelles sur la variante renseignée, « ex : 18,40 » sur la suggestion, listes traduites, champ en erreur.
- **Douane** : seule la variante stockée apparaît, catégorie présélectionnée.
- **CSV** : lien d'export, formulaire multipart, résultat avec lignes rejetées traduites.

## 5. Écarts et points ouverts

1. **Arguments des offres** : traduits tels quels depuis l'écran classique. Plusieurs décrivent des
   fonctions qui disparaissent en D2 (calculs manuels, annotations, recommandation IA avant I1).
   **Réécriture à arbitrer avant D2.**
2. **Retour d'abonnement** : la racine de l'app, donc l'écran classique jusqu'à D2 (`returnUrl`
   inchangé par principe). D2 réorientera la racine.
3. **Champs vides** : tranché le 2026-09-25 (option c), voir §7.
4. **Liste sans pagination** : jusqu'à 20 pages de 50 produits, comme avant. Un bandeau signale une
   liste incomplète.
5. **Le recalcul des marges passées** après changement de catégorie douanière n'est pas proposé ici.
   C'était une opération de l'écran classique (`recalc_estimated_margins`) ; la sync v2 recalcule les
   commandes suivantes. Le bandeau le dit (« les prochains calculs utiliseront ce taux »).

## 6. Preuves à faire sur la boutique de dev (après GO commit + déploiement)

**Offre**
1. `/app/settings/plan` affiche « Offre actuelle : Expert », le bandeau « boutique de développement »,
   et aucun bouton puisque l'offre est la plus haute.
2. Test de montée optionnel sur une boutique en offre gratuite : « Choisir Pro » ouvre la page
   d'approbation Shopify en test, puis le retour se fait sur l'app.

**Coûts produits**
3. `/app/settings/products` liste les 4 produits de test avec leurs statuts, dont Poster « À compléter ».
4. « Saisir les coûts » sur Poster, prix d'achat `12`, puis Enregistrer : le bandeau confirme la variante
   enregistrée. Ensuite :
   - Poster passe en « Complets » ;
   - sur Aujourd'hui, la ligne « CA sans coût connu, hors marge » disparaît au chargement suivant ;
   - le jalon « coûts » de la mise en route progresse.
5. Modifier un champ fait apparaître la barre de sauvegarde ; « Discard » remet la valeur.
6. Douane : confirmer la catégorie d'un produit affiche le bandeau (« le taux a changé » si c'est le
   cas), et le produit sort de la liste.
7. CSV : exporter le modèle, corriger une ligne, en casser une autre, réimporter. Le bandeau affiche
   « N importées, 1 ligne rejetée » avec le champ en cause.
8. L'écran classique fonctionne toujours et affiche les mêmes coûts : même table `variant_costs`.

## 7. Arbitrages du 2026-09-25 sur les points ouverts

- **Point 1 (a)** : textes des offres conservés jusqu'à D2. **Rappel : réécrire les arguments des
  offres avant D2** ; la tarification du nouveau produit sera décidée avant.
- **Point 2 (c)** : un champ de coût vide = non renseigné ; la variante n'est pas enregistrée et reste
  à compléter, jamais la suggestion enregistrée comme confirmée. Exception : quantité par lot vide = 1.
  Appliqué : `parseProductForm` renvoie les variantes laissées à compléter (`skipped`), les champs
  vides sont signalés « Obligatoire pour enregistrer cette variante », un bandeau compte les variantes
  laissées à compléter ; la recopie serveur des suggestions (`productSuggestions`) est supprimée. Une
  variante déjà renseignée dont on vide un champ garde ses valeurs enregistrées.

## 8. Ce qui reste

- Votre GO pour le commit unique et le push, avec le statut Vercel lu par l'API GitHub.
- Les preuves ci-dessus sur la boutique de dev.
- La suite de l'ordre retenu : S3 (mode Produit), D1c (Produits + audit), D0, D2, D3.
