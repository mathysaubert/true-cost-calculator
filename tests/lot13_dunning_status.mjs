// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Dunning — dérivation du statut courant + line items (app/lib/dunning.js).
//  C'est LE maillon "détection" qu'on ne peut PAS éprouver via un vrai FROZEN (inatteignable
//  sur dev store) : on le prouve en PUR avec des nodes mockés tels que les renverrait
//  allSubscriptions, dont un FROZEN noyé dans le bruit (CANCELLED/EXPIRED/PENDING). Aucun I/O.
//  Pour lancer : node tests/lot13_dunning_status.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { deriveSubscriptionStatus, recurringLineItems } from "../app/lib/dunning.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

// node façon allSubscriptions.edges[].node
const node = (status, name = "True Cost Calculator Pro", li) => ({ id: `gid://shopify/AppSubscription/${Math.random()}`, name, status, lineItems: li });
const recurringLi = (amount, currencyCode = "USD", interval = "EVERY_30_DAYS") =>
  [{ plan: { pricingDetails: { __typename: "AppRecurringPricing", price: { amount, currencyCode }, interval } } }];

// ── FROZEN noyé dans le bruit → 'frozen' + le bon frozenNode ──
console.log("\n── frozen au milieu de l'historique bruité ──");
{
  const nodes = [
    node("CANCELLED"), node("EXPIRED"), node("CANCELLED"),
    node("FROZEN", "True Cost Calculator Expert", recurringLi("15.0")),
    node("EXPIRED"), node("PENDING"),
  ];
  const { status, frozenNode } = deriveSubscriptionStatus(nodes);
  ok(status === "frozen", "statut = frozen malgré 5 lignes de bruit");
  ok(frozenNode?.name === "True Cost Calculator Expert", "frozenNode = le sub gelé (bon plan capturé)");
}

// ── ACTIVE gagne sur tout (même si un FROZEN traîne dans l'historique) ──
console.log("\n── précédence : ACTIVE > FROZEN ──");
{
  const { status, frozenNode } = deriveSubscriptionStatus([node("FROZEN"), node("ACTIVE"), node("CANCELLED")]);
  ok(status === "active", "ACTIVE présent → active (gagne sur frozen)");
  ok(frozenNode === null, "pas de frozenNode quand active");
}

// ── FROZEN gagne sur PENDING (notre propre re-charge en attente d'approbation) ──
console.log("\n── précédence : FROZEN > PENDING ──");
{
  const { status } = deriveSubscriptionStatus([node("PENDING"), node("FROZEN", "True Cost Calculator Pro", recurringLi("9.0"))]);
  ok(status === "frozen", "frozen + pending → frozen (la cadence ≥3j gère l'anti-spam)");
}

// ── PENDING seul (pas d'actif/frozen) → 'pending' ──
console.log("\n── pending seul ──");
{
  ok(deriveSubscriptionStatus([node("PENDING"), node("EXPIRED")]).status === "pending", "pending + expired → pending");
}

// ── que du bruit terminal → 'cancelled' ; tableau vide → 'cancelled' ──
console.log("\n── plus rien d'actif → cancelled ──");
{
  ok(deriveSubscriptionStatus([node("CANCELLED"), node("EXPIRED"), node("DECLINED")]).status === "cancelled", "cancelled/expired/declined → cancelled");
  ok(deriveSubscriptionStatus([]).status === "cancelled", "historique vide → cancelled");
  ok(deriveSubscriptionStatus().status === "cancelled", "argument absent → cancelled (robustesse)");
}

// ── recurringLineItems : reconstruit le MÊME prix (jamais sous-facturer) ──
console.log("\n── recurringLineItems : même prix/intervalle ──");
{
  const li = recurringLineItems(node("FROZEN", "True Cost Calculator Expert", recurringLi("15.0", "USD", "EVERY_30_DAYS")));
  ok(li.length === 1, "1 line item récurrent reconstruit");
  const d = li[0]?.plan?.appRecurringPricingDetails;
  ok(d?.price?.amount === 15 && typeof d.price.amount === "number", "amount = 15 (Number, pas string)");
  ok(d?.price?.currencyCode === "USD" && d?.interval === "EVERY_30_DAYS", "devise + intervalle préservés");
}

// ── recurringLineItems : ignore le non-récurrent, robuste aux entrées vides ──
console.log("\n── recurringLineItems : filtrage & robustesse ──");
{
  const usage = [{ plan: { pricingDetails: { __typename: "AppUsagePricing", balanceUsed: { amount: "1" } } } }];
  ok(recurringLineItems(node("FROZEN", "X", usage)).length === 0, "pricing non récurrent (usage) ignoré");
  ok(recurringLineItems(node("FROZEN", "X", undefined)).length === 0, "lineItems absent → []");
  ok(recurringLineItems(null).length === 0, "node null → [] (pas de crash)");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 13 (statut + line items dunning) : ✓ Tous les tests passent"
  : ` BILAN LOT 13 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
