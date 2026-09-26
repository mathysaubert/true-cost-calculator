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
import { NewProduct } from "../components/simulator/NewProduct.jsx";
import { ModeBar, SIM_MODES } from "../components/simulator/ModeBar.jsx";
import { unitEconomics, NEW_PRODUCT_FIELDS, NEW_PRODUCT_ENUMS } from "../lib/simulator/newProduct.js";
import "../styles/overview.css";
import { embeddedErrorBoundary } from "../lib/routeError.jsx";

const DAY_MS = 86_400_000;
const periodDaysOf = (w) => (w?.start && w?.end ? Math.round((Date.parse(w.end) - Date.parse(w.start)) / DAY_MS) + 1 : 30);
const rowToMemory = (d) => ({ id: d.id, decided_at: String(d.decided_at).slice(0, 10), rule_id: d.scenario?.rule_id ?? null, values: d.scenario?.values ?? {}, days: d.scenario?.days ?? null, horizon: d.scenario?.horizon ?? null, mode: d.scenario?.mode ?? "shop", product_id: d.scenario?.product_id ?? null, product_title: d.scenario?.product_title ?? null, new_cm2: d.scenario?.outputs?.cm2 ?? null, new_cm2_pct: d.scenario?.outputs?.cm2_pct ?? null, expected_low: d.expected_impact_low, expected_high: d.expected_impact_high, review_at: d.review_at ?? null, observed_at: d.observed_at ?? null, observed_impact: d.observed_impact ?? null, note: d.note ?? null });
const MEMORY_COLS = "id, decided_at, scenario, expected_impact_low, expected_impact_high, review_at, observed_at, observed_impact, note";

async function loadMemory(shop) {
  const { data } = await supabase.from("decision_log").select(MEMORY_COLS).eq("shop_domain", shop).eq("kind", "simulated").order("decided_at", { ascending: false }).limit(5);
  return (data ?? []).map(rowToMemory);
}
async function loadCompare(shop, ids) {
  if (!ids.length) return [];
  const { data } = await supabase.from("decision_log").select(MEMORY_COLS).eq("shop_domain", shop).eq("kind", "simulated").in("id", ids);
  return ids.map((id) => (data ?? []).find((d) => d.id === id)).filter(Boolean).map(rowToMemory).filter((m) => m.mode !== "new").map((m) => ({ id: m.id, rule_id: m.rule_id, values: m.values, decided_at: m.decided_at }));
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const days = parsePeriodDays(url.searchParams.get("days"));
  const compareIds = parseCompareIds(url.searchParams.get("compare"));
  // S2c (W4a) : les décisions dues sont observées en arrière-plan, une fois, avant que la mémoire ne soit relue.
  background(reviewDueDecisions({ supabase, shop: session.shop, admin, now: new Date() }), "decision_review");
  const mode = SIM_MODES.includes(url.searchParams.get("mode")) ? url.searchParams.get("mode") : "shop";
  const [view, memory, compare] = await Promise.all([
    loadOverview({ supabase, shop: session.shop, admin, days, withBriefing: false, withProducts: mode === "product" }),
    loadMemory(session.shop).catch(() => []),
    loadCompare(session.shop, compareIds).catch(() => []),
  ]);
  const { values, rule, horizon } = parseScenario(url.searchParams);
  const products = view.productList ?? [];
  const product = mode === "product" ? (products.find((p) => p.id === url.searchParams.get("product"))?.id ?? products[0]?.id ?? null) : null;
  const leaves = mode === "product" ? view.productLeaves?.[product] ?? {} : view.waterfall?.leaves ?? {};
  return { days, mode, products, product, productTitle: products.find((p) => p.id === product)?.title ?? null, periodDays: periodDaysOf(view.windows?.current), leaves, ordersInPeriod: view.ordersInPeriod ?? 0, excludedCurrent: view.excludedCurrent, isDevShop: view.isDevShop, includeTestOrders: view.includeTestOrders, initial: values, rule, horizon, memory, compare, now: new Date().toISOString(), newInitial: view.newProductDefaults ?? {}, shopCountryCode: view.shopCountryCode ?? null };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const days = parsePeriodDays(form.get("days"));
  if (intent === "keep_new") {
    // S3 : nouveau produit, recalculé côté serveur depuis les champs ; pas d'observé (produit hypothétique).
    const inputs = {};
    for (const f of [...NEW_PRODUCT_FIELDS.map((x) => x.id), ...NEW_PRODUCT_ENUMS]) { const v = form.get(`np_${f}`); if (v != null && v !== "") inputs[f] = String(v); }
    const { data: st } = await supabase.from("shop_settings").select("shop_country_code").eq("shop_domain", session.shop).maybeSingle();
    const out = unitEconomics({ inputs, shopCountryCode: st?.shop_country_code ?? null });
    if (!out.ok) return { intent: "simulate", ok: false, error: "empty" };
    const res = await recordDecision({ supabase, shop: session.shop, kind: "simulated", scenario: { source: "simulator", mode: "new", inputs, outputs: out, node: "cm2" }, expected: { node: "cm2" } });
    return { intent: "simulate", ...res, kind: "simulated" };
  }
  if (intent !== "keep") return { intent, ok: false, error: "unknown_intent" };
  const { values, rule, horizon } = parseScenario(form);
  const mode = form.get("mode") === "product" ? "product" : "shop";
  const productId = mode === "product" ? String(form.get("product") ?? "") : null;
  const view = await loadOverview({ supabase, shop: session.shop, admin, days, withBriefing: false, withProducts: mode === "product" });
  const leaves = mode === "product" ? view.productLeaves?.[productId] ?? {} : view.waterfall?.leaves ?? {};
  const run = runScenario({ leaves, values, periodDays: periodDaysOf(view.windows?.current), horizon });
  if (run.empty) return { intent: "simulate", ok: false, error: "empty" };
  const scenario = { ...scenarioRecord({ run, rule, days }), mode, product_id: productId, product_title: mode === "product" ? view.productList?.find((p) => p.id === productId)?.title ?? null : null };
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
        <ModeBar mode={view.mode} products={view.products} product={view.product} days={view.days} />
        {view.mode === "new" ? (
          <NewProduct initial={view.newInitial} shopCountryCode={view.shopCountryCode} days={view.days} />
        ) : empty ? <OverviewEmptyState excluded={view.excludedCurrent} /> : view.mode === "product" && !view.product ? null : (
          <Simulator key={`${view.mode}:${view.product ?? ""}`} leaves={view.leaves} periodDays={view.periodDays} days={view.days} initial={view.initial} rule={view.rule} horizon={view.horizon} memory={view.memory} compare={view.compare} now={view.now} mode={view.mode} product={view.product} productTitle={view.productTitle} />
        )}
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return embeddedErrorBoundary(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
