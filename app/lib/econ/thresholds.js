// ── Seuils (10.3) — PUR, lit les nœuds évalués ────────────────────────────────────────────────
// Bases : BE-ROAS / ROAS cible en TTC (A1) — déjà dans nodes.js ; ici les seuils qui exigent des
// hypothèses de période : récupération du CAC et seuil de rentabilité (deux versions, décision 5).
const div = (a, b) => (a == null || b == null || !(b > 0) ? null : a / b);

// v = nœuds évalués (evaluate) ; extra = { monthly_contribution_per_customer, fixed_costs_monthly,
// marketing_monthly }. « unreachable » quand la contribution par commande est ≤ 0.
export function thresholds(v = {}, extra = {}) {
  const cac = v.cac_global ?? null;
  const payback = div(cac, extra.monthly_contribution_per_customer);
  const fixedM = extra.fixed_costs_monthly ?? null;
  const mktM = extra.marketing_monthly ?? null;

  const breakevenOn = (contribPerOrder, monthlyCosts) => {
    if (monthlyCosts == null) return { status: "unknown", orders: null, revenue: null };
    if (contribPerOrder == null) return { status: "unknown", orders: null, revenue: null };
    if (!(contribPerOrder > 0)) return { status: "unreachable", orders: null, revenue: null };
    const orders = monthlyCosts / contribPerOrder;
    return { status: "ok", orders, revenue: v.aov == null ? null : orders * v.aov };
  };

  return {
    be_roas: v.be_roas ?? null,
    target_roas: v.target_roas ?? null,
    be_cac: v.be_cac ?? null,
    cac_payback_months: payback,
    breakeven: {
      onCm3: breakevenOn(v.cm3_per_order, fixedM),                                     // version A : marketing variable
      onCm2WithMarketing: breakevenOn(v.cm2_per_order, fixedM == null || mktM == null ? null : fixedM + mktM), // version B
    },
  };
}
