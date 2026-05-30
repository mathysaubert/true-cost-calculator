// Sentry server-side instrumentation — must be imported before all other modules.
// DSN is public (safe to commit). See: https://docs.sentry.io/concepts/key-terms/dsn-explainer/
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "https://77da8ce0da23f737a708d7f4965b8405@o4511479041097728.ingest.de.sentry.io/4511479059578960",
  environment: process.env.NODE_ENV ?? "development",
  tracesSampleRate: 0.1,
  // Ignore Shopify auth redirects (302) and normal 4xx responses — not bugs
  ignoreErrors: [/^Response$/],
  beforeSend(event) {
    // Drop non-error HTTP responses thrown by React Router (redirects, 404s)
    if (event.exception?.values?.[0]?.type === "Response") return null;
    return event;
  },
});
