import { authenticate } from "../shopify.server";

// OAuth callback — Shopify redirects here after merchant authorizes the app.
// authenticate.admin() handles both OAuth code exchange (new install) and
// Token Exchange (embedded re-auth), stores the session, then redirects to
// the embedded app. The previous redirect-only approach skipped the code
// exchange, leaving no session for real (non-dev) stores.
export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};
