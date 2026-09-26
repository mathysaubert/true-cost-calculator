// ── Aujourd'hui (Vue d'ensemble) : /app/overview — 9 blocs du PDF (I0-B) ─────────────────────
// 1 période et synchronisation · 2 trois résultats · 3 votre situation · 4 trois priorités ·
// 5 opportunité · 6 courbe (réservée F4-B) · 7 cascade (tableau, graphique F4-B) · 8 fiabilité ·
// 9 tous les indicateurs (replié → page Indicateurs). Structure Polaris (s-page, s-banner,
// s-modal) ; style maison dans le wrapper .tcc. Aucun champ contrôlé (React 18).
import { useLoaderData, useActionData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { parsePeriodDays } from "../lib/overview.js";
import { loadOverview, setIncludeTestOrders } from "../lib/overview.server.js";
import { recordShownInsights, recordDecision } from "../lib/decisions.server.js";
import { opportunityFingerprint, scenarioFromOpportunity } from "../lib/decisions.js";
import { background } from "../lib/sync/background.server.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { OverviewHeader } from "../components/overview/OverviewHeader.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { DevShopBanner } from "../components/overview/Banners.jsx";
import { Results, Situation, Priorities, Opportunity, AllIndicators, DecisionBanner } from "../components/overview/Briefing.jsx";
import { DataHealth } from "../components/overview/DataHealth.jsx";
import { OverviewEmptyState } from "../components/overview/Blocks.jsx";
import { ContributionChart } from "../components/charts/ContributionChart.jsx";
import { WaterfallChart } from "../components/charts/WaterfallChart.jsx";
import "../styles/overview.css";
import { embeddedErrorBoundary } from "../lib/routeError.jsx";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const days = parsePeriodDays(new URL(request.url).searchParams.get("days"));
  const hasAllOrders = String(session.scope ?? "").split(",").map((s) => s.trim()).includes("read_all_orders");
  const view = await loadOverview({ supabase, shop: session.shop, admin, days, hasAllOrders, withBriefing: true });
  // I0-C (D7a) : mémoire silencieuse de ce qui est montré, après la réponse, jamais bloquante.
  background(recordShownInsights({ supabase, shop: session.shop, briefing: view.briefing, window: view.windows?.current, currency: view.currency, confidence: view.confidence }), "insight_log");
  return { ...view, opportunityFingerprint: opportunityFingerprint(view.briefing?.opportunity, view.windows?.current) };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "toggle_test_orders") {
    return { intent, ...(await setIncludeTestOrders({ supabase, shop: session.shop, value: form.get("value") === "1" })) };
  }
  if (intent === "simulate") {
    // Le scénario est recalculé côté serveur (jamais lu depuis le formulaire) et doit correspondre
    // à l'empreinte affichée : sinon il a changé depuis l'affichage → « périmé ».
    const days = parsePeriodDays(form.get("days"));
    const view = await loadOverview({ supabase, shop: session.shop, admin, days, withBriefing: true });
    const opp = view.briefing?.opportunity ?? null;
    const fp = opportunityFingerprint(opp, view.windows?.current);
    if (!opp || fp !== form.get("fingerprint")) return { intent, ok: false, error: "stale" };
    const res = await recordDecision({ supabase, shop: session.shop, kind: "simulated", insightFingerprint: fp, scenario: scenarioFromOpportunity(opp), expected: { low: opp.impact?.low, high: opp.impact?.high, node: opp.node }, horizonDays: 30 });
    return { intent, ...res, kind: "simulated" };
  }
  return { intent, ok: false, error: "unknown_intent" };
};

export default function Overview() {
  const view = useLoaderData();
  const actionResult = useActionData();
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
        <DecisionBanner result={actionResult?.intent === "simulate" ? actionResult : null} />
        {empty ? (
          <OverviewEmptyState excluded={view.excludedCurrent} partials={partials} titles={view.titles} />
        ) : (
          <>
            <Results results={b?.results} kpis={view.kpis} />
            <Situation slots={b?.situation ?? []} titles={view.titles} />
            <Priorities priorities={b?.priorities ?? []} partials={partials} titles={view.titles} days={view.days} />
            <Opportunity opportunity={b?.opportunity} titles={view.titles} fingerprint={view.opportunityFingerprint} days={view.days} />
            <ContributionChart chart={view.chart} days={view.days} />
            <WaterfallChart leaves={view.waterfall?.leaves} nodes={view.waterfall?.nodes} gaps={view.waterfall?.gaps} flags={view.waterfall?.flags} />
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
  return embeddedErrorBoundary(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
