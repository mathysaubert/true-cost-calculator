// ── Réglages : /app/settings — état des réglages et fiabilité (R1, S2) ────────────────────────
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { loadSettings, loadMarketing, loadConnections } from "../lib/settings.server.js";
import { loadOverview } from "../lib/overview.server.js";
import { settingsStatus } from "../lib/settings.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { SettingsNav } from "../components/settings/SettingsNav.jsx";
import { SettingsIndex } from "../components/settings/SettingsIndex.jsx";
import { DataHealth } from "../components/overview/DataHealth.jsx";
import "../styles/overview.css";
import { embeddedErrorBoundary } from "../lib/routeError.jsx";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const [s, m, c, overview] = await Promise.all([
    loadSettings({ supabase, shop: session.shop }),
    loadMarketing({ supabase, shop: session.shop, withCodes: false }),
    loadConnections({ supabase, shop: session.shop }),
    loadOverview({ supabase, shop: session.shop, admin, days: 30, withBriefing: false }).catch((e) => { console.error("[Settings] fiabilité :", e?.message); return null; }),
  ]);
  return { items: settingsStatus({ settings: s.settings, fixedCosts: s.fixedCosts, gateways: s.gateways, day: s.today, partners: m.partners, promoRules: m.rules, connections: c.items.filter((x) => x.id !== "shopify") }), confidence: overview?.confidence ?? null };
};

export default function SettingsPage() {
  const view = useLoaderData();
  const { t } = useI18n();
  return (
    <s-page heading={t("settings.title")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("settings.subtitle")}</p>
        <SectionRail current="settings" />
        <SettingsNav current="index" />
        <SettingsIndex items={view.items} />
        <DataHealth confidence={view.confidence} compact />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return embeddedErrorBoundary(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
