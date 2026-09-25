# D0 — Correctif « Annuler » des Réglages, et règle « non renseigné » (2026-09-25)

Statut : correctif A + P1 + D1 **écrit, gate verte, non committé** (GO attendu).
L'alignement « non renseigné » n'est **pas écrit** : il change des calculs, des phrases, et demande une migration de schéma. Explication et choix en section 4.

Diagnostic : `docs/rapports/2026-09-25_d0_annuler-reglages.md`.

## 1. Correctif A

`app/components/settings/Fields.jsx` est le seul fichier applicatif modifié. Il couvre les quatre composants : nombre, texte, date et liste déroulante. Ils servent tous les formulaires des Réglages : Coûts, Objectifs, Boutique, Marketing et panneau des Coûts produits.

Chaque champ Polaris reçoit maintenant sa valeur de départ (la propriété `defaultValue`, que Polaris reflète dans l'attribut `value`). C'est celle que remet « Annuler ». Elle est posée côté client, après chaque rendu, dès que la valeur enregistrée change.

Écart avec la version décrite dans le diagnostic : passer `defaultValue` directement en prop faisait écrire à React 19 un attribut `defaultValue` dans le HTML serveur. Il en résultait un écart d'hydratation à chaque chargement complet des Réglages, détecté par le nouveau test. La valeur de départ est donc posée côté client seulement. Le HTML serveur est inchangé : attribut `value` seul, comme avant.

## 2. Protection P1 et contrôle D1

**P1 :** aucune garde supplémentaire. « Annuler » remet la valeur enregistrée, donc un champ ne peut plus être vidé par accident par ce chemin. Vider volontairement un champ reste un effacement, sous réserve de la section 4.

**D1 :** `tests/lot35_settings_reset.mjs` (10 assertions), dans la chaîne `npm test` et donc dans le build Vercel.

- Il rend les **vrais** composants de `Fields.jsx` avec le rendu client de React 19, dans `jsdom`.
- Les éléments `s-text-field` et `s-select` reproduisent le contrat lu dans `polaris.js` : attribut `value` égal à `defaultValue`, et réinitialisation `value = defaultValue || ""`.

Chemins prouvés :

| Chemin | Résultat |
|---|---|
| Arrivée par le menu (rendu client) : saisie puis « Annuler » | les 4 types de champ reprennent la valeur enregistrée |
| Après un enregistrement (nouvelle valeur) puis « Annuler » | reprend la nouvelle valeur |
| Page chargée en entier (rendu serveur + hydratation) | reprend la valeur, 0 écart d'hydratation, HTML serveur sans `defaultValue` |
| Réglage non renseigné, puis « Annuler » | reste vide, aucune valeur inventée |
| Témoin : champ Polaris sans le correctif | « Annuler » vide le champ (défaut de la boutique reproduit) |

Contre-épreuve : sans le correctif (fichier `Fields.jsx` d'origine), le lot 35 échoue sur 3 assertions, celles du chemin « arrivée par le menu ».

**Dépendance ajoutée :** `jsdom` 28.1.0, en développement seulement. La version 30 exige Node 24.15 ou plus, ce que `engine-strict` aurait pu refuser sur Vercel. La version 28 accepte Node 20.19, 22.12 et 24 ou plus. Audit npm inchangé : 46.

## 3. Gate

| Étape | Résultat |
|---|---|
| `npm run lint` | 0 erreur, 104 warnings |
| `npm test` | 35 lots verts, dont le lot 35 |
| `node scripts/render_check.mjs` | 136 scénarios OK |
| `node scripts/render_routes.mjs` | 39 rendus OK |
| `npm run build` | OK |
| Fichiers protégés | 0 diff |

Correction annexe du rendu : le scénario Connexions utilisait des dates fixes (24 septembre, 10 h UTC), alors que le composant mesure l'écart avec l'horloge réelle. Depuis 10 h UTC aujourd'hui, « il y a 2 heures » était devenu « hier » et le scénario échouait. Les dates sont désormais relatives à l'heure courante. Le composant n'a pas changé.

Preuve finale : refaire le test 1 en boutique après deploy. Arriver dans Réglages par le menu, modifier un champ, « Annuler » : l'ancienne valeur doit revenir.

## 4. Règle « un réglage effacé reste non renseigné » : audit du serveur

### 4.1 Ce que fait le serveur aujourd'hui, champ par champ

| Page | Champ | Champ vidé puis enregistré | Conforme |
|---|---|---|---|
| Coûts | Emballage par commande | non renseigné (NULL) | oui |
| Coûts | Coût par retour | non renseigné | oui |
| Coûts | Fenêtre de retour (jours) | non renseigné | oui |
| Coûts | Délai de livraison promis | non renseigné | oui |
| Coûts | **Port par défaut** | **0 €, et marqué confirmé** | **non** |
| Coûts | Port par pays (lignes) | ligne vide ignorée | oui |
| Coûts | Frais de paiement (%, fixe) | refusé : champ obligatoire | oui (jamais 0) |
| Coûts | Coût fixe (montant) | refusé : champ obligatoire | oui |
| Objectifs | **Objectif de marge CM2** | **0 %** | **non** |
| Objectifs | Marge visée après pub | non renseigné | oui |
| Objectifs | Prix du produit principal | non renseigné | oui |
| Boutique | Pays, balise B2B, langues, listes de pays | non renseigné | oui |
| Boutique | Historique (mois) | inchangé : colonne obligatoire, défaut 24 | oui (jamais 0) |
| Boutique | Régime de TVA | liste sans choix vide | oui |
| Marketing | Commission, montants | refusés : obligatoires | oui |
| Coûts produits | Coûts d'une variante | non renseigné (règle (c)) | oui |

Deux champs sont non conformes. Valeurs stockées aujourd'hui, lues sans rien modifier :

- les 4 boutiques ont l'objectif à 0, la valeur par défaut, jamais choisie ;
- aucune n'a de port par défaut enregistré.

### 4.2 Objectif de marge CM2 : ce que changerait l'alignement

**Pourquoi il est à 0.** La colonne est déclarée obligatoire avec 0 par défaut, dans `shop_settings` comme dans `shop_plans`. Le déclencheur de recopie de l'écran classique (R0-02) force aussi 0. Le formulaire Objectifs affiche déjà un 0 comme un champ vide : aujourd'hui, 0 sert de « non renseigné » déguisé, et un vrai choix de 0 % ne se distingue pas d'un objectif absent.

Ce qu'il faudrait :

1. **Migration de schéma (action irréversible, GO séparé) :**
   - la colonne devient facultative dans `shop_settings` et `shop_plans` ;
   - le déclencheur R0-02 recopie l'absence au lieu de la remplacer par 0 ;
   - les 0 actuels, tous des valeurs par défaut, deviennent « non renseigné » (NULL).
2. **Serveur :** un champ vidé reste NULL. Un 0 saisi reste un vrai 0 %.
3. **Formulaire :** un 0 enregistré s'affiche « 0 », un objectif absent s'affiche vide.

Effet sur les calculs : **aucun**. Tous les consommateurs traitent déjà l'absence comme 0 :

- l'alerte e-mail compare à la perte stricte ;
- l'audit n'a pas de bande « sous l'objectif » ;
- les cibles de CPA prennent le seuil de rentabilité seul ;
- l'analyse « marge en baisse » utilise le repère de 40 %.

Effet sur les phrases, qui changent :

| Endroit | Aujourd'hui (objectif à 0) | Après (objectif non renseigné) |
|---|---|---|
| Audit du catalogue | « objectif à 0 % : bande inactive » | « objectif non renseigné : bande inactive », avec un lien vers Objectifs |
| E-mail d'alerte | « sous votre objectif de marge (0 %) » | « à perte » ; la phrase avec pourcentage est réservée à un objectif réellement choisi |
| Objectifs | un 0 s'affiche vide | un 0 choisi s'affiche « 0 » ; un objectif absent s'affiche vide |
| Mise en route | « objectif non renseigné » si 0 | inchangé pour un objectif absent ; un 0 % choisi compte comme « renseigné » |

Un vrai choix de 0 % continue de vouloir dire « alerte seulement à perte réelle ».

L'écran classique, protégé jusqu'à D2, écrit encore l'objectif dans `shop_plans`. Il garde son comportement : il envoie toujours un nombre.

### 4.3 Port par défaut : ce que changerait l'alignement

**Aujourd'hui.** Vider le port par défaut puis enregistrer stocke 0 €, marqué confirmé. Le moteur compte alors un port marchand de 0 € sur chaque commande sans règle par pays. C'est une marge trop optimiste, présentée comme sûre.

**Après.** Le port par défaut vidé reste non renseigné. Il n'y a pas de migration : c'est un champ JSON. Le moteur applique alors sa règle existante pour un port absent : il compte « le port facturé au client » et le signale « à confirmer ».

Effet sur les calculs :

- la CM2 baisse du port facturé sur les commandes concernées, au lieu de 0 € ;
- la part « à confirmer » de la fiabilité augmente.

Effet sur les phrases et les écrans :

- la Fiabilité des données et les cascades affichent « port à confirmer » ;
- la mise en route marque le port « non renseigné », au lieu de « renseigné » ;
- le Simulateur (nouveau produit) et l'audit ne pré-remplissent plus de port, et l'audit le liste dans « non renseignés ».

Le cas d'un marchand qui expédie réellement à ses frais sans coût (0 €) reste possible : il saisit 0, qui est alors un vrai choix confirmé.

Aucune boutique n'a de port par défaut enregistré aujourd'hui : l'alignement ne change aucun chiffre existant.

### 4.4 Choix à faire

1. **Port par défaut :** aligner (vide = non renseigné) ou laisser tel quel. Ni migration ni donnée existante touchée.
2. **Objectif de marge :** aligner ou laisser tel quel. L'alignement demande la migration de schéma de la section 4.2, qui passe par un GO séparé avant application en test puis en production.
3. Si vous alignez l'objectif : confirmer le nouvel e-mail d'alerte et le libellé de l'audit (tableau 4.2).

Recommandation : aligner les deux. Le port d'abord, car il est sans migration et corrige une marge optimiste présentée comme sûre. L'objectif ensuite, avec la migration écrite, testée en base de test et soumise à votre GO avant la production.
