# Port par défaut « non renseigné », et objectif de marge avec D2 (2026-09-25)

Statut : alignement du port **écrit, gate verte, non committé** (GO attendu).
Objectif de marge : **rien d'écrit**, recommandation en section 4.
Le correctif « Annuler » est committé (`7a90f6f`, Vercel success).

## 1. Ce qui change pour le marchand

Réglages > Coûts, bloc « Port par pays » :

| Saisie | Avant | Après |
|---|---|---|
| Port par défaut vidé (ou jamais saisi), puis Enregistrer | 0 €, marqué confirmé | **non renseigné** ; le calcul compte le port facturé au client, signalé « à confirmer » |
| 0 saisi | 0 €, confirmé | inchangé : vrai choix de 0 €, confirmé |
| Surcharge par pays seule, sans défaut | défaut 0 € confirmé | défaut non renseigné ; les pays saisis sont confirmés, les autres commandes sont « à confirmer » |

Le badge du bloc a maintenant trois états : « Renseigné » (vert) si le port par défaut est confirmé, « À confirmer » (orange) si seules des surcharges par pays existent ou si la règle n'est pas confirmée, et « Manquant » (rouge) sinon. Le même état alimente la mise en route (page d'accueil des Réglages et activation).

Un enregistrement où rien n'est saisi n'écrit plus de « donnée corrigée » dans le journal des décisions.

## 2. Effet sur les calculs et le copilote

Le moteur (`econ/`, protégé) n'a pas changé. Il avait déjà la règle voulue pour un port absent : il compte le port facturé au client et le signale « à confirmer ». Seule change l'entrée qu'on lui donne.

- **CM2 :** sur une commande sans règle de pays, le port marchand vaut le port facturé au lieu de 0 €. La marge baisse d'autant, sans rester optimiste en silence.
- **Fiabilité des données, cascades, analyses :** le trou « port à confirmer » apparaît pour ces commandes, avec les phrases existantes du copilote. Aucune phrase nouvelle.
- **Simulateur (nouveau produit) et audit :** aucun port n'est pré-rempli. L'audit liste le port dans « Non renseignés, comptés 0 ».

Données existantes : aucune boutique n'a de port par défaut enregistré (lu en base le 2026-09-25, 4 boutiques). Aucun chiffre existant ne change, et aucune migration n'est nécessaire (champ JSON).

## 3. Fichiers, preuves, gate

Fichiers modifiés :

- `app/lib/settings.js` : défaut vide gardé à NULL, et confirmation seulement si quelque chose a été saisi. Nouvelle fonction `shippingState`, utilisée par la mise en route.
- `app/components/settings/CostsForms.jsx` : badge à trois états.
- `app/routes/app.settings.costs.jsx` : pas de « donnée corrigée » pour un enregistrement vide.
- `tests/lot29_settings.mjs` : l'attente « défaut vide donne 0 » devient « défaut vide reste non renseigné ».

Nouveau lot 36 (`tests/lot36_shipping_unset.mjs`, 14 assertions) :

- formulaire : vide, 0 saisi, surcharge seule ;
- états du badge et de la mise en route ;
- **calcul par le vrai moteur** (`orderCosts`) : port non renseigné, donc port facturé de 4,90 € « à confirmer » ; 0 € choisi, donc 0 € confirmé ; surcharge FR confirmée et commande BE « à confirmer » ;
- Simulateur et audit ;
- branchements.

Nouveau rendu réel : les trois états du badge (surcharge seule, rien, 0 € confirmé).

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 104 warnings |
| `npm test` | 36 lots verts |
| `node scripts/render_check.mjs` | 137 scénarios OK |
| `node scripts/render_routes.mjs` | 39 rendus OK |
| `npm run build` | OK |
| Fichiers protégés | 0 diff |

À vérifier en boutique après deploy : dans Réglages > Coûts, vider le port par défaut puis enregistrer. Le badge doit passer à « Manquant », et Fiabilité des données doit montrer le port « à confirmer ».

## 4. Objectif de marge : maintenant ou avec D2 ?

**Réponse : oui, c'est plus simple et plus sûr avec D2.**

Faire le changement maintenant demanderait de toucher cinq endroits qui disparaissent en D2 :

1. **La colonne de `shop_plans`, l'ancienne table,** qui est aussi déclarée obligatoire avec 0 par défaut.
2. **Le déclencheur R0-02**, qui recopie `shop_plans` vers `shop_settings` en forçant 0. Il faudrait le réécrire.
3. **La recopie de l'app vers `shop_plans`** à chaque enregistrement des Objectifs. Un objectif vide y échouerait tant que la colonne reste obligatoire.
4. **L'écran classique, protégé jusqu'à D2 :** il lit l'objectif dans `shop_plans` (avec repli à 0) et l'y écrit toujours en nombre.
5. **Le recalcul des marges estimées**, qui lit encore `shop_plans`.

Il faudrait donc deux tables, un déclencheur réécrit et une migration testée contre un écran qu'on ne peut pas modifier. Cela ferait plus d'actions irréversibles, sur du code voué à disparaître.

Avec D2, ces cinq points sont supprimés par le lot lui-même. Il ne reste qu'une modification :

- dans `shop_settings`, la colonne devient facultative, sans valeur par défaut ;
- les 0 jamais choisis (les 4 boutiques) passent à « non renseigné » ;
- dans l'app, le serveur des Objectifs, l'affichage du formulaire, et les phrases de l'audit et de l'e-mail (tableau 4.2 du rapport précédent).

Tout se fait sous la même sauvegarde Supabase que D2, dans la même migration relue et testée en base de test avant la production.

**Coût de l'attente jusqu'à D2 : faible.** Aujourd'hui, un 0 est déjà traité partout comme « non renseigné » :

- le formulaire l'affiche vide ;
- la mise en route le compte comme manquant ;
- l'analyse de marge utilise le repère de 40 % ;
- l'alerte e-mail ne se déclenche qu'à perte, ce qui est le comportement voulu sans objectif.

Aucun calcul n'est faux. Deux défauts restent visibles jusqu'à D2 :

- un 0 % choisi exprès ne se distingue pas d'un objectif absent ;
- l'audit et l'e-mail écrivent « objectif à 0 % » ou « (0 %) » au lieu de « non renseigné ».

Proposition : inscrire l'alignement de l'objectif au périmètre de D2, avec la sauvegarde Supabase et la réécriture des arguments des offres, et le rappeler dans la Phase 0 de D2.
