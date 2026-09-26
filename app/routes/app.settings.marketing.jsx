// ── Réglages > Marketing : /app/settings/marketing (R2, décision H : saisie ici, lecture dans Marketing) ──
import { useLoaderData, useActionData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { loadMarketing, addPartner, deletePartner, savePromoRule, deletePromoRule, addManualCommission, deleteManualCommission } from "../lib/settings.server.js";
import { partnerFromForm, promoRuleFromForm, manualCommissionFromForm } from "../lib/settings.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { SettingsNav } from "../components/settings/SettingsNav.jsx";
import { SettingsBanner } from "../components/settings/Fields.jsx";
import { Partners, PromoRules, ManualCommissions } from "../components/settings/MarketingForms.jsx";
import "../styles/overview.css";
import { embeddedErrorBoundary } from "../lib/routeError.jsx";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return loadMarketing({ supabase, shop: session.shop });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  if (intent === "add_partner") {
    const { row, errors } = partnerFromForm(form);
    if (Object.keys(errors).length) return { intent, ok: false, errors };
    return { intent, ...(await addPartner({ supabase, shop, row })) };
  }
  if (intent === "delete_partner") return { intent, ...(await deletePartner({ supabase, shop, id })) };
  if (intent === "save_promo_rule") {
    const { partners } = await loadMarketing({ supabase, shop, withCodes: false });
    const { row, errors } = promoRuleFromForm(form, partners);
    if (Object.keys(errors).length) return { intent, ok: false, errors };
    return { intent, ...(await savePromoRule({ supabase, shop, row })) };
  }
  if (intent === "delete_promo_rule") return { intent, ...(await deletePromoRule({ supabase, shop, code: String(form.get("code") ?? "") })) };
  if (intent === "add_manual_commission") {
    const { partners, currency } = await loadMarketing({ supabase, shop, withCodes: false });
    const { row, errors } = manualCommissionFromForm(form, partners);
    if (Object.keys(errors).length) return { intent, ok: false, errors };
    return { intent, ...(await addManualCommission({ supabase, shop, row, currency })) };
  }
  if (intent === "delete_manual_commission") return { intent, ...(await deleteManualCommission({ supabase, shop, id })) };
  return { intent, ok: false, error: "unknown_intent" };
};

export default function SettingsMarketing() {
  const view = useLoaderData();
  const result = useActionData();
  const { t } = useI18n();
  return (
    <s-page heading={t("settings.marketing.title")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("settings.marketing.subtitle")}</p>
        <SectionRail current="settings" />
        <SettingsNav current="marketing" />
        <SettingsBanner result={result} />
        <Partners partners={view.partners} result={result} />
        <PromoRules rules={view.rules} partners={view.partners} codes={view.codes} result={result} />
        <ManualCommissions commissions={view.commissions} partners={view.partners} result={result} />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return embeddedErrorBoundary(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
