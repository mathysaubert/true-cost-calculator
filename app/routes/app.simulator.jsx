// ── Simulateur : /app/simulator (S1) — feuilles agrégées de la période chargées une fois, calcul
// client, « Retenir ce scénario » recalculé côté serveur puis decision_log (I0-C). ──────────────
import { useLoaderData, useActionData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { parsePeriodDays } from "../lib/overview.js";
import { loadOverview } from "../lib/overview.server.js";
import { recordDecision } from "../lib/decisions.server.js";
import { parseScenario, runScenario, scenarioRecord } from "../lib/simulator/index.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { DevShopBanner } from "../components/overview/Banners.jsx";
import { DecisionBanner } from "../components/overview/Briefing.jsx";
import { OverviewEmptyState } from "../components/overview/Blocks.jsx";
import { Simulator } from "../components/simulator/Simulator.jsx";
import "../styles/overview.css";

const DAY_MS = 86_400_000;
const periodDaysOf = (w) => (w?.start && w?.end ? Math.round((Date.parse(w.end) - Date.parse(w.start)) / DAY_MS) + 1 : 30);

async function loadMemory(shop) {
  const { data } = await supabase.from("decision_log").select("id, decided_at, scenario, expected_impact_low, expected_impact_high").eq("shop_domain", shop).eq("kind", "simulated").order("decided_at", { ascending: false }).limit(5);
  return (data ?? []).map((d) => ({ id: d.id, decided_at: String(d.decided_at).slice(0, 10), rule_id: d.scenario?.rule_id ?? null, values: d.scenario?.values ?? {}, days: d.scenario?.days ?? null, horizon: d.scenario?.horizon ?? null, expected_low: d.expected_impact_low, expected_high: d.expected_impact_high }));
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const days = parsePeriodDays(url.searchParams.get("days"));
  const [view, memory] = await Promise.all([
    loadOverview({ supabase, shop: session.shop, admin, days, withBriefing: false }),
    loadMemory(session.shop).catch(() => []),
  ]);
  const { values, rule, horizon } = parseScenario(url.searchParams);
  return { days, periodDays: periodDaysOf(view.windows?.current), leaves: view.waterfall?.leaves ?? {}, ordersInPeriod: view.ordersInPeriod ?? 0, excludedCurrent: view.excludedCurrent, isDevShop: view.isDevShop, includeTestOrders: view.includeTestOrders, initial: values, rule, horizon, memory };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "keep") return { intent, ok: false, error: "unknown_intent" };
  const days = parsePeriodDays(form.get("days"));
  const { values, rule, horizon } = parseScenario(form);
  const view = await loadOverview({ supabase, shop: session.shop, admin, days, withBriefing: false });
  const run = runScenario({ leaves: view.waterfall?.leaves ?? {}, values, periodDays: periodDaysOf(view.windows?.current), horizon });
  if (run.empty) return { intent: "simulate", ok: false, error: "empty" };
  const scenario = scenarioRecord({ run, rule, days });
  const res = await recordDecision({ supabase, shop: session.shop, kind: "simulated", insightFingerprint: rule ? `${rule}:simulator` : null, scenario, expected: { low: scenario.range.low, high: scenario.range.high, node: "cm2" }, horizonDays: horizon === "month" ? 30 : run.periodDays });
  return { intent: "simulate", ...res, kind: "simulated" };
};

export default function SimulatorPage() {
  const view = useLoaderData();
  const result = useActionData();
  const { t } = useI18n();
  const empty = (view.ordersInPeriod ?? 0) === 0;
  return (
    <s-page heading={t("nav.simulator")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("sim.subtitle")}</p>
        <SectionRail current="simulator" />
        <DevShopBanner isDevShop={view.isDevShop} includeTestOrders={view.includeTestOrders} />
        <DecisionBanner result={result?.intent === "simulate" ? result : null} />
        {empty ? <OverviewEmptyState excluded={view.excludedCurrent} /> : (
          <Simulator leaves={view.leaves} periodDays={view.periodDays} days={view.days} initial={view.initial} rule={view.rule} horizon={view.horizon} memory={view.memory} />
        )}
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
