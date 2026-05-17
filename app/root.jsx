import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router";

export default function App() {
  return (
    <html lang="en">
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

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[root] Unhandled error:", error);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Error</title>
      </head>
      <body style={{ fontFamily: "sans-serif", padding: "2rem" }}>
        <h1>App Error</h1>
        <p>{error?.message || String(error)}</p>
        {error?.stack && (
          <pre style={{ fontSize: "0.8rem", background: "#f5f5f5", padding: "1rem", overflow: "auto" }}>
            {error.stack}
          </pre>
        )}
      </body>
    </html>
  );
}
