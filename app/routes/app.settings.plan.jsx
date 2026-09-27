// ── Réglages > Offre : /app/settings/plan (F4-D1b, X4 ; D2-1 W4 a) — offre reconnue et changement ──
// App Pricing allumée (SHOPIFY_APP_PRICING=1) : changement par la page d'offres de Shopify, aucune
// facturation créée par l'app. Éteinte : montées par l'API de facturation (billing.server.js).
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { loadEntitlement, requestSubscription } from "../lib/billing.server.js";
import { planView, isAppPricing, pricingPageUrl, customPlanMailto } from "../lib/plans.js";
import { planLabelOf } from "../lib/plan.js";
import { loadPlanUsage } from "../lib/usage.server.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { SettingsNav } from "../components/settings/SettingsNav.jsx";
import { PlanCards } from "../components/settings/PlanCards.jsx";
import "../styles/overview.css";
import { embeddedErrorBoundary } from "../lib/routeError.jsx";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const [ent, { data: st }] = await Promise.all([
    loadEntitlement({ admin, shop: session.shop }),
    supabase.from("shop_settings").select("is_dev_shop, shop_timezone").eq("shop_domain", session.shop).maybeSingle(),
  ]);
  // D2-2 (Z3) : volume du mois écoulé face à l'offre reconnue (jamais sur une offre indéterminée).
  const usage = ent.source === "indeterminate" ? null : await loadPlanUsage({ supabase, shop: session.shop, plan: planLabelOf(ent), timeZone: st?.shop_timezone ?? "UTC" });
  return {
    view: planView({ ent, appPricing: isAppPricing(process.env.SHOPIFY_APP_PRICING), changeUrl: pricingPageUrl(session.shop, process.env.SHOPIFY_APP_HANDLE), suggest: usage?.over && usage.suggest !== "custom" ? usage.suggest : null }),
    usage,
    customHref: customPlanMailto(session.shop),
    isDevShop: st?.is_dev_shop === true,
    welcome: new URL(request.url).searchParams.get("subscribed") === "true",
  };
};

export const action = async ({ request }) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  // App Pricing : Shopify interdit toute facturation créée par l'app (page d'offres de Shopify seulement).
  if (isAppPricing(process.env.SHOPIFY_APP_PRICING)) return { intent, ok: false, error: "app_pricing" };
  if (intent === "subscribe_pro") return requestSubscription({ billing, admin, session, plan: "pro" });
  if (intent === "subscribe_expert") return requestSubscription({ billing, admin, session, plan: "expert" });
  return { intent, ok: false, error: "unknown_intent" };
};

export default function SettingsPlan() {
  const { view, isDevShop, welcome, usage, customHref } = useLoaderData();
  const { t } = useI18n();
  return (
    <s-page heading={t("plan.title")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("plan.subtitle")}</p>
        <SectionRail current="settings" />
        <SettingsNav current="plan" />
        <PlanCards view={view} isDevShop={isDevShop} welcome={welcome} usage={usage} customHref={customHref} />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return embeddedErrorBoundary(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
