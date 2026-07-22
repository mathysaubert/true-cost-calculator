// ── Recalcul des marges historiques — ORCHESTRATION SERVEUR (Brique 2) ──────────────────────
// Branche les décisions PURES (recalcMargins.js) dans une opération I/O qui corrige les marges
// figées sur des coûts ESTIMÉS/MANQUANTS : supprime les lignes recalculables, re-synchronise
// (recrée avec les coûts ACTUELS), re-baseline product_profitability_state, résume au marchand.
//
// ⚠ AUCUN EMAIL. Le re-baseline écrit product_profitability_state par un upsert DIRECT (comme
// writeStates du cron), JAMAIS via runForShop : ce module n'importe pas email.server.js et
// n'appelle ni sendLossAlert ni la branche `basculements`. De plus l'état écrit ≡ ce que le
// prochain cron recalculera (même lecture, même agrégat, même seuil) ⇒ zéro fausse transition.
//
// PROTECTION SANS TRANSACTION (le bulk Shopify poll ~25s → impossible en BEGIN/COMMIT) :
//   capture → DELETE → syncShopOrders → réconcilie-restaure → re-baseline → résumé.
// Toute ligne supprimée est soit recréée par le sync (même fenêtre created_at), soit restaurée
// À L'IDENTIQUE (réconciliation). Les lignes confirmed/imported ne sont JAMAIS visées. Zéro perte.
//
// engine.js intouché ; le sync est syncShopOrders (= bouton = cron), aucune logique dupliquée.
import { syncShopOrders } from "./orderSync.server.js";
import { aggregateOrderMargins } from "./orderHistory.js";
import { computeProfitabilityChanges } from "./profitabilityAlert.js";
import { selectDeletableLines, touchedProductIds, lineKey, missingLines, buildRecalcSummary } from "./recalcMargins.js";

// ≡ monitor & cron (api.cron.profitability.jsx) : l'état re-baseliné doit refléter EXACTEMENT ce
// que le cron relira (mêmes lignes, même ordre, même cap) sinon fausse transition au prochain run.
const ORDER_MARGINS_CAP = 5000;
const WINDOW_DAYS = 30;

const readMargins = (supabase, shop) => supabase.from("order_margins").select("*")
  .eq("shop_domain", shop).order("order_created_at", { ascending: false }).limit(ORDER_MARGINS_CAP);

// Titres produits pour nommer les « passés à perte » — best-effort (comme le cron). Échec → repli gid.
async function resolveTitles(admin, productIds) {
  if (!productIds.length) return new Map();
  try {
    const resp = await admin.graphql(
      `query Titles($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id title } } }`,
      { variables: { ids: productIds } });
    const j = await resp.json();
    return new Map((j.data?.nodes ?? []).filter(Boolean).map((n) => [n.id, n.title]));
  } catch (e) { console.error("[Recalc] titres:", e?.message); return new Map(); }
}

// byProduct → forme buildRecalcSummary, restreint aux produits touchés (name résolu, sinon repli interne).
const toSummaryProduits = (byProduct, touched, titles) => byProduct
  .filter((p) => touched.has(p.product_id))
  .map((p) => ({ product_id: p.product_id, name: titles.get(p.product_id), net_margin: p.net_margin }));

