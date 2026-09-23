// ── Vue d'ensemble (Overview) : /app/overview ─────────────────────────────────────────────────
// Structure Polaris (s-page, s-banner, s-modal) ; style maison dans le wrapper .tcc (app-owned).
// Loader : Supabase + deux lectures Admin (plan une fois, nom de boutique). Aucun calcul ici.
// Action : bascule C6 (boutique de développement seulement). Aucun champ contrôlé (React 18).
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { parsePeriodDays } from "../lib/overview.js";
import { loadOverview, setIncludeTestOrders } from "../lib/overview.server.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { OverviewHeader } from "../components/overview/OverviewHeader.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { KpiGrid } from "../components/overview/KpiGrid.jsx";
import { DataGapsBanner, OverviewNotes, DevShopBanner } from "../components/overview/Banners.jsx";
import { OverviewEmptyState, ReservedSlots, EngineBanner } from "../components/overview/Blocks.jsx";
import "../styles/overview.css";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const days = parsePeriodDays(new URL(request.url).searchParams.get("days"));
  const hasAllOrders = String(session.scope ?? "").split(",").map((s) => s.trim()).includes("read_all_orders");
  return loadOverview({ supabase, shop: session.shop, admin, days, hasAllOrders });
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
  return (
    <s-page heading={t("nav.overview")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <OverviewHeader firstName={view.firstName} shopName={view.shopName} lastSync={view.lastSync} now={view.now} days={view.days} windows={view.windows} />
        <SectionRail current="overview" />
        <DevShopBanner isDevShop={view.isDevShop} includeTestOrders={view.includeTestOrders} />
        {view.mixedCurrency && <s-banner tone="warning">{t("overview.currency.mixed")}</s-banner>}
        <DataGapsBanner gaps={view.gaps} />
        {empty ? <OverviewEmptyState excluded={view.excludedCurrent} /> : <KpiGrid kpis={view.kpis} />}
        {!empty && <OverviewNotes notes={view.notes} />}
        <ReservedSlots />
        <EngineBanner />
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
