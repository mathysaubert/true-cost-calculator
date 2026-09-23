import { authenticate } from "../shopify.server";
import db from "../db.server";
import { supabase } from "../supabase.server";
import { planBackfill } from "../lib/sync/jobs.server.js";
import { scopeHasAllOrders } from "../lib/sync/windows.js";

export const action = async ({ request }) => {
  const { payload, session, shop } = await authenticate.webhook(request);

  const current = payload.current;

  if (session) {
    await db.session.update({
      where: {
        id: session.id,
      },
      data: {
        scope: current.toString(),
      },
    });
  }

  // F2 (B1) : read_all_orders accordé → les fenêtres mensuelles manquantes (jusqu'à history_months)
  // sont créées ici ; le cron de sync les exécute. Repli : le cron replanifie chaque jour.
  if (shop && scopeHasAllOrders(Array.isArray(current) ? current.join(",") : String(current ?? ""))) {
    try {
      const { data } = await supabase.from("shop_settings").select("history_months").eq("shop_domain", shop).maybeSingle();
      await planBackfill({ supabase, shop, hasAllOrders: true, historyMonths: data?.history_months ?? 24 });
    } catch (e) { console.error(`[Sync] plan backfill ${shop} :`, e?.message); }
  }

  return new Response();
};
