import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// Mandatory Shopify RGPD webhook: delete all shop data 48 hours after uninstall.
// Fired by Shopify as a second-pass guarantee after app/uninstalled.
export const action = async ({ request }) => {
  const { payload } = await authenticate.webhook(request);

  const shop = payload?.shop_domain;
  if (!shop) return new Response(null, { status: 200 });

  console.info("[RGPD] shop/redact", { shop });

  await Promise.allSettled([
    supabase.from("calculation_annotations").delete().eq("shop_domain", shop),
    supabase.from("calculations").delete().eq("shop_domain", shop),
    supabase.from("usage").delete().eq("shop_domain", shop),
    supabase.from("margin_alerts").delete().eq("shop_domain", shop),
    supabase.from("rate_limits").delete().eq("shop_domain", shop),
  ]);

  return new Response(null, { status: 200 });
};
