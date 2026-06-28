import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import db from "../db.server";

// Unified RGPD compliance webhook handler.
// authenticate.webhook verifies the Shopify HMAC signature and throws a 401
// Response if invalid — no manual verification needed.
export const action = async ({ request }) => {
  const { topic, payload } = await authenticate.webhook(request);

  const shop = payload?.shop_domain;

  if (topic === "customers/data_request") {
    console.info("[RGPD] customers/data_request", { shop, customerId: payload?.customer?.id });
    return new Response(null, { status: 200 });
  }

  if (topic === "customers/redact") {
    console.info("[RGPD] customers/redact", { shop, customerId: payload?.customer?.id });
    return new Response(null, { status: 200 });
  }

  if (topic === "shop/redact") {
    if (!shop) return new Response(null, { status: 200 });
    console.info("[RGPD] shop/redact", { shop });
    // Liste exhaustive — doit rester identique à celle de app/uninstalled.
    // shop/redact est le signal de purge officiel Shopify (~48h) : il sert aussi de
    // filet si app/uninstalled a échoué (webhook perdu).
    await Promise.allSettled([
      supabase.from("calculation_annotations").delete().eq("shop_domain", shop),
      supabase.from("calculations").delete().eq("shop_domain", shop),
      supabase.from("usage").delete().eq("shop_domain", shop),
      supabase.from("margin_alerts").delete().eq("shop_domain", shop),
      supabase.from("rate_limits").delete().eq("shop_domain", shop),
      supabase.from("product_profitability_state").delete().eq("shop_domain", shop),
      supabase.from("variant_costs").delete().eq("shop_domain", shop),
      supabase.from("order_margins").delete().eq("shop_domain", shop),
      supabase.from("order_sync_state").delete().eq("shop_domain", shop),
      supabase.from("shop_plans").delete().eq("shop_domain", shop),
      // Filet : nettoie la session morte si app/uninstalled ne l'a pas fait.
      db.session.deleteMany({ where: { shop } }),
    ]);
    return new Response(null, { status: 200 });
  }

  return new Response(null, { status: 200 });
};
