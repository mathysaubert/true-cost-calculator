# Phase 0 : modèle Excel (.xlsx) ; plan de remise à zéro des 5 snowboards (2026-09-26)

Le correctif CSV et le taux de retour de l'audit sont committés (`c4a04c0`, Vercel success).

Rappel ajouté à la Phase 0 de D2 : **changement d'offre dans les deux sens depuis l'app (exigence App Store 1.2.3)**. Aujourd'hui, une boutique Expert ne peut passer ni en Pro ni en Gratuit sans le support. Il sera traité avec la réécriture des arguments des offres. Les rappels de D2 sont donc quatre :

1. la sauvegarde Supabase ;
2. les arguments des offres ;
3. l'exigence 1.2.3 ;
4. l'objectif de marge « non renseigné ».

## 1. Modèle Excel : bibliothèque choisie

Candidats mesurés le 2026-09-26, chacun installé dans un dossier temporaire isolé, avec `npm audit`.

| Bibliothèque | Licence | Paquets installés | Poids installé | Audit npm | Dernière version | Lecture et écriture |
|---|---|---|---|---|---|---|
| **write-excel-file 4.1.1 + read-excel-file 9.3.10** | MIT | 8 | 8 Mo | 0 | juin et août 2026 | oui (deux paquets) |
| exceljs 4.4.0 | MIT | 78 | 34 Mo | 2 modérées (ancien `uuid`) | déc. 2024 | oui |
| xlsx (SheetJS) 0.18.5 sur npm | Apache-2.0 | 8 | 7 Mo | failles connues (pollution de prototype, déni de service par regex) | 2022 sur npm ; les versions à jour ne sont distribuées que par le CDN de SheetJS, hors registre npm | oui |
| Écrivain maison sur `fflate` | MIT | 1 | 0,8 Mo | 0 | à jour | écriture simple, **lecture** des fichiers réenregistrés par Excel coûteuse à écrire soi-même |

**Recommandation : `write-excel-file` et `read-excel-file`.** Ce sont les plus légers, sans alerte, maintenus en 2026, compatibles Node 18 et plus, donc 22 et 24. Ils partagent `fflate` pour le zip.

Essai fait en isolé :

- **Écriture puis relecture en mémoire :** accents conservés (« Tee été », « Électronique »), 22.5 relu comme nombre, cellule vide relue vide.
- **Fichier d'un autre écrivain :** un fichier produit par `exceljs`, avec un format monétaire, est relu correctement (nombre et accents). C'est le comportement attendu pour un fichier réenregistré par Excel.

**Poids ajouté à l'app : côté serveur seulement.** Les deux bibliothèques ne seraient importées que dans des modules `.server`. Le code livré au navigateur ne change pas. Le build Vercel sera vérifié.

## 2. Ce que je propose d'écrire

- **Téléchargement principal « Exporter le modèle Excel (.xlsx) » :**
  - même contenu que le CSV : coûts vides si non renseignés, suggestion Shopify dans sa colonne ;
  - nombres typés et en-têtes figés ;
  - une seconde feuille « Valeurs acceptées » liste les régimes de TVA, les modes d'expédition, les pays et les catégories.
