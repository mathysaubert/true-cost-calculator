// ── Téléchargement du modèle des coûts produits : /app/settings/products/export?format=xlsx|csv ──
// Route de ressource authentifiée (jeton de session ajouté par App Bridge au fetch de la page) :
// .xlsx en principal, CSV UTF-8 (avec BOM) en second. Même contenu que l'import attend.
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { exportCosts } from "../lib/productCosts.server.js";
import { resolveLocale, readCookie, LOCALE_COOKIE } from "../lib/i18n/resolveLocale.js";
import { catalogsFor } from "../locales/index.js";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const { data: st } = await supabase.from("shop_settings").select("locale_override").eq("shop_domain", session.shop).maybeSingle();
  const { locale } = resolveLocale({ override: st?.locale_override ?? null, param: url.searchParams.get("locale"), cookie: readCookie(request.headers.get("cookie"), LOCALE_COOKIE), acceptLanguage: request.headers.get("accept-language") });
  const cat = catalogsFor(locale), t = (k) => cat[locale]?.[k] ?? cat.en?.[k] ?? k;
  const file = await exportCosts({ admin, supabase, shop: session.shop, format, sheetNames: { costs: t("productcosts.xlsx.sheet_costs"), values: t("productcosts.xlsx.sheet_values") } });
  return new Response(file.body, {
    status: 200,
    headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" },
  });
};
