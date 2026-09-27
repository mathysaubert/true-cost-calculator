# D2-1 — W7 : textes des offres proposés, en rendu réel (2026-09-26)

Statut : **textes validés par Mathys le 2026-09-26, avec les corrections du §3 ; rien n'est encore écrit dans l'app.** Le rendu utilise les vrais composants et la vraie feuille de style de l'app, le vrai polaris.js et Edge. Il passe par une copie de travail de l'écran Offre, hors du dépôt, qui applique W4 (a) : un seul bouton « Changer d'offre » vers la page d'offres de Shopify.

Captures, dans `docs/rapports/2026-09-26_w7_captures/` :

| Fichier | Contenu |
|---|---|
| `offre_fr_free_1280.png` | Français, offre actuelle Gratuit, ordinateur |
| `offre_fr_pro_1280.png` | Français, offre actuelle Pro (Pro marquée « Actuelle », sans ligne d'essai) |
| `offre_en_free_1280.png` | Anglais, offre actuelle Gratuit |
| `offre_fr_free_390.png` | Français, téléphone (390 px) : cartes empilées, sans défilement horizontal |

## 1. Textes proposés (français)

**En-tête**
- Sous-titre : « Votre offre actuelle et ce que contient chaque offre. La facturation et le changement d'offre passent par Shopify. »
- Bouton : « Changer d'offre », avec l'aide « Ouvre la page d'offres de Shopify : montée, descente ou essai, en un clic. »

**Gratuit : 0 $ / mois, jusqu'à 50 commandes par mois**
1. Votre marge réelle par commande et par produit, frais cachés déduits
2. Aujourd'hui : vos priorités, classées par ce qu'elles vous coûtent
3. Indicateurs clés et fiabilité des données : ce qui est calculé, et à quel point c'est sûr
4. Coûts produits, réglages et import de vos coûts (Excel ou CSV)

**Pro : 29 $ / mois, 14 jours d'essai gratuit, jusqu'à 500 commandes par mois** (badge « Populaire »)
1. Tout ce que contient Gratuit
2. Simulateur complet : toute la boutique, un produit existant ou un nouveau produit, avant de décider
3. Vos scénarios retenus, à rejouer à tout moment
4. Alerte e-mail dès qu'un produit passe à perte

**Expert : 69 $ / mois, 14 jours d'essai gratuit, jusqu'à 3 000 commandes par mois** (badge « Recommandé »)
1. Tout ce que contient Pro
2. Audit du catalogue : la marge de chaque produit actif à son prix catalogue, même avant sa première vente

**Pied de page**
- « Jamais de blocage : si vous dépassez le volume de votre offre, tout reste accessible. L'app vous propose alors l'offre adaptée, à partir du mois suivant. »
- « Plus de 3 000 commandes par mois ? Une offre sur mesure est possible sur demande. »

La version anglaise, équivalente, est visible sur la capture `offre_en_free_1280.png`.

## 2. Points à trancher

1. **La mesure des décisions à 30 jours (Y4, Pro) n'existe pas encore.** La mémoire des décisions enregistre et rejoue les scénarios, mais ne mesure rien. Selon Y4 (« les offres ne décrivent que ce qui existe »), elle est **absente** des textes, qui la remplacent par « Vos scénarios retenus, à rejouer ». Elle sera ajoutée le jour où elle existera.
2. **Volumes et contenu des offres dépendent de D2-2.**
   - Aujourd'hui, l'app applique encore 200 / 1 000 commandes / illimité, et ne réserve pas encore le Simulateur ni les alertes à Pro (Z4). Ces textes décrivent donc l'état **après D2-2**.
   - Options :
     - (a) **publier ces textes avec D2-2** ; D2-1 garde les textes actuels, en corrigeant seulement l'essai à 14 jours et le bouton ;
     - (b) livrer D2-1 et D2-2 ensemble, avant l'activation d'App Pricing.
   - Recommandation : **(b)**. L'activation d'App Pricing est de toute façon après les deux lots, et le marchand ne verrait jamais d'écart entre le texte et l'app.
3. **Liste d'Expert courte** (2 lignes). C'est honnête : seul l'audit est propre à Expert aujourd'hui. Le copilote IA et la publicité connectée y seront ajoutés quand ils existeront (Y4).
4. **Badges** « Populaire » (Pro) et « Recommandé » (Expert) : gardés tels quels. À retirer si tu préfères.

## 3. Validation de Mathys et corrections (2026-09-26)

- **Mesure à 30 jours.** Vérifiée dans le code : S2 (97f0569) l'a bien livrée. `review_at` = date de décision + horizon. Le résultat est posé une seule fois, en arrière-plan, à la première ouverture après cette date (`reviewDueDecisions`). La mémoire affiche « observé à partir du … », puis « observé {{valeur}} (toutes causes confondues) ». **Mon exclusion était une erreur** : j'avais cherché de mauvais libellés. Ligne ajoutée à Pro : « Le résultat réel de vos décisions, mesuré 30 jours après (toutes causes confondues) ». La réserve reprend celle que l'app affiche déjà. L'alerte e-mail passe en 5e ligne.
- **Livraison.** Option (b) : D2-1 et D2-2 sont livrés ensemble, avant l'activation d'App Pricing.
- **Expert en deux lignes :** validé.
- **Badges.** « Populaire » est retiré (aucun abonné, ce serait inexact). « Recommandé » passe sur **Pro** ; Expert n'a plus de badge.
- **Captures refaites** avec ces corrections, dans le même dossier.
