// ── Réglages > Objectifs : /app/settings/goals (R1, S7) ───────────────────────────────────────
import { useLoaderData, useActionData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { loadSettings, saveSettings } from "../lib/settings.server.js";
import { FIELDS, parseFields } from "../lib/settings.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { SettingsNav } from "../components/settings/SettingsNav.jsx";
import { SettingsBanner } from "../components/settings/Fields.jsx";
import { GoalsForm } from "../components/settings/GoalsForm.jsx";
import "../styles/overview.css";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [s, { data: alert }] = await Promise.all([
    loadSettings({ supabase, shop: session.shop }),
    supabase.from("margin_alerts").select("threshold").eq("shop_domain", session.shop).maybeSingle(),
  ]);
  return { settings: s.settings, alertThreshold: alert?.threshold ?? null };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "save_goals") return { intent, ok: false, error: "unknown_intent" };
  const { values, errors } = parseFields(FIELDS.goals, form);
  if (Object.keys(errors).length) return { intent, ok: false, errors };
  // Le seuil CM2 vide revient à 0 (colonne NOT NULL DEFAULT 0 : « perte stricte »).
  if (values.profitability_threshold_pct === null) values.profitability_threshold_pct = 0;
  return { intent, ...(await saveSettings({ supabase, shop: session.shop, values })) };
};

export default function SettingsGoals() {
  const view = useLoaderData();
  const result = useActionData();
  const { t } = useI18n();
  return (
    <s-page heading={t("settings.goals.title")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("settings.goals.subtitle")}</p>
        <SectionRail current="settings" />
        <SettingsNav current="goals" />
        <SettingsBanner result={result} />
        <GoalsForm settings={view.settings} result={result} alertThreshold={view.alertThreshold} />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
