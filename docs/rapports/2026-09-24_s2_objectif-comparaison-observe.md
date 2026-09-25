# S2 — Mode objectif, comparaison de scénarios, résultat observé à J+30 (2026-09-24)

Suite de `2026-09-24_s2_phase0.md` ; arbitrages W1-W7 consignés dans `2026-09-22_decisions.md`
§K. GO S2a, S2b, S2c reçus le 2026-09-24 ; aucun commit sans GO.

Statut : **écrit et prouvé localement (gate complète verte). Aucune migration (les colonnes
`review_at`, `observed_impact`, `observed_at`, `note` existent depuis I0-01), aucun cron nouveau,
aucun commit, aucun push.** Fichiers protégés : 0 diff (`findThreshold` du moteur jamais appelé).

## 1. Faits du §4 de la Phase 0, vérifiés

1. **`loadOverview` avec un `now` passé** : `overviewWindows` construit la fenêtre courante depuis
   le jour de `now` (les `days` jours qui se terminent ce jour-là) et la précédente juste avant.
   Avec `now = review_at = decided_at + horizon` et `days = horizon` : courante = les 30 jours
   après la décision, précédente = les 30 jours avant. Le plafond de 5 000 lignes et les 4
   périodes de référence s'appliquent ; une fenêtre « avant » sans commande (historique non
   couvert) donne `no_history`, jamais un chiffre.
2. **Une seule fois** : la revue ne sélectionne que `observed_at IS NULL` et pose `observed_at`
   même quand l'observation est impossible (la raison est gardée dans `note`).

## 2. S2a — mode objectif (W1b, W2a)

