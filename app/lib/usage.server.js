// ── D2-2 (Z2, Z3) — Volume de commandes du mois, compté depuis `orders` ──────────────────────────
// Toute commande créée dans le mois, selon la date locale de la boutique (day_local), sauf commandes de
// test et brouillons (excluded_reason 'test' | 'draft'). Les annulées, cartes cadeaux seules et B2B
// comptent. Remplace le compteur d'ingestion usage.orders_count (Z2), qui n'est plus lu. Ne lève jamais.
import { dayInTimeZone } from "./overview.js";
import { monthRange, prevMonthOf, overageOf } from "./plan.js";

export async function monthOrderCount({ supabase, shop, month }) {
  const { from, to } = monthRange(month);
  const { count, error } = await supabase.from("orders")
    .select("shop_domain", { count: "exact", head: true })
    .eq("shop_domain", shop).gte("day_local", from).lt("day_local", to)
    .or("excluded_reason.is.null,excluded_reason.not.in.(test,draft)");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// plan : 'free'|'pro'|'expert' (offre reconnue). Retour : { month, prevMonth, prevCount, currentCount,
// plan, cap, over, suggest } ; over/suggest portent sur le mois ÉCOULÉ (Z3 : dès le 1er du mois suivant).
// null en cas d'échec : rien ne s'affiche plutôt qu'un bandeau faux.
export async function loadPlanUsage({ supabase, shop, plan = "free", timeZone = "UTC", now = new Date() }) {
  try {
    const month = dayInTimeZone(now, timeZone || "UTC").slice(0, 7);
    const prevMonth = prevMonthOf(month);
    const [prevCount, currentCount] = await Promise.all([
      monthOrderCount({ supabase, shop, month: prevMonth }),
      monthOrderCount({ supabase, shop, month }),
    ]);
    return { month, prevMonth, prevCount, currentCount, ...overageOf({ plan, count: prevCount }) };
  } catch (e) {
    console.warn(`[Usage] comptage mensuel KO ${shop} : ${e?.message}`);
    return null;
  }
}
