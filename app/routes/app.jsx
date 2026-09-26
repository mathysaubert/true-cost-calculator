// ── Coquille de l'app embarquée (F4-A) : App Bridge + Polaris WC, navigation, locale ──────────
// Locale (C3a) : surcharge marchand > ?locale= (chargement initial depuis l'admin) > cookie
// tcc_locale > Accept-Language > en. Le cookie est posé quand la locale vient du paramètre ou
// d'une surcharge, pour les navigations client suivantes (qui ne portent plus ?locale=).
// Le rendu serveur et le client utilisent la MÊME locale (jamais celle lue côté client par App Bridge).
// Navigation admin (s-app-nav) : App Bridge n'offre ni badge ni état désactivé → seules les sections
// LIVRÉES y figurent ; la nav complète avec « Bientôt » vit dans le rail app-owned de chaque page.
import { Outlet, useLoaderData, useRouteError, data } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { resolveLocale, readCookie, localeCookieHeader, localeDir, LOCALE_COOKIE } from "../lib/i18n/resolveLocale.js";
import { catalogsFor } from "../locales/index.js";
import { I18nProvider } from "../lib/i18n/context.jsx";
import { LIVE_SECTIONS } from "../lib/sections.js";
import { embeddedErrorBoundary } from "../lib/routeError.jsx";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  let settings = null;
  try {
    const { data: row } = await supabase.from("shop_settings").select("locale_override, shop_currency, shop_timezone").eq("shop_domain", session.shop).maybeSingle();
    settings = row ?? null;
  } catch (e) { console.error("[App] shop_settings :", e?.message); }

  const cookie = readCookie(request.headers.get("cookie"), LOCALE_COOKIE);
  const { locale, source } = resolveLocale({
    override: settings?.locale_override ?? null,
    param: url.searchParams.get("locale"),
    cookie,
    acceptLanguage: request.headers.get("accept-language"),
  });
  const headers = {};
  if ((source === "param" || source === "override") && cookie !== locale) headers["Set-Cookie"] = localeCookieHeader(locale);

  return data({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    locale, dir: localeDir(locale), localeSource: source,
    catalogs: catalogsFor(locale),
    currency: settings?.shop_currency ?? null,
    timeZone: settings?.shop_timezone ?? "UTC",
  }, { headers });
};

export default function App() {
  const { apiKey, locale, catalogs, currency, timeZone } = useLoaderData();

  return (
    <AppProvider apiKey={apiKey}>
      <I18nProvider locale={locale} catalogs={catalogs} currency={currency} timeZone={timeZone}>
        <AppNav />
        <Outlet />
      </I18nProvider>
    </AppProvider>
  );
}

// rel="home" fixe la page d'accueil (Aujourd'hui, masquée du menu par l'admin), puis les sections
// livrées. L'écran classique a été supprimé en D2-3 (2026-09-26).
function AppNav() {
  const { catalogs, locale } = useLoaderData();
  const cat = catalogs[locale] ?? catalogs.en ?? {};
  const label = (k) => cat[k] ?? catalogs.en?.[k] ?? k;
  return (
    <s-app-nav>
      <s-link rel="home" href="/app/overview">{label("nav.home")}</s-link>
      {LIVE_SECTIONS.map((s) => <s-link key={s.id} href={s.path}>{label(`nav.${s.id}`)}</s-link>)}
    </s-app-nav>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return embeddedErrorBoundary(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
