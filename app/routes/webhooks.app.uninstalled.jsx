import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session } = await authenticate.webhook(request);

  // Delete Shopify session tokens from Prisma
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Delete all shop data from Supabase (RGPD / data isolation).
  // Purge IMMÉDIATE de toute donnée marchand scopée par shop_domain.
  // Liste exhaustive — doit rester identique à celle de shop/redact (webhooks.compliance.jsx).
  await Promise.allSettled([
    supabase.from("calculation_annotations").delete().eq("shop_domain", shop),
    supabase.from("calculations").delete().eq("shop_domain", shop),
    supabase.from("usage").delete().eq("shop_domain", shop),
    supabase.from("margin_alerts").delete().eq("shop_domain", shop),
    supabase.from("rate_limits").delete().eq("shop_domain", shop),
    supabase.from("product_profitability_state").delete().eq("shop_domain", shop),
    supabase.from("subscription_dunning_state").delete().eq("shop_domain", shop),
    supabase.from("variant_costs").delete().eq("shop_domain", shop),
    supabase.from("order_margins").delete().eq("shop_domain", shop),
    supabase.from("order_sync_state").delete().eq("shop_domain", shop),
    supabase.from("shop_plans").delete().eq("shop_domain", shop),
  ]);

  return new Response();
};
