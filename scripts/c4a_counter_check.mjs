// Vérif C4a : le compteur usage.orders_count sur-compte-t-il les re-syncs ?
// LECTURE SEULE (aucune écriture). Usage : node --env-file=.env scripts/c4a_counter_check.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY manquants dans l'env."); process.exit(1); }

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const month = new Date().toISOString().slice(0, 7);

const { data, error } = await supabase
  .from("usage")
  .select("shop_domain, month, orders_count, updated_at")
  .eq("month", month)
  .order("updated_at", { ascending: false });

if (error) {
  if (/orders_count/i.test(error.message) || error.code === "42703") {
    console.error("❌ Colonne usage.orders_count INEXISTANTE → migration 20260716_usage_orders_count.sql PAS appliquée.");
    console.error("   (Le compteur C4a est non-fatal : il n'a donc rien compté jusqu'ici.) Applique la migration d'abord.");
  } else {
    console.error("❌ Erreur lecture usage:", error.message, error.code ?? "");
  }
  process.exit(2);
}

console.log(`\n=== usage.orders_count — mois ${month} — lu à ${new Date().toISOString()} ===`);
if (!data || data.length === 0) {
  console.log("  (aucune ligne 'usage' pour ce mois — aucun sync n'a encore incrémenté)");
} else {
  for (const r of data) {
    console.log(`  ${String(r.shop_domain).padEnd(42)} orders_count=${String(r.orders_count).padStart(5)}   maj=${r.updated_at}`);
  }
}
console.log("");
