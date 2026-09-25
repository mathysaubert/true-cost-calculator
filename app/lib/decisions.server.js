// ── Mémoire des décisions (I0-C) — écritures Supabase, jamais bloquantes pour la page ──────────
// recordShownInsights : appelé en arrière-plan par le loader de « Aujourd'hui » (D7a : priorités et
// opportunité affichées) ; détecte aussi les règles de données corrigées (decision_log data_fixed).
// recordDecision : une ligne decision_log validée par le module pur.
import { insightLogRows, resolvedDataRules, dataFixedDecision, decisionRow } from "./decisions.js";

const DATA_RULES = ["cost_coverage", "fees_unconfirmed", "no_ad_source"];

export async function recordShownInsights({ supabase, shop, briefing, window, currency = null, confidence = null }) {
  const out = { recorded: 0, resolved: 0 };
  if (!supabase || !shop || !briefing) return out;
  const rows = insightLogRows({ briefing, window, currency, confidenceScore: confidence?.score ?? null });
  if (rows.length) {
    const { error } = await supabase.rpc("record_insights", { p_shop: shop, p_rows: rows });
    if (error) { console.warn(`[Decisions] record_insights KO (${error.message}) : migration I0-01 appliquée ?`); return out; }
    out.recorded = rows.length;
  }
  // Règles de données montrées puis disparues → corrigées.
  const { data: open, error: e2 } = await supabase.from("insight_log").select("rule_id, fingerprint, payload")
    .eq("shop_domain", shop).eq("subject_kind", "shop").in("rule_id", DATA_RULES).is("resolved_at", null);
  if (e2) { console.warn(`[Decisions] lecture insight_log KO : ${e2.message}`); return out; }
  const resolved = resolvedDataRules({ open: open ?? [], insights: briefing.insights ?? [] });
  for (const r of resolved) {
    const row = dataFixedDecision({ shop, resolved: r, scoreAfter: confidence?.score ?? null });
    const { error: e3 } = await supabase.from("decision_log").insert(row);
    if (e3) { console.warn(`[Decisions] decision_log data_fixed KO : ${e3.message}`); continue; }
    await supabase.from("insight_log").update({ resolved_at: new Date().toISOString() }).eq("shop_domain", shop).in("fingerprint", r.fingerprints);
    out.resolved++;
  }
  return out;
}

export async function recordDecision({ supabase, shop, ...rest }) {
  const row = decisionRow({ shop, ...rest });
  const { data, error } = await supabase.from("decision_log").insert(row).select("id, kind, decided_at").maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, ...data };
}

// ── S2c : résultat observé à J+30 (W4a, W5) — une fois par décision, en arrière-plan ─────────────
import { loadOverview } from "./overview.server.js";
import { reviewWindow, observedImpact, dueForReview } from "./simulator/observed.js";

export async function reviewDueDecisions({ supabase, shop, admin = null, now = new Date(), limit = 5 }) {
  const out = { reviewed: 0, unobservable: 0 };
  if (!supabase || !shop) return out;
  const { data, error } = await supabase.from("decision_log").select("id, kind, review_at, observed_at, horizon_days, scenario, decided_at").eq("shop_domain", shop).eq("kind", "simulated").is("observed_at", null).lte("review_at", now.toISOString()).order("review_at", { ascending: true }).limit(limit);
  if (error) { console.warn(`[Decisions] revue KO : ${error.message}`); return out; }
  for (const d of dueForReview(data ?? [], now)) {
    try {
      const w = reviewWindow(d);
      const productId = d.scenario?.product_id ?? null;
      const view = await loadOverview({ supabase, shop, admin, days: w.days, now: w.now, withBriefing: false, observeProduct: productId });
      // S3 : une décision produit est observée sur ce produit seul, jamais sur toute la boutique.
      const src = productId ? { afterNodes: view.productObs?.after ?? {}, beforeNodes: view.productObs?.before ?? {}, beforeOrders: view.productObs?.beforeOrders ?? 0 } : { afterNodes: view.waterfall?.nodes ?? {}, beforeNodes: view.previousNodes ?? {}, beforeOrders: view.previousOrders ?? 0 };
      const obs = observedImpact({ ...src, node: d.scenario?.node ?? "cm2" });
      const { error: e2 } = await supabase.from("decision_log").update({ observed_impact: obs.value, observed_at: now.toISOString(), note: obs.reason ? `observed:${obs.reason}` : null }).eq("shop_domain", shop).eq("id", d.id);
      if (e2) { console.warn(`[Decisions] observé KO : ${e2.message}`); continue; }
      if (obs.value == null) out.unobservable++; else out.reviewed++;
    } catch (e) { console.warn(`[Decisions] revue ${d.id} : ${e?.message}`); }
  }
  return out;
}
