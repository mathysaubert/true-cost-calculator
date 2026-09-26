# D2-3 : suppression du code de l'écran classique (2026-09-26)

Statut : **écrit, gate verte, non committé** (GO attendu).

Les arbitrages Z1 à Z9 sont consignés dans `2026-09-22_decisions.md`, section N. La tarification est en section M.

## 1. Ce qui change pour le marchand

- **Plus d'écran classique.** L'adresse `/app`, page d'accueil de l'app dans l'admin, **redirige vers Aujourd'hui** en gardant les paramètres de l'admin (boutique, hôte, jeton).
- **Retour après abonnement :** Shopify renvoie vers `/app?subscribed=true`, qui mène maintenant à **Réglages > Offre** avec le message de bienvenue.
- **Menu de l'admin :** l'entrée « Écran classique » disparaît, et l'accueil pointe vers Aujourd'hui.
- **État vide (Aujourd'hui, Indicateurs, Simulateur, Produits) :** le bouton « Ouvrir l'écran classique » disparaît. Il reste « Compléter les réglages ».
- **Réglages > Objectifs :** la ligne qui rappelait l'ancien seuil d'alerte des calculs de l'écran classique (table `margin_alerts`) disparaît.
- **Aucune donnée n'est supprimée** dans ce lot. Les tables et colonnes de l'écran classique restent en base jusqu'à D2-4.

## 2. Code supprimé ou modifié

| Élément | Traitement |
|---|---|
| `app/routes/app._index.jsx` (écran classique, environ 4 000 lignes) | remplacé par une redirection de 11 lignes |
| `app/components/costsUi.jsx`, `customsUi.jsx` | supprimés (remplacés par Réglages > Coûts produits) |
| `app/lib/aiPayload.js`, `roas.js` | supprimés (recommandation IA, retour prévu en I1, X8) |
| `app/lib/cpaTargets.js` | supprimé |
| `app/lib/recalcEstimatedMargins.server.js`, `recalcMargins.js` | supprimés : recalcul des marges estimées de l'écran classique ; le moteur `econ` ne réécrit jamais les instantanés |
| `app/routes/debug.jsx` | supprimé (Z9) |
| Recopie des réglages vers `shop_plans` (`MIRROR_COLUMNS`, `mirrorFor`) | retirée : l'app écrit dans `shop_settings` seulement |
| Réglages > Objectifs | ne lit plus `margin_alerts` |
| `scripts/customs_confirm_proof.mjs`, `recalc_estimated_margins.mjs`, `recalc_live_proof.mjs` | supprimés (outils du recalcul) |
| Tests `lot2_ui_labels`, `lot4_display_guardrails`, `lot15_cpa_targets`, `lot19_recalc_margins` | supprimés : ils testaient du code supprimé |
| Clés de catalogue `nav.legacy`, `overview.empty.cta_legacy`, `settings.goals.alert_threshold` | supprimées (en et fr) |

Bilan : 36 fichiers touchés, **6 331 lignes supprimées**, 111 ajoutées.

**Gardés, car utilisés ailleurs :**

- `engine.js` (import des commandes, coûts, douane), toujours protégé ;
- `orderSync.server.js` (cron de rentabilité) ;
- `orderHistory.js`, `auditClassify.js`, `variantCosts.js`, `customsClassification*.js`, `plan*.js`, `betaShops.js` ;
- `crypto.server.js` (futures connexions publicitaires, décision 20).

**Reste de fonctions mortes dans des modules gardés,** à nettoyer plus tard sans urgence :

- `variantCosts.js` : l'ancien CSV (`parseCostsCsv`, `buildCostsCsv`, `validateCostRow`) ;
- `orderHistory.js` : ventilations de l'ancien monitor ;
- `auditClassify.js` : `classifyAudit`, `auditLabels`.

`engine.js` n'est pas touché : il reste protégé.

**Tests adaptés** : ils visaient l'écran classique et visent maintenant le code qui reste.

- **Lot 21 :** le branchement bêta, dans `billing.server.js`.
- **Lot 22 :** `maxDuration` des crons de synchronisation et de rentabilité.
- **Lot 32 :** facturation, dans le seul module qui reste.
- **Lot 29 :** plus de recopie vers `shop_plans`.
- **Lot 26 :** liste d'exclusions.
- **Lot 39 :** plus de lien ni d'entrée de menu vers l'écran classique.
- **Lot 20 :** le bloc du recalcul retiré.

**Preuves adaptées :**

- **Rendu réel :** les composants supprimés sont retirés, et les états vides et les Objectifs vérifient l'absence de l'écran classique.
- **Rendu des routes :** il vérifie les deux redirections.
- **Preuve serveur d'abonnement :** elle ne compare plus avec l'écran classique, qui n'a plus d'action.

## 3. Gate

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 24 warnings (104 avant : l'écran classique en portait 80) |
| `npm test` | 35 lots verts (39 moins les 4 supprimés) |
| `node scripts/render_check.mjs` | 112 scénarios OK (31 scénarios des composants supprimés retirés) |
| `node scripts/render_routes.mjs` | 41 rendus OK, dont `/app` → Aujourd'hui (paramètres gardés) et `/app?subscribed=true` → Offre |
| `npm run check:browser` | 4 preuves OK (Annuler, abonnement, export, bandeau et erreurs en build minifié) |
| `npm run check:server` | 2 preuves OK (abonnement : 401 et redirection Shopify ; export et import .xlsx) |
| `npm run build` | OK |
| Fichiers protégés | `engine.js`, `econ/*`, `sync/*` : 0 diff. `app._index.jsx` n'est plus protégé : c'est l'objet du lot |

## 4. À vérifier en boutique après deploy

1. Ouvrir l'app depuis l'admin : elle arrive sur Aujourd'hui. Le menu n'a plus « Écran classique ».
2. Dans un état vide (commandes de test exclues) : seul « Compléter les réglages » est proposé.
3. Réglages > Objectifs : plus de ligne sur l'ancien seuil d'alerte.
4. Réglages > Boutique ou Objectifs : enregistrer un réglage fonctionne toujours (écriture dans `shop_settings` seulement).

**Lot suivant : D2-4 (base de données).** Il demande d'abord votre sauvegarde Supabase, puis une relecture des calculs restants (X10), puis la migration en base de test avec retour arrière prouvé, puis en production, avec un GO par étape.

## 5. Ce que vous devrez faire vous-même pour D2-0 (vérification de Shopify App Pricing)

But : essayer la tarification Shopify **sur une app de test séparée**, sans jamais toucher la vraie app. Les libellés exacts des menus peuvent différer légèrement de ceux indiqués.

1. **Créer l'app de test.**
   - Dans le Partner Dashboard (partners.shopify.com), même organisation que True Cost Calculator : Apps → Créer une app → création manuelle.
   - Nom : par exemple « TCC tarification test ».
   - Si le Dashboard le demande pour la tarification Shopify, choisir une distribution **publique, non listée** sur l'App Store.
2. **Créer une boutique de développement dédiée,** par exemple « tcc-tarif-test ». Garder la boutique de dev actuelle hors de l'essai.
3. **M'indiquer, sans les écrire dans le chat :**
   - le **Client ID** et le **Client secret** de l'app de test, dans le fichier `.env.test` (lignes que je vous préparerai) ;
   - le **nom de domaine** de la nouvelle boutique (`xxx.myshopify.com`), qui peut, lui, être dit dans le chat.
4. **Activer la tarification Shopify sur l'app de test seulement.** Dans l'app de test : Distribution / Tarification (« Pricing ») → choisir la **tarification gérée par Shopify** (Shopify App Pricing).
   - Ce choix est **sans retour arrière documenté** : c'est la raison de le faire sur l'app de test.
5. **Créer les plans de l'app de test :**
   - « Gratuit » à 0 $ ;
   - « Pro » à 29 $ par mois, essai de 14 jours ;
   - « Expert » à 69 $ par mois, essai de 14 jours ;
   - un **plan privé** « Expert bêta » à 69 $ par mois, essai de 45 jours, accès réservé au domaine de la boutique de test.
6. **Créer un accès à l'API Partner.** Dans les réglages de l'organisation : Clients API Partner → créer un client avec la permission **« Gérer les apps »** (« Manage apps »). Mettre le jeton et le numéro d'organisation dans `.env.test`, jamais dans le chat.
7. **Lancer l'app de test sur la boutique.** Je préparerai une configuration séparée (`shopify.app.<test>.toml`). Vous taperez une commande du type `shopify app dev --config <test>`, qui demande votre connexion Shopify et que je ne peux pas faire à votre place.
8. **Faire les parcours, avec moi en direct :**
   - installer l'app ;
   - ouvrir la page d'offres de Shopify et choisir Pro (essai de 14 jours) ;
   - descendre en Gratuit, puis monter en Expert (**cycle Expert → Pro → Expert** compris) ;
   - vérifier que le plan privé n'apparaît que sur la boutique autorisée ;
   - après son essai de 45 jours (simulé si Shopify le permet), vérifier si un second essai est proposé.

   Pendant ce temps, je vérifie comment l'app lit l'offre : par sa requête actuelle ou par l'API Partner.
9. **À la fin :** vous pourrez supprimer l'app de test et la boutique de test. **Rien n'est activé sur la vraie app sans votre GO séparé.**

À garder à l'esprit : la documentation de Shopify ne tranche pas deux points, et ce sont eux que D2-0 doit trancher. D'abord, est-ce que la requête actuelle de l'app voit encore les abonnements App Pricing ? Ensuite, un marchand passé par le plan privé bêta reçoit-il un nouvel essai de 14 jours sur le plan public ?
