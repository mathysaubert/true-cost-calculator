// ── Page de preuve navigateur : bandeau « commandes de test » sur la page Produits (vrai composant) ──
// Routeur de données : /app/overview porte l'action (comme l'app), /app/products affiche le bandeau.
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, useLoaderData, useLocation } from "react-router";
import { DevShopBanner } from "../../app/components/overview/Banners.jsx";
import { I18nProvider } from "../../app/lib/i18n/context.jsx";
import { CATALOGS } from "../../app/locales/index.js";

window.__state = { include: false, actions: [], productsLoads: 0 };
function Products() {
  const d = useLoaderData();
  const loc = useLocation();
  return (
    <I18nProvider locale="fr" catalogs={{ en: CATALOGS.en, fr: CATALOGS.fr }} currency="EUR" timeZone="UTC">
      <p id="where">{loc.pathname}</p>
      <p id="loads">{d.loads}</p>
      <DevShopBanner isDevShop includeTestOrders={d.include} />
    </I18nProvider>
  );
}
const router = createBrowserRouter([
  { path: "/scripts/browser/errors.html", Component: () => <p id="start">start</p> },
  { path: "/app/overview", Component: () => <p id="overview">overview</p>, action: async ({ request }) => { const fd = await request.formData(); window.__state.actions.push(String(fd.get("intent"))); window.__state.include = fd.get("value") === "1"; return { intent: "toggle_test_orders", ok: true, include_test_orders: window.__state.include }; } },
  { path: "/app/products", Component: Products, loader: () => ({ include: window.__state.include, loads: ++window.__state.productsLoads }) },
]);
window.__router = router;
createRoot(document.getElementById("app")).render(<RouterProvider router={router} />);
window.__ready = true;
