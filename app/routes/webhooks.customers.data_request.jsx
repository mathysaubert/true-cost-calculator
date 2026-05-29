import { authenticate } from "../shopify.server";

// Mandatory Shopify RGPD webhook: respond to a customer's data access request.
// This app stores no PII linked to individual customers — data is indexed
// by shop_domain only. Respond with an empty data set.
export const action = async ({ request }) => {
  const { payload } = await authenticate.webhook(request);

  const shopDomain = payload?.shop_domain ?? "unknown";
  const customerId = payload?.customer?.id ?? "unknown";
  console.info("[RGPD] customers/data_request", { shopDomain, customerId });

  // No customer-level PII to return — all data is shop-scoped.
  return new Response(null, { status: 200 });
};
