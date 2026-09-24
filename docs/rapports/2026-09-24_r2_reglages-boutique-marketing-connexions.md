# R2 — Réglages > Boutique, Marketing, Connexions (2026-09-24)

Suite de `2026-09-24_r1_reglages-socle.md` (R1 committée `e3621c3`, S3 prouvé) et de S1
(`961edc1`, `76d04f0`). GO d'écriture R2 reçu le 2026-09-24 ; aucun commit sans GO.

Statut : **écrit et prouvé localement (gate complète verte). Aucune migration, aucun commit, aucun
push.** Fichiers protégés : 0 diff.

## 1. Problème

Après R1, les réglages d'identité (pays, TVA, B2B, historique, langues, pays de vente et
d'expédition, sources d'approvisionnement : S8), la saisie des partenaires, codes promo et
commissions manuelles (décision H : « saisie dans Réglages ») et l'état des connexions n'avaient
aucun écran ; `partners`, `promo_code_rules`, `manual_commissions`, `integration_connections`
n'étaient écrites par personne, et `b2b_tag`, `history_months`, `locale_override`,
`report_locale` non plus.

## 2. Solution

### 2.1 Module pur `app/lib/settings.js` (+95 lignes)

| Export | Rôle |
|---|---|
| `SHOP_FIELDS`, `COUNTRY_LIST_FIELDS`, `LOCALE_CHOICES` | pays (ISO-2), régime de TVA (`VAT_REGIMES`, recopié vers `shop_plans`), étiquette B2B (normalisée en minuscules comme la sync la lit), profondeur d'historique (1 à 60 mois, vide = inchangé), langue de l'app et des rapports (36 locales de l'admin, vide = automatique), 3 listes de pays |
| `parseCountryList`, `parseShopForm` | « fr, de ; US » → `["FR","DE","US"]`, dédoublonné, code à 3 lettres refusé ; chaque champ invalide signalé sans écriture |
| `partnerFromForm`, `promoRuleFromForm`, `manualCommissionFromForm` | partenaire (nom, mode `codes` / `manual`), règle de code (code en majuscules comme à l'ingestion, partenaire optionnel, commission 0-100 %, base HT après / avant remise, dates), commission manuelle (partenaire **manuel** seulement, mois `AAAA-MM`, montant, note) |
| `codesFromOrders` | codes vus dans `orders.discount_codes` (90 jours), comptés et triés : la page dit lesquels n'ont pas de règle |
| `connectionsStatus`, `PROVIDERS` | Shopify (dernière synchronisation ; « en retard » après 3 jours ; « jamais ») + Meta, Google Ads, TikTok, Search Console : connecté / erreur / révoqué / non connecté |
| `settingsStatus` | +5 états (pays de l'entreprise, pays de vente, partenaires, règles de codes, connexion publicitaire) : 13 lignes sur 5 pages à l'accueil |

### 2.2 Serveur `app/lib/settings.server.js` (+45 lignes)

`loadMarketing` (partenaires, règles, commissions, codes vus, devise), `addPartner` /
`deletePartner` (CASCADE sur les commissions, `SET NULL` sur les règles : schéma F1-14),
`savePromoRule` (upsert `shop_domain, code`), `deletePromoRule`, `addManualCommission` (upsert
`partenaire, mois`), `deleteManualCommission`, `loadConnections` (`integration_connections` +
dernier `sync_jobs` terminé). Boutique : `saveSettings` de R1 (upsert `shop_settings` + recopie
`vat_regime` vers `shop_plans`).

### 2.3 Composants et routes

| Route | Composants | Intents |
|---|---|---|
| `/app/settings/shop` | `ShopForm` : pays, **devise lue depuis Shopify (lecture seule)**, TVA (`s-select`), B2B, historique, langue de l'app et des rapports (noms par `Intl.DisplayNames`, aucune clé par langue), 3 listes de pays | `save_shop` |
| `/app/settings/marketing` | `Partners`, `PromoRules` (codes vus sans règle), `ManualCommissions` (formulaire seulement s'il existe un partenaire manuel) | `add_partner`, `delete_partner`, `save_promo_rule`, `delete_promo_rule`, `add_manual_commission`, `delete_manual_commission` |
| `/app/settings/connections` | `ConnectionsList` : 5 lignes, état, compte, dernière synchronisation, erreur, « connecteur à venir » | aucun |

`Fields.jsx` gagne `SelectField` (`s-select` + `s-option`, non contrôlé, `value` initial). Les six
sujets de la sous-navigation sont livrés ; l'accueil charge aussi Marketing et Connexions pour
ses états.

### 2.4 Catalogues

89 clés `settings.*` de plus en/fr (748 au total, `fr = en`) : champs Boutique (libellé + aide),
régimes de TVA, modes de partenaire, bases de commission, fournisseurs, états de connexion,
messages vides, placeholders.

## 3. Preuves locales (gate complète, 2026-09-24)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 631 avertissements (`react/prop-types`) |
| `npm test` | 30 lots verts ; lot 29 = 50 assertions (+17) |
| `node scripts/render_check.mjs` | 99 scénarios verts (+5) |
| `npm run build` | OK |
| fichiers protégés | 0 diff |

Lot 29 (§3b) : listes de pays ; Boutique (majuscules, TVA, étiquette normalisée, historique
entier, langues, listes ; chaque champ invalide signalé ; historique vide = inchangé ; TVA recopiée
vers `shop_plans`) ; partenaire ; règle de code (majuscules, partenaire, taux, base, dates ;
erreurs) ; commission manuelle (partenaire manuel seulement, mois, montant) ; codes vus ;
connexions (Shopify + 4, erreur et absence distinguées, retard après 3 jours) ; scans (formulaires
natifs, `s-select` non contrôlé, aucun état React, devise jamais saisie) ; 13 états sur 5 pages ;
traductions.

Rendus réels (5) : Boutique vide (pays vide, devise n/a en lecture seule, TVA « assujetti »
sélectionnée, deux listes de langues avec « Automatique » et « français (fr) », 3 listes de pays,
historique vide avec placeholder 24, aucun style inline) et renseignée avec erreur sur un champ ;
Marketing complet (2 partenaires, « Codes vus … sans règle : WELCOME (3 commandes) », règle TEST20
12,5 % HT après remise, options de partenaire, commission manuelle limitée au partenaire manuel) et
vide (trois messages, formulaire de commission absent) ; Connexions (Shopify connecté avec
« dernière synchronisation il y a N heures », Meta en erreur avec compte et message, 3 « Non
connecté » avec « connecteur à venir ») ; sous-nav à 6 liens ; accueil à 13 lignes sur 5 pages.

## 4. Écarts et points ouverts

1. **Devise en lecture seule.** `shop_currency` est écrite par la sync à chaque ingestion ; un
   champ éditable serait écrasé. La « devise de reporting » du PDF (distincte) demandera une
   colonne (`report_currency`) et une conversion : hors R2.
2. **Pays en texte ISO-2** (pas de liste déroulante des 250 pays) : cohérent avec R1 ; une liste
   viendra avec la localisation des pays (35 langues).
3. **Suppression d'un partenaire = définitive**, avec cascade sur ses commissions manuelles et
   détachement de ses règles (schéma F1-14) ; pas de confirmation navigateur (formulaire natif).
4. **Connexions sans connecteur** : les boutons Meta / Google / TikTok / Search Console arrivent
   avec les sections Marketing et Croissance ; la page dit « connecteur à venir ».
5. **Built for Shopify** demande la « Contextual Save Bar » pour les formulaires (lu le
   2026-09-24) : nos formulaires ont un bouton par bloc. À traiter en R3 (voir Phase 0 F4-B §5).
6. `Intl.DisplayNames` : noms de langues rendus côté serveur et client avec la même locale ; sur
   un runtime sans données ICU la valeur retombe sur le code.

## 5. Preuves à faire sur la boutique de dev (après GO commit + déploiement)

Seul : HTTP 200 sur `/app/settings/shop`, `/app/settings/marketing`, `/app/settings/connections`.

Clics :

1. Boutique : pays `FR`, TVA « Franchise », historique `12`, langue de l'app « français » →
   Enregistrer → valeurs réaffichées ; l'écran classique montre « Franchise » (recopie
   `shop_plans`) ; l'app reste en français après changement de langue de l'admin (`locale_override`).
2. Boutique : pays de vente `FR, DE`, sources `CN` → réaffichés ; code `FRA` → erreur sur le champ,
   rien enregistré.
3. Marketing : partenaire « Agence A » (codes) → règle `TEST20` 12,5 % → « Aujourd'hui » : la
   commande #1038 porte une commission (CM3 baisse de 15 $ = 12,5 % de 120), la cascade affiche
   « Commissions » ; le message « Codes vus sans règle » ne cite plus TEST20.
4. Marketing : partenaire « Influ B » (manuel) → commission 2026-09 de 250 → CM3 du mois baisse
   d'autant ; supprimer le partenaire retire la commission (cascade).
5. Connexions : « Commandes Shopify · Connecté · dernière synchronisation il y a … » ; les 4
   fournisseurs « Non connecté · connecteur à venir ».
6. Accueil Réglages : 13 lignes dont « Pays de l'entreprise » et « Partenaires » passés à
   « Renseigné ».

## 6. Ce qui reste

GO commit unique + push (statut Vercel via l'API GitHub), preuves ci-dessus, puis R3 (liste de
contrôle d'activation, états vides reliés à Réglages, Contextual Save Bar si retenue) et F4-B
selon la Phase 0 jointe.
