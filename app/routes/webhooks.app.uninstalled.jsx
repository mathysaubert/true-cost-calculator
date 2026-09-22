import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import db from "../db.server";
import { PURGE_TABLES } from "../lib/schema.js";

export const action = async ({ request }) => {
  const { shop, session } = await authenticate.webhook(request);

  // Delete Shopify session tokens from Prisma
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Purge IMMÉDIATE de toute donnée marchand scopée par shop_domain (RGPD / isolation) — purge
  // totale (décision g). Source de vérité = la fonction SQL purge_shop (F1-23) ; si la RPC est
  // absente (migration pas encore appliquée) ou échoue, repli table par table sur la liste partagée
  // app/lib/schema.js — le lot23 vérifie que les deux listes coïncident.
  const { error } = await supabase.rpc("purge_shop", { p_shop: shop });
  if (error) {
    console.error("[Uninstall] purge_shop RPC KO, repli table par table :", error.message);
    await Promise.allSettled(PURGE_TABLES.map((t) => supabase.from(t).delete().eq("shop_domain", shop)));
  }

  return new Response();
};
