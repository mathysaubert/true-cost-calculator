// ── Activation (R3, PDF « indicateurs d'activation ») — PUR ───────────────────────────────────
// Trois jalons : Shopify synchronisé, coûts produits renseignés ou importés, première situation
// financière générée. Chaque jalon non atteint pointe la page qui le débloque. Les manques de
// fiabilité pointent la page Réglages qui les corrige.
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

// Règle de fiabilité → page où la corriger. Coûts par variante et coût rendu : Réglages > Coûts produits (F4-D1a).
export const RULE_PAGES = {
  cost_coverage: { path: "/app/settings/products", section: "products" },
  landed_cost: { path: "/app/settings/products", section: "products" },
  ads_connected: { path: "/app/settings/connections", section: "connections" },
  shipping_costs: { path: "/app/settings/costs", section: "costs" },
  payment_fees: { path: "/app/settings/costs", section: "costs" },
  fixed_costs: { path: "/app/settings/costs", section: "costs" },
  currency: { path: "/app/settings/shop", section: "shop" },
};
export const settingsPathForRule = (ruleId) => RULE_PAGES[ruleId] ?? { path: "/app/settings", section: "index" };

// Part minimale du CA à coût connu pour considérer les coûts « renseignés » (PDF : « COGS renseignés ou importés »).
export const COSTS_DONE_SHARE = 0.8;

export function activationChecklist({ lastSync = null, confidence = null, briefing = null, ordersInPeriod = 0 } = {}) {
  const cost = (confidence?.rules ?? []).find((r) => r.id === "cost_coverage") ?? null;
  const costShare = cost?.applicable ? num(cost.measure) ?? 0 : null;
  const items = [
    { id: "synced", done: !!lastSync, path: "/app/settings/connections", detail: null },
    { id: "costs", done: costShare != null && costShare >= COSTS_DONE_SHARE, path: "/app/settings/products", detail: costShare == null ? null : Math.round(costShare * 100) },
    { id: "situation", done: (ordersInPeriod ?? 0) > 0 && (briefing?.situation?.length ?? 0) > 0, path: "/app/overview", detail: null },
  ];
  return { items, done: items.filter((i) => i.done).length, total: items.length, complete: items.every((i) => i.done) };
}
