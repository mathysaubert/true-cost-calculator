// ── Page de preuve navigateur : téléchargement du modèle des coûts produits (vrai composant CostsCsv) ──
// Routeur de données React Router (comme l'app), vrai polaris.js (chargé par le harnais). La route
// d'export est servie par le harnais (Playwright) avec un fichier produit par le code serveur réel.
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { CostsCsv } from "../../app/components/settings/ProductCosts.jsx";
import { I18nProvider } from "../../app/lib/i18n/context.jsx";
import { CATALOGS } from "../../app/locales/index.js";

function Page() {
  return (
    <I18nProvider locale="fr" catalogs={{ en: CATALOGS.en, fr: CATALOGS.fr }} currency="EUR" timeZone="UTC">
      <CostsCsv />
    </I18nProvider>
  );
}
const router = createBrowserRouter([{ path: "/scripts/browser/export.html", Component: Page }]);
createRoot(document.getElementById("app")).render(<RouterProvider router={router} />);
window.__ready = true;
