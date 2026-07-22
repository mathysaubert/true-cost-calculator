// Harness de RENDU RÉEL (standard CLAUDE.md) : rend les composants UI RÉELS via Vite SSR + memory
// router (contexte useFetcher), sur données chargées ET état initial vide/null. Pas de déduction.
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { CustomsClassificationPanel: Panel, CustomsEstimatedTag: Tag } = await vite.ssrLoadModule("/app/components/customsUi.jsx");

let ko = 0;
function render(element) {
  const router = createMemoryRouter([{ path: "/", element }]);
  return renderToStaticMarkup(React.createElement(RouterProvider, { router }));
}
function check(label, element, expect) {
  try {
    const html = render(element);
    const ok = expect(html);
    if (!ok) ko++;
    console.log(`  ${ok ? "OK " : "ERR"} ${label}`);
    console.log(`       → ${html === "" ? "(vide — composant retourne null)" : html.replace(/\s+/g, " ").slice(0, 120) + (html.length > 120 ? "…" : "")}`);
  } catch (e) { ko++; console.log(`  ERR ${label} → THROW ${e.constructor.name}: ${e.message}`); }
}

console.log("=== RENDU RÉEL — CustomsClassificationPanel (Suivi des coûts) ===");
check("rows=null (ÉTAT INITIAL avant réponse listFetcher) — ne doit PLUS crasher", React.createElement(Panel, { rows: null, onConfirmed(){} }), () => true);
check("rows=[] (chargé, catalogue vide) → panneau masqué", React.createElement(Panel, { rows: [], onConfirmed(){} }), (h) => h === "");
check("rows=[1 produit estimé] → affiche « à confirmer »", React.createElement(Panel, { rows: [{ product_id: "p1", product_title: "Tapis", categorie: "Sport", customs_confirmed: false }], onConfirmed(){} }), (h) => /à confirmer/.test(h) && /Tapis/.test(h));
check("rows=[1 produit confirmé] → panneau masqué (null)", React.createElement(Panel, { rows: [{ product_id: "p1", product_title: "Tapis", categorie: "Sport", customs_confirmed: true }], onConfirmed(){} }), (h) => h === "");
check("rows=[2 variantes divergentes] → « catégories divergentes »", React.createElement(Panel, { rows: [{ product_id: "p1", product_title: "Tapis", categorie: "Sport", customs_confirmed: false }, { product_id: "p1", product_title: "Tapis", categorie: "Textile", customs_confirmed: false }], onConfirmed(){} }), (h) => /divergentes/.test(h));

console.log("\n=== RENDU RÉEL — CustomsEstimatedTag (Monitor / Audit) ===");
check("estimated=true → badge « Taux estimé »", React.createElement(Tag, { estimated: true }), (h) => /estimé/.test(h));
check("estimated=false → null (aucun affichage, par contrat)", React.createElement(Tag, { estimated: false }), (h) => h === "");
check("estimated=undefined (champ absent) → null", React.createElement(Tag, { estimated: undefined }), (h) => h === "");

console.log("\n" + (ko === 0 ? "✅ Tous les rendus réels OK" : `❌ ${ko} rendu(s) en échec`));
await vite.close();
process.exit(ko === 0 ? 0 : 1);
