import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import db from "../db.server";
import { PURGE_TABLES } from "../lib/schema.js";

// Unified RGPD compliance webhook handler.
// authenticate.webhook verifies the Shopify HMAC signature and throws a 401
// Response if invalid — no manual verification needed.
export const action = async ({ request }) => {
  const { topic, payload } = await authenticate.webhook(request);

  const shop = payload?.shop_domain;

  if (topic === "customers/data_request") {
    // V1 : demande traitée manuellement (export des lignes orders/customers_agg du client) — journalisée.
    console.info("[RGPD] customers/data_request", { shop, customerId: payload?.customer?.id });
    return new Response(null, { status: 200 });
  }

  if (topic === "customers/redact") {
    console.info("[RGPD] customers/redact", { shop, customerId: payload?.customer?.id });
    // Le client disparaît des agrégats, ses commandes perdent son identifiant (F1-23, gid brut).
    if (shop && payload?.customer?.id != null) {
      const { error } = await supabase.rpc("redact_customer", {
        p_shop: shop,
        p_customer_id: `gid://shopify/Customer/${payload.customer.id}`,
      });
      if (error) console.error("[RGPD] redact_customer RPC KO :", error.message);
    }
    return new Response(null, { status: 200 });
  }

  if (topic === "shop/redact") {
    if (!shop) return new Response(null, { status: 200 });
    console.info("[RGPD] shop/redact", { shop });
    // shop/redact est le signal de purge officiel Shopify (~48h) : il sert aussi de filet si
    // app/uninstalled a échoué (webhook perdu). Même source de vérité que l'uninstall : la fonction
    // SQL purge_shop (F1-23), repli sur la liste partagée app/lib/schema.js si la RPC est absente.
    const { error } = await supabase.rpc("purge_shop", { p_shop: shop });
    if (error) {
      console.error("[RGPD] purge_shop RPC KO, repli table par table :", error.message);
      await Promise.allSettled(PURGE_TABLES.map((t) => supabase.from(t).delete().eq("shop_domain", shop)));
    }
    // Filet : nettoie la session morte si app/uninstalled ne l'a pas fait.
    await db.session.deleteMany({ where: { shop } }).catch((e) => console.error("[RGPD] session cleanup :", e?.message));
    return new Response(null, { status: 200 });
  }

  return new Response(null, { status: 200 });
};
