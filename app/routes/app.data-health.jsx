// ── Fiabilité des données : /app/data-health — score, règles, manques et déblocages (I0-B) ─────
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { parsePeriodDays } from "../lib/overview.js";
import { loadOverview } from "../lib/overview.server.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { DataHealth, HealthRules } from "../components/overview/DataHealth.jsx";
import { ActivationChecklist } from "../components/overview/Activation.jsx";
import { activationChecklist } from "../lib/activation.js";
import { DataGapsBanner } from "../components/overview/Banners.jsx";
import { PartialConclusions } from "../components/overview/Briefing.jsx";
import "../styles/overview.css";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const days = parsePeriodDays(new URL(request.url).searchParams.get("days"));
  const hasAllOrders = String(session.scope ?? "").split(",").map((s) => s.trim()).includes("read_all_orders");
  const view = await loadOverview({ supabase, shop: session.shop, admin, days, hasAllOrders, withBriefing: true });
  return { ...view, activation: activationChecklist({ lastSync: view.lastSync, confidence: view.confidence, briefing: view.briefing, ordersInPeriod: view.ordersInPeriod }) };
};

export default function DataHealthPage() {
  const view = useLoaderData();
  const { t } = useI18n();
  const dataInsights = (view.briefing?.insights ?? []).filter((i) => i.kind === "data" || i.status === "partial");
  return (
    <s-page heading={t("nav.data_health")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("health.page.subtitle")}</p>
        <SectionRail current="data_health" />
        <ActivationChecklist checklist={view.activation} />
        <DataHealth confidence={view.confidence} compact={false} />
        <HealthRules confidence={view.confidence} />
        <DataGapsBanner gaps={view.gaps} />
        <PartialConclusions partials={dataInsights} titles={view.titles} title={t("overview.priorities.partials")} />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
