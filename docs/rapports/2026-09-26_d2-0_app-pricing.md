# D2-0 — Essai de Shopify App Pricing sur une app de test (2026-09-26)

Statut : essai terminé, à la demande de Mathys, après l'étape 8f. La vraie app n'a pas été touchée. Rien n'est commité.
Préparation et incidents du lancement : `2026-09-26_d2-0_preparation-etape-7.md`.

## 1. Réponse aux deux questions de D2-0

| Question | Réponse |
|---|---|
| La requête actuelle de l'app voit-elle les abonnements App Pricing ? | **Oui.** `currentAppInstallation.allSubscriptions`, en version 2026-01 comme l'app aujourd'hui, renvoie l'abonnement avec son **nom de plan** (« Pro », « Expert », « Free ») et son statut. |
| Un marchand passé par le plan privé bêta reçoit-il un nouvel essai sur le plan public ? | **Non mesurable ici.** Sur la boutique de développement, Shopify a redonné un essai complet à chaque souscription, même sur une offre déjà essayée. D'après la documentation de Shopify (relevée par Mathys), une boutique réelle suit les jours d'essai **par offre, sur 180 jours, même après réinstallation**. Un testeur pourrait donc enchaîner Expert Beta (45 jours) puis Expert (14 jours), ce qui est contraire à Y6. |

## 2. Mise en place (étapes 1 à 7)

- **App de test.** « TCC Tarification test » (organisation Sprintweb), créée dans le Dev Dashboard, identifiant Partner 428433932289. **La tarification App Pricing était activée d'office** (« App Pricing enabled »), sans choix et sans avertissement. Aucun retour en arrière n'est proposé.
- **Boutique.** tcc-tarif-test.myshopify.com, offre Basic, données de test générées.
- **Plans.**
  - Publics : Free (gratuit, identifiant `free`), Pro (29 $ par mois, essai de 14 jours, `pro`), Expert (69 $ par mois, essai de 14 jours, `expert`).
  - Privé : Expert Beta (69 $ par mois, essai de 45 jours, `expert-beta`), réservé à tcc-tarif-test.
  - Contraintes du formulaire : **le nom sur les factures fait 18 caractères au plus, ne peut plus être modifié, et doit correspondre au nom de la fiche**. Même règle pour l'identifiant interne (30 caractères au plus).
