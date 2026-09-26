// ── Page de preuve navigateur : bouton d'abonnement de Réglages > Offre (vrai composant PlanCards) ──
// Routeur de données React Router (comme l'app), vrai polaris.js (chargé par le harnais). L'action
// note chaque envoi dans window.__submits ; un formulaire témoin reproduit « Retenir » du Simulateur.
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Form } from "react-router";
import { PlanCards } from "../../app/components/settings/PlanCards.jsx";
import { planView } from "../../app/lib/plans.js";
import { I18nProvider } from "../../app/lib/i18n/context.jsx";
import { CATALOGS } from "../../app/locales/index.js";

window.__submits = [];
const view = planView({ ent: { isPro: false, isExpert: false, source: "live" }, isBeta: false, betaTrialDays: 45 });

function Page() {
  return (
    <I18nProvider locale="fr" catalogs={{ en: CATALOGS.en, fr: CATALOGS.fr }} currency="EUR" timeZone="UTC">
      <PlanCards view={view} isDevShop />
      <Form method="post" id="witness"><input type="hidden" name="intent" value="keep" /><s-button type="submit" variant="secondary">Retenir ce scénario</s-button></Form>
    </I18nProvider>
  );
}

const router = createBrowserRouter([{
  path: "/scripts/browser/plan.html",
  Component: Page,
  action: async ({ request }) => { const fd = await request.formData(); window.__submits.push(String(fd.get("intent"))); return null; },
}]);
createRoot(document.getElementById("app")).render(<RouterProvider router={router} />);
window.__ready = true;
