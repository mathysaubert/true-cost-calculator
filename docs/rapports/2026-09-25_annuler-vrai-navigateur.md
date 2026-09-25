# « Annuler » des Réglages : vraie cause, prouvée dans un vrai navigateur (2026-09-25)

Statut : correctif **écrit, gate verte, non committé** (GO attendu).
Le correctif précédent (`7a90f6f`) ne marchait pas en boutique. Le lot 35 passait parce qu'il simulait un contrat Polaris faux.

## 1. Méthode

Nouveau script `scripts/browser_reset_check.mjs` (`npm run check:browser`) :

- **Navigateur :** le vrai Edge installé, piloté par `playwright-core` (outil de développement, aucun navigateur téléchargé).
- **Polaris :** le **vrai `polaris.js`**, chargé depuis le CDN Shopify comme dans l'app.
- **Composants :** React 19 et les **vrais composants** des Réglages (`Fields.jsx`).
- **Barre de sauvegarde :** son code de suivi de formulaire est **extrait tel quel d'`app-bridge.js`**. C'est le code qui mémorise les valeurs et exécute « Annuler ».
- **Actions :** Playwright tape au clavier dans le champ, choisit une option dans la liste, puis clique « Annuler » dans la barre.

Deux chemins, reproduisant votre procédure :

1. **Arrivée par le menu** : l'app est chargée, puis la page Objectifs est rendue côté client.
2. **Page chargée en entier** : HTML du rendu serveur (fait en Node), mis à niveau par Polaris, puis hydraté.

Chaque chemin affiche 45 %, 4,90 € et TVA « franchise ». On saisit 60 et 7, on passe la TVA à « assujetti », puis on clique « Annuler ». On enregistre ensuite 50 et on recommence.

## 2. Vraie cause

Les mesures ont été faites dans le vrai navigateur, puis confirmées par la lecture de `polaris.js` et d'`app-bridge.js`.

1. **« Annuler » remet la valeur de départ que Polaris détient.** App Bridge mémorise bien la valeur au moment où le champ reçoit le focus et la réécrit, mais dans le gestionnaire de l'événement `reset`. Selon la norme HTML, cet événement passe **avant** la réinitialisation de chaque champ. Polaris réinitialise ensuite `value = defaultValue || ""`, et c'est sa valeur de départ qui l'emporte.
2. **Pour `s-text-field`, la valeur de départ ne se lit que dans l'attribut HTML `value`.** Au rendu client, React 19 pose `value` en propriété, donc aucun attribut n'existe et la valeur de départ est vide.
3. **Polaris surcharge `setAttribute` sur ses éléments.** Il ignore l'écriture d'un attribut dont le nom figure dans les props React de l'élément, ce qui est le cas de `value`. C'est ce qui a fait échouer `7a90f6f` :
   - notre écriture de `defaultValue` passait par cette surcharge et était ignorée ;
   - un `setAttribute("value", …)` direct l'était aussi.

   Seul le HTML analysé, au chargement complet, crée l'attribut, d'où la différence entre les deux chemins.
4. **Pour `s-select`, la réinitialisation vide la valeur.** La liste prend alors l'option qui porte l'attribut `selected`, ou la première option. Aucune option ne le portait, donc la TVA revenait toujours à la première option, sur les deux chemins.

La piste « valeur posée avant que Polaris soit prêt » ne s'applique pas au chemin menu : Polaris est déjà chargé quand on navigue. Elle ne jouerait que si React rendait les champs avant le chargement de Polaris, ce qui n'arrive pas dans l'app, où le script Polaris précède le contenu.

## 3. Correctif (un seul possible dans le cadre de l'option A)

Seul `app/components/settings/Fields.jsx` change côté application :