`app/lib/simulator/objective.js` (pur) : `solveObjective({ leaves, periodDays, horizon, node,
target, lever, base })` → bissection **maison** sur `runScenario` (40 itérations) dans les bornes
d'écran du levier, les autres leviers du scénario courant maintenus (`base`). Cibles : CA HT, CM2,
CM3, résultat, BE-ROAS, CM2 %. Fonctionne pour les 8 leviers, y compris fulfilment et budget pub
(surcharges) ; `findThreshold` du moteur intouché. Réponses : atteint (valeur arrondie à 0,1 %, ou à
l'unité pour le CAC, et « après »), hors de portée (bornes, meilleur bord), indisponible, invalide.

Écran : bloc « Atteindre un objectif » sous les leviers (cible, valeur, levier avec les leviers
sans donnée désactivés, « Trouver »), phrase « Prix à +6,4 % atteint 55,0 % de CM2 % » et
« Appliquer » (pose la valeur sur le levier), ou « n'atteint pas la cible dans les bornes … : au
mieux … ».

## 3. S2b — comparaison (W3a)

`app/lib/simulator/compare.js` (pur) : `parseCompareIds` (ids nettoyés, dédoublonnés, au plus 2 +
le courant = 3), `compareScenarios` → 5 nœuds × scénarios (après, écart, fourchette), chaque
scénario **rejoué sur les feuilles du jour**. Écran : `?compare=<id>,<id>` ; table « Comparer des
scénarios » avec la note « Recalculé sur la période courante : … jamais sur les montants
enregistrés à l'époque », lien « Fermer la comparaison » ; dans la mémoire, « Comparer » /
« Retirer de la comparaison » sur chaque scénario retenu (les valeurs du scénario courant restent
dans l'URL).

## 4. S2c — résultat observé (W4a, W5, W6)

- `app/lib/simulator/observed.js` (pur) : `reviewAt` (= `decided_at + horizon`), `reviewWindow`,
  `observedImpact` (après − avant sur le nœud du scénario, `no_history` si la fenêtre « avant » n'a
  aucune commande, `no_after` si le nœud manque), `observedStatus` (observé / non observable / en
  attente / due / aucun), `dueForReview`.
- Action « Retenir » : `review_at` posé à la décision.
- `decisions.server.js` : `reviewDueDecisions` (au plus 5 décisions dues par ouverture ; pour
  chacune `loadOverview(now = review_at, days = horizon)` ; `observed_impact`, `observed_at`,
  `note = observed:<raison>`) ; `loadOverview` expose `previousNodes` et `previousOrders`.
- Simulateur : la revue tourne en arrière-plan à l'ouverture (`background`, comme `insight_log`) ;
  la mémoire affiche « attendu 80 – 120 € · observé +95 € (toutes causes confondues) », « non
  observable : l'historique ne couvre pas la période d'avant », « observé à partir du 24 oct.
  2026 » ou « observation en attente ».

## 5. Preuves locales (gate complète, 2026-09-24)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 661 avertissements (`react/prop-types`) |
| `npm test` | 31 lots verts ; lot 30 = 59 (+24) |
| `node scripts/render_check.mjs` | 117 scénarios verts (+3) |
| `npm run build` | OK |
| fichiers protégés | 0 diff |

Lot 30 : objectif (6 cibles ; CM2 % + 3 pt par le prix atteint à 0,05 pt près et la valeur rejouée
redonne l'après annoncé ; CM2 + 5 % par le panier avec retours + 10 % maintenus ; cible × 10 hors
de portée avec bornes et meilleur bord ; fulfilment (surcharge) résolu ; BE-ROAS − 10 % par le
coût produit ; CAC arrondi à l'unité ; raisons ; `findThreshold` jamais appelé) ; comparaison (ids,
plafond 3, une cellule par scénario, rejeu identique à un scénario seul, scénario vide → écart 0,
fourchette par cellule) ; observé (`review_at` + horizon, fenêtre de revue, après − avant, raisons,
5 états, décisions dues, serveur une fois, route en arrière-plan, nœuds précédents exposés) ;
catalogues et branchements.

Rendus réels : bloc objectif initial (6 cibles, CM2 % sélectionnée, budget pub désactivé sans pub,
« Trouver », aucun résultat au rendu serveur) ; comparaison à 3 colonnes et 5 lignes avec la note,
« Fermer », « Retirer de la comparaison » / « Comparer » et l'URL qui garde le scénario courant ;
mémoire observée (observé + 95,00 €, non observable avec la raison, « observé à partir du 19 nov.
2026 », due, attendu 80 – 120).

## 6. Écarts et points ouverts

1. **Le résultat de l'objectif n'existe qu'au clic** (client) : le rendu serveur prouve le bloc et
   ses options ; la résolution se prouve en boutique.
2. **Monotonie supposée** sur l'intervalle du levier (bissection) ; un nœud non monotone (rare
   ici : tous les nœuds sont affines ou hyperboliques dans le levier) donnerait une solution parmi
   d'autres, jamais une fausse.
3. **Observé = toutes causes confondues**, dit à chaque affichage ; aucune attribution au
   scénario.
4. **Notifications** (W4b) et cron de revue : plus tard.
5. Les décisions retenues **avant** S2c n'ont pas de `review_at` : elles restent « observation en
   attente » sans date et ne sont jamais revues ; à poser à la main si voulu.

## 7. Preuves à faire sur la boutique de dev (après GO commit + déploiement)

1. Simulateur : « Atteindre un objectif » → cible CM2 %, valeur 55, levier Prix → « Prix à +N %
   atteint 55,0 % … » ; « Appliquer » pose le prix et la table suit ; cible 95 % → « hors de
   portée … au mieux … » ; levier Budget pub désactivé sans pub.
2. Retenir deux scénarios → « Comparer » sur le premier, puis sur le second → table à 3 colonnes ;
   « Retirer » ; l'URL porte `compare=`.
3. Une décision retenue porte `review_at = decided_at + 30 j` en base ; en attendant, la mémoire
   dit « observé à partir du … ».
4. Preuve différée à J+30 : à l'ouverture du Simulateur après la date, `observed_impact` et
   `observed_at` posés une fois ; sur la boutique de dev (historique de 15 commandes récentes), la
   fenêtre « avant » n'a probablement aucune commande → « non observable : l'historique ne couvre
   pas la période d'avant », `note = observed:no_history`.

## 8. Ce qui reste

GO commit unique + push (statut Vercel via l'API GitHub), preuves ci-dessus. Ensuite : S3 (mode
Produit, avec F4-D), F4-D (React 19 + visx + react-router 8, suppression de l'écran classique), I0-D
(relecture du ton français), I1 (« Demander »).
