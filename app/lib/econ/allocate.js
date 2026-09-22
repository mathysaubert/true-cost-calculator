// ── Allocation des coûts de COMMANDE aux lignes — PUR (décisions A4, A5) ─────────────────────
// Frais de paiement, port marchand et emballage sont supportés par la commande ; on les répartit
// entre ses lignes AU PRORATA DU CA HT DE LIGNE (D3 existant, généralisé). Règles :
//   • lignes sans CA (coût inconnu n'est PAS un critère : c'est le CA qui compte ; une ligne
//     'missing' A un CA) : toute ligne à line_ca_ht null est ignorée (part 0, rien alloué) ;
//   • Σ CA = 0 → 0 partout (jamais de division par zéro) ;
//   • emballage : une ligne avec packaging_override_unit (surcharge variante, A4) paie
//     override × unités et sort du pool ; le pool par commande est réparti entre les autres.
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };

export function allocateOrderCosts({ lines = [], costs = {} } = {}) {
  const payment = num(costs.payment_fees), shipping = num(costs.shipping_cost), packagingPool = num(costs.packaging_cost);
  const priced = lines.filter((l) => l.line_ca_ht != null);
  const total = priced.reduce((s, l) => s + num(l.line_ca_ht), 0);
  const share = (l) => (total > 0 ? num(l.line_ca_ht) / total : 0);
  const pooled = priced.filter((l) => l.packaging_override_unit == null);
  const pooledTotal = pooled.reduce((s, l) => s + num(l.line_ca_ht), 0);
  const pooledShare = (l) => (pooledTotal > 0 ? num(l.line_ca_ht) / pooledTotal : 0);
  const out = new Map();
  for (const l of lines) {
    if (l.line_ca_ht == null) { out.set(l.line_item_id, { payment: 0, shipping: 0, packaging: 0, share: 0 }); continue; }
    const packaging = l.packaging_override_unit != null
      ? num(l.packaging_override_unit) * num(l.units ?? 0)
      : packagingPool * pooledShare(l);
    out.set(l.line_item_id, { payment: payment * share(l), shipping: shipping * share(l), packaging, share: share(l) });
  }
  return out;
}
