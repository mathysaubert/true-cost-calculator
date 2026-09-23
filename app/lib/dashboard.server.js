// ── Tableau de bord — lectures Supabase → moteur (F4-A) ─────────────────────────────────────
// Aucun calcul ici : on lit les faits F1/F2, on les adapte (econ/adapters.js) et on appelle
// aggregate() pour la période courante ET la précédente. Un seul appel Admin GraphQL possible, une
// fois par boutique : shop.plan.partnerDevelopment (C6), mémorisé dans shop_settings.is_dev_shop.
import { aggregate } from "./econ/aggregate.js";
import { linesFromOrderMarginsRows, ordersForEngine, applyOrderDiscounts } from "./econ/adapters.js";
import { dashboardWindows, buildKpis, buildNotes, buildGaps, DASHBOARD_LINES_CAP } from "./dashboard.js";

const DEV_SHOP_QUERY = `{ shop { plan { partnerDevelopment } } }`;
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const rows = ({ data, error }, label) => { if (error) throw new Error(`dashboard (${label}) : ${error.message}`); return data ?? []; };

// Réglages boutique + détection « boutique de développement » (lue une fois, mémorisée si la
// colonne existe ; sinon la valeur reste en mémoire pour cette requête et l'écran l'affiche quand même).
export async function loadDashboardSettings({ supabase, shop, admin = null }) {
  const { data } = await supabase.from("shop_settings").select("*").eq("shop_domain", shop).maybeSingle();
  const settings = data ?? { shop_domain: shop };
  let isDevShop = settings.is_dev_shop ?? null;
  let devShopSource = isDevShop == null ? "unknown" : "stored";
  if (isDevShop == null && admin) {
    try {
      const j = await (await admin.graphql(DEV_SHOP_QUERY)).json();
      const v = j?.data?.shop?.plan?.partnerDevelopment;
      if (typeof v === "boolean") {
        isDevShop = v; devShopSource = "live";
        const { error } = await supabase.from("shop_settings").upsert({ shop_domain: shop, is_dev_shop: v }, { onConflict: "shop_domain" });
        if (error) console.warn(`[Dashboard] is_dev_shop non mémorisé (${error.message}) : migration F4-01 appliquée ?`);
      }
    } catch (e) { console.error(`[Dashboard] plan query ${shop} :`, e?.message); }
  }
  const includeTestOrders = isDevShop === true && settings.include_test_orders === true;
  return { settings, isDevShop, devShopSource, includeTestOrders };
}

// Bascule C6 : autorisée UNIQUEMENT si la boutique est une boutique de développement.
export async function setIncludeTestOrders({ supabase, shop, value }) {
  const { data } = await supabase.from("shop_settings").select("is_dev_shop").eq("shop_domain", shop).maybeSingle();
  if (data?.is_dev_shop !== true) return { ok: false, error: "not_dev_shop" };
  const { error } = await supabase.from("shop_settings").update({ include_test_orders: value === true, updated_at: new Date().toISOString() }).eq("shop_domain", shop);
  if (error) return { ok: false, error: error.message };
  return { ok: true, include_test_orders: value === true };
}

