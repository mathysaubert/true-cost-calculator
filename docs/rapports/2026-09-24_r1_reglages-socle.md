# R1 — Réglages socle : accueil, Coûts, Objectifs (2026-09-24)

Suite de `2026-09-24_r0_migrations-reglages.md` (R0 committé `ba87d49`, migrations S-01 et S-02
appliquées test et prod). Arbitrages S1-S10 dans `2026-09-22_decisions.md` §I. GO d'écriture R1
reçu le 2026-09-24 : « rien de committé sans mon GO, rapport à la fin avec les preuves à faire sur
la boutique de dev ».

Statut : **écrit et prouvé localement (gate complète verte). Aucune migration, aucun commit, aucun
push.** `app/routes/app._index.jsx`, `app/lib/engine.js`, `app/lib/econ/*`, `app/lib/sync/*` :
0 diff.

## 1. Problème

Les réglages que le moteur lit (`gateway_fee_rules`, `shipping_cost_rules`, emballage, coût par
retour, coûts fixes, objectifs, prix du produit principal) n'avaient aucun écran ; l'écran
classique n'écrit que `shop_plans`. Frais et port restaient « à confirmer » partout, les coûts
fixes inexistants, le point mort « inconnu », le score de fiabilité plafonné.

## 2. Solution

### 2.1 Module pur `app/lib/settings.js` (127 lignes)

| Export | Rôle |
|---|---|
| `SETTINGS_NAV` | 6 sujets (S2) : accueil, Coûts, Objectifs livrés ; Boutique, Marketing, Connexions « Bientôt » (R2) |
| `FIELDS` | champs scalaires par formulaire : colonne, unité (`money`, `pct`, `int`), bornes ; `profitability_threshold_pct` marqué `mirror` |
| `MIRROR_COLUMNS` | 7 colonnes historiques recopiées vers `shop_plans` (S1a) |
| `parseNumber`, `parseFields` | virgule française et espaces fines acceptées (NFKC), vide = NULL (jamais un défaut inventé), invalide et hors bornes signalés sans écriture |
| `shippingRulesFromForm` | port par défaut + jusqu'à 5 surcharges pays (code ISO-2, majuscules), `confirmed: true` à la sauvegarde (A3, S6) |
| `gatewayRuleFromForm`, `mergeGatewayRule`, `ruleFor`, `gatewaysFromOrders`, `presetFor` | une règle par passerelle (S4) : sauvegarder = confirmer ; passerelles vues dans `orders.gateway_names` ; valeurs usuelles = placeholders seulement |
| `fixedCostFromForm`, `isActiveFixedCost` | libellé libre, montant mensuel, actif du / au (S5) |
| `mirrorFor`, `dataRuleOf` | recopie ; règle de fiabilité touchée par chaque intent (S10) |
| `settingsStatus` | 8 états `set` / `unset` / `unconfirmed` avec leur page (accueil) |

### 2.2 Serveur `app/lib/settings.server.js` (58 lignes)

`loadSettings` (réglages, coûts fixes, passerelles vues sur 90 jours, jour boutique) ;
`saveSettings` : upsert `shop_settings` puis upsert `shop_plans` des colonnes miroir (le trigger
R0-02 relit des valeurs identiques et ne réécrit rien) ; `saveGatewayRule` (fusion),
`saveShippingRules`, `addFixedCost`, `endFixedCost` (fin = jour boutique), `deleteFixedCost` ;
`recordSettingsFix` : `decision_log` `data_fixed` explicite `{ rule_id, field, source: "settings" }`,
une par règle et par jour (dédoublonnage par `scenario->>rule_id`), jamais bloquante.

### 2.3 Composants `app/components/settings/`

