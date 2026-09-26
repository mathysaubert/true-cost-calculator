# D2-4 — Vérification 3 en échec : enquête (2026-09-26)

Symptôme signalé : après avoir vidé « Objectif de marge de contribution (CM2) » et enregistré, l'audit affiche « Objectif à 0 % : bande inactive » au lieu de « objectif non renseigné ».

Conclusion : l'audit ne se trompe pas. La base contient bien **0** pour la boutique de dev, et l'audit affiche exactement le libellé prévu pour un objectif à 0 %. Aucun maillon du code déployé ne transforme un champ vidé en 0 : navigateur, serveur et base ont été prouvés un par un. Il n'y a donc pas de correctif d'app à écrire. L'explication la plus probable est un enregistrement de « 0 » après le vidage. Un nouveau test court permettra de trancher (§4).

## 1. Valeur enregistrée (lecture seule, production)

| Boutique | Objectif | Dernière modification (UTC) | Offre |
|---|---|---|---|
| true-cost-dev.myshopify.com | **0** | 2026-09-26 12:43:42 | expert |
| les 3 autres boutiques | NULL | avant aujourd'hui | — |

Juste après la migration, la boutique de dev avait 45. Elle est passée à 0 par un seul enregistrement, à 12:43:42.

## 2. Quelle version a enregistré

- **Version en ligne.** D2-4 (da29ddc) est en ligne depuis 12:38:38 (statut Vercel lu via l'API GitHub), soit 5 minutes avant l'enregistrement.
- **Ancienne version, écartée.** L'ancienne version réécrivait un champ vide en 0 ; c'était la seule explication par le code. Pour qu'une page ouverte avant le déploiement reste servie par l'ancienne version, il faudrait le cookie `__vdpl` posé par le fichier d'entrée de Vercel. L'app utilise son propre `app/entry.server.jsx`, qui ne pose pas ce cookie. Les requêtes de 12:43 sont donc allées à D2-4.

## 3. La chaîne, maillon par maillon

| Maillon | Preuve | Résultat |
|---|---|---|
| Navigateur : champ vidé | Vrai Edge et vrai polaris.js, pour les deux chemins (arrivée par le menu, page rechargée). On vide par Retour ou Suppr, puis Tab, et on lit le FormData du formulaire | Le formulaire envoie `""` (clé présente), jamais 0 |
| Action Objectifs | Lecture du code déployé et test du lot 40 | Les valeurs lues sont passées telles quelles ; plus aucune réécriture en 0 |
| Lecture du formulaire (`parseFields`) | Lot 40 | `""` devient NULL, `"0"` devient 0 |
| Écriture (`saveSettings`) | Lot 40, avec une base simulée qui capture la requête | Un seul upsert `shop_settings`, avec `profitability_threshold_pct: null` |
| Base | Lecture seule en production | Colonne facultative, sans défaut, aucun déclencheur sur `shop_settings` |
| Autres écrivains de `shop_settings` | Recherche dans le code | La synchronisation, le bandeau des commandes de test et le marquage boutique de dev ne touchent jamais l'objectif |
| Audit | Rendu réel (render_check) | NULL affiche « objectif non renseigné » ; 0 affiche « Objectif à 0 % : bande inactive » |

L'affichage vu en boutique correspond donc exactement à un 0 réellement enregistré.

Explication la plus probable : les vérifications 2 (« saisir 0 et enregistrer ») et 3 se sont enchaînées, et l'audit a été lancé après l'enregistrement de 0. Une seule date de modification est conservée, donc la base ne permet pas de le confirmer.

## 4. Nouveau test proposé

1. Réglages → Objectifs : vider le champ CM2, enregistrer, puis **recharger la page**. Le champ doit rester vide, et la mise en route doit indiquer « Manquant ».
2. Sans rien saisir d'autre, aller dans Produits et lancer l'audit. La bande du milieu doit afficher « objectif non renseigné ».
3. Je relis la valeur en lecture seule. Attendu : NULL.

Si le champ réapparaît avec 0 après le rechargement de l'étape 1, le défaut est réel. Je reprendrai alors l'enquête avec l'heure exacte de l'essai.

## 5. Ajouts (tests seulement, aucun changement d'app)

- `scripts/browser_reset_check.mjs` : dans le vrai navigateur, un objectif vidé part vide dans le formulaire, pour les deux chemins.
- `tests/lot40_d2_4_legacy_drop.mjs` (section 3b) : un champ vide mène à un upsert avec NULL, et l'action ne réécrit pas l'objectif.

## 6. Gate

| Contrôle | Résultat |
|---|---|
| `npm run lint` | 0 erreur |
| `npm test` | Vert (lot 40 : 34 contrôles) |
| `node scripts/render_check.mjs` | Tout OK |
| `node scripts/render_routes.mjs` | 41 rendus OK |
| `npm run check:browser` | 4 preuves OK, dont la nouvelle (deux chemins) |
| `npm run check:server` | OK |
| `npm run build` | OK |
| Code de l'app et fichiers protégés | 0 diff |

Rien n'est commité.
