// ── Simulateur : /app/simulator (S1 ; S2a objectif, S2b comparaison, S2c observé) — feuilles
// agrégées de la période chargées une fois, calcul client, « Retenir ce scénario » recalculé côté
// serveur puis decision_log (I0-C) avec review_at (W6) ; revue des décisions dues en arrière-plan (W4). ──
import { useLoaderData, useActionData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { parsePeriodDays } from "../lib/overview.js";
import { loadOverview } from "../lib/overview.server.js";
import { recordDecision, reviewDueDecisions } from "../lib/decisions.server.js";
import { parseScenario, runScenario, scenarioRecord } from "../lib/simulator/index.js";
import { parseCompareIds } from "../lib/simulator/compare.js";
import { reviewAt } from "../lib/simulator/observed.js";
import { background } from "../lib/sync/background.server.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { DevShopBanner } from "../components/overview/Banners.jsx";
import { DecisionBanner } from "../components/overview/Briefing.jsx";
import { OverviewEmptyState } from "../components/overview/Blocks.jsx";
import { Simulator } from "../components/simulator/Simulator.jsx";
import "../styles/overview.css";

const DAY_MS = 86_400_000;
const periodDaysOf = (w) => (w?.start && w?.end ? Math.round((Date.parse(w.end) - Date.parse(w.start)) / DAY_MS) + 1 : 30);
const rowToMemory = (d) => ({ id: d.id, decided_at: String(d.decided_at).slice(0, 10), rule_id: d.scenario?.rule_id ?? null, values: d.scenario?.values ?? {}, days: d.scenario?.days ?? null, horizon: d.scenario?.horizon ?? null, expected_low: d.expected_impact_low, expected_high: d.expected_impact_high, review_at: d.review_at ?? null, observed_at: d.observed_at ?? null, observed_impact: d.observed_impact ?? null, note: d.note ?? null });
const MEMORY_COLS = "id, decided_at, scenario, expected_impact_low, expected_impact_high, review_at, observed_at, observed_impact, note";

async function loadMemory(shop) {
  const { data } = await supabase.from("decision_log").select(MEMORY_COLS).eq("shop_domain", shop).eq("kind", "simulated").order("decided_at", { ascending: false }).limit(5);
  return (data ?? []).map(rowToMemory);
}
async function loadCompare(shop, ids) {
  if (!ids.length) return [];
  const { data } = await supabase.from("decision_log").select(MEMORY_COLS).eq("shop_domain", shop).eq("kind", "simulated").in("id", ids);
  return ids.map((id) => (data ?? []).find((d) => d.id === id)).filter(Boolean).map(rowToMemory).map((m) => ({ id: m.id, rule_id: m.rule_id, values: m.values, decided_at: m.decided_at }));
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const days = parsePeriodDays(url.searchParams.get("days"));
  const compareIds = parseCompareIds(url.searchParams.get("compare"));
  // S2c (W4a) : les décisions dues sont observées en arrière-plan, une fois, avant que la mémoire ne soit relue.
  background(reviewDueDecisions({ supabase, shop: session.shop, admin, now: new Date() }), "decision_review");
  const [view, memory, compare] = await Promise.all([
    loadOverview({ supabase, shop: session.shop, admin, days, withBriefing: false }),
    loadMemory(session.shop).catch(() => []),
    loadCompare(session.shop, compareIds).catch(() => []),
  ]);
  const { values, rule, horizon } = parseScenario(url.searchParams);
  return { days, periodDays: periodDaysOf(view.windows?.current), leaves: view.waterfall?.leaves ?? {}, ordersInPeriod: view.ordersInPeriod ?? 0, excludedCurrent: view.excludedCurrent, isDevShop: view.isDevShop, includeTestOrders: view.includeTestOrders, initial: values, rule, horizon, memory, compare, now: new Date().toISOString() };
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
  const horizonDays = horizon === "month" ? 30 : run.periodDays;
  const decidedAt = new Date().toISOString();
  const res = await recordDecision({ supabase, shop: session.shop, kind: "simulated", insightFingerprint: rule ? `${rule}:simulator` : null, scenario, expected: { low: scenario.range.low, high: scenario.range.high, node: "cm2" }, horizonDays, reviewAt: reviewAt(decidedAt, horizonDays) });
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
          <Simulator leaves={view.leaves} periodDays={view.periodDays} days={view.days} initial={view.initial} rule={view.rule} horizon={view.horizon} memory={view.memory} compare={view.compare} now={view.now} />
        )}
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
