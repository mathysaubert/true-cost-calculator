# Retours boutique de dev sur la cascade : diagnostic et correctifs (2026-09-24)

Contexte : rendu complet de F4-B sur la boutique de dev (15 commandes de test). Deux incohérences
dans « Où est passé votre argent ? ». Diagnostic en lecture seule, correctifs, gate, commit sur GO.

## 1. La cascade ne s'additionnait pas : 855 − 430 − 4,20 = 420,80 mais CM2 = 300,80

**Diagnostic.** Le nœud `cm2` du moteur vaut `known_ca_ht − coûts` : il ne compte que les lignes à
coût connu. Sur la boutique de dev, les trois Posters (3 × 40 = 120 $) n'ont pas de coût : CA net
855, CA à coût connu 735, CM2 = 735 − 430 − 4,20 = 300,80. Les 120 $ sortaient de la marge sans
ligne pour le dire.

**Correctif.** `WATERFALL_SPEC` gagne une ligne optionnelle « CA sans coût connu, hors marge »
(`unknown_ca_ht`) entre le CA net et les coûts, masquée quand elle vaut 0. La cascade et le tableau
partagent `waterfallRows()` (module pur). **Invariant vérifié au centime sur la fixture à lignes sans
coût** (lot 31) : 744 − 372 − 132 − 0 − 0 − 8,94 − 0 = 231,06 = CM2 du moteur ; et sur la boutique
saine (aucune ligne masquée, 12 lignes).

## 2. « Coûts fixes (prorata) 0,00 $ » alors que le résultat dit « non renseignés »

**Diagnostic.** `fixedCostsForWindow()` renvoie 0 quand aucun coût fixe n'existe ; la cascade
lisait la feuille brute alors que la tuile applique la règle « > 0 sinon non renseigné ». Même
angle mort sur les autres coûts : emballage (réglage absent → feuille à 0), port (sans règle, le
moteur reprend le port facturé au client et le marque « non confirmé »), frais de paiement (règle
non confirmée → montant estimé ; aucune règle → 0), publicité (source non connectée → 0).

**Correctif.** `waterfallRows()` attribue un statut par ligne avec la même règle que les tuiles et
le bloc Résultats, à partir de `agg.dataGaps` et de drapeaux posés par le loader depuis les
réglages :

| Ligne | Règle | Affichage |
|---|---|---|
| Coûts fixes | aucune ligne `fixed_costs` | « non renseigné », sans barre, le total ne descend pas |
| Emballage | `packaging_cost_per_order` absent (ou trou `no_packaging_cost`) | « non renseigné » |
| Port marchand | trou `unconfirmed_shipping` : montant > 0 → **« à confirmer »** (badge, barre atténuée) ; 0 → « non renseigné » |
| Frais de paiement | trou `unconfirmed_fees` : idem | badge « à confirmer » ou « non renseigné » |
| Retours | `return_cost_per_return` absent **et** remboursements sur la période | « non renseigné » ; sans remboursement, 0 est juste |
| Publicité | aucune source pub | « non connecté » |
| Commissions | 0 sans règle de code | 0, juste |

Le tableau sous dépliage porte les mêmes statuts (`data-status`, badge, italique).

## 3. Preuves

Gate complète verte : lint 0 erreur (651 avertissements `prop-types`), 31 lots (lot 31 = 40, +5 :
spécification à 13 lignes, ligne masquée à 0 sur la boutique saine, invariant au centime avec lignes
sans coût, statuts par ligne, coût non renseigné qui ne descend pas le total), 109 rendus réels (+1 :
fixture manquante réelle avec « CA sans coût connu, hors marge −372,00 € », emballage et coûts fixes
« non renseigné », frais « à confirmer » avec badge, pub « non connecté », 13 lignes au tableau),
build OK, fichiers protégés 0 diff (`aggregate.js` intouché : le calcul de la CM2 est juste, c'est
la lecture qui manquait).

À revoir sur la boutique de dev : « CA net 855 → CA sans coût connu, hors marge −120 → coûts →
CM2 300,80 » ; « Coûts fixes : non renseigné » puis montant après saisie dans Réglages > Coûts ;
port et frais « à confirmer » tant que les règles ne sont pas confirmées, puis montants nets.
