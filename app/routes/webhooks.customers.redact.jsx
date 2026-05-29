import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// Mandatory Shopify RGPD webhook: delete customer data within 30 days.
// This app stores no PII linked to individual customers — data is indexed
// by shop_domain only. Log the request for compliance records.
export const action = async ({ request }) => {
  const { payload } = await authenticate.webhook(request);

  const shopDomain = payload?.shop_domain ?? "unknown";
  const customerId = payload?.customer?.id ?? "unknown";
  console.info("[RGPD] customers/redact", { shopDomain, customerId });

  // No customer-level PII stored — calculations are shop-scoped only.
  // No rows to delete, but Shopify requires a 200 response within 5 s.
  void supabase; // import kept for future use

  return new Response(null, { status: 200 });
};
