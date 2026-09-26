// ── Réglages > Coûts produits (F4-D1a) — lectures / écritures, même chemin que l'écran classique ──
// Requête variantes, lecture variant_costs, suggestions (buildCostRowsForDisplay, jamais persistées),
// enregistrement (validateCostRow, source 'confirmed'), import CSV ('imported'), invalidation douane
// et confirmation de classification : fonctions de variantCosts.js / customsClassification.server.js.
import { buildCostRowsForDisplay } from "./variantCosts.js";
import { costsCsvTemplate, parseCostsCsvStrict, parseCostRows, decodeCsvBytes } from "./costsCsv.js";
import { buildCostsXlsx, readCostsXlsx, isXlsx, isLegacyXls, XLSX_CONTENT_TYPE, XLSX_MAX_BYTES } from "./costsXlsx.server.js";
import { applyCustomsInvalidation, confirmCustomsCategory } from "./customsClassification.server.js";

const VARIANTS_QUERY = `query CostVariants($cursor: String) {
  products(first: 50, after: $cursor, query: "status:active") {
    edges { node {
      id title productType isGiftCard
      category { name }
      variants(first: 100) {
        edges { node { id title price inventoryItem { unitCost { amount } } } }
        pageInfo { hasNextPage }
      }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

function pushVariants(node, variants) {
  for (const ve of node.variants?.edges ?? []) {
    const v = ve.node;
    variants.push({
      variant_id: v.id, product_id: node.id, product_title: node.title, variant_title: v.title,
      price: parseFloat(v.price ?? "0"), unitCost: v.inventoryItem?.unitCost?.amount,
      categoryName: node.category?.name, productType: node.productType,
    });
  }
}

async function defaultsFor(supabase, shop) {
  const { data } = await supabase.from("shop_settings").select("vat_regime, shipping_model, default_import_country, shop_currency").eq("shop_domain", shop).maybeSingle();
  return { defaultCountry: data?.default_import_country ?? "Chine", vatRegime: data?.vat_regime ?? "assujetti", shippingModel: data?.shipping_model ?? "dropshipping", currency: data?.shop_currency ?? null };
}

// Lecture seule : aucune ligne n'est écrite à l'ouverture (règle d'intégrité de l'écran classique).
export async function loadProductCosts({ admin, supabase, shop }) {
  const variants = [];
  let cursor = null, hasNext = true, pages = 0, variantsCapped = false, giftCardCount = 0, incomplete = false;
  const start = Date.now();
  while (hasNext && pages < 20) {
    if (Date.now() - start > 8000) { console.error("[ProductCosts] time budget exceeded"); incomplete = true; break; }
    pages++;
    try {
      const json = await (await admin.graphql(VARIANTS_QUERY, { variables: { cursor } })).json();
      const page = json.data?.products;
      if (!page) break;
      for (const { node } of page.edges) {
        if (node.isGiftCard === true) { giftCardCount++; continue; }
        if (node.variants?.pageInfo?.hasNextPage) variantsCapped = true;
        pushVariants(node, variants);
      }
      hasNext = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
    } catch (e) { console.error("[ProductCosts] variants query:", e?.message); incomplete = true; break; }
  }
  const d = await defaultsFor(supabase, shop);
  const { data: stored } = await supabase.from("variant_costs").select("*").eq("shop_domain", shop);
  const storedMap = new Map((stored ?? []).map((r) => [r.variant_id, r]));
  const rows = buildCostRowsForDisplay({ variants, storedMap, defaultCountry: d.defaultCountry, vatRegime: d.vatRegime, shippingModel: d.shippingModel });
  return { rows, variantsCapped, giftCardCount, incomplete: incomplete || (hasNext && pages >= 20), currency: d.currency };
}

// Enregistrement d'un produit : lignes déjà validées (parseProductForm) → source 'confirmed'.
export async function saveProductCosts({ supabase, shop, rows }) {
  if (!rows.length) return { ok: true, saved: 0 };
  const upserts = rows.map((r) => ({ shop_domain: shop, variant_id: r.variant_id, product_id: r.product_id ?? null, ...r.value, source: "confirmed", updated_at: new Date().toISOString() }));
  // Éditer la CATÉGORIE par ce chemin (≠ confirmation douane) invalide la classification douanière.
  await applyCustomsInvalidation(supabase, shop, upserts);
  const { error } = await supabase.from("variant_costs").upsert(upserts, { onConflict: "shop_domain,variant_id" });
  return error ? { ok: false, error: error.message } : { ok: true, saved: upserts.length };
}

// Téléchargement du modèle (route authentifiée) : .xlsx (principal) ou CSV UTF-8 avec BOM (second).
export async function exportCosts({ admin, supabase, shop, format = "xlsx", sheetNames }) {
  const { rows } = await loadProductCosts({ admin, supabase, shop });
  if (format === "csv") return { body: costsCsvTemplate(rows, { bom: true }), contentType: "text/csv; charset=utf-8", filename: "true-cost-calculator-costs.csv" };
  return { body: await buildCostsXlsx(rows, sheetNames), contentType: XLSX_CONTENT_TYPE, filename: "true-cost-calculator-costs.xlsx" };
}

// Fichier téléversé (.xlsx ou .csv) → mêmes règles d'import. Taille bornée ; .xls/.ods signalés.
export async function importCostsFile({ supabase, shop, bytes }) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (u8.length > XLSX_MAX_BYTES) return { ok: false, error: "header", saved: 0, header: { reason: "too_large" }, incomplete: 0, csvErrors: [], errorCount: 0 };
  if (isLegacyXls(u8)) return { ok: false, error: "header", saved: 0, header: { reason: "unsupported_format" }, incomplete: 0, csvErrors: [], errorCount: 0 };
  if (isXlsx(u8)) {
    let rawRows;
    try { rawRows = await readCostsXlsx(u8); }
    catch (e) { console.error("[ProductCosts] xlsx illisible :", e?.message); return { ok: false, error: "header", saved: 0, header: { reason: "unreadable" }, incomplete: 0, csvErrors: [], errorCount: 0 }; }
    return importParsed({ supabase, shop, parsed: parseCostRows(rawRows) });
  }
  return importCostsCsv({ supabase, shop, text: decodeCsvBytes(u8) });
}

// Import (2026-09-26) : lignes complètes enregistrées ('imported') ; lignes à coût vide « à compléter »
// (comptées à part, rien d'écrit) ; rejets avec raison. Voir costsCsv.js.
export async function importCostsCsv({ supabase, shop, text }) {
  return importParsed({ supabase, shop, parsed: parseCostsCsvStrict(text ?? "") });
}
async function importParsed({ supabase, shop, parsed }) {
  const summary = { incomplete: parsed.incomplete.length, incompleteLines: parsed.incomplete.slice(0, 10), csvErrors: parsed.errors.slice(0, 20), errorCount: parsed.errors.length, header: parsed.header };
  if (parsed.header) return { ok: false, error: "header", saved: 0, ...summary };
  const upserts = parsed.rows.map((r) => ({ shop_domain: shop, variant_id: r.variant_id, ...r.value, source: "imported", updated_at: new Date().toISOString() }));
  if (upserts.length) {
    await applyCustomsInvalidation(supabase, shop, upserts);
    const { error } = await supabase.from("variant_costs").upsert(upserts, { onConflict: "shop_domain,variant_id" });
    if (error) return { ok: false, error: error.message, saved: 0, ...summary };
  }
  return { ok: true, saved: upserts.length, ...summary };
}

export async function confirmCustoms({ supabase, shop, productId, categorie }) {
  const r = await confirmCustomsCategory({ supabase, shop, productId, categorie });
  return r.success ? { ok: true, updated: r.updated, rateChanged: r.rateChanged } : { ok: false, error: r.error };
}
