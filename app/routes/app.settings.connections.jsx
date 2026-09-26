// ── Réglages > Connexions : /app/settings/connections (R2) — état seulement, aucun connecteur ──
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { loadConnections } from "../lib/settings.server.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { SettingsNav } from "../components/settings/SettingsNav.jsx";
import { ConnectionsList } from "../components/settings/ConnectionsList.jsx";
import "../styles/overview.css";
import { embeddedErrorBoundary } from "../lib/routeError.jsx";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return loadConnections({ supabase, shop: session.shop });
};

export default function SettingsConnections() {
  const view = useLoaderData();
  const { t } = useI18n();
  return (
    <s-page heading={t("settings.connections.title")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("settings.connections.subtitle")}</p>
        <SectionRail current="settings" />
        <SettingsNav current="connections" />
        <ConnectionsList items={view.items} />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return embeddedErrorBoundary(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
