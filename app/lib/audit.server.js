// ── D1c — Audit catalogue Expert (section Produits) ──────────────────────────────────────────────
// Même balayage que l'écran classique (produits actifs, première variante, 10 pages de 50, budget
// de 7 s) et même catégorie douanière effective (resolveAuditCategory). Le calcul passe au modèle
// CM2 : marge unitaire au prix catalogue par unitEconomics (S3), réglages confirmés de shop_settings,
// coût marchand prioritaire sur le coût Shopify. Lecture seule : rien n'est écrit.
import { shopifyTypeToCategory } from "./variantCosts.js";
import { resolveAuditCategory } from "./customsClassification.js";
import { unitEconomics } from "./simulator/newProduct.js";
import { auditInputs, auditAssumptions } from "./products.js";

const AUDIT_QUERY = `query AuditProducts($cursor: String) {
  shop { taxesIncluded }
  products(first: 50, after: $cursor, query: "status:active") {
    edges { node { id title productType category { name }
      variants(first: 1) { edges { node { id price inventoryItem { unitCost { amount } } } } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;
const MAX_PAGES = 10, BUDGET_MS = 7000;

export async function runCatalogAudit({ admin, supabase, shop, returnRatePct = null, now = new Date() }) {
  const started = Date.now();
  const products = [];
  let cursor = null, hasNext = true, pages = 0, taxesIncluded = true, incomplete = false;
  while (hasNext && pages < MAX_PAGES) {
    if (Date.now() - started > BUDGET_MS) { incomplete = true; console.error("[Audit] time budget exceeded after", pages, "pages"); break; }
    pages++;
    try {
      const json = await (await admin.graphql(AUDIT_QUERY, { variables: { cursor } })).json();
      const page = json.data?.products;
      if (!page) break;
      if (json.data?.shop?.taxesIncluded === false) taxesIncluded = false;
      products.push(...page.edges.map((e) => e.node));
      hasNext = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
    } catch (e) { console.error("[Audit] GraphQL error:", e?.message); incomplete = true; break; }
  }
  if (hasNext && pages >= MAX_PAGES) incomplete = true;

  const [{ data: settings }, { data: vcRows }] = await Promise.all([
    supabase.from("shop_settings").select("*").eq("shop_domain", shop).maybeSingle(),
    supabase.from("variant_costs").select("variant_id, source, prix_achat, port_entrant, qty_par_lot, vat_regime, shipping_model, categorie, customs_confirmed").eq("shop_domain", shop),
  ]);
  const st = settings ?? {};
  const vcByVariant = new Map((vcRows ?? []).map((r) => [r.variant_id, r]));

  const rows = [];
  let noCost = 0;
  for (const node of products) {
    const variant = node.variants?.edges?.[0]?.node;
    const vc = variant?.id ? vcByVariant.get(variant.id) ?? null : null;
    const mapped = shopifyTypeToCategory(node.category?.name, node.productType, node.title) ?? "Autre";
    const { category, estimated } = resolveAuditCategory(vc, mapped);
    const built = auditInputs({ price: variant?.price, shopifyCost: variant?.inventoryItem?.unitCost?.amount, vc, category, settings: st, returnRatePct, pricesIncludeTax: taxesIncluded });
    if (!built) { noCost++; continue; }
    const r = unitEconomics({ inputs: built.inputs, shopCountryCode: st.shop_country_code ?? null, now });
    if (!r.ok) { noCost++; continue; }
    rows.push({ id: node.id, title: node.title, price_ttc: r.price_ttc, cost: Number(built.inputs.prix_achat), cost_source: built.cost_source, landed: r.landed, cm2: r.cm2, cm2_pct: r.cm2_pct, category, customs_estimated: estimated });
  }
  return {
    rows, scanned: products.length, noCost, incomplete, taxesIncluded,
    thresholdPct: Number(st.profitability_threshold_pct) || 0,
    missingSettings: auditAssumptions(st), returnRatePct,
    ranAt: now.toISOString(),
  };
}
