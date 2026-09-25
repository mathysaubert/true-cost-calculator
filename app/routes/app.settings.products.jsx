// ── Réglages > Coûts produits : /app/settings/products (F4-D1a, X3) — portage du « Suivi des coûts » ──
import { useLoaderData, useActionData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { loadProductCosts, saveProductCosts, importCostsCsv, confirmCustoms } from "../lib/productCosts.server.js";
import { groupProducts, statusCounts, filterProducts, parseProductForm, csvErrorFields, STATUS_FILTERS } from "../lib/productCosts.js";
import { recordSettingsFix } from "../lib/settings.server.js";
import { dayInTimeZone } from "../lib/overview.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { SettingsNav } from "../components/settings/SettingsNav.jsx";
import { ProductCostSummary, ProductCostList, CustomsPanel, CostsCsv } from "../components/settings/ProductCosts.jsx";
import "../styles/overview.css";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = STATUS_FILTERS.includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "all";
  const data = await loadProductCosts({ admin, supabase, shop: session.shop });
  const products = groupProducts(data.rows);
  return { products: filterProducts(products, status), all: products, counts: statusCounts(products), filter: status, openId: url.searchParams.get("product"), currency: data.currency, csv: data.csv, variantsCapped: data.variantsCapped, giftCardCount: data.giftCardCount, incomplete: data.incomplete };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const today = dayInTimeZone(new Date(), "UTC");
  if (intent === "save_product") {
    const productId = String(form.get("product_id") ?? "");
    const { rows, errors, skipped } = parseProductForm(form, { productId });
    const res = await saveProductCosts({ supabase, shop, rows });
    if (res.ok && res.saved > 0) await recordSettingsFix({ supabase, shop, rule: "cost_coverage", field: `product:${productId}`, day: today });
    return { intent, product_id: productId, ...res, errors, skipped, ok: res.ok && errors.length === 0 };
  }
  if (intent === "import_csv") {
    const file = form.get("csv");
    const text = file && typeof file.text === "function" ? await file.text() : String(file ?? "");
    const res = await importCostsCsv({ supabase, shop, text });
    if (res.ok && res.saved > 0) await recordSettingsFix({ supabase, shop, rule: "cost_coverage", field: "csv", day: today });
    return { intent, ...res, csvErrors: csvErrorFields(res.csvErrors ?? []) };
  }
  if (intent === "confirm_customs") {
    const res = await confirmCustoms({ supabase, shop, productId: String(form.get("product_id") ?? ""), categorie: String(form.get("categorie") ?? "") });
    if (res.ok) await recordSettingsFix({ supabase, shop, rule: "landed_cost", field: "customs", day: today });
    return { intent, ...res };
  }
  return { intent, ok: false, error: "unknown_intent" };
};

export default function SettingsProducts() {
  const view = useLoaderData();
  const result = useActionData();
  const { t } = useI18n();
  return (
    <s-page heading={t("productcosts.title")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("productcosts.subtitle")}</p>
        <SectionRail current="settings" />
        <SettingsNav current="products" />
        {result?.intent === "save_product" && (result.ok ? <s-banner tone="success">{t("productcosts.saved", { count: result.saved ?? 0 })}</s-banner> : <s-banner tone="warning">{t("productcosts.save_errors", { count: result.errors?.length ?? 0 })}</s-banner>)}
        {result?.intent === "save_product" && result.skipped?.length > 0 && <s-banner tone="info">{t("productcosts.skipped", { count: result.skipped.length })}</s-banner>}
        {result && result.ok === false && result.error && result.intent !== "save_product" && <s-banner tone="critical">{t("settings.error.failed")}</s-banner>}
        {(view.variantsCapped || view.incomplete) && <s-banner tone="warning">{t("productcosts.capped")}</s-banner>}
        {view.giftCardCount > 0 && <p className="tcc-muted">{t("productcosts.gift_cards", { count: view.giftCardCount })}</p>}
        <ProductCostSummary counts={view.counts} filter={view.filter} />
        <ProductCostList products={view.products} openId={view.openId} filter={view.filter} currency={view.currency} result={result?.intent === "save_product" ? result : null} />
        <CustomsPanel products={view.all} result={result} />
        <CostsCsv csv={view.csv} result={result} />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
