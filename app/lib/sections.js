// ── Navigation cible (décision du 2026-09-23, remplace la section 12 du brief) — PUR ──────────
// 12 sections branchées sur le même moteur. status : live (route livrée) | soon (« Bientôt »,
// grisée, non cliquable). L'ordre est celui de la navigation. Les libellés viennent des catalogues
// (nav.<id>). L'ancien écran reste accessible sous nav.legacy jusqu'à F4-D (hors de cette liste).
export const SECTIONS = [
  { id: "overview",     path: "/app/overview", status: "live" },
  { id: "profit",       path: null, status: "soon" },
  { id: "growth",       path: null, status: "soon" },
  { id: "customers",    path: null, status: "soon" },
  { id: "products",     path: null, status: "soon" },
  { id: "inventory",    path: null, status: "soon" },
  { id: "marketing",    path: null, status: "soon" },
  { id: "cash",         path: null, status: "soon" },
  { id: "intelligence", path: null, status: "soon" },
  { id: "simulator",    path: null, status: "soon" },
  { id: "experiments",  path: null, status: "soon" },
  { id: "settings",     path: null, status: "soon" },
];
export const LIVE_SECTIONS = SECTIONS.filter((s) => s.status === "live");
export const sectionById = (id) => SECTIONS.find((s) => s.id === id) ?? null;

// Emplacements réservés de l'Overview (maquette) : chacun renvoie à la section qui le livrera.
// Jamais un chiffre : une carte discrète « Disponible avec … ».
export const OVERVIEW_RESERVED = [
  { id: "chart",     section: "overview",     size: "wide" },   // grande courbe (F4-B)
  { id: "changes",   section: "intelligence", size: "narrow" }, // 3 principaux changements
  { id: "assistant", section: "intelligence", size: "aside" },  // panneau IA
  { id: "products",  section: "products",     size: "quarter" },
  { id: "marketing", section: "marketing",    size: "quarter" },
  { id: "funnel",    section: "growth",       size: "quarter" },
  { id: "stock",     section: "inventory",    size: "quarter" },
];