- **Nombre, texte, date :** après chaque rendu client, le crochet `useStartValue` écrit l'attribut `value` par la **méthode DOM native** (`Element.prototype.setAttribute`). Ce n'est pas la méthode surchargée par Polaris. L'attribut porte la même valeur que celle écrite par le rendu serveur.
- **Liste déroulante :** l'option enregistrée porte l'attribut `selected`. Le rendu serveur l'écrit par la prop, le rendu client par la méthode native, et il est retiré des autres options.

Tous les formulaires des Réglages en profitent :

- Coûts : coûts par commande, port, frais, coûts fixes ;
- Objectifs, Boutique, Marketing ;
- panneau des Coûts produits.

Les alternatives écartées faisaient toutes perdre l'apparence Polaris (champs HTML natifs, option B déjà refusée), ou reposaient sur un minutage fragile (réécrire les valeurs après la réinitialisation).

## 4. Preuve dans le vrai navigateur

| Contrôle | Arrivée par le menu | Page chargée en entier |
|---|---|---|
| 45 et 4,90 affichés | OK | OK |
| Saisie 60 et 7, TVA sur « assujetti », barre affichée | OK | OK |
| « Annuler » : objectif revient à 45 | OK | OK |
| « Annuler » : port revient à 4,90 | OK | OK |
| « Annuler » : TVA revient à « franchise » | OK | OK |
| « Annuler » : la barre disparaît | OK | OK |
| Aucune erreur d'hydratation | sans objet | OK |
| Après un enregistrement à 50, « Annuler » remet 50 | OK | OK |

Total : 15 contrôles OK.

**Contre-épreuve** : le même script sur le `Fields.jsx` du commit `7a90f6f` donne 6 échecs.

- *Chemin menu* : objectif et port vidés, comme en boutique ; TVA revenue à la première option ; après un enregistrement, champ vide.
- *Chargement complet* : TVA revenue à la première option ; après un enregistrement, « Annuler » remettait l'ancienne valeur 45 au lieu de 50.

Ces deux derniers défauts existaient donc aussi avant D0. Le correctif les supprime.

## 5. Lot 35 réaligné

Le lot 35 (jsdom, dans `npm test` et le build Vercel) simulait un contrat faux : une propriété `defaultValue` reflétée dans l'attribut. Il reproduit maintenant le comportement **mesuré** :

- surcharge de `setAttribute` qui ignore `value` quand c'est une prop React ;
- valeur de départ lue dans l'attribut ;
- réinitialisation de la liste par l'option `selected`.

Il reste un garde-fou rapide. La preuve est le script navigateur. Contre-épreuve : 4 échecs sur l'ancien `Fields.jsx`, 0 sur le nouveau.

## 6. Gate

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 104 warnings |
| `npm test` | 36 lots verts |
| `node scripts/render_check.mjs` | 137 scénarios OK |
| `node scripts/render_routes.mjs` | 39 rendus OK |
| `node scripts/browser_reset_check.mjs` | 15 contrôles OK dans Edge, vrai `polaris.js` |
| `npm run build` | OK |
| Fichiers protégés | 0 diff |

Le rendu serveur porte maintenant `selected=""` sur l'option enregistrée de chaque liste. Six attentes du rendu acceptent désormais cet attribut.

Dépendance ajoutée : `playwright-core` 1.63.0, en développement seulement. Aucun navigateur n'est téléchargé : le script utilise Edge, ou Chrome avec `BR_CHANNEL=chrome`. Le script navigateur n'est pas dans le build Vercel, car il demande un navigateur et le réseau. Il est à lancer à chaque gate.

## 7. Limites et suite

- Le correctif s'appuie sur deux comportements internes de Polaris : l'attribut `value` des champs texte et l'attribut `selected` des options. Si une version de Polaris les change, le script navigateur échouera, puisqu'il charge toujours le `polaris.js` publié.
- Preuve finale en boutique après deploy. Refaire votre procédure : Objectifs à 45, aller sur Aujourd'hui, revenir, saisir 60, cliquer « Annuler ». Le 45 doit revenir. Refaire avec le port par défaut et une liste, par exemple la TVA dans Boutique.
