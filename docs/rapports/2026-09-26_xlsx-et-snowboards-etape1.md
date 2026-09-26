# Modèle Excel (.xlsx) des coûts produits ; snowboards, étape 1 (2026-09-26)

Statut :

- **Snowboards, étape 1 (base de test) : faite, retour arrière prouvé.** La production n'est pas modifiée. L'étape 2 attend votre second GO.
- **Modèle Excel : écrit, gate verte, preuve dans le vrai navigateur, non committé** (GO attendu).

## 1. Snowboards : étape 1, base de test

Script `snowboards_reset.mjs` (fichier de travail), sur les 5 identifiants de ligne exacts, avec la sauvegarde prise en lecture seule depuis la production.

| Étape en base de test | Résultat |
|---|---|
| État initial | 0 ligne sur 5 (la base de test n'a pas de boutique de dev) |
| Insertion d'une copie des 5 lignes | 5 lignes, identiques champ par champ à la sauvegarde |
| **Suppression** | 5 lignes supprimées, 0 restante |
| **Restauration** | 5 lignes réinsérées, **identiques champ par champ** à la sauvegarde (19 colonnes comparées) |
| Nettoyage | 5 lignes retirées : base de test revenue à son état initial |

Contrôle en lecture seule après l'étape 1 : la production est inchangée. Les 5 snowboards sont présents, et le tee, le cap et le hoodie aussi (3 sur 3).

**Étape 2 (production, sur votre GO)** : suppression des 5 lignes, puis vérification qu'elles sont absentes et que le tee, le cap et le hoodie restent. La sauvegarde reste disponible pour une restauration à l'identique, déjà prouvée.

## 2. Modèle Excel

### 2.1 Pour le marchand

Réglages > Coûts produits, bloc « Importer ou exporter (Excel ou CSV) » :

- **Téléchargement principal : « Exporter le modèle Excel (.xlsx) ».**
  - Feuille **« Coûts »** : mêmes colonnes et mêmes règles que le CSV. Coûts vides quand ils ne sont pas renseignés, vrai 0 conservé, suggestion Shopify dans sa colonne. Nombres typés, première ligne figée.
  - Feuille **« Valeurs acceptées »** : régimes de TVA, modes d'expédition, pays et catégories.
  - Les noms des feuilles suivent la langue de la boutique (« Costs » et « Accepted values » en anglais).
- **Téléchargement secondaire : « CSV (UTF-8) »**, avec la marque d'encodage, pour que les accents s'affichent dans Excel.
- **Pendant la préparation,** le bouton .xlsx indique le chargement et l'autre bouton est désactivé. En cas d'échec : « Le fichier n'a pas pu être préparé. Rechargez la page et réessayez. »
- **Import : un fichier .xlsx ou .csv,** avec les mêmes règles : lignes « à compléter » signalées à part, rejets avec raison, 0 comme vrai 0.
  - Un ancien .xls, un fichier de plus de 5 Mo ou un classeur illisible reçoivent chacun un message clair, qui dit quoi faire.
  - Seule la première feuille est lue.

### 2.2 Technique

- **Bibliothèques (Phase 0 validée) :** `write-excel-file` 4.1.1 et `read-excel-file` 9.3.10, importées **seulement côté serveur** (`app/lib/costsXlsx.server.js`). Vérification après build : aucune trace de ces bibliothèques dans le code livré au navigateur. Audit npm inchangé : 46.
- **Route de téléchargement authentifiée :** `/app/settings/products/export?format=xlsx|csv` (`app/routes/app.settings.products_.export.jsx`). Elle renvoie le fichier en pièce jointe, sans mise en cache. La page l'appelle par `fetch`, qui reçoit le jeton de session d'App Bridge, puis enregistre le fichier depuis la page. Le lien `data:` construit à chaque ouverture de la page est supprimé, et la page ne calcule plus le CSV au chargement.
- **Règles d'import communes :** le découpage du CSV et la lecture du .xlsx produisent des lignes, validées par la même fonction (`parseCostRows`). Un .xlsx est reconnu à sa signature de fichier, pas à son extension.

### 2.3 Preuves

**Vrai navigateur** (`scripts/browser_export_check.mjs`) : vrai Edge, vrai `polaris.js`, vrai composant de la page. La route d'export est servie avec le fichier produit par le code serveur réel.

| Contrôle | Résultat |
|---|---|
| Clic « Exporter le modèle Excel » : requête fetch GET vers la route, format xlsx | OK |
| Fichier reçu par le navigateur : `true-cost-calculator-costs.xlsx` | OK |
| Fichier relu : feuilles « Coûts » et « Valeurs acceptées » | OK |
| Tee à 21,5 en nombre, « Électronique » et « Tee été » intacts | OK |
| Snowboard sans coût saisi : cellules vides | OK |
| Clic « CSV (UTF-8) » : fichier `.csv` avec marque d'encodage, accents intacts | OK |
| Pendant la préparation : chargement et bouton désactivé | OK |
| Erreur serveur : message affiché | OK |

**Vraie app côté serveur** (`scripts/export_route_check.mjs`) : vrai gestionnaire de requêtes, vraies routes, vrai `authenticate.admin` avec jeton de session signé. Shopify et la base sont simulés, et aucune écriture réelle n'a lieu.

| Contrôle | Résultat |
|---|---|
| Route .xlsx : 200, type .xlsx, pièce jointe | OK |
| Feuilles nommées dans la langue de la boutique (fr) | OK |
| Tee saisi à 22 ; Cap vide avec suggestion 20 ; Snowboard vide sans suggestion | OK |
| Route CSV : 200, marque d'encodage | OK |
| Sans jeton de session : aucun fichier servi (page d'authentification) | OK |
| Import d'un .xlsx par l'action de la page : 1 variante enregistrée (Cap, 18,5, « importé ») | OK |
| Réponse : 1 importée, 1 à compléter (Snowboard), 0 rejet | OK |

**Lot 38** (20 assertions) :

- aller-retour .xlsx avec le même résultat que le CSV : 8 importées, 16 à compléter, 0 rejet ;
- fichier retouché : « 12,40 » saisi en texte, catégorie en minuscules, quantité vide ;
- ancien .xls, zip illisible, taille bornée ;
- CSV avec marque d'encodage ;
- bibliothèques jamais importées côté navigateur.

## 3. Gate

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 104 warnings |
| `npm test` | 38 lots verts |
| `node scripts/render_check.mjs` | 139 scénarios OK |
| `node scripts/render_routes.mjs` | 39 rendus OK |
| `npm run check:browser` | 3 preuves navigateur OK (Annuler, abonnement, export) |
| `npm run check:server` | 2 preuves serveur OK (abonnement, export et import) |
| `npm run build` | OK ; bibliothèques .xlsx absentes du code navigateur |
| Fichiers protégés | 0 diff |

Ajustements de tests :

- **Lot 32 :** l'assertion « aucun état React » admet désormais le seul état du téléchargement (bouton en attente). Tout autre `useState`, `onChange` ou `useFetcher` reste interdit dans ce fichier.
- **Lot 26 :** il lit aussi la route d'export, pour les clés de catalogue des noms de feuilles.
- **Stub Supabase :** il note les écritures, sans effet, pour la preuve serveur.

## 4. À vérifier en boutique après deploy

1. Réglages > Coûts produits : « Exporter le modèle Excel (.xlsx) ». Le fichier doit s'ouvrir dans Excel en colonnes, avec les accents, et avec deux feuilles.
2. Réimporter ce .xlsx sans le modifier. Le résultat attendu avant l'étape 2 : 8 importées, 16 à compléter, 0 rejet. Après l'étape 2 : 3 importées, 21 à compléter.
3. « CSV (UTF-8) » : dans Excel en français, les accents doivent être corrects. Les colonnes, elles, dépendent de la langue de Windows : c'est la raison du .xlsx en principal.

## 5. Décisions attendues

1. GO pour le commit du modèle Excel. Le commit inclura aussi le rapport de Phase 0 de ce matin.
2. GO pour l'étape 2 des snowboards en production.
