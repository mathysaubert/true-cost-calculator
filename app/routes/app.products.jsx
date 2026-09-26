// ── Produits : /app/products (D1c, X6a) — liste par produit de la période (CA HT, CM2, CM2 %,
// unités, statut de coût) et audit catalogue Expert (lecture seule, 10 par jour). ──
import { useLoaderData, useActionData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { parsePeriodDays } from "../lib/overview.js";
import { loadOverview } from "../lib/overview.server.js";
import { loadEntitlement } from "../lib/billing.server.js";
import { checkRateLimit } from "../lib/rateLimit.server.js";
import { runCatalogAudit } from "../lib/audit.server.js";
import { PRODUCTS_MAX, PRODUCT_COST_STATUSES, PRODUCT_SORTS, productSummary, sortProducts, filterByStatus, returnRateFromKpis } from "../lib/products.js";
import { useI18n } from "../lib/i18n/context.jsx";
import { PeriodSelector } from "../components/overview/OverviewHeader.jsx";
import { SectionRail } from "../components/overview/SectionRail.jsx";
import { DevShopBanner } from "../components/overview/Banners.jsx";
import { OverviewEmptyState } from "../components/overview/Blocks.jsx";
import { ProductList, ProductSummary } from "../components/products/ProductList.jsx";
import { CatalogAudit } from "../components/products/CatalogAudit.jsx";
import "../styles/overview.css";
import { embeddedErrorBoundary } from "../lib/routeError.jsx";

const AUDIT_DAILY_LIMIT = 10; // même plafond que l'écran classique (clé run_audit partagée)

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const days = parsePeriodDays(url.searchParams.get("days"));
  const status = PRODUCT_COST_STATUSES.includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "all";
  const sort = PRODUCT_SORTS.includes(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "ca_ht";
  const [view, ent] = await Promise.all([
    loadOverview({ supabase, shop: session.shop, admin, days, withBriefing: false, withProducts: true, productLimit: PRODUCTS_MAX }),
    loadEntitlement({ admin, shop: session.shop }).catch(() => ({ source: "indeterminate" })),
  ]);
  const all = view.productList ?? [];
  return {
    days, status, sort,
    products: sortProducts(filterByStatus(all, status), sort),
    summary: productSummary(all), productCount: view.productCount ?? all.length, capped: (view.productCount ?? 0) > all.length,
    ordersInPeriod: view.ordersInPeriod ?? 0, excludedCurrent: view.excludedCurrent, isDevShop: view.isDevShop, includeTestOrders: view.includeTestOrders,
    isExpert: ent?.isExpert === true, planIndeterminate: ent?.source === "indeterminate",
    // Taux de retour = l'indicateur « Taux de retour » de l'app (commandes sorties de la fenêtre de retour
    // ayant un retour ou un remboursement), seulement s'il est mesurable ; sinon champ vide (non renseigné).
    ...returnRateFromKpis(view.kpis), thresholdPct: view.thresholdPct ?? 0,
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  if (String(form.get("intent") ?? "") !== "run_audit") return { intent: "audit", ok: false, error: "unknown" };
  const ent = await loadEntitlement({ admin, shop: session.shop }).catch(() => null);
  if (ent?.isExpert !== true) return { intent: "audit", ok: false, error: "expert_only" };
  if (!(await checkRateLimit(session.shop, "run_audit", AUDIT_DAILY_LIMIT))) return { intent: "audit", ok: false, error: "rate_limited" };
  const raw = parseFloat(String(form.get("return_rate_pct") ?? "").replace(",", "."));
  const returnRatePct = Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null;
  const out = await runCatalogAudit({ admin, supabase, shop: session.shop, returnRatePct });
  return { intent: "audit", ok: true, ...out };
};

// L'audit ne change aucune donnée : inutile de recharger la liste après son exécution.
export const shouldRevalidate = ({ formData, defaultShouldRevalidate }) => (formData?.get("intent") === "run_audit" ? false : defaultShouldRevalidate);

export default function Products() {
  const view = useLoaderData();
  const result = useActionData();
  const { t } = useI18n();
  const empty = (view.ordersInPeriod ?? 0) === 0;
  return (
    <s-page heading={t("nav.products")} inlineSize="large">
      <div className="tcc tcc-overview tcc-stack">
        <p className="tcc-muted">{t("products.subtitle")}</p>
        <SectionRail current="products" />
        <div className="tcc-hero__side"><PeriodSelector days={view.days} /></div>
        <DevShopBanner isDevShop={view.isDevShop} includeTestOrders={view.includeTestOrders} />
        {empty ? <OverviewEmptyState excluded={view.excludedCurrent} /> : (
          <>
            <ProductSummary summary={view.summary} capped={view.capped} total={view.productCount} />
            <ProductList products={view.products} summary={view.summary} days={view.days} status={view.status} sort={view.sort} />
          </>
        )}
        <CatalogAudit isExpert={view.isExpert} indeterminate={view.planIndeterminate} returnRatePct={view.returnRatePct} returnRateMissing={view.returnRateMissing} returnRateNoOrders={view.returnRateNoOrders} thresholdPct={view.thresholdPct} result={result?.intent === "audit" ? result : null} />
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return embeddedErrorBoundary(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