- **Téléchargement secondaire « CSV (UTF-8) » :** CSV actuel, avec en plus la marque d'encodage (BOM) pour les accents dans Excel.
- **Import :** accepte `.xlsx` (reconnu à sa signature de fichier, pas seulement à l'extension) et `.csv`. Les deux passent par les mêmes règles : « à compléter », raisons de rejet, 0 comme vrai 0. Seule la première feuille est lue.
- **Mode de téléchargement dans l'app embarquée.** Le CSV actuel est un lien `data:` construit au chargement de la page. Pour le .xlsx, fichier binaire, je propose une route de ressource authentifiée (`/app/settings/products/export`) : un clic appelle cette route par `fetch`, App Bridge ajoute le jeton de session, puis le fichier est téléchargé depuis la page. Il n'est plus construit à chaque ouverture de la page.
- **Tests :**
  - un lot 38 pour l'aller-retour .xlsx (même résultat que le CSV : 8 importées, 16 à compléter, 0 rejet) et l'import d'un .xlsx produit par un autre écrivain ;
  - un rendu réel ;
  - une preuve navigateur du téléchargement dans Edge.

## 3. Risques

1. **Téléchargement depuis l'iframe de l'admin.** Un lien simple vers la route n'aurait pas de jeton de session, d'où le passage par `fetch` puis le téléchargement depuis la page. Il faudra le prouver dans le vrai navigateur, puis en boutique.
2. **Formats non pris en charge.** `read-excel-file` ne lit que le .xlsx : pas l'ancien .xls ni le .ods. L'import le dira clairement et proposera d'enregistrer en .xlsx ou en CSV.
3. **Fichier piégé ou énorme.** La taille sera limitée avant lecture, par exemple 5 Mo, avec un message clair au-delà.
4. **Excel qui retouche les valeurs.** Excel peut transformer un texte qui ressemble à un nombre ou à une date. Les identifiants de variante (`gid://…`) ne sont pas concernés. Les cellules de coût restent des nombres, et un nombre saisi comme texte (« 12,5 ») reste accepté par l'import.
5. **Maintenance.** Les deux paquets ont le même auteur, actif en 2026. En cas d'abandon, le format .xlsx reste stable, et `exceljs` serait un repli.
6. **Build.** Les modules ESM et CommonJS doivent passer le build Vercel et les deux scripts de rendu. C'est vérifié à la gate.

Choix à confirmer : la bibliothèque (recommandation ci-dessus), la seconde feuille « Valeurs acceptées » (oui par défaut), et le téléchargement par route authentifiée plutôt qu'un lien `data:`.

## 4. Plan : 5 snowboards à « non renseigné »

Lignes visées, identifiées en lecture seule : titres par l'API Admin, prix enregistré égal au coût Shopify, port 8 estimé.

| Produit | Prix enregistré | Coût Shopify |
|---|---|---|
| The Multi-location Snowboard | 700 | 700 |
| The Collection Snowboard: Oxygen | 625 | 625 |
| The 3p Fulfilled Snowboard | 2 700 | 2 700 |
| The Multi-managed Snowboard | 500 | 500 |
| The Collection Snowboard: Liquid | 429 | 429 |

Le tee, le cap et le hoodie sont gardés : le script ne vise que les 5 identifiants de ligne ci-dessus et contrôle que les 3 autres restent en place.

Effet :

- Coûts produits : les 5 snowboards passent « à compléter ».
- Audit : il reprend le coût Shopify, marqué « à confirmer ».
- Commandes futures : sans coût tant qu'il n'est pas saisi.
- **Commandes passées : aucun effet.** Leurs instantanés de marge ne sont jamais réécrits, par construction de la synchronisation.

Préparation faite, en lecture seule : **sauvegarde des 5 lignes complètes** depuis la prod, dans le fichier de travail `snowboards_backup.json`. La base de test ne contient pas ces lignes : elle n'a pas de boutique de dev.

Étapes, **chacune sur votre GO** (script `snowboards_reset.mjs`, identifiants exacts, contrôles avant et après, aucune URL ni clé affichée) :

1. **Base de test, preuve du retour arrière :**
   - insérer une copie des 5 lignes ;
   - les supprimer et vérifier qu'elles sont absentes ;
   - les restaurer et vérifier qu'elles sont identiques champ par champ à la sauvegarde ;
   - les retirer, pour revenir à l'état initial de la base de test.
2. **Production :** supprimer les 5 lignes, vérifier qu'elles sont absentes et que tee, cap et hoodie sont toujours là. La sauvegarde reste disponible pour une restauration à l'identique.

Garde-fous du script :

- il refuse de supprimer si l'état en base diffère de la sauvegarde ;
- il refuse de restaurer par-dessus des lignes existantes ;
- les modes réservés à la base de test y sont limités.
