# I0 — Contenu pédagogique par KPI et par insight (brouillon en/fr, à relire)

Brouillon rédigé à partir du brief §10 et de la synthèse stratégique. Anglais = source (décision
11), français = version relue. Aucun chiffre inventé : les repères sont ceux de `config.js`
(`BENCHMARKS`), les variables `{{…}}` sont remplies par le moteur. Convention : phrases courtes,
jamais de causalité affirmée dans `cause` sans contribution chiffrée ; les impacts sont des
fourchettes (« environ {{low}} à {{high}} »). Clés cibles : `learn.kpi.<id>.*`, `insight.<rule>.*`.

## 1. Les 12 indicateurs (`learn.kpi.<id>.what | why | how | watch`)

### ca_ht — Net revenue (excl. tax) / CA net HT
- what · en: What your customers paid for products and shipping, after discounts and refunds, before tax. · fr: Ce que vos clients ont payé pour les produits et le port, après remises et remboursements, avant taxes.
- why · en: Every margin starts here; growing revenue that does not grow contribution is the first warning sign. · fr: Toute marge part d'ici ; un CA qui monte sans que la contribution suive est le premier signal d'alerte.
- how · en: Gross revenue − discounts − refunds − tax lines, from each order line, in your store currency. · fr: CA brut − remises − remboursements − lignes de taxe, ligne par ligne, dans la devise de la boutique.
- watch · en: Compare it with contribution, not on its own. · fr: À lire avec la contribution, jamais seul.

### orders — Orders / Commandes
- what · en: Distinct paid orders in the period, excluding test, draft, cancelled, gift-card-only and B2B orders. · fr: Commandes payées distinctes de la période, hors test, brouillon, annulées, cartes cadeaux seules et B2B.
- why · en: Volume drives fixed-cost absorption and the reliability of every ratio. · fr: Le volume absorbe les coûts fixes et conditionne la fiabilité de tous les ratios.
- how · en: Counted once per order; refunded orders stay counted with their refund. · fr: Une fois par commande ; une commande remboursée reste comptée avec son remboursement.
- watch · en: Below 10 orders, ratios are not shown yet. · fr: Sous 10 commandes, les ratios ne s'affichent pas encore.

### aov — Average order value / Panier moyen
- what · en: Net revenue divided by orders. · fr: CA net HT divisé par le nombre de commandes.
- why · en: A larger basket dilutes shipping, packaging and payment fees per order. · fr: Un panier plus grand dilue le port, l'emballage et les frais de paiement par commande.
- how · en: Net revenue (excl. tax) ÷ orders. · fr: CA net HT ÷ commandes.
- watch · en: Aim for 10 to 30 % above your main product price; below that, bundles and thresholds are the usual levers. · fr: Visez 10 à 30 % au-dessus du prix de votre produit principal ; en dessous, bundles et seuils de livraison sont les leviers habituels.

### cvr — Conversion rate / Taux de conversion
- what · en: Sessions that completed checkout divided by sessions. · fr: Sessions ayant finalisé le paiement divisées par les sessions.
- why · en: It multiplies every other effort: the same traffic, more orders. · fr: Il multiplie tout le reste : même trafic, plus de commandes.
- how · en: Requires Shopify session data; computed on human sessions only. · fr: Exige les données de sessions Shopify ; calculé sur les sessions humaines seulement.
- watch · en: Typical range 1.5 to 3 %; read it with the add-to-cart and checkout rates. · fr: Plage habituelle 1,5 à 3 % ; à lire avec les taux d'ajout au panier et de paiement.

### cm2_pct — Contribution margin 2 / Marge de contribution 2
- what · en: What is left after the product cost, shipping you pay, packaging, payment fees and return costs, as a share of net revenue. · fr: Ce qui reste après le coût produit, le port que vous payez, l'emballage, les frais de paiement et les frais de retour, en part du CA net.
- why · en: It is the money available to pay for acquisition and fixed costs. · fr: C'est l'argent disponible pour payer l'acquisition et les coûts fixes.
- how · en: (Net revenue − landed product cost − order costs) ÷ net revenue, on lines with a known cost. · fr: (CA net − coût produit rendu − coûts de commande) ÷ CA net, sur les lignes à coût connu.
- watch · en: Your own target comes first; 40 to 60 % is the usual band. · fr: Votre objectif prime ; 40 à 60 % est la bande habituelle.

