import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError, useRouteLoaderData } from "react-router";
import { describeRouteError, ROOT_ERROR_KEYS } from "./lib/routeError.jsx";
import { resolveLocale, readCookie, localeDir, LOCALE_COOKIE } from "./lib/i18n/resolveLocale.js";
import { catalogsFor } from "./locales/index.js";

// Loader racine (sans authentification) : langue probable et textes de la page d'erreur, seulement
// ceux-là (le catalogue complet n'est jamais envoyé ici).
export const loader = ({ request }) => {
  const { locale } = resolveLocale({ param: new URL(request.url).searchParams.get("locale"), cookie: readCookie(request.headers.get("cookie"), LOCALE_COOKIE), acceptLanguage: request.headers.get("accept-language") });
  const cat = catalogsFor(locale);
  const errorTexts = Object.fromEntries(ROOT_ERROR_KEYS.map((k) => [k, cat[locale]?.[k] ?? cat.en?.[k] ?? null]).filter(([, v]) => v != null));
  return { locale, dir: localeDir(locale), errorTexts };
};

export default function App() {
  // lang/dir suivent la locale résolue par la coquille (routes/app) ; hors /app : en, ltr.
  const app = useRouteLoaderData("routes/app");
  return (
    <html lang={app?.locale ?? "en"} dir={app?.dir ?? "ltr"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// Page d'erreur racine (2026-09-26) : toujours un message lisible et traduit, jamais « [object Object] ».
// Langue et textes : ceux de la coquille /app s'ils sont chargés, sinon ceux du loader racine (cookie,
// Accept-Language), sinon l'anglais. Détail technique court (code, message) sous le message.
export function ErrorBoundary() {
  const error = useRouteError();
  const app = useRouteLoaderData("routes/app");
  const root = useRouteLoaderData("root");
  const locale = app?.locale ?? root?.locale ?? "en";
  const texts = app?.catalogs ? { ...(app.catalogs.en ?? {}), ...(app.catalogs[locale] ?? {}) } : root?.errorTexts ?? {};
  const t = (k, vars = {}) => String(texts[k] ?? FALLBACK_TEXTS[k] ?? k).replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? ""));
  const info = describeRouteError(error);
  console.error("[root] Unhandled error:", info.status ?? "", info.detail ?? "");
  return (
    <html lang={locale} dir={app?.dir ?? root?.dir ?? "ltr"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{t("error.title")}</title>
      </head>
      <body style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", padding: "2rem", maxWidth: "40rem" }}>
        <h1 style={{ fontSize: "1.25rem" }} data-root-error={info.key}>{t("error.title")}</h1>
        <p>{t(info.key)}</p>
        <p><button type="button" onClick={() => window.location.reload()}>{t("error.reload")}</button></p>
        {(info.status || info.detail) && (
          <p style={{ color: "#616161", fontSize: "0.8125rem" }} data-root-error-detail="">
            {info.status ? t("error.code", { code: info.status }) : ""}{info.status && info.detail ? " · " : ""}{info.detail ? t("error.detail", { detail: info.detail }) : ""}
          </p>
        )}
      </body>
    </html>
  );
}

// Dernier recours si aucun catalogue n'est chargé (le loader racine lui-même a échoué).
const FALLBACK_TEXTS = {
  "error.title": "Something went wrong",
  "error.generic": "The page could not be displayed. Reload it; if the problem persists, reopen the app from your Shopify admin.",
  "error.reload": "Reload the page",
  "error.code": "Code {{code}}",
  "error.detail": "Detail: {{detail}}",
};
