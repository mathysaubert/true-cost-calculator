# Phase 0 courte — page Décisions (section Piloter) (2026-09-25)

Lecture seule : aucun fichier modifié. Périmètre : priorités et opportunités en pleine page,
journal des décisions (`insight_log`, `decision_log`), filtres simples. La section est aujourd'hui
« Bientôt » (`sections.js`, `decisions`, `path: null`).

## 1. Ce qui existe

| Élément | État |
|---|---|
| Briefing | `buildBriefing` produit priorités (3), opportunité, insights (dont partiels) ; rendu sur « Aujourd'hui » par `Priorities`, `Opportunity`, `Analysis` (3 niveaux, CTA vers le Simulateur ou les Indicateurs) |
| `insight_log` | écrit en arrière-plan à chaque affichage d'« Aujourd'hui » : une ligne par empreinte (règle + sujet + **fenêtre** + impact arrondi), `rank` (1-3 priorité, 0 opportunité), `status`, `impact_low/high`, `payload`, `first_shown_at`, `last_shown_at`, `shown_count`, `resolved_at` (règle de données disparue). **Jamais relu par un écran.** |
| `decision_log` | écrit par : « Retenir ce scénario » (Aujourd'hui, Simulateur : `simulated`, `review_at`, observé à J+30), sauvegardes Réglages (`data_fixed`, source `settings`), disparition d'une règle de données (`data_fixed` déduit). Relu seulement par la mémoire du Simulateur (5 derniers `simulated`). Les kinds `accepted`, `dismissed`, `action_started`, `action_done` existent (CHECK SQL) mais **aucun code ne les écrit**. |
| Volume | l'empreinte contient la fenêtre, qui finit aujourd'hui : une priorité stable produit **une ligne par jour et par vue** (7 / 30 / 90). Le journal ne peut pas lister `insight_log` tel quel. |
| Décisions antérieures à S2c | sans `review_at` : jamais revues. |

## 2. Arbitrages

**P1 — Structure.** (a) Une page `/app/decisions` en deux blocs : « À traiter » (priorités et
opportunité courantes en pleine page) puis « Journal » ; (b) deux routes (`/app/decisions` et
`/app/decisions/journal`). Recommandation : **(a)**, avec un segmenté « À traiter / Journal » en liens
(`?view=`), comme la période.

**P2 — « À traiter ».** (a) Briefing recalculé (`loadOverview`, même code qu'« Aujourd'hui ») : les
3 priorités, l'opportunité, **puis tous les autres insights détectés** (au-delà des 3) et les
partiels, chacun en composant `Analysis` ; (b) relire la dernière ligne `insight_log`. Recommandation :
**(a)** : chiffres du jour, pas un instantané ; « Aujourd'hui » garde 3 priorités, Décisions montre
tout ce que le copilote voit, classé par score.

**P3 — Journal : ce qu'on y lit.** Une ligne = un événement, du plus récent au plus ancien :

| Événement | Source | Compaction |
|---|---|---|
| Signal apparu | `insight_log.first_shown_at` | **une ligne par règle + sujet + jour** (la première empreinte du jour, toutes vues confondues), avec « montré N fois » |
| Signal résolu | `insight_log.resolved_at` | une ligne |
| Scénario retenu | `decision_log` `simulated` | une ligne, lien « Rejouer » |
| Donnée corrigée | `decision_log` `data_fixed` | une ligne (source : réglages ou déduite) |
| Observé à J+30 | `decision_log.observed_at` | une ligne « attendu / observé (toutes causes confondues) » ou « non observable » |
| Pris en charge / ignoré | `decision_log` `accepted` / `dismissed` | selon P4 |

Options : (a) ce journal complet ; (b) décisions seulement (sans les signaux). Recommandation :
**(a)** : c'est l'histoire « le copilote a vu → vous avez fait → voici ce qui s'est passé ».

**P4 — Gestes sur une priorité.** (a) Journal en lecture seule ; (b) deux boutons sur chaque
analyse : « Je m'en occupe » (`accepted`, `review_at` à J+30 pour l'observé) et « Ignorer »
(`dismissed`), enregistrés seulement ; (c) (b) + une priorité ignorée ne remonte plus dans les 3
d'« Aujourd'hui » tant que son empreinte de règle + sujet n'a pas changé de signe ou pendant 30 jours.
Recommandation : **(b) maintenant**, (c) dans un lot suivant (il touche la sélection des priorités,
`priority.js`, et mérite ses propres tests).

**P5 — Filtres.** Type d'événement (tous, signaux, scénarios, données corrigées, observés, pris en
charge / ignorés), période (30 j, 90 j, tout), règle (liste des règles vues). Liens natifs
(`?type=&since=&rule=`), aucun champ contrôlé. Recommandation : ces trois filtres, rien d'autre.

**P6 — Volume.** 50 événements par page, « Plus ancien » par `?before=<date>`. Lecture bornée côté
serveur (`insight_log` sur la période, compaction en pur).

**P7 — Compaction en base.** (a) Aucune (compaction à la lecture) ; (b) tâche de purge « dernier par
règle + sujet + jour » ; recommandation : **(a)** tant que le volume reste faible (une boutique =
quelques centaines de lignes par mois).

**P8 — Nav.** Décisions devient « live » (6 sections livrées) ; « Expériences » reste un sous-ensemble
futur (`accepted` / `action_started` avec `review_at`).

## 3. Découpe

| Lot | Contenu | Taille |
|---|---|---|
| DP1 | `app/lib/decisionsJournal.js` (pur : fusion `insight_log` + `decision_log` en événements, compaction règle + sujet + jour, filtres, pagination), route `/app/decisions` (« À traiter » + « Journal », segmenté, filtres), nav live, lot 32, `render_check` | M |
| DP2 | « Je m'en occupe » / « Ignorer » sur les analyses (Décisions et Aujourd'hui), `accepted` avec `review_at`, `dismissed` ; observé à J+30 étendu aux `accepted` | S |
| DP3 | (option P4c) priorité ignorée retirée des 3 d'« Aujourd'hui » pendant 30 jours | S |

Aucune migration (tables et kinds existants). Ordre : DP1 → DP2 → DP3.

## 4. Ce qui reste

Vos arbitrages P1 à P8, puis GO DP1.
