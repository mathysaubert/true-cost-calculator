// ── Aujourd'hui (Vue d'ensemble) : /app/overview — 9 blocs du PDF (I0-B) ─────────────────────
// 1 période et synchronisation · 2 trois résultats · 3 votre situation · 4 trois priorités ·
// 5 opportunité · 6 courbe (réservée F4-B) · 7 cascade (tableau, graphique F4-B) · 8 fiabilité ·
// 9 tous les indicateurs (replié → page Indicateurs). Structure Polaris (s-page, s-banner,
// s-modal) ; style maison dans le wrapper .tcc. Aucun champ contrôlé (React 18).
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { parsePeriodDays } from "../lib/overview.js";
import { loadOverview, setIncludeTestOrders } from "../lib/overview.server.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { OverviewHeader } from "../components/overview/OverviewHeader.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { DevShopBanner } from "../components/overview/Banners.jsx";
import { Results, Situation, Priorities, Opportunity, WaterfallTable, AllIndicators } from "../components/overview/Briefing.jsx";
import { DataHealth } from "../components/overview/DataHealth.jsx";
import { OverviewEmptyState, ReservedSlots } from "../components/overview/Blocks.jsx";
import "../styles/overview.css";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const days = parsePeriodDays(new URL(request.url).searchParams.get("days"));
  const hasAllOrders = String(session.scope ?? "").split(",").map((s) => s.trim()).includes("read_all_orders");
  return loadOverview({ supabase, shop: session.shop, admin, days, hasAllOrders, withBriefing: true });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "toggle_test_orders") {
    return setIncludeTestOrders({ supabase, shop: session.shop, value: form.get("value") === "1" });
  }
  return { ok: false, error: "unknown_intent" };
};

export default function Overview() {
  const view = useLoaderData();
  const { t, day } = useI18n();
  const empty = (view.ordersInPeriod ?? 0) === 0;
  const b = view.briefing;
  const partials = (b?.insights ?? []).filter((i) => i.status === "partial");
  return (
    <s-page heading={t("nav.overview")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <OverviewHeader firstName={view.firstName} shopName={view.shopName} lastSync={view.lastSync} now={view.now} days={view.days} windows={view.windows} />
        <SectionRail current="overview" />
        <DevShopBanner isDevShop={view.isDevShop} includeTestOrders={view.includeTestOrders} />
        {view.mixedCurrency && <s-banner tone="warning">{t("overview.currency.mixed")}</s-banner>}
        {empty ? (
          <OverviewEmptyState excluded={view.excludedCurrent} partials={partials} titles={view.titles} />
        ) : (
          <>
            <Results results={b?.results} kpis={view.kpis} />
            <Situation slots={b?.situation ?? []} titles={view.titles} />
            <Priorities priorities={b?.priorities ?? []} partials={partials} titles={view.titles} />
            <Opportunity opportunity={b?.opportunity} titles={view.titles} />
            <ReservedSlots only={["chart"]} />
            <WaterfallTable leaves={view.waterfall?.leaves} nodes={view.waterfall?.nodes} />
          </>
        )}
        <DataHealth confidence={view.confidence} compact />
        <AllIndicators kpis={view.kpis} />
        <p className="tcc-muted">
          {view.historySince ? t("overview.history.since", { date: day(view.historySince) }) : null}
          {view.historySince && !view.hasAllOrders ? " " : null}
          {!view.hasAllOrders ? t("overview.history.pending") : null}
        </p>
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