- **Lancement.** Configuration séparée `shopify.app.tcc-tarif-test.toml` et lanceur `scripts/d2_0_dev.mjs`, avec preuve et garde-fous, sur la base **tcc-test** uniquement.
- **Incidents du lancement,** tous corrigés et documentés dans le rapport de préparation :
  - des webhooks à données protégées refusés ;
  - un démarrage qui a **lu** la production (rien d'écrit, vérifié) ;
  - l'hôte du tunnel bloqué par Vite ;
  - un arrêt natif de Node (`0xC0000409`) au premier pré-regroupement de Vite, qui ne s'est pas reproduit.

## 3. Mesures (lecture seule, API Admin de la boutique de test)

| Étape | Page d'offres Shopify | Abonnements (allSubscriptions) | Conclusion de l'app (code actuel) |
|---|---|---|---|
| Départ | 4 cartes : Expert Beta (« Créé pour vous », en tête), Free, Pro, Expert ; prix barrés à 0 $ (boutique de dev) | Aucun | Gratuit |
| 8b. Pro | Approbation « Forfait : Pro », « Gratuit », sans nombre de jours | **Pro ACTIVE**, `trialDays: 14`, fin de période +14 jours, prix 0 $, `test: false`, retour `?plan_handle=pro` | **free** (cache `shop_plans` à 14:29:41) : le nom « Pro » n'est pas reconnu |
| 8d. Descente en Free | Pro marquée « Actuel » ; approbation « Forfait : Free », rien sur la fin de Pro | **Free ACTIVE** (0 $, 30 jours, sans essai, `plan_handle=free`) ; Pro **CANCELLED immédiatement** | free |
| 8e. Montée en Expert | Expert « 14 jours d'essai » | **Expert ACTIVE**, essai complet de 14 jours ; Free CANCELLED | free (nom non reconnu) |
| 8f. Retour en Pro | Pro « 14 jours d'essai restants » | **Nouveau Pro ACTIVE, essai complet de 14 jours**, alors que Pro avait déjà été essayé | free |

**API Partner.** `activeSubscription(appId, shopId)` existe en 2026-07 et en unstable. Elle renvoie `items.handle`, `trialEndsAt`, `legacySubscriptionId`, etc., avec la seule permission « Gérer les applications ». Elle renvoie `null` ici : l'app de test, créée dans le Dev Dashboard, est invisible pour l'API Partner. La vraie app, elle, est visible (vérifié).

## 4. Enseignements

1. **L'app voit les abonnements App Pricing sans changer de requête.** Elle les reconnaît **par le nom du plan**, qui est court (18 caractères au plus) et fixé à la création.
2. **Le code actuel classe tout abonné App Pricing en Gratuit,** parce qu'il attend « True Cost Calculator Pro » et « True Cost Calculator Expert ». Activer App Pricing sur la vraie app **avant** le correctif ferait perdre l'accès payant à tout nouvel abonné.
3. **Gratuit est un vrai abonnement ACTIVE à 0 $.** L'app ne doit jamais déduire « payant » d'un abonnement actif, ni du prix (0 $ sur une boutique de dev).
4. **Chaque changement d'offre crée un nouvel abonnement et annule l'ancien immédiatement.** L'historique `allSubscriptions`, déjà utilisé par l'app, garde toute la trace.
5. **L'identifiant du plan** n'est pas un champ de l'abonnement dans l'API Admin. Il figure dans l'adresse de retour (`plan_handle`, avec `charge_id`) et dans l'API Partner (`items.handle`).
6. **Montée, descente et offre privée** fonctionnent par la page d'offres de Shopify, ce qui satisfait l'exigence 1.2.3 (changer d'offre dans les deux sens). L'offre privée n'apparaît que sur la boutique autorisée ; sa visibilité ailleurs n'a pas été testée.
7. **Les essais ne se mesurent pas sur une boutique de développement.** Selon la documentation, sur une vraie boutique, l'essai est suivi par offre sur 180 jours.

## 5. Constats secondaires (pour D2-1 et D2-2)

- **Page Offre de l'app :** elle annonce « 7 jours d'essai gratuit » alors que Y5 prévoit 14 jours. Ses boutons « Choisir Pro » et « Choisir Expert » passent par l'API de facturation de l'app (`requestSubscription`), que l'essai n'a pas utilisée.
- **Lien « Voir les offres » (Produits → Offre) :** il a affiché une page vide jusqu'au rafraîchissement. À reproduire en D2-1.
- **Ordre des cartes :** Shopify place l'offre privée en tête, avec la mention « Créé pour vous ».

## 6. Recommandation pour activer App Pricing sur la vraie app

L'activation est irréversible. Elle ne doit venir **qu'après** un code capable de reconnaître les nouveaux abonnements, déployé et prouvé.

### Ordre proposé

1. **D2-1 (code).**
   - Reconnaître les plans App Pricing par leur nom : ajouter les alias « Pro » et « Expert » aux listes prévues pour ça (`PRO_NAMES` et `EXPERT_NAMES`, `plan.server.js`), **en gardant** les anciens noms. Shopify l'indique sur la page Pricing : les abonnements existants restent en facturation manuelle tant qu'on ne les migre pas.
   - Rattacher explicitement « Free » à Gratuit.
   - Remplacer les boutons d'abonnement de la page Offre par un lien vers la page d'offres de Shopify (`/charges/<handle de l'app>/pricing_plans`).
   - Corriger les durées d'essai affichées (14 jours).
   - Tests et preuves navigateur. Rendu vérifié sur **cette app de test**, qu'on garde pour ça : relancer `node scripts/d2_0_dev.mjs run`, puis vérifier que Pro et Expert sont reconnus.
2. **Déploiement de D2-1 en production**, sans effet visible tant qu'App Pricing n'est pas activée, puisque les anciens noms restent reconnus.
3. **Création des plans sur la vraie app,** par Mathys, dans le Partner Dashboard :
   - noms **identiques à ceux de la fiche** App Store (18 caractères au plus, définitifs), par exemple « Pro » et « Expert » ;
   - essai de 14 jours ;
   - identifiants `free`, `pro` et `expert`.
4. **Activation d'App Pricing sur la vraie app,** sur GO séparé.
5. **Vérification sur true-cost-dev.** Souscrire, puis vérifier dans l'app l'offre reconnue et l'accès aux fonctions Pro et Expert. Refaire le cycle de descente et de remontée.
6. **Plus tard (décision séparée) : migration des abonnés existants.** L'API Partner unstable propose `migratableAppSubscriptions` et `appSubscriptionMigrationOperation`. Tant que la migration n'est pas faite, les anciens noms restent reconnus.

### Bêta Y6 : deux options à trancher en Phase 0 de D2-1

| Option | Effet | Limite |
|---|---|---|
| **A. Plan privé « Expert Beta » (45 jours)** | Déjà essayé : visible uniquement pour la boutique autorisée | Essai suivi par offre : Expert Beta puis Expert = 45 + 14 jours, contraire à Y6 |
| **B. Pas de plan privé : Expert public + prolongation d'essai par marchand** depuis le Partner Dashboard (fonction documentée par Shopify, proposée par Mathys) | Un seul plan, donc un seul compteur d'essai : pas de cumul | Fonction non essayée ici : sa disponibilité avec App Pricing et sa durée maximale restent à vérifier |

Recommandation : l'**option B**, sous réserve de vérifier dans la documentation, en Phase 0 de D2-1, que la prolongation marche avec App Pricing et jusqu'à 45 jours. Elle respecte Y6 sans code particulier. Le mécanisme actuel de la bêta (liste `BETA_SHOPS`) serait alors à retirer ou à revoir en même temps.

### Reconnaissance par nom ou par l'API Partner

- **Par nom (recommandé pour D2-1).** Aucune nouvelle dépendance, et la même requête qu'aujourd'hui, qui est prouvée ici.
- **Par l'API Partner `activeSubscription`.** Plus riche (`items.handle`, `trialEndsAt`), mais elle demande de garder un jeton d'organisation côté serveur (Vercel), et elle n'est disponible qu'en 2026-07 (version candidate) et en unstable. À envisager plus tard, en contrôle croisé, pas comme source principale.

## 7. Nettoyage (étape 9)

| Élément | Recommandation |
|---|---|
| Terminal de l'app de test | Arrêter (`q`) |
| App « TCC Tarification test » et boutique tcc-tarif-test | **Garder jusqu'à la fin de D2-1** pour vérifier le correctif, puis supprimer (Dev Dashboard) |
| Client API Partner « TCC tarification test » | Garder (utile pour la vraie app et la migration) ; sinon, révoquer |
| Données de l'essai sur tcc-test | 1 session, 1 ligne `shop_settings`, 1 ligne `shop_plans` pour tcc-tarif-test. Sans effet ; à supprimer sur GO (mutation de la base de test) ou à laisser jusqu'à D2-1 |
| Fichiers locaux | `scripts/d2_0_dev.mjs` et `shopify.app.tcc-tarif-test.toml` (le Client ID n'est pas un secret) : à commiter avec les rapports sur GO. `.env.tcc-tarif-test` reste ignoré par git |
| Vraie app | Vérifier qu'elle s'ouvre toujours normalement dans true-cost-dev : la mise à jour d'adresses (« Update URLs ») n'a porté que sur l'app de test |