// Lecture des faits sur [previous.start, current.end] puis agrégation des deux fenêtres.
export async function loadDashboard({ supabase, shop, admin = null, days, now = new Date(), hasAllOrders = false }) {
  const { settings, isDevShop, devShopSource, includeTestOrders } = await loadDashboardSettings({ supabase, shop, admin });
  const timeZone = settings.shop_timezone || "UTC";
  const win = dashboardWindows({ now, timeZone, days });
  const from = win.previous.start, to = win.current.end;

  const [ordersRows, lineRows, legacyCount, refunds, returns, fulfillments, fixedCosts, codeRules, manualCommissions, variantCosts, adSpend, sessions, customers, lastJob, firstOrder, invLast] = await Promise.all([
    rows(await supabase.from("orders").select("*").eq("shop_domain", shop).gte("day_local", from).lte("day_local", to).order("day_local", { ascending: false }).limit(DASHBOARD_LINES_CAP + 1), "orders"),
    rows(await supabase.from("order_margins").select("order_id, line_item_id, product_id, variant_id, quantity, refunded_qty, effective_qty, unit_price_ht, tax_lines, is_gift_card, cm1_components, cm1_unit, cm2_alloc, breakdown_version, cost_source, currency_code, day_local")
      .eq("shop_domain", shop).not("breakdown_version", "is", null).gte("day_local", from).lte("day_local", to).order("day_local", { ascending: false }).limit(DASHBOARD_LINES_CAP + 1), "lines"),
    (async () => { const { count, error } = await supabase.from("order_margins").select("id", { count: "exact", head: true }).eq("shop_domain", shop).is("breakdown_version", null).gte("order_created_at", `${from}T00:00:00Z`).lte("order_created_at", `${to}T23:59:59Z`); if (error) throw new Error(`dashboard (legacy) : ${error.message}`); return count ?? 0; })(),
    rows(await supabase.from("refunds").select("refund_id, order_id, shipping_refunded, settled, line_items").eq("shop_domain", shop).gte("day_local", from), "refunds"),
    rows(await supabase.from("returns").select("return_id, order_id, status, line_items").eq("shop_domain", shop).gte("day_local", from), "returns"),
    rows(await supabase.from("fulfillments").select("fulfillment_id, order_id, created_at, delivered_at, promised_at").eq("shop_domain", shop).gte("day_local", from), "fulfillments"),
    rows(await supabase.from("fixed_costs").select("amount_monthly, active_from, active_to").eq("shop_domain", shop), "fixed_costs"),
    rows(await supabase.from("promo_code_rules").select("code, partner_id, commission_pct, commission_base, active_from, active_to").eq("shop_domain", shop), "promo_code_rules"),
    rows(await supabase.from("manual_commissions").select("period_month, amount").eq("shop_domain", shop), "manual_commissions"),
    rows(await supabase.from("variant_costs").select("variant_id, supplier_lead_days, buffer_days, prix_achat").eq("shop_domain", shop), "variant_costs"),
    rows(await supabase.from("ad_spend").select("day_local, platform, spend, spend_shop_currency, platform_revenue, platform_orders").eq("shop_domain", shop).gte("day_local", from).lte("day_local", to), "ad_spend"),
    rows(await supabase.from("sessions_daily").select("day_local, source, device, sessions, atc_sessions, checkout_sessions, purchase_sessions").eq("shop_domain", shop).gte("day_local", from).lte("day_local", to), "sessions"),
    rows(await supabase.from("customers_agg").select("customer_id, cohort_month, first_order_at, second_order_at, orders_count, cm2_total").eq("shop_domain", shop).limit(DASHBOARD_LINES_CAP), "customers"),
    (async () => { const { data } = await supabase.from("sync_jobs").select("kind, finished_at, window_end").eq("shop_domain", shop).eq("status", "completed").order("finished_at", { ascending: false }).limit(1).maybeSingle(); return data ?? null; })(),
    (async () => { const { data } = await supabase.from("orders").select("day_local").eq("shop_domain", shop).order("day_local", { ascending: true }).limit(1).maybeSingle(); return data?.day_local ?? null; })(),
    (async () => { const { data } = await supabase.from("inventory_daily").select("day_local").eq("shop_domain", shop).order("day_local", { ascending: false }).limit(1).maybeSingle(); return data?.day_local ?? null; })(),
  ]);
  const inventory = invLast ? rows(await supabase.from("inventory_daily").select("variant_id, product_id, available, tracked, cost_per_unit, day_local").eq("shop_domain", shop).eq("day_local", invLast).limit(1000), "inventory") : [];

  const capped = lineRows.length > DASHBOARD_LINES_CAP || ordersRows.length > DASHBOARD_LINES_CAP;
  const lineSlice = lineRows.slice(0, DASHBOARD_LINES_CAP);
  const orderSlice = ordersRows.slice(0, DASHBOARD_LINES_CAP);
  const orderIds = orderSlice.map((o) => o.order_id);
  let fees = [];
  for (const ids of chunk(orderIds, 200)) fees.push(...rows(await supabase.from("order_fees").select("order_id, fee_amount, source, confirmed").eq("shop_domain", shop).in("order_id", ids), "order_fees"));

  const { lines, legacy: legacyInSlice } = linesFromOrderMarginsRows(lineSlice);
  const { orders, excluded, reincluded } = ordersForEngine(orderSlice, { refunds, includeTestOrders });
  const vcMap = new Map(variantCosts.map((v) => [v.variant_id, v]));
  const base = { orders, lines, fees, returns, fulfillments, adSpend, codeRules, manualCommissions, fixedCosts, sessions, inventory, variantCosts: vcMap, customers, settings, now };
  const current = applyOrderDiscounts(aggregate({ ...base, window: win.current }), orders, win.current);
  const previous = applyOrderDiscounts(aggregate({ ...base, window: win.previous }), orders, win.previous);

  const inWin = (o) => o.day_local >= win.current.start && o.day_local <= win.current.end;
  const excludedCurrent = { test: 0, draft: 0, cancelled: 0, gift_card_only: 0, b2b: 0 };
  for (const o of orders) if (o.excluded_reason && inWin(o)) excludedCurrent[o.excluded_reason] = (excludedCurrent[o.excluded_reason] ?? 0) + 1;

  return {
    days, windows: win, timeZone, currency: settings.shop_currency ?? current.currency ?? null,
    isDevShop, devShopSource, includeTestOrders, reincluded,
    kpis: buildKpis({ current, previous }),
    notes: buildNotes(current),
    gaps: buildGaps({ agg: current, legacyLines: legacyCount + legacyInSlice, capped, excluded: excludedCurrent }),
    excluded, excludedCurrent,
    ordersInPeriod: current.shop.leaves.orders, mixedCurrency: current.currency === "MIXED",
    lastSync: lastJob?.finished_at ?? null, historySince: firstOrder, hasAllOrders,
  };
}
