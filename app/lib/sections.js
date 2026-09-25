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
    { id: "simulator",    path: "/app/simulator",   status: "live" },
    { id: "ask",          path: null, status: "soon" },
  ] },
  { id: "explore", sections: [
    { id: "metrics",      path: "/app/metrics",     status: "live" },
    { id: "profit",       path: null, status: "soon" },
    { id: "growth",       path: null, status: "soon" },
    { id: "customers",    path: null, status: "soon" },
    { id: "products",     path: "/app/products",    status: "live" },
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

// Emplacements réservés de la Vue d'ensemble : plus aucun depuis F4-B (courbe B1, cascade B2).
// La liste reste pour un futur bloc ; ReservedSlot rend une carte « Bientôt » sans chiffre.
export const OVERVIEW_RESERVED = [];
