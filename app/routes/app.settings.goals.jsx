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
import { embeddedErrorBoundary } from "../lib/routeError.jsx";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const s = await loadSettings({ supabase, shop: session.shop });
  return { settings: s.settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "save_goals") return { intent, ok: false, error: "unknown_intent" };
  const { values, errors } = parseFields(FIELDS.goals, form);
  if (Object.keys(errors).length) return { intent, ok: false, errors };
  // D2-4 : objectif de marge vide = non renseigné (NULL, colonne facultative) ; 0 saisi = vrai 0.
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
        <GoalsForm settings={view.settings} result={result} />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return embeddedErrorBoundary(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
