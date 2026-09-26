# Trois défauts vus en boutique : bandeau de test, erreur « [object Object] », taux de retour (2026-09-26)

Statut : trois correctifs **écrits, gate verte, preuves dans le vrai navigateur, non committés** (GO attendu).
Un seul correctif était possible pour chacun : il est écrit.

Test 10 validé par vos soins : la commande de test arrive en quelques secondes. Les relances ne sont pas prouvables sans les journaux Vercel, c'est noté.

## 1. « Inclure les commandes brouillon et de test » ne marche pas sur Produits

**Cause.** Le bandeau envoyait sa demande à l'action de la **page courante**. Seule Aujourd'hui traite cette demande. Ailleurs, l'action répondait « demande inconnue », que la page Produits affiche « Cette action n'est pas disponible ».

**Pages concernées :** les quatre qui affichent ce bandeau.

| Page | Avant | Après |
|---|---|---|
| Aujourd'hui | fonctionnait | fonctionne |
| Produits | « Cette action n'est pas disponible » | fonctionne |
| Indicateurs | sans effet (pas d'action sur la page) | fonctionne |
| Simulateur | sans effet (son action ne connaît pas cette demande) | fonctionne |

**Correctif :** dans le composant du bandeau, la demande part vers l'action d'Aujourd'hui par un « fetcher » de React Router. On reste sur la page, ses données sont rechargées, et le bouton affiche un chargement pendant l'envoi. En cas d'échec, un message traduit s'affiche.

**Preuve dans le vrai navigateur** (Edge, vrai composant, vrai `polaris.js`), sur une page Produits :

- le clic appelle l'action d'Aujourd'hui ;
- l'adresse reste `/app/products`, sans « Cette action n'est pas disponible » ;
- les données de la page sont rechargées (1 puis 2 chargements) et le libellé du bouton bascule.

## 2. « Ouvrir l'écran classique » mène à « App Error [object Object] »

**Cause, en deux temps.**

1. **Le bouton de l'état vide était un lien HTML brut** (`<a href="/app">`). Il rechargeait toute la page dans l'iframe de l'admin, sans les paramètres de session. Le serveur répond alors par la page d'authentification de Shopify (« bounce »), qui obtient un jeton puis recharge. Le menu, lui, passe par App Bridge, d'où la différence.
2. **Cette réponse devait être affichée par `boundary.error`** de `@shopify/shopify-app-react-router`. Or cette fonction la reconnaît par le **nom de classe** (`ErrorResponseImpl`). Dans le bundle de production minifié, cette classe s'appelle « Xe » (mesuré dans notre build). Le test échoue, l'erreur remonte à la page d'erreur racine, et celle-ci affichait `error.message || String(error)`, soit « [object Object] ».

**Correctif :**

- **Le lien de l'état vide** devient un lien React Router, qui fait une navigation interne avec la session, comme le menu.
- **`app/lib/routeError.jsx`** remplace `boundary.error` dans les **14 routes** de l'app, écran classique protégé excepté. Il reconnaît ces réponses par `isRouteErrorResponse`, la fonction officielle de React Router, qui ne dépend d'aucun nom, et les affiche comme Shopify. Toute autre erreur remonte à la racine.
- **La page d'erreur racine** (`app/root.jsx`) affiche désormais un message lisible et traduit, avec un code court :
  - « Une erreur est survenue » ;
  - un message selon le cas : session expirée (401/403, « Rouvrez l'app depuis votre admin Shopify »), page introuvable (404), service indisponible (503), ou message général ;
  - un bouton « Recharger la page » ;
  - « Code 401 » ou « Détail : … » en petit.

  Jamais d'objet converti en texte.
- **Langue de la page d'erreur :** celle de l'app si elle est chargée. Sinon, celle du nouveau loader racine (cookie, langue du navigateur). En dernier recours, l'anglais. Le loader racine n'envoie que les 8 textes d'erreur : le fichier racine livré au navigateur pèse 2,3 Ko, sans catalogue.

**Liens vers l'écran classique vérifiés :**

- Le bouton de l'état vide, présent sur Aujourd'hui, Indicateurs, Simulateur et Produits, était le seul lien HTML brut vers `/app` dans l'app, écran classique protégé excepté. Il est corrigé.
- Les deux entrées du menu de l'admin, « Accueil » et « Écran classique », passent par App Bridge. Elles sont inchangées et fonctionnaient.

**Preuves :**

- **Vrai navigateur, build de production minifié.** Une page construite par `vite build` avec minification, comme en production. Le contrôle vérifie que la classe a bien perdu son nom dans ce bundle.

  | Montage | Résultat |
  |---|---|
  | Avant : `boundary.error` de Shopify et ancienne page racine | « App Error[object Object] », défaut de la boutique reproduit |
  | Après : `embeddedErrorBoundary` | la page d'authentification Shopify s'affiche, pas d'erreur |
  | Filet : nouvelle racine avec une erreur non reconnue | « Une erreur est survenue. La page n'a pas pu s'afficher… Code 200 » |

- **Lot 39 :** la réponse minifiée est rejetée par Shopify et reconnue par le correctif. Il vérifie aussi les messages par statut, qu'aucun « [object Object] » n'apparaît, les 14 routes et l'absence de lien brut.
- **Rendus réels de la page d'erreur racine :** 401 en français, objet inconnu, `Error` avec détail, et anglais de secours sans aucune donnée.

## 3. « Il manque 1 commande » dans l'audit

**Cause.** Commandes de test exclues, la période ne retient **aucune** commande. L'indicateur « Taux de retour » renvoie alors un **drapeau** « aucune commande », qui vaut 1. L'audit le lisait comme un nombre de commandes manquantes. Le seuil réel est bien de **50 commandes sorties de leur fenêtre de retour**, comme dit hier.

**Correctif :** l'audit ne lit plus que le vrai manque (`orders_out_of_window`). Deux messages distincts :

- **Aucune commande retenue :** « Taux de retour non mesurable : aucune commande retenue sur la période (commandes de test exclues, s'il y en a)… ».
- **Pas assez de commandes :** « Taux de retour pas encore mesurable : il faut 50 commandes sorties de leur fenêtre de retour ; il en manque N… ».

Preuve dans le lot 39 :

- drapeau « aucune commande » : « aucune commande », pas 1 ;
- 3 commandes mûres sur 50 : « il en manque 47 » ;
- indicateur mesurable : 4,3 %.

## 4. Fichiers et gate

**Fichiers modifiés :**

- `app/components/overview/Banners.jsx` (bandeau) ;
- `app/components/overview/Blocks.jsx` (lien) ;
- `app/lib/routeError.jsx` (nouveau) ;
- `app/root.jsx` (loader et page d'erreur) ;
- les 14 routes (`embeddedErrorBoundary`) ;
- `app/lib/products.js`, `components/products/CatalogAudit.jsx`, `routes/app.products.jsx` (taux de retour) ;
- catalogues en/fr (`error.*`, message « aucune commande ») ;
- lot 26 (famille de clés `error.*`), lot 39 (nouveau), `scripts/render_check.mjs` ;
- `scripts/browser_errors_check.mjs` et ses pages `scripts/browser/errors*`.

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 104 warnings |
| `npm test` | 39 lots verts |
| `node scripts/render_check.mjs` | 143 scénarios OK |
| `node scripts/render_routes.mjs` | 39 rendus OK |
| `npm run check:server` | 2 preuves serveur OK |
| `npm run check:browser` | 4 preuves navigateur OK |
| `npm run build` | OK ; fichier racine navigateur de 2,3 Ko, sans catalogue |
| Fichiers protégés | 0 diff |

## 5. Preuves navigateur (`npm run check:browser`)

| Preuve | Résultat |
|---|---|
| « Annuler » des Réglages | OK |
| Boutons d'abonnement | OK |
| Téléchargement .xlsx / CSV | OK |
| Bandeau et erreurs en build minifié (nouveau) | 7 contrôles OK |

## 6. À vérifier en boutique après deploy

1. Page Produits avec l'état vide : cliquer « Inclure les commandes brouillon et de test ». La page reste sur Produits et affiche les commandes de test. Refaire depuis Indicateurs et Simulateur.
2. Commandes de test exclues : cliquer « Ouvrir l'écran classique » dans l'état vide. L'écran classique doit s'ouvrir, sans page d'erreur.
3. Audit du catalogue, commandes de test exclues : « aucune commande retenue sur la période ». Commandes de test incluses : « il faut 50 commandes… il en manque N ».