| Fichier | Contenu |
|---|---|
| `SettingsNav.jsx` | sous-navigation en pastilles, `aria-current`, « Bientôt » grisés |
| `Fields.jsx` | `NumberField`, `TextField`, `DateField` = `s-text-field` **non contrôlés** (`name`, `value` initial, `placeholder`, `details`, `error`, `suffix`) ; `SettingsBanner` succès / champs / échec |
| `CostsForms.jsx` | `OrderCostsForm` (emballage, coût par retour, fenêtre de retour, promesse de livraison), `ShippingForm` (défaut + 5 pays, badge Renseigné / À confirmer), `GatewayRules` (un formulaire par passerelle vue, badge Confirmé / À confirmer, phrase des valeurs usuelles, message si aucune passerelle), `FixedCosts` (lignes actives / terminées, total mensuel, Terminer aujourd'hui, Supprimer, ajout) |
| `GoalsForm.jsx` | CM2 cible (0 affiché vide, bande 40-60 en rappel), marge après pub, prix du produit principal ; seuil d'alerte de l'écran classique rappelé sous son nom, inchangé (S7a) |
| `SettingsIndex.jsx` | états par page avec lien « Ouvrir » |

Chaque formulaire est un `<Form method="post">` natif avec un `intent` caché ; aucun `useState`,
aucun `onChange` (S3a, vérifié par le lot 29).

### 2.4 Routes

| Route | Fichier | Loader | Action |
|---|---|---|---|
| `/app/settings` | `app.settings._index.jsx` | `loadSettings` + `loadOverview` sans briefing (fiabilité) | aucune |
| `/app/settings/costs` | `app.settings.costs.jsx` | `loadSettings` | `save_order_costs`, `save_shipping`, `save_gateway`, `add_fixed_cost`, `end_fixed_cost`, `delete_fixed_cost` ; chaque succès → `recordSettingsFix` |
| `/app/settings/goals` | `app.settings.goals.jsx` | `loadSettings` + `margin_alerts.threshold` | `save_goals` (seuil vide → 0, colonne NOT NULL) |

Nav : `settings` devient « live » (`sections.js`) ; `s-app-nav` la liste automatiquement ; le rail
compte 4 liens et 9 « Bientôt ».

### 2.5 Point mort allumé (S5)

`insights/index.js` : `thresholds()` reçoit `fixed_costs_monthly` (coûts fixes de la période × 30 /
jours) et `marketing_monthly` (pub + commissions, si source pub) au lieu de `null`.

### 2.6 Catalogues et style

83 clés `settings.*` en/fr (614 clés au total, `fr = en`) : titres, sous-nav, états, erreurs,
libellé + aide de chaque champ, passerelles (pluriel `orders_one/_other`), coûts fixes, objectifs,
placeholders (`FR` / `US`, format de date). CSS : `.tcc-subnav`, `.tcc-form*` (grille 2 colonnes
→ 1 sous 560 px via le parent `.tcc-form-host`), `.tcc-gateway`, `.tcc-table*`, `.tcc-status`.

## 3. Preuves locales (gate complète, 2026-09-24)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 584 avertissements (`react/prop-types`) |
| `npm test` | 29 lots verts ; lot 26 = 123, lot 27 = 101, lot 29 (nouveau) = 33 |
| `node scripts/render_check.mjs` | 90 scénarios verts (+9) |
| `npm run build` | OK |
| fichiers protégés | 0 diff |

Lot 29 : nombres (virgule, espaces, vide, invalide), champs (arrondi, NULL, entier, bornes, absent
non touché, colonne miroir), port (défaut, pays, ligne vide, code à 3 lettres refusé), règle de
passerelle (confirmée, erreurs, fusion triée, tolérance), passerelles vues (comptées, triées),
valeurs usuelles, coût fixe (nettoyage, dates, fin avant début), actif aux bornes, `mirrorFor`,
`dataRuleOf`, 8 états, pages livrées ; catalogues (libellé + aide par champ, états, sous-nav,
erreurs) ; scans (module pur sans I/O ni date, serveur écrit `shop_settings` puis `shop_plans`,
`data_fixed` dédoublonné, aucun état React, placeholders jamais valeurs, `thresholds` alimenté).

Rendus réels (9) : sous-nav ; coûts de commande vides (4 champs, `value=""`, aide, suffixe jours,
aucun placeholder chiffré) et renseignés avec une erreur « Hors bornes. » sur le seul champ fautif
; port non confirmé (badge, défaut vide) et confirmé (FR = 3, DE = 6, 10 champs pays / montant) ;
passerelles (shopify_payments à confirmer avec placeholders 1.5 / 0.25 et « Valeurs usuelles :
1,5 % + 0,25 » ; paypal confirmé `value="3.4"`) et aucune passerelle ; coûts fixes (actif avec
Terminer + Supprimer, terminé grisé, total « 1 200,00 $ par mois », ajout) et vide ; objectifs
(suffixe %, seuil 0 vide, bande « entre 40 % et 60 % », seuil d'alerte rappelé) ; accueil (8
états, 2 pages, badges, lien Ouvrir) ; bandeau (succès, champs, échec, rien).

## 4. Écarts et points ouverts

1. **S3 : preuve finale au premier clic.** Le SSR prouve le balisage (`name`, `value`) mais pas
   la participation des `s-text-field` aux `FormData` : si l'action reçoit des champs vides sur la
   boutique de dev, repli (b) champs HTML natifs dans `Fields.jsx` (un seul fichier).
2. **Accueil = un chargement complet** (`loadOverview` pour la fiabilité) : acceptable, même
   coût que « Aujourd'hui ».
3. **Pays en code ISO-2 tapé** (pas de liste déroulante) : suffisant pour 5 surcharges ; une liste
   viendra avec Réglages > Boutique (R2, pays de vente / expédition).
4. **Coûts fixes en devise boutique** (`currency_code` = `shop_currency` à l'ajout) ; pas de
   conversion.
5. **Suppression d'un coût fixe = définitive** (Terminer aujourd'hui est la voie douce, S5) ;
   confirmation navigateur non ajoutée (formulaire natif) : à décider si un garde-fou est voulu.

## 5. Preuves à faire sur la boutique de dev (après GO commit + déploiement)

Seul, après déploiement : HTTP 200 sur `/app/settings`, `/app/settings/costs`,
`/app/settings/goals` avec la session de dev.

Clics :

1. **S3 (bloquant)** : Coûts → saisir un emballage `0,35` → Enregistrer → bandeau « Enregistré »,
   valeur réaffichée après rechargement. Si le bandeau dit « Enregistré » mais la valeur revient
   vide, les FormData n'ont pas porté le champ → repli (b).
2. Passerelle vue (au moins une commande synchronisée) → Confirmer avec les valeurs usuelles →
   badge « Confirmé » ; Fiabilité : règle « Frais de paiement » monte ; `decision_log` porte une
   ligne `data_fixed` `{ rule_id: payment_fees, source: settings }` et une seule même après un
   second enregistrement le même jour.
3. Port : défaut `4,90` + `FR` `3` → Confirmer → badge Renseigné ; « Aujourd'hui » : trou « port
   non confirmé » disparaît au chargement suivant.
4. Coût fixe « Loyer » 1 200 → ligne active, total ; « Aujourd'hui » : résultat estimé sans le
   marqueur « coûts fixes non renseignés » ; Terminer aujourd'hui → ligne grisée.
5. Objectifs : CM2 cible `45` → Enregistrer ; écran classique : le seuil de rentabilité affiche 45
   (recopie `shop_plans`) ; inversement, modifier un frais dans l'écran classique → Réglages >
   Coûts n'affiche rien de plus (les frais par passerelle sont distincts) mais `shop_settings`
   porte la nouvelle valeur (trigger R0-02, vérifiable par `verify_r0.mjs`-style lecture).
6. Prix du produit principal `60` → « Aujourd'hui » peut afficher « Panier proche du prix du
   produit principal » (règle jusqu'ici muette en prod).
7. Thème sombre et iPhone portrait : formulaires en une colonne, aucun débordement.

## 6. Ce qui reste

GO commit unique + push (statut Vercel via l'API GitHub), puis preuves ci-dessus ; ensuite S1
(Simulateur boutique) selon l'ordre R0 → R1 → S1 → R2 → R3 → S2 → S3.
