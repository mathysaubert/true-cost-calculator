// ── Réglages > Offre : /app/settings/plan (F4-D1b, X4) — même facturation que l'écran classique ──
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { loadEntitlement, requestSubscription } from "../lib/billing.server.js";
import { planView } from "../lib/plans.js";
import { isBetaShop, BETA_TRIAL_DAYS } from "../lib/betaShops.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { SettingsNav } from "../components/settings/SettingsNav.jsx";
import { PlanCards } from "../components/settings/PlanCards.jsx";
import "../styles/overview.css";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const [ent, { data: st }] = await Promise.all([
    loadEntitlement({ admin, shop: session.shop }),
    supabase.from("shop_settings").select("is_dev_shop").eq("shop_domain", session.shop).maybeSingle(),
  ]);
  return {
    view: planView({ ent, isBeta: isBetaShop(session.shop, process.env.BETA_SHOPS), betaTrialDays: BETA_TRIAL_DAYS }),
    isDevShop: st?.is_dev_shop === true,
    welcome: new URL(request.url).searchParams.get("subscribed") === "true",
  };
};

export const action = async ({ request }) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "subscribe_pro") return requestSubscription({ billing, admin, session, plan: "pro" });
  if (intent === "subscribe_expert") return requestSubscription({ billing, admin, session, plan: "expert" });
  return { intent, ok: false, error: "unknown_intent" };
};

export default function SettingsPlan() {
  const { view, isDevShop, welcome } = useLoaderData();
  const { t } = useI18n();
  return (
    <s-page heading={t("plan.title")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("plan.subtitle")}</p>
        <SectionRail current="settings" />
        <SettingsNav current="plan" />
        <PlanCards view={view} isDevShop={isDevShop} welcome={welcome} />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