// Entrées : { admin } (Admin GraphQL online OU offline), supabase (service role), shop, now injecté
// (déterminisme/tests). Sortie : { success, lignesRecalculees, produitsPassesAPerte, resume, ... }.
export async function recalcEstimatedMargins({ admin, supabase, shop, now = new Date() }) {
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();

  // 1. AVANT — lecture unique : capture des lignes supprimables + agrégat complet (baseline résumé).
  const { data: rowsBefore, error: eRead } = await readMargins(supabase, shop);
  if (eRead) return { success: false, error: `Lecture order_margins : ${eRead.message}` };
  const captured = selectDeletableLines(rowsBefore ?? [], now, { windowDays: WINDOW_DAYS }); // lignes complètes
  if (captured.length === 0) {
    return { success: true, lignesRecalculees: 0, produitsTouches: 0, produitsPassesAPerte: [], resume: "", restored: 0, message: "Aucune ligne recalculable dans la fenêtre." };
  }
  const touched = touchedProductIds(captured);
  const aggAvant = aggregateOrderMargins(rowsBefore ?? []);

  // 2. DELETE — recalculables (estimated|missing) ∈ fenêtre sync (order_created_at). confirmed/imported jamais visées.
  const del = await supabase.from("order_margins").delete({ count: "exact" })
    .eq("shop_domain", shop).in("cost_source", ["estimated", "missing"]).gte("order_created_at", cutoffIso);
  if (del.error) return { success: false, error: `DELETE order_margins : ${del.error.message}` };

  // 3. SYNC — recrée les lignes supprimées avec les coûts ACTUELS ; DO NOTHING sur les survivantes (idempotent).
  let sync;
  try { sync = await syncShopOrders({ admin, supabase, shop }); }
  catch (e) { sync = { success: false, error: e?.message ?? "exception" }; }

  // 4. RÉCONCILIE-RESTAURE — toute ligne capturée non recréée est restaurée À L'IDENTIQUE.
  //    Sync KO ⇒ rien recréé ⇒ restauration complète = rollback ; sync OK ⇒ seuls les traînards hors fenêtre.
  const { data: rowsAfterSync } = await readMargins(supabase, shop);
  const toRestore = missingLines(captured, new Set((rowsAfterSync ?? []).map(lineKey)));
  if (toRestore.length) {
    // ignoreDuplicates : ne réécrit jamais une ligne déjà recréée (snapshot figé préservé), remplit juste les absentes.
    const res = await supabase.from("order_margins")
      .upsert(toRestore, { onConflict: "shop_domain,order_id,line_item_id", ignoreDuplicates: true });
    if (res.error) console.error("[Recalc] restauration :", res.error.message);
  }
  if (!sync?.success) {
    return { success: false, error: `Synchronisation échouée (${sync?.error ?? "?"}) — lignes restaurées, aucune perte.`, restored: toRestore.length };
  }

  // 5. APRÈS — état FINAL (post-restauration si des traînards ont été restaurés, sinon la lecture post-sync suffit).
  const rowsFinal = toRestore.length ? ((await readMargins(supabase, shop)).data ?? []) : (rowsAfterSync ?? []);
  const aggApres = aggregateOrderMargins(rowsFinal);

  // 6. RE-BASELINE MUET — état courant réécrit SANS chemin d'email, sur l'agrégat COMPLET par produit.
  //    prevMap VIDE ⇒ tout ressort en `seeds` (état courant, aucun `basculement`) ⇒ aucune alerte possible.
  //    Même seuil que le cron ⇒ état stocké ≡ état que le prochain cron recalculera ⇒ zéro fausse transition.
  const { data: planRow } = await supabase.from("shop_plans")
    .select("profitability_threshold_pct").eq("shop_domain", shop).maybeSingle();
  const thresholdPct = planRow?.profitability_threshold_pct ?? 0;
  const { seeds } = computeProfitabilityChanges(aggApres.byProduct, new Map(), thresholdPct);
  const stateRows = seeds.filter((e) => touched.has(e.product_id)).map((e) => ({
    shop_domain: shop, product_id: e.product_id, last_state: e.state,
    last_margin: e.margin, currency_code: e.currency ?? null, last_checked_at: nowIso,
  }));
  if (stateRows.length) {
    const wr = await supabase.from("product_profitability_state").upsert(stateRows, { onConflict: "shop_domain,product_id" });
    if (wr.error) console.error("[Recalc] re-baseline :", wr.error.message);
  }

  // 7. RÉSUMÉ — « PASSÉ À PERTE » uniquement (jamais de bonne nouvelle sur des coûts fictifs, cf. Phase 0).
  const titles = await resolveTitles(admin, [...touched]);
  const summary = buildRecalcSummary(
    { lignes: captured.length, produits: toSummaryProduits(aggAvant.byProduct, touched, titles) },
    { lignes: captured.length, produits: toSummaryProduits(aggApres.byProduct, touched, titles) },
  );
  return {
    success: true,
    lignesRecalculees: summary.lignesRecalculees,
    produitsTouches: touched.size,
    produitsPassesAPerte: summary.produitsPassesAPerte,
    resume: summary.resume.passesAPerte,
    restored: toRestore.length,
    ingested: sync.ingested ?? 0,
  };
}
