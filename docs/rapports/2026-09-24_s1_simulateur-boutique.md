# S1 — Simulateur boutique : leviers, résultat, fourchette, mémoire (2026-09-24)

Suite de `2026-09-24_r1_reglages-socle.md` (R1 committée `e3621c3`, S3 prouvé sur la boutique de
dev : champs Polaris conservés). Arbitrages T1-T7 dans `2026-09-22_decisions.md` §I. GO
d'écriture S1 reçu le 2026-09-24 ; aucun commit sans GO.

Statut : **écrit et prouvé localement (gate complète verte). Aucune migration, aucun commit, aucun
push.** `app/routes/app._index.jsx`, `app/lib/engine.js`, `app/lib/econ/*` (dont `simulate.js`,
appelé tel quel), `app/lib/sync/*` : 0 diff.

## 1. Problème

Le moteur savait simuler (`econ/simulate.js`) mais rien ne l'exposait : le CTA « Simuler » des
analyses ouvrait la modale, l'opportunité affichait un seul scénario figé, « Retenir ce scénario »
promettait un simulateur absent, et la décision 4 (mois calendaire) contredisait l'horizon réel.

## 2. Solution

### 2.1 Module pur `app/lib/simulator/` (3 fichiers, 118 lignes)

| Fichier | Contenu |
|---|---|
| `levers.js` | 8 leviers du PDF : prix, panier, volume, retours, coût produit rendu (fournisseur + fret + droits), fulfilment (port + emballage), budget pub, CAC. Les cinq premiers sont des facteurs du moteur (`price_factor`, `aov_factor`, `cvr_factor`, `return_rate_factor`, `cogs_factor`) ; fulfilment et budget pub sont des **surcharges de feuilles calculées après les leviers** (composables avec le volume) ; le CAC est absolu. `leverAvailable` grise un levier sans donnée (budget pub sans dépense, CAC sans nouveaux clients). `valuesFromEconLevers` fait le chemin inverse (opportunité, mémoire). Nœuds affichés : CA HT, CM2, CM3, résultat, BE-ROAS |
| `scenario.js` | `parseScenario` (URL ou FormData : virgule acceptée, borné, invalide ignoré, règle épurée, horizon `period` / `month`) ; `scenarioSearch` (chaîne de requête sans les zéros) ; `runScenario` : avant / après / écart par nœud, **fourchette T5** = même scénario avec volume × 0,9 et × 1,1, **horizon T4b** = montants × 30 / jours de la période (jamais les ratios), hypothèses du moteur, note « scénario, pas prévision » ; `scenarioRecord` : scénario rejouable pour `decision_log` (règle, source, valeurs, leviers, surcharges, hypothèses, nœud CM2, avant / après, fourchette d'écart) |
| `index.js` | `simulatorHref(insight, { days })` : lien pré-chargé depuis une règle (leviers de `simulation`) ou une opportunité (`levers`) |

Le volume est la conversion à sessions et pub constantes (T5) : aucune élasticité inventée.

### 2.2 Composant `app/components/simulator/Simulator.jsx` (T3)

Leviers sur champs HTML natifs (`range` + `number`) tenus par `useState`, calcul **côté client** avec
`runScenario` (pur), scénario initial depuis l'URL (rendu serveur identique), horizon en bascule
(période choisie / par mois), table de résultat (avant, après, écart signé, fourchette), badge
« Simulation », dépliage des hypothèses (facteurs, fourchette, horizon, note), « Retenir ce
scénario » = formulaire POST natif avec les valeurs en champs cachés (désactivé si aucun levier),
lien de rejeu pour chaque scénario retenu (mémoire). Aucun champ Polaris contrôlé (C1a) ; aucune
couleur ni style inline.

### 2.3 Route `/app/simulator` (`app.simulator.jsx`)

Loader : `loadOverview` sans briefing (feuilles agrégées de la période, ≈ 2,6 Ko), 5 derniers
`decision_log` `simulated`, scénario de l'URL. Action `keep` : l'URL et les champs cachés ne sont
jamais crus, le serveur **recalcule** le scénario sur les feuilles du jour puis écrit `decision_log`
`simulated` (`scenarioRecord`, fourchette d'écart CM2, horizon 30 j ou période). Bandeau
`DecisionBanner` réutilisé. État vide actionnable si 0 commande.

### 2.4 Branchements

- `Analysis` : le CTA `simulate` devient un lien vers le Simulateur pré-chargé (`days` transmis
  par `Priorities` et `Opportunity`) ; l'opportunité gagne « Ouvrir dans le simulateur » à côté de
  « Retenir ».
- `sections.js` : Simulateur « live » (5 sections livrées, 8 « Bientôt ») ; `s-app-nav` le liste.
- Catalogues : 45 clés `sim.*` en/fr (659 au total, `fr = en`) ; `decision.recorded.simulated`
  ne promet plus le simulateur « à la prochaine version ».
- CSS : `.tcc-sim*`, `.tcc-lever*`, `.tcc-seg__btn`, `.tcc-simtable*` (une colonne sous 860 px,
  table repliée sous 560 px, conteneur = parent `.tcc-sim-host`).

## 3. Preuves locales (gate complète, 2026-09-24)

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 597 avertissements (`react/prop-types`) |
| `npm test` | 30 lots verts ; lot 30 (nouveau) = 33 assertions ; lots 26 à 29 inchangés verts |
| `node scripts/render_check.mjs` | 94 scénarios verts (+4) |
| `npm run build` | OK |
| fichiers protégés | 0 diff |

Lot 30 : 8 leviers ; % → facteurs, 0 ignoré, CAC absolu ; surcharges composables avec le volume ;
disponibilité ; facteurs → valeurs (arrondi 0,1) ; 5 nœuds ; URL (virgule, bornes, invalide, règle
épurée, horizon inconnu), requête sans zéros, FormData ; exécution : sans levier après = avant ;
panier +7 % → CA × 1,07 et CM2 en hausse ; fourchette bas < après < haut ; hypothèse et note ;
horizon mois × 30 / jours sur les montants, jamais sur BE-ROAS ; coût rendu +10 % et retours
+50 % → tout en baisse ; volume +20 % = CA × 1,2 à sessions constantes ; levier indisponible
ignoré ; scénario rejouable et rejeu ; **le Simulateur retrouve l'après de l'opportunité à 0,5 €
près** (même moteur) ; lien pré-chargé ; catalogues ; scans (module pur sans I/O ni React,
`econ/simulate.js` seul, champs natifs, POST natif, recalcul serveur).

Rendus réels (4) : scénario pré-chargé (8 leviers range + number, panier à 7, « Pré-chargé depuis :
Panier proche du prix du produit principal », 5 lignes dont CM2 en hausse et BE-ROAS, hypothèse
« commandes constantes avec un panier plus grand (× 1.07) », champs cachés du formulaire Retenir,
aucun champ Polaris ni style) ; scénario vide (message, aucun écart signé, bouton désactivé,
mémoire vide) ; horizon mois + boutique sans pub (budget pub et CAC grisés « Indisponible »,
mémoire avec lien de rejeu `?days=30&basket=7&rule=aov_vs_main_price`, fourchette « 80,00 € –
120,00 € ») ; anglais (Before / After / Change / Range, note).

## 4. Écarts et points ouverts

1. **Un seul levier de volume.** Le PDF cite « taux de conversion » et « volume de commandes » ;
   dans le moteur c'est le même facteur (`cvr_factor`, sessions constantes). Un levier, libellé
   « Volume de commandes », aide « conversion à sessions et pub constantes ».
2. **Fret et douane dans le coût rendu.** Le levier « coût produit rendu » couvre fournisseur +
   fret + droits (le coût rendu est dans les COGS du moteur) ; pas de levier douane séparé.
3. **Mode objectif (« quel prix pour 55 % ? ») et comparaison de scénarios** = lot S2 (T7, T6).
4. **Mémoire limitée aux 5 derniers scénarios**, sans résultat observé (S2 : `observed_impact` à
   J+30).
5. **Horizon « par mois » enregistré tel quel** (`horizon_days` 30) ; la période sinon.
6. **Le formulaire Retenir envoie les valeurs de l'écran** ; le serveur recalcule sur les feuilles
   du jour : entre l'affichage et le clic, une synchronisation peut changer légèrement les montants
   enregistrés (voulu : jamais une valeur venue du navigateur).

## 5. Preuves à faire sur la boutique de dev (après GO commit + déploiement)

Seul, après déploiement : HTTP 200 sur `/app/simulator`, `/app/simulator?days=7&price=5`.

Clics :

1. Nav : « Simulateur » dans le menu admin et dans le rail (Piloter), 8 « Bientôt » restants.
2. « Aujourd'hui » → opportunité → « Ouvrir dans le simulateur » : page pré-chargée (« Pré-chargé
   depuis : … »), la valeur du panier reprend celle de l'opportunité, l'après CM2 correspond à la
   fourchette affichée sur « Aujourd'hui » (horizon par mois).
3. Déplacer le curseur Prix à +5 : les 5 lignes se recalculent sans rechargement ; l'écart CM2 est
   vert, la fourchette encadre l'après ; bascule « Par mois » multiplie les montants sans toucher
   BE-ROAS.
4. Budget pub et CAC grisés « Indisponible » tant qu'aucune dépense pub n'est connectée.
5. « Retenir ce scénario » → bandeau « Scénario enregistré … » ; la liste « Scénarios retenus »
   affiche la ligne avec « Rejouer » ; le rejeu restitue les mêmes valeurs ; `decision_log` porte
   une ligne `simulated` avec `scenario.source = "simulator"`.
6. Un CTA « Simuler » d'une analyse (ex. « Marge sous l'objectif ») ouvre le Simulateur avec la
   règle en pré-chargement.
7. iPhone portrait : leviers et résultats en une colonne, table repliée ; thème sombre.

## 6. Ce qui reste

GO commit unique + push (statut Vercel via l'API GitHub), preuves ci-dessus, puis R2 (Réglages >
Boutique, Marketing, Connexions) selon l'ordre R0 → R1 → S1 → R2 → R3 → S2 → S3.
