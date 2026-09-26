// ── Réglages > Coûts : /app/settings/costs (R1, S4 S5 S6 S10) ─────────────────────────────────
import { useLoaderData, useActionData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { loadSettings, saveSettings, saveGatewayRule, saveShippingRules, addFixedCost, endFixedCost, deleteFixedCost, recordSettingsFix } from "../lib/settings.server.js";
import { FIELDS, parseFields, shippingRulesFromForm, gatewayRuleFromForm, fixedCostFromForm, dataRuleOf } from "../lib/settings.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { SettingsNav } from "../components/settings/SettingsNav.jsx";
import { SettingsBanner } from "../components/settings/Fields.jsx";
import { OrderCostsForm, ShippingForm, GatewayRules, FixedCosts } from "../components/settings/CostsForms.jsx";
import "../styles/overview.css";
import { embeddedErrorBoundary } from "../lib/routeError.jsx";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return loadSettings({ supabase, shop: session.shop });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const s = await loadSettings({ supabase, shop });
  const done = async (res, field) => {
    if (res.ok) await recordSettingsFix({ supabase, shop, rule: dataRuleOf(intent), field, day: s.today });
    return { intent, ...res };
  };
  if (intent === "save_order_costs") {
    const { values, errors } = parseFields(FIELDS.order_costs, form);
    if (Object.keys(errors).length) return { intent, ok: false, errors };
    return done(await saveSettings({ supabase, shop, values }), Object.keys(values).join(","));
  }
  if (intent === "save_shipping") {
    const { rules, errors } = shippingRulesFromForm(form);
    if (Object.keys(errors).length) return { intent, ok: false, errors };
    // Rien de saisi : réglage non renseigné, pas de « donnée corrigée » au journal.
    if (!rules.confirmed) return { intent, ...(await saveShippingRules({ supabase, shop, rules })) };
    return done(await saveShippingRules({ supabase, shop, rules }), "shipping_cost_rules");
  }
  if (intent === "save_gateway") {
    const { rule, errors } = gatewayRuleFromForm(form);
    if (Object.keys(errors).length) return { intent, ok: false, errors, gateway: rule.gateway };
    return { gateway: rule.gateway, ...(await done(await saveGatewayRule({ supabase, shop, rule }), `gateway:${rule.gateway}`)) };
  }
  if (intent === "add_fixed_cost") {
    const { row, errors } = fixedCostFromForm(form);
    if (Object.keys(errors).length) return { intent, ok: false, errors };
    return done(await addFixedCost({ supabase, shop, row, currency: s.settings.shop_currency ?? null }), "fixed_costs");
  }
  if (intent === "end_fixed_cost") return done(await endFixedCost({ supabase, shop, id: String(form.get("id") ?? ""), day: s.today }), "fixed_costs");
  if (intent === "delete_fixed_cost") return done(await deleteFixedCost({ supabase, shop, id: String(form.get("id") ?? "") }), "fixed_costs");
  return { intent, ok: false, error: "unknown_intent" };
};

export default function SettingsCosts() {
  const view = useLoaderData();
  const result = useActionData();
  const { t } = useI18n();
  return (
    <s-page heading={t("settings.costs.title")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("settings.costs.subtitle")}</p>
        <SectionRail current="settings" />
        <SettingsNav current="costs" />
        <SettingsBanner result={result} />
        <OrderCostsForm settings={view.settings} result={result} />
        <ShippingForm settings={view.settings} result={result} />
        <GatewayRules settings={view.settings} gateways={view.gateways} result={result} />
        <FixedCosts rows={view.fixedCosts} today={view.today} result={result} />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return embeddedErrorBoundary(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
