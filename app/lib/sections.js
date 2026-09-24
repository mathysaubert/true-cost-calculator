// ── Navigation hybride (décision I0 du 2026-09-23, trois groupes) — PUR ───────────────────────
// Piloter (Steer) : Aujourd'hui, Décisions, Simulateur, Demander ; Explorer : Indicateurs, Profit,
// Croissance, Clients, Produits, Marketing, Stock ; Système : Fiabilité des données, Réglages.
// status : live (route livrée) | soon (« Bientôt », grisée, non cliquable). Les Expériences vivent
// dans Décisions ; Trésorerie viendra plus tard ; l'écran classique reste hors liste jusqu'à F4-D.
// Libellés : nav.<id> et nav.group.<group> dans les catalogues.
export const NAV_GROUPS = [
  { id: "steer", sections: [
    { id: "overview",     path: "/app/overview",    status: "live" },
    { id: "decisions",    path: null, status: "soon" },
    { id: "simulator",    path: null, status: "soon" },
    { id: "ask",          path: null, status: "soon" },
  ] },
  { id: "explore", sections: [
    { id: "metrics",      path: "/app/metrics",     status: "live" },
    { id: "profit",       path: null, status: "soon" },
    { id: "growth",       path: null, status: "soon" },
    { id: "customers",    path: null, status: "soon" },
    { id: "products",     path: null, status: "soon" },
    { id: "marketing",    path: null, status: "soon" },
    { id: "inventory",    path: null, status: "soon" },
  ] },
  { id: "system", sections: [
    { id: "data_health",  path: "/app/data-health", status: "live" },
    { id: "settings",     path: "/app/settings",    status: "live" },
  ] },
];
export const SECTIONS = NAV_GROUPS.flatMap((g) => g.sections.map((s) => ({ ...s, group: g.id })));
export const LIVE_SECTIONS = SECTIONS.filter((s) => s.status === "live");
export const sectionById = (id) => SECTIONS.find((s) => s.id === id) ?? null;

// Emplacements réservés de la Vue d'ensemble (blocs 6 et 7 du PDF) : jamais un chiffre.
export const OVERVIEW_RESERVED = [
  { id: "chart",     section: "overview", size: "wide" },   // évolution de la contribution (F4-B)
  { id: "waterfall", section: "overview", size: "wide" },   // cascade « Où est passé votre argent ? » (rendu F4-B ; tableau dès I0-B)
];
