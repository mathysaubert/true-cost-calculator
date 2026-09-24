// ── Réglages > Boutique : /app/settings/shop (R2, S8) ─────────────────────────────────────────
import { useLoaderData, useActionData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { loadSettings, saveSettings } from "../lib/settings.server.js";
import { parseShopForm } from "../lib/settings.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { SettingsNav } from "../components/settings/SettingsNav.jsx";
import { SettingsBanner } from "../components/settings/Fields.jsx";
import { ShopForm } from "../components/settings/ShopForm.jsx";
import "../styles/overview.css";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const s = await loadSettings({ supabase, shop: session.shop });
  return { settings: s.settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "save_shop") return { intent, ok: false, error: "unknown_intent" };
  const { values, errors } = parseShopForm(form);
  if (Object.keys(errors).length) return { intent, ok: false, errors };
  return { intent, ...(await saveSettings({ supabase, shop: session.shop, values })) };
};

export default function SettingsShop() {
  const view = useLoaderData();
  const result = useActionData();
  const { t } = useI18n();
  return (
    <s-page heading={t("settings.shop.title")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("settings.shop.subtitle")}</p>
        <SectionRail current="settings" />
        <SettingsNav current="shop" />
        <SettingsBanner result={result} />
        <ShopForm settings={view.settings} result={result} />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
