# D0 — « Annuler » vide les champs des Réglages : cause et options (2026-09-25)

Statut : diagnostic fait, **aucun code écrit**. Plusieurs correctifs sont possibles : choix attendu.

## 1. Cause

Le test 1 de la boutique est reproduit par lecture du code de Polaris (script public `polaris.js`) et de React 19.

Sur un champ Polaris `s-text-field`, comme sur un champ HTML classique, il y a deux valeurs :

- **L'attribut `value`** est la valeur par défaut. Polaris le range dans `defaultValue`.
- **La propriété `value`** est la valeur affichée et saisie.

Quand la barre de sauvegarde annule, elle réinitialise le formulaire. Chaque champ Polaris exécute alors son code de réinitialisation, qui remet `value = defaultValue || ""`.

Ce que fait React 19 avec notre code `<s-text-field value={…}>` :

| Chemin | Ce que React 19 écrit | Valeur par défaut | « Annuler » |
|---|---|---|---|
| Page chargée en entier (rendu serveur) | attribut `value="…"` | la valeur enregistrée | remet la valeur : OK |
| Arrivée par le menu (rendu client) | propriété `value` seulement | vide | vide le champ : **échec** |

React 18 écrivait l'attribut dans les deux cas, d'où l'absence du problème avant D0. C'est le risque signalé au §7 du rapport D0.

Le même mécanisme touche les listes déroulantes `s-select`.

Formulaires concernés, tous construits sur les composants de `app/components/settings/Fields.jsx` :

- Coûts : coûts par commande, port, frais de paiement, coûts fixes ;
- Objectifs, Boutique, Marketing ;
- panneau des Coûts produits.

## 2. Un champ vidé par « Annuler » peut-il être enregistré vide ?

**Oui, aujourd'hui.** Après « Annuler », la barre de sauvegarde disparaît et les champs restent vides. Si le marchand modifie ensuite un autre champ du même formulaire puis enregistre, les champs vidés partent vides.

Côté serveur, un champ vide veut dire « effacer ». C'est la règle des Réglages : une valeur vide est enregistrée à NULL, jamais remplacée par un défaut inventé. Conséquences :

- les coûts par commande, le port et les frais sont effacés ;
- l'objectif de marge est remis à 0 %, ce qui change aussi l'alerte e-mail et le classement de l'audit.

D0 est en production depuis `a933211`. Aucune boutique marchande réelle n'est abonnée (vérifié le 2026-09-25), donc l'exposition réelle se limite aux boutiques de dev et de revue. Le correctif reste urgent.

## 3. Options de correctif

**Option A (recommandée) : donner aussi la valeur par défaut aux champs Polaris.**

- *Le changement.* Dans les 4 composants de `Fields.jsx`, on passe la même valeur à `value` et à `defaultValue`.
- *Pourquoi ça marche.* Sur le rendu serveur, l'attribut `value` reste écrit comme aujourd'hui. Sur le rendu client, React 19 pose la propriété `defaultValue`, que Polaris reflète dans l'attribut `value`. « Annuler » remet donc la valeur enregistrée dans les deux chemins.
- *Implications.* Un seul fichier change, et tous les formulaires sont corrigés d'un coup. Aucun changement visuel. Le correctif s'appuie sur la propriété `defaultValue` de Polaris, documentée pour ces champs.

**Option B : remplacer les champs Polaris des Réglages par des champs HTML natifs.**

- *Le changement.* C'est le repli S3b déjà prévu.
- *Implications.* Il ne dépend plus du fonctionnement interne de Polaris, car la réinitialisation native des champs HTML est standard. En revanche, les Réglages perdent l'apparence Polaris : champs, erreurs et aides seraient à restyler en CSS. Le changement est plus large : 6 fichiers de formulaires et les rendus.

**Option C : recharger toute la page à l'ouverture des Réglages.**

- *Le changement.* Les liens vers les Réglages forcent un chargement complet.
- *Implications.* Le problème est masqué, pas corrigé : une page de Réglages rendue côté client, par exemple après un enregistrement, pourrait encore le rencontrer. La navigation devient plus lente. Déconseillé.

## 4. Protection contre l'enregistrement d'un champ vidé

Avec l'option A ou B, « Annuler » remet les valeurs, et le cas de la section 2 disparaît. Reste le choix d'une protection supplémentaire :

- **P1 (recommandée) : pas de garde en plus.** Vider volontairement un champ efface toujours le réglage, selon la règle actuelle. Le contrôle ajouté (section 5) prouve qu'« Annuler » ne vide plus rien.
- **P2 : confirmation avant d'effacer.** Chaque champ porte sa valeur enregistrée dans le formulaire. Si un champ qui avait une valeur part vide, la page demande « Vous allez effacer : … » avant d'envoyer. Le marchand est protégé de toute cause d'effacement accidentel, au prix d'une étape de plus quand l'effacement est voulu.
- **P3 : refus côté serveur.** Un champ qui avait une valeur ne peut plus être vidé par le formulaire. Il faudrait un bouton « Effacer » explicite par champ. C'est la protection la plus forte, mais elle change la règle des Réglages et l'interface.

## 5. Contrôle qui prouve le retour de l'ancienne valeur

Le rendu serveur actuel ne peut pas voir ce défaut, car il ne touche que le chemin « page chargée en entier ». Pour prouver le chemin client, il faut un DOM.

- **D1 (recommandée) : `jsdom` en dépendance de développement,** ajoutée aux dépendances de test uniquement, jamais livrée. Un nouveau test rend les vrais composants de `Fields.jsx` avec le rendu client de React 19, dans un formulaire. Les éléments `s-text-field` et `s-select` y reproduisent le contrat Polaris lu dans `polaris.js` : attribut `value` égal à `defaultValue`, réinitialisation vers `defaultValue`. Le test saisit une valeur, réinitialise le formulaire et vérifie le retour de l'ancienne valeur, dans les deux chemins : rendu client, et rendu serveur suivi de l'hydratation. Il échoue aujourd'hui et doit passer après le correctif.
- **D2 : sans nouvelle dépendance.** Un test statique vérifie que chaque champ de `Fields.jsx` reçoit `defaultValue`. C'est une preuve plus faible : elle vérifie le code, pas le comportement.

Dans tous les cas, la preuve finale reste le test 1 refait en boutique après deploy.

## 6. Choix à faire

1. Correctif : A, B ou C.
2. Protection : P1, P2 ou P3.
3. Contrôle : D1 (ajoute `jsdom` en dépendance de développement) ou D2.

Recommandation : **A + P1 + D1**. Ensuite viennent la gate complète, le rapport, et aucun commit sans votre GO.
