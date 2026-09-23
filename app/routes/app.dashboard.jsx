// ── Tableau de bord (F4-A) : /app/dashboard ──────────────────────────────────────────────────
// Loader : Supabase seul (+ une lecture shop.plan.partnerDevelopment, une fois). Aucun calcul ici :
// dashboard.server.js → adaptateurs → aggregate ; la page affiche les 12 KPI, les trous, les notes.
// Action : bascule C6 (boutique de développement seulement). Aucun champ contrôlé (React 18, C1a).
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { parsePeriodDays } from "../lib/dashboard.js";
import { loadDashboard, setIncludeTestOrders } from "../lib/dashboard.server.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { KpiGrid } from "../components/dashboard/KpiGrid.jsx";
import { DataGapsBanner, DashboardNotes } from "../components/dashboard/DataGapsBanner.jsx";
import { PeriodSelector } from "../components/dashboard/PeriodSelector.jsx";
import { DashboardEmptyState } from "../components/dashboard/DashboardEmptyState.jsx";
import { DevShopBanner } from "../components/dashboard/DevShopBanner.jsx";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const days = parsePeriodDays(new URL(request.url).searchParams.get("days"));
  const hasAllOrders = String(session.scope ?? "").split(",").map((s) => s.trim()).includes("read_all_orders");
  return loadDashboard({ supabase, shop: session.shop, admin, days, hasAllOrders });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "toggle_test_orders") {
    return setIncludeTestOrders({ supabase, shop: session.shop, value: form.get("value") === "1" });
  }
  return { ok: false, error: "unknown_intent" };
};

export default function Dashboard() {
  const view = useLoaderData();
  const { t, dateTime, day } = useI18n();
  const empty = (view.ordersInPeriod ?? 0) === 0;
  return (
    <s-page heading={t("dashboard.title")} inlineSize="large">
      <s-stack gap="base">
        <s-paragraph color="subdued">{t("dashboard.subtitle")}</s-paragraph>
        <PeriodSelector days={view.days} windows={view.windows} />
        <DevShopBanner isDevShop={view.isDevShop} includeTestOrders={view.includeTestOrders} />
        {view.mixedCurrency && <s-banner tone="warning">{t("dashboard.currency.mixed")}</s-banner>}
        <DataGapsBanner gaps={view.gaps} />
      </s-stack>
      {empty ? <DashboardEmptyState excluded={view.excludedCurrent} /> : <KpiGrid kpis={view.kpis} />}
      {!empty && <s-section><DashboardNotes notes={view.notes} /></s-section>}
      <s-section slot="aside">
        <s-stack gap="small-200">
          <s-text color="subdued">{view.lastSync ? t("dashboard.sync.last", { date: dateTime(view.lastSync) }) : t("dashboard.sync.never")}</s-text>
          {view.historySince && <s-text color="subdued">{t("dashboard.history.since", { date: day(view.historySince) })}</s-text>}
          {!view.hasAllOrders && <s-text color="subdued">{t("dashboard.history.pending")}</s-text>}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
