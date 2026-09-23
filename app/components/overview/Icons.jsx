// ── Icônes SVG maison (24 px, trait 1.75) — app-owned, colorées par currentColor ──────────────
// Aucune chaîne visible : décoratives (aria-hidden), le libellé de la tuile porte le sens.
const P = {
  ca_ht: "M3 17l6-6 4 4 8-8M14 7h7v7",
  orders: "M6 7h12l1 13H5L6 7zM9 7a3 3 0 016 0",
  aov: "M4 8h16l-2 9H6L4 8zM9 12v2M15 12v2M8 8l2-4M16 8l-2-4",
  cvr: "M4 5h16l-6 7v6l-4 2v-8L4 5z",
  cm2_pct: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4",
  cm3: "M12 4l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
  net_result: "M4 7h14a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V7zM4 7V5a2 2 0 012-2h10M16 14h4",
  cac_global: "M15 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6",
  mer: "M3 11v2a1 1 0 001 1h2l7 4V6L6 10H4a1 1 0 00-1 1zM16 9a4 4 0 010 6M18 6a8 8 0 010 12",
  poas: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM5 18l.7 2L8 20.7 5.7 21.4 5 23.5l-.7-2.1L2 20.7l2.3-.7L5 18z",
  ltv_cac: "M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z",
  return_rate: "M4 10a8 8 0 0114-5l3 3M21 4v5h-5M20 14a8 8 0 01-14 5l-3-3M3 20v-5h5",
  chart: "M4 19V5M4 19h16M8 15l4-5 3 3 5-6",
  changes: "M12 4v16M6 10l6-6 6 6",
  assistant: "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z",
  products: "M4 7h16v13H4zM4 7l2-3h12l2 3M9 11h6",
  marketing: "M3 11v2a1 1 0 001 1h2l7 4V6L6 10H4a1 1 0 00-1 1zM16 9a4 4 0 010 6",
  funnel: "M4 5h16l-6 7v6l-4 2v-8L4 5z",
  stock: "M4 8l8-4 8 4v8l-8 4-8-4V8zM4 8l8 4 8-4M12 12v8",
  spark: "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z",
  check: "M5 12l4 4L19 6",
  soon: "M12 7v5l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  brand: "M4 18V6a2 2 0 012-2h9l5 5v9a2 2 0 01-2 2H6a2 2 0 01-2-2zM15 4v5h5M8 13h8M8 17h5",
};
export const ICON_IDS = Object.keys(P);

export function Icon({ id, className }) {
  const d = P[id] ?? P.spark;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

export function ArrowIcon({ direction = "up" }) {
  const d = direction === "up" ? "M12 19V5M5 12l7-7 7 7" : direction === "down" ? "M12 5v14M5 12l7 7 7-7" : "M5 12h14";
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
