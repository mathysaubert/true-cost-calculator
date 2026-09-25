// ── Page de preuve navigateur (scripts/browser_reset_check.mjs) : VRAIS composants des Réglages ──
// React 19 (rendu client), vrai polaris.js (chargé par le harnais), code de suivi de formulaire de la
// barre de sauvegarde extrait tel quel d'app-bridge.js (injecté par le harnais : window.__abK).
import { createRoot, hydrateRoot } from "react-dom/client";
import { tree } from "./reset-tree.jsx";

let root = null;
// Arrivée par le menu : rendu client (createRoot).
window.__render = (view, saved) => { root ??= createRoot(document.getElementById("app")); root.render(tree(view, saved)); };
// Page chargée en entier : HTML du rendu serveur (fait en Node par le harnais) analysé par le
// navigateur, mis à niveau par Polaris, puis hydraté.
window.__hydrate = (html) => new Promise((resolve) => {
  const el = document.getElementById("app");
  el.innerHTML = html;
  window.__hydrationErrors = [];
  root = hydrateRoot(el, tree("goals"), { onRecoverableError: (e) => window.__hydrationErrors.push(String(e?.message ?? e)) });
  setTimeout(resolve, 150);
});
window.__ready = true;
