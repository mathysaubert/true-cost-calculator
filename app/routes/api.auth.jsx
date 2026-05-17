import { redirect } from "react-router";

// OAuth installation callback for Token Exchange apps.
//
// Token Exchange strategy does not process OAuth codes — auth happens via
// App Bridge session tokens (see auth.$.jsx). This route simply redirects
// the merchant back to their Shopify admin after the OAuth installation
// consent screen. The embedded app will then authenticate transparently
// through Token Exchange on first load.
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return redirect("/auth/login");
  }

  // Redirect to the app inside Shopify admin — App Bridge will provide
  // a session token and Token Exchange will create the session.
  return redirect(
    `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`
  );
};
