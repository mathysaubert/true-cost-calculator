// ── Page de preuve navigateur, BUILD MINIFIÉ : erreur d'authentification Shopify (« bounce ») ──────
// Construite par vite build (minification comme en production). Deux racines comparées :
//   ?root=old : ancienne page d'erreur racine (error.message || String(error)) ;
//   ?root=new : nouvelle page (describeRouteError + textes traduits).
// Deux routes filles qui lèvent la même réponse HTML qu'App Bridge attend :
//   /shopify : boundary.error de Shopify (test par nom de classe) ; /ours : embeddedErrorBoundary.
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Outlet, useRouteError } from "react-router";
import { errorBoundary as shopifyBoundary } from "../../node_modules/@shopify/shopify-app-react-router/dist/esm/server/boundary/error.mjs";
import { embeddedErrorBoundary, describeRouteError } from "../../app/lib/routeError.jsx";
import fr from "../../app/locales/fr.js";

const BOUNCE = '<p id="bounce">Page App Bridge (bounce)</p>';
const which = new URLSearchParams(location.search).get("root") ?? "new";
function RootOld() { const error = useRouteError(); return <div id="root-error"><h1>App Error</h1><p>{error?.message || String(error)}</p></div>; }
function RootNew() {
  const info = describeRouteError(useRouteError());
  const t = (k, v = {}) => String(fr[k] ?? k).replace(/\{\{(\w+)\}\}/g, (_, x) => String(v[x] ?? ""));
  return <div id="root-error"><h1>{t("error.title")}</h1><p>{t(info.key)}</p>{info.status && <p>{t("error.code", { code: info.status })}</p>}</div>;
}
const throwBounce = () => { throw new Response(BOUNCE, { status: 200, headers: { "Content-Type": "text/html" } }); };
const router = createBrowserRouter([{
  path: "/", Component: Outlet, ErrorBoundary: which === "old" ? RootOld : RootNew,
  children: [
    { index: true, Component: () => <p id="home">home</p> },
    { path: "shopify", loader: throwBounce, Component: () => null, ErrorBoundary: () => shopifyBoundary(useRouteError()) },
    { path: "ours", loader: throwBounce, Component: () => null, ErrorBoundary: () => embeddedErrorBoundary(useRouteError()) },
  ],
}]);
window.__router = router;
createRoot(document.getElementById("app")).render(<RouterProvider router={router} />);
window.__ready = true;