### cm3 — Contribution margin 3 / Marge de contribution 3
- what · en: Contribution after advertising and partner commissions. · fr: La contribution après publicité et commissions partenaires.
- why · en: It tells whether growth paid for itself. · fr: Elle dit si la croissance s'est payée elle-même.
- how · en: CM2 − ad spend − commissions. Without an ad source connected, CM3 equals CM2. · fr: CM2 − dépenses pub − commissions. Sans source pub connectée, la CM3 égale la CM2.
- watch · en: A CM3 that shrinks while revenue grows means acquisition is eating the margin. · fr: Une CM3 qui rétrécit quand le CA monte : l'acquisition mange la marge.

### net_result — Net result / Résultat net
- what · en: What remains after fixed costs, prorated to the period. · fr: Ce qui reste après les coûts fixes, au prorata de la période.
- why · en: The only number that says whether the business made money. · fr: Le seul chiffre qui dit si l'entreprise a gagné de l'argent.
- how · en: CM3 − fixed costs × days in period ÷ days in month. Without fixed costs entered, the result is an estimate. · fr: CM3 − coûts fixes × jours de la période ÷ jours du mois. Sans coûts fixes renseignés, c'est une estimation.
- watch · en: Enter fixed costs once; the break-even point follows. · fr: Renseignez vos coûts fixes une fois ; le point mort en découle.

