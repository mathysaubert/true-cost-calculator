// ── Erreurs de route (2026-09-26) — remplace boundary.error de @shopify/shopify-app-react-router ─────
// boundary.error reconnaît les réponses d'authentification Shopify (page « bounce » / sortie d'iframe,
// HTML à afficher tel quel) par le NOM de classe (constructor.name === "ErrorResponseImpl"). Dans le
// bundle navigateur minifié, cette classe s'appelle autrement (mesuré : « Xe ») : le test échoue, l'erreur
// remonte jusqu'à la racine et s'affichait « [object Object] ». Ici : isRouteErrorResponse (fonction
// officielle de React Router, indépendante des noms), puis même rendu que Shopify pour une réponse
// HTML ; toute autre erreur remonte à l'ErrorBoundary racine, qui affiche un message lisible et traduit.
import { isRouteErrorResponse } from "react-router";

export function embeddedErrorBoundary(error) {
  if (isRouteErrorResponse(error) && typeof error.data === "string" && error.data.trim() !== "") {
    return <div dangerouslySetInnerHTML={{ __html: error.data }} />;
  }
  throw error;
}

// ── Message lisible pour l'ErrorBoundary racine (pur) ──────────────────────────────────────────────
// → { key, status, detail } ; key : clé de catalogue « error.* » ; detail : texte technique court ou null.
// Jamais d'objet converti en texte (« [object Object] »).
export function describeRouteError(error) {
  if (isRouteErrorResponse(error)) {
    const status = Number(error.status) || null;
    const key = status === 401 || status === 403 ? "error.session" : status === 404 ? "error.not_found" : status === 503 ? "error.unavailable" : "error.generic";
    const detail = typeof error.data === "string" && error.data && !/<[a-z]/i.test(error.data) ? error.data.slice(0, 200) : (error.statusText || null);
    return { key, status, detail };
  }
  if (error instanceof Error) return { key: "error.generic", status: null, detail: error.message ? String(error.message).slice(0, 200) : null };
  if (typeof error === "string") return { key: "error.generic", status: null, detail: error.slice(0, 200) };
  return { key: "error.generic", status: null, detail: null };
}

export const ROOT_ERROR_KEYS = ["error.title", "error.generic", "error.session", "error.not_found", "error.unavailable", "error.reload", "error.code", "error.detail"];
