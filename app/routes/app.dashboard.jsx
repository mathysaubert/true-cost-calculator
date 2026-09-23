// ── Ancienne adresse du Tableau de bord → Vue d'ensemble (renommage du 2026-09-23) ────────────
import { redirect } from "react-router";

export const loader = ({ request }) => {
  const url = new URL(request.url);
  return redirect(`/app/overview${url.search}`);
};