### cac_global — Customer acquisition cost / Coût d'acquisition client
- what · en: Advertising and commissions divided by new customers. · fr: Publicité et commissions divisées par les nouveaux clients.
- why · en: Above the contribution of a first order, each new customer loses money until they buy again. · fr: Au-dessus de la contribution d'une première commande, chaque nouveau client perd de l'argent jusqu'à son rachat.
- how · en: (Ad spend + commissions) ÷ new customers; new = first order of the customer. · fr: (Dépenses pub + commissions) ÷ nouveaux clients ; nouveau = première commande du client.
- watch · en: Compare it with your break-even CAC (CM2 of a first order). · fr: À comparer à votre CAC de rentabilité (CM2 d'une première commande).

### mer — Marketing efficiency ratio / Efficacité marketing (MER)
- what · en: Net revenue divided by total marketing spend. · fr: CA net divisé par la dépense marketing totale.
- why · en: The blended view no attribution model can distort. · fr: La vue globale qu'aucun modèle d'attribution ne déforme.
- how · en: Net revenue (excl. tax) ÷ (ad spend + commissions). · fr: CA net HT ÷ (dépenses pub + commissions).
- watch · en: Below 3, marketing takes more than a third of revenue. · fr: Sous 3, le marketing prend plus d'un tiers du CA.

### poas — Profit on ad spend / Profit sur dépenses pub (POAS)
- what · en: Contribution of orders attributed to paid channels divided by ad spend. · fr: Contribution des commandes attribuées aux canaux payants divisée par les dépenses pub.
- why · en: ROAS counts revenue; POAS counts what you keep. · fr: Le ROAS compte le CA ; le POAS compte ce que vous gardez.
- how · en: CM2 of UTM-attributed orders ÷ ad spend. · fr: CM2 des commandes attribuées par UTM ÷ dépenses pub.
- watch · en: Below 1, paid orders do not cover their own ads. · fr: Sous 1, les commandes payantes ne couvrent pas leur publicité.

### ltv_cac — LTV / CAC
- what · en: Average lifetime contribution of a customer divided by the cost to acquire one. · fr: Contribution moyenne d'un client sur sa durée de vie divisée par son coût d'acquisition.
- why · en: It says how much acquisition the business can afford. · fr: Il dit combien d'acquisition l'entreprise peut se permettre.
- how · en: Average CM2 per customer over the history ÷ CAC; needs at least 30 customers and 6 months. · fr: CM2 moyenne par client sur l'historique ÷ CAC ; exige au moins 30 clients et 6 mois.
- watch · en: 3 is the usual floor. · fr: 3 est le plancher habituel.

### return_rate — Return rate / Taux de retour
- what · en: Orders returned or refunded among orders whose return window has closed. · fr: Commandes retournées ou remboursées parmi celles dont le délai de retour est écoulé.
- why · en: A return costs the sale, the shipping and the handling; reasons point to the fix. · fr: Un retour coûte la vente, le port et le traitement ; les motifs indiquent le remède.
- how · en: Returned or refunded orders ÷ orders past the return window (default 30 days). · fr: Commandes retournées ou remboursées ÷ commandes hors délai de retour (30 jours par défaut).
- watch · en: Above 5 % overall, or 1 % for defects, look at the reasons. · fr: Au-dessus de 5 % au total, ou 1 % pour défaut, regardez les motifs.

## 2. Les 17 règles (`insight.<rule>.observation | context | cause | impact | recommendation | simulation | followup | partial`)

Variables communes : `{{period}}`, `{{prev}}`, `{{delta_pts}}`, `{{delta_pct}}`, `{{low}}`,
`{{high}}`, `{{currency}}`, `{{confidence}}`.

### cm2_below_target
- observation · en: Your contribution margin is {{cm2_pct}}, below your {{target}} target. · fr: Votre marge de contribution est de {{cm2_pct}}, sous votre objectif de {{target}}.
- context · en: Over {{period}}, on {{known_share}} of revenue with a known cost. · fr: Sur {{period}}, sur {{known_share}} du CA à coût connu.
- cause · en: Product cost weighs {{cogs_share}} of revenue and order costs {{order_cost_share}}. · fr: Le coût produit pèse {{cogs_share}} du CA et les coûts de commande {{order_cost_share}}.
- impact · en: Reaching the target would add about {{low}} to {{high}} of contribution over the period. · fr: Atteindre l'objectif ajouterait environ {{low}} à {{high}} de contribution sur la période.
- recommendation · en: Test a price increase on the main product or renegotiate its cost. · fr: Testez une hausse de prix sur le produit principal ou renégociez son coût.
- simulation · en: Price +{{x}} % at constant volume, or product cost −{{y}} %. · fr: Prix +{{x}} % à volume constant, ou coût produit −{{y}} %.
- followup · en: Check the margin 14 days after the change. · fr: Vérifiez la marge 14 jours après le changement.
- partial · en: With {{orders}} orders, the margin per order is measurable; {{missing}} more orders before the rate is reliable. · fr: Avec {{orders}} commandes, la marge par commande est mesurable ; encore {{missing}} commandes avant un taux fiable.

### cm2_drop
- observation · en: Your contribution margin fell by {{delta_pts}} points. · fr: Votre marge de contribution a baissé de {{delta_pts}} points.
- context · en: {{cm2_pct}} over {{period}}, against {{prev_cm2_pct}} the previous period. · fr: {{cm2_pct}} sur {{period}}, contre {{prev_cm2_pct}} la période précédente.
- cause · en: {{factor_1}} explains {{share_1}} of the change; {{factor_2}} explains {{share_2}}. · fr: {{factor_1}} explique {{share_1}} de l'écart ; {{factor_2}} en explique {{share_2}}.
- impact · en: About {{low}} to {{high}} of contribution over the period. · fr: Environ {{low}} à {{high}} de contribution sur la période.
- recommendation · en: Act on {{factor_1}} first. · fr: Agissez d'abord sur {{factor_1}}.
- simulation · en: Bring {{factor_1}} back to its previous level, everything else equal. · fr: Ramenez {{factor_1}} à son niveau précédent, toutes choses égales par ailleurs.
- followup · en: Compare the margin after 7 days. · fr: Comparez la marge après 7 jours.
- partial · en: The margin moved, but {{unexplained}} of the change is not explained by the data: treat it as a signal to verify. · fr: La marge a bougé, mais {{unexplained}} de l'écart n'est pas expliqué par les données : à vérifier.

### revenue_vs_contribution
- observation · en: Revenue grew {{rev_delta}} while contribution changed {{cm2_delta}}. · fr: Le CA a progressé de {{rev_delta}} alors que la contribution a varié de {{cm2_delta}}.
- context · en: Growth is not turning into margin. · fr: La croissance ne se transforme pas en marge.
- cause · en: Variable costs rose faster than revenue: {{factor_1}} ({{share_1}}). · fr: Les coûts variables ont monté plus vite que le CA : {{factor_1}} ({{share_1}}).
- impact · en: The gap represents about {{low}} to {{high}} of contribution. · fr: L'écart représente environ {{low}} à {{high}} de contribution.
- recommendation · en: Slow the cost driver before pushing more volume. · fr: Freinez le poste de coût avant de pousser le volume.
- simulation · en: Same revenue with the previous cost rates. · fr: Même CA avec les taux de coût précédents.
- followup · en: Watch contribution per order weekly. · fr: Suivez la contribution par commande chaque semaine.
- partial · en: Revenue is up; contribution needs a known cost on {{missing_share}} of revenue to be compared. · fr: Le CA monte ; la contribution a besoin d'un coût connu sur {{missing_share}} du CA pour être comparée.

### refund_pressure
- observation · en: Refunds reached {{refund_share}} of gross revenue. · fr: Les remboursements atteignent {{refund_share}} du CA brut.
- context · en: {{refunded}} refunded on {{gross}} sold over {{period}}. · fr: {{refunded}} remboursés sur {{gross}} vendus sur {{period}}.
- cause · en: Main reason: {{reason}} ({{reason_share}} of returned units). · fr: Motif principal : {{reason}} ({{reason_share}} des unités retournées).
- impact · en: Above a 5 % rate, refunds cost about {{low}} to {{high}} of revenue. · fr: Au-delà de 5 %, les remboursements coûtent environ {{low}} à {{high}} de CA.
- recommendation · en: Fix the top reason on the most returned product. · fr: Traitez le motif principal sur le produit le plus retourné.
- simulation · en: Return rate back to {{target_rate}}. · fr: Taux de retour ramené à {{target_rate}}.
- followup · en: Check the rate once the return window has closed for the period. · fr: Vérifiez le taux une fois le délai de retour écoulé pour la période.
- partial · en: Refunds are visible now; the rate needs {{missing}} more orders past their return window. · fr: Les remboursements sont visibles ; le taux exige encore {{missing}} commandes hors délai de retour.

### discount_weight
- observation · en: Discounts take {{discount_share}} of gross revenue. · fr: Les remises prennent {{discount_share}} du CA brut.
- context · en: {{discounts}} of discounts on {{gross}} over {{period}}. · fr: {{discounts}} de remises sur {{gross}} sur {{period}}.
- cause · en: Codes {{top_codes}} carry most of it. · fr: Les codes {{top_codes}} en portent l'essentiel.
- impact · en: Every 5 points of discount are about {{low}} to {{high}} of contribution. · fr: Chaque 5 points de remise représentent environ {{low}} à {{high}} de contribution.
- recommendation · en: Cap the discount or restrict it to first orders. · fr: Plafonnez la remise ou réservez-la aux premières commandes.
- simulation · en: Discounts −{{x}} points at constant volume. · fr: Remises −{{x}} points à volume constant.
- followup · en: Compare orders and margin 14 days after. · fr: Comparez commandes et marge 14 jours après.
- partial · en: Discount weight is measurable from the first order. · fr: Le poids des remises se mesure dès la première commande.

### cost_coverage
- observation · en: {{lines}} order lines have no product cost. · fr: {{lines}} lignes de commande n'ont pas de coût produit.
- context · en: {{unknown_share}} of revenue cannot be margin-checked. · fr: {{unknown_share}} du CA ne peut pas être analysé en marge.
- cause · en: Costs are missing for {{products}} products. · fr: Les coûts manquent pour {{products}} produits.
- impact · en: Unknown until costs are entered. · fr: Inconnu tant que les coûts ne sont pas saisis.
- recommendation · en: Enter the cost of {{top_product}} first: it covers {{top_share}} of the missing revenue. · fr: Saisissez d'abord le coût de {{top_product}} : il couvre {{top_share}} du CA manquant.
- simulation · en: none · fr: aucune
- followup · en: Margins recompute with the next synchronization. · fr: Les marges se recalculent à la prochaine synchronisation.
- partial · en: Revenue, orders and basket are already reliable; contribution needs the costs. · fr: CA, commandes et panier sont déjà fiables ; la contribution attend les coûts.

### fees_unconfirmed
- observation · en: Payment or shipping costs are estimated on {{orders}} orders. · fr: Les frais de paiement ou de port sont estimés sur {{orders}} commandes.
- context · en: Estimates use default rates until you confirm yours. · fr: Les estimations utilisent des taux par défaut tant que vous ne confirmez pas les vôtres.
- cause · en: none · fr: aucune
- impact · en: About {{low}} to {{high}} of estimated fees in the margin. · fr: Environ {{low}} à {{high}} de frais estimés dans la marge.
- recommendation · en: Confirm your rates: reliability goes from {{score}} to {{score_after}}. · fr: Confirmez vos taux : la fiabilité passe de {{score}} à {{score_after}}.
- simulation · en: none · fr: aucune
- followup · en: none · fr: aucun
- partial · en: The margin is computed; only its precision is affected. · fr: La marge est calculée ; seule sa précision est en jeu.

### aov_vs_main_price
- observation · en: Your average order is {{aov}}, close to your main product price ({{main_price}}). · fr: Votre panier moyen est de {{aov}}, proche du prix de votre produit principal ({{main_price}}).
- context · en: Most customers buy one item. · fr: La plupart des clients achètent un seul article.
- cause · en: none · fr: aucune
- impact · en: Raising the basket by {{x}} % could add about {{low}} to {{high}} of contribution per month, before any effect on conversion. · fr: Augmenter le panier de {{x}} % pourrait ajouter environ {{low}} à {{high}} de contribution par mois, avant effet éventuel sur la conversion.
- recommendation · en: Test a bundle or a free-shipping threshold. · fr: Testez un bundle ou un seuil de livraison offerte.
- simulation · en: Basket +{{x}} % at constant orders. · fr: Panier +{{x}} % à commandes constantes.
- followup · en: Compare basket and conversion after 14 days. · fr: Comparez panier et conversion après 14 jours.
- partial · en: The basket is measurable at 10 orders. · fr: Le panier se mesure à partir de 10 commandes.

### provisional_share
- observation · en: {{share}} of revenue is still within the return window. · fr: {{share}} du CA est encore dans le délai de retour.
- context · en: Figures for the last {{days}} days may still move. · fr: Les chiffres des {{days}} derniers jours peuvent encore bouger.
- recommendation · en: Read margins with caution until the window closes. · fr: Lisez les marges avec prudence jusqu'à la fin du délai.
- partial · en: same as observation · fr: identique à l'observation

### product_concentration
- observation · en: {{product}} makes {{share}} of your revenue. · fr: {{product}} fait {{share}} de votre CA.
- context · en: One product carries the business. · fr: Un seul produit porte l'activité.
- impact · en: A 10 % drop on this product is about {{low}} to {{high}} of contribution. · fr: Une baisse de 10 % sur ce produit représente environ {{low}} à {{high}} de contribution.
- recommendation · en: Protect its margin and cost; watch its return rate. · fr: Protégez sa marge et son coût ; surveillez son taux de retour.
- partial · en: Concentration is measurable from the first orders. · fr: La concentration se mesure dès les premières commandes.

### product_loss
- observation · en: {{product}} loses money: {{cm2}} per unit. · fr: {{product}} perd de l'argent : {{cm2}} par unité.
- context · en: On {{units}} units over {{period}}. · fr: Sur {{units}} unités sur {{period}}.
- cause · en: Landed cost {{landed}} against a net price of {{price}}. · fr: Coût rendu {{landed}} contre un prix net de {{price}}.
- impact · en: About {{low}} to {{high}} lost over the period. · fr: Environ {{low}} à {{high}} perdus sur la période.
- recommendation · en: Raise the price, cut the cost or stop selling it alone. · fr: Montez le prix, baissez le coût ou ne le vendez plus seul.
- simulation · en: Price to break-even: {{be_price}}. · fr: Prix de rentabilité : {{be_price}}.
- followup · en: Check the unit margin after the change. · fr: Vérifiez la marge unitaire après le changement.
- partial · en: Needs a known cost for this product. · fr: Exige un coût connu pour ce produit.

### cac_above_be
- observation · en: Your CAC is {{cac}}, above your break-even CAC of {{be_cac}}. · fr: Votre CAC est de {{cac}}, au-dessus de votre CAC de rentabilité de {{be_cac}}.
- context · en: A first order does not pay for its acquisition. · fr: Une première commande ne paie pas son acquisition.
- cause · en: Ad spend rose {{spend_delta}} while new customers changed {{new_delta}}. · fr: La dépense pub a monté de {{spend_delta}} alors que les nouveaux clients ont varié de {{new_delta}}.
- impact · en: About {{low}} to {{high}} over the period. · fr: Environ {{low}} à {{high}} sur la période.
- recommendation · en: Cut spend below the break-even or raise first-order margin. · fr: Réduisez la dépense sous le seuil ou augmentez la marge de première commande.
- simulation · en: CAC back to {{be_cac}}, everything else equal. · fr: CAC ramené à {{be_cac}}, toutes choses égales par ailleurs.
- followup · en: Compare CAC and new customers after 7 days. · fr: Comparez CAC et nouveaux clients après 7 jours.
- partial · en: Connect your ad account to compute CAC. · fr: Connectez votre compte publicitaire pour calculer le CAC.

### roas_below_be
- observation · en: Your ROAS is {{roas}}, below your break-even ROAS of {{be_roas}}. · fr: Votre ROAS est de {{roas}}, sous votre ROAS de rentabilité de {{be_roas}}.
- context · en: Ads bring revenue but not contribution. · fr: La pub apporte du CA mais pas de contribution.
- impact · en: About {{low}} to {{high}} of ad spend not covered by margin. · fr: Environ {{low}} à {{high}} de dépense pub non couverte par la marge.
- recommendation · en: Pause the campaigns below break-even. · fr: Mettez en pause les campagnes sous le seuil.
- partial · en: Connect your ad account to compare ROAS with break-even. · fr: Connectez votre compte publicitaire pour comparer le ROAS au seuil.

### mer_low
- observation · en: Your MER is {{mer}}: marketing takes {{share}} of revenue. · fr: Votre MER est de {{mer}} : le marketing prend {{share}} du CA.
- recommendation · en: Compare it with your contribution rate before adding budget. · fr: Comparez-le à votre taux de contribution avant d'ajouter du budget.
- partial · en: Connect your ad account to compute MER. · fr: Connectez votre compte publicitaire pour calculer le MER.

### no_ad_source
- observation · en: {{orders}} orders came from paid channels, but no ad account is connected. · fr: {{orders}} commandes viennent de canaux payants, mais aucun compte publicitaire n'est connecté.
- recommendation · en: Connect Meta or Google to compute your CAC threshold and 3 more indicators. · fr: Connectez Meta ou Google pour calculer votre seuil de CAC et 3 indicateurs de plus.
- partial · en: same as observation · fr: identique à l'observation

### stock_reorder
- observation · en: {{variants}} variants are at their reorder point. · fr: {{variants}} variantes sont au point de commande.
- impact · en: A stock-out costs about {{low}} to {{high}} of revenue per day. · fr: Une rupture coûte environ {{low}} à {{high}} de CA par jour.
- recommendation · en: Reorder now; lead time {{lead}} days. · fr: Recommandez maintenant ; délai fournisseur {{lead}} jours.
- partial · en: Needs 14 days of sales to estimate coverage. · fr: Exige 14 jours de ventes pour estimer la couverture.

### otd_low
- observation · en: {{otd}} of parcels arrived on time, below 95 %. · fr: {{otd}} des colis sont arrivés à l'heure, sous 95 %.
- recommendation · en: Check the carrier or the promised delivery time. · fr: Vérifiez le transporteur ou la promesse de livraison.
- partial · en: Needs 20 delivered parcels. · fr: Exige 20 colis livrés.

## 3. « Votre situation » (phrases, `situation.<slot>.<variant>`)
- result.positive · en: Your store is making money: {{net_result}} of estimated result over {{period}}. · fr: Votre boutique gagne de l'argent : {{net_result}} de résultat estimé sur {{period}}.
- result.negative · en: Your store is losing money: {{net_result}} over {{period}}. · fr: Votre boutique perd de l'argent : {{net_result}} sur {{period}}.
- result.unknown · en: The result cannot be computed yet: {{gap}}. · fr: Le résultat ne peut pas encore être calculé : {{gap}}.
- trend.diverging · en: Revenue grows faster than contribution. · fr: Le CA progresse plus vite que la contribution.
- trend.aligned · en: Revenue and contribution move together. · fr: CA et contribution évoluent ensemble.
- trend.single_period · en: One period only: no trend yet. · fr: Une seule période : pas encore de tendance.
- factor · en: The main factor is {{factor}} ({{share}} of the change). · fr: Le facteur principal est {{factor}} ({{share}} de l'écart).
- data.high · en: Data reliability is high ({{score}}). · fr: La fiabilité des données est élevée ({{score}}).
- data.medium · en: Data reliability is {{score}}; {{top_gap}} would raise it most. · fr: La fiabilité des données est de {{score}} ; {{top_gap}} la ferait le plus progresser.
- data.low · en: Data reliability is low ({{score}}): read the figures as estimates. · fr: La fiabilité des données est faible ({{score}}) : lisez les chiffres comme des estimations.

## 4. Niveaux de confiance (`confidence.<status>.label | help`)
- confirmed · en: Confirmed — direct calculation on complete data. · fr: Confirmé — calcul direct sur données complètes.
- likely · en: Very likely — strong evidence, a few assumptions. · fr: Très probable — forte évidence, quelques hypothèses.
- to_verify · en: To verify — interesting signal, insufficient data. · fr: À vérifier — signal intéressant, données insuffisantes.
- simulation · en: Simulation — theoretical result, everything else equal. · fr: Simulation — résultat théorique, toutes choses égales par ailleurs.
