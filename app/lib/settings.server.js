// ── Réglages (R1) — lectures / écritures Supabase ─────────────────────────────────────────────
// Écrit shop_settings (source de vérité, S1) et recopie les colonnes historiques vers shop_plans ;
// le trigger R0-02 relit des valeurs identiques et ne réécrit rien. Chaque sauvegarde qui touche
// une règle de fiabilité laisse une trace decision_log data_fixed (S10), une par règle et par jour.
import { mirrorFor, mergeGatewayRule, gatewaysFromOrders } from "./settings.js";
import { decisionRow } from "./decisions.js";
import { dayInTimeZone } from "./overview.js";

const DAY_MS = 86_400_000;
const now = () => new Date().toISOString();

export async function loadSettings({ supabase, shop, gatewayDays = 90 }) {
  const [{ data: row }, { data: fixed }, { data: orders }] = await Promise.all([
    supabase.from("shop_settings").select("*").eq("shop_domain", shop).maybeSingle(),
    supabase.from("fixed_costs").select("id, label, amount_monthly, currency_code, active_from, active_to").eq("shop_domain", shop).order("created_at", { ascending: true }),
    supabase.from("orders").select("gateway_names").eq("shop_domain", shop).gte("day_local", new Date(Date.now() - gatewayDays * DAY_MS).toISOString().slice(0, 10)).limit(2000),
  ]);
  const settings = row ?? { shop_domain: shop };
  return { settings, fixedCosts: fixed ?? [], gateways: gatewaysFromOrders(orders ?? []), today: dayInTimeZone(new Date(), settings.shop_timezone || "UTC") };
}

// Écriture de colonnes scalaires + recopie vers shop_plans (S1a). Erreur → { ok:false } jamais lancée.
export async function saveSettings({ supabase, shop, values = {} }) {
  if (!Object.keys(values).length) return { ok: true, saved: 0 };
  const { error } = await supabase.from("shop_settings").upsert({ shop_domain: shop, ...values, updated_at: now() }, { onConflict: "shop_domain" });
  if (error) return { ok: false, error: error.message };
  const mirror = mirrorFor(values);
  if (Object.keys(mirror).length) {
    const { error: e2 } = await supabase.from("shop_plans").upsert({ shop_domain: shop, ...mirror, updated_at: now() }, { onConflict: "shop_domain" });
    if (e2) console.warn(`[Settings] recopie shop_plans KO : ${e2.message}`);
  }
  return { ok: true, saved: Object.keys(values).length };
}

export async function saveGatewayRule({ supabase, shop, rule }) {
  const { data } = await supabase.from("shop_settings").select("gateway_fee_rules").eq("shop_domain", shop).maybeSingle();
  const rules = mergeGatewayRule(data?.gateway_fee_rules ?? [], rule);
  return saveSettings({ supabase, shop, values: { gateway_fee_rules: rules } });
}

export async function saveShippingRules({ supabase, shop, rules }) {
  return saveSettings({ supabase, shop, values: { shipping_cost_rules: rules } });
}

export async function addFixedCost({ supabase, shop, row, currency = null }) {
  const { error } = await supabase.from("fixed_costs").insert({ shop_domain: shop, currency_code: currency, ...row });
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function endFixedCost({ supabase, shop, id, day }) {
  const { error } = await supabase.from("fixed_costs").update({ active_to: day, updated_at: now() }).eq("shop_domain", shop).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function deleteFixedCost({ supabase, shop, id }) {
  const { error } = await supabase.from("fixed_costs").delete().eq("shop_domain", shop).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// S10 : trace explicite « donnée corrigée », dédoublonnée par règle et par jour. Jamais bloquante.
export async function recordSettingsFix({ supabase, shop, rule, field, day }) {
  if (!rule) return { recorded: false };
  try {
    const since = `${day}T00:00:00Z`;
    const { data: existing } = await supabase.from("decision_log").select("id").eq("shop_domain", shop).eq("kind", "data_fixed").gte("decided_at", since).eq("scenario->>rule_id", rule).eq("scenario->>source", "settings").limit(1);
    if (existing?.length) return { recorded: false, duplicate: true };
    const row = decisionRow({ shop, kind: "data_fixed", scenario: { rule_id: rule, field, source: "settings" } });
    const { error } = await supabase.from("decision_log").insert(row);
    if (error) { console.warn(`[Settings] decision_log data_fixed KO : ${error.message}`); return { recorded: false }; }
    return { recorded: true };
  } catch (e) { console.warn(`[Settings] decision_log : ${e?.message}`); return { recorded: false }; }
}
