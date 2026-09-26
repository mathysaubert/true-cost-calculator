// ── /app : ancienne adresse de l'écran classique, supprimé en D2-3 (2026-09-26) ─────────────────
// Page d'accueil de l'app dans l'admin et adresse de retour après abonnement : redirection vers
// Aujourd'hui en gardant les paramètres (shop, host, embedded, jeton…) ; retour d'abonnement
// (?subscribed=true) → Réglages > Offre, qui affiche le message de bienvenue. L'authentification
// est faite par la coquille /app (app.jsx), comme pour toutes les pages.
import { redirect } from "react-router";

export const loader = ({ request }) => {
  const url = new URL(request.url);
  const target = url.searchParams.get("subscribed") === "true" ? "/app/settings/plan" : "/app/overview";
  return redirect(`${target}${url.search}`);
};
