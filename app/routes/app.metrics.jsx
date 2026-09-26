// ── Indicateurs : /app/metrics — bibliothèque complète des 12 KPI et de leurs calculs (I0-B) ──
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { parsePeriodDays } from "../lib/overview.js";
import { loadOverview } from "../lib/overview.server.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { PeriodSelector } from "../components/overview/OverviewHeader.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { KpiGrid } from "../components/overview/KpiGrid.jsx";
import { DataGapsBanner, OverviewNotes, DevShopBanner } from "../components/overview/Banners.jsx";
import { OverviewEmptyState, EngineBanner } from "../components/overview/Blocks.jsx";
import { MetricsLearn } from "../components/overview/MetricsLearn.jsx";
import "../styles/overview.css";
import { embeddedErrorBoundary } from "../lib/routeError.jsx";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const days = parsePeriodDays(new URL(request.url).searchParams.get("days"));
  const hasAllOrders = String(session.scope ?? "").split(",").map((s) => s.trim()).includes("read_all_orders");
  return loadOverview({ supabase, shop: session.shop, admin, days, hasAllOrders, withBriefing: true });
};

export default function Metrics() {
  const view = useLoaderData();
  const { t, day } = useI18n();
  const empty = (view.ordersInPeriod ?? 0) === 0;
  const partials = (view.briefing?.insights ?? []).filter((i) => i.status === "partial");
  const w = view.windows;
  return (
    <s-page heading={t("metrics.title")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("metrics.subtitle")}</p>
        <SectionRail current="metrics" />
        <div className="tcc-hero__side">
          <PeriodSelector days={view.days} />
          {w?.current && <p className="tcc-period">{t("overview.period.range_partial", { start: day(w.current.start) })}, {t("overview.period.compare", { count: view.days, start: day(w.previous.start), end: day(w.previous.end) })}</p>}
        </div>
        <DevShopBanner isDevShop={view.isDevShop} includeTestOrders={view.includeTestOrders} />
        {view.mixedCurrency && <s-banner tone="warning">{t("overview.currency.mixed")}</s-banner>}
        <DataGapsBanner gaps={view.gaps} />
        {empty ? <OverviewEmptyState excluded={view.excludedCurrent} partials={partials} titles={view.titles} /> : <KpiGrid kpis={view.kpis} />}
        {!empty && <OverviewNotes notes={view.notes} />}
        <MetricsLearn />
        <EngineBanner />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return embeddedErrorBoundary(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
