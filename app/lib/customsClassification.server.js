// ── Fiabilité douane — I/O de la classification (confirmation + invalidation) ─────────────────
// Extrait de la route pour être appelé À L'IDENTIQUE par l'action ET le harness E2E (preuve réelle).
// Décisions pures dans customsClassification.js ; ici uniquement le plumbing Supabase. engine.js intouché.
// AUCUNE écriture de product_profitability_state (invariants d'alerting intacts par construction).
import { CATEGORIE_KEYS } from "./variantCosts.js";
import { resolveCustomsConfirmedOnWrite, customsRateChanged } from "./customsClassification.js";

// Invalidation sur un lot d'upserts variant_costs (chemins d'ÉDITION de la catégorie : costs_save,
// costs_import_csv). Lit la catégorie + le flag STOCKÉS, applique resolveCustomsConfirmedOnWrite par
// ligne : catégorie changée ⇒ customs_confirmed=false ; identique ⇒ flag préservé. Mute `upserts`.
const LOOKUP_CHUNK = 100; // .in() part en query string : chunker évite de dépasser la limite d'URL sur un gros CSV.

export async function applyCustomsInvalidation(supabase, shop, upserts) {
  const ids = upserts.map((u) => u.variant_id);
  // Lookup CHUNKÉ (paquets de 100) → un import CSV de centaines de variantes ne fait pas exploser l'URL.
  const prev = new Map();
  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    const batch = ids.slice(i, i + LOOKUP_CHUNK);
    const { data } = await supabase.from("variant_costs")
      .select("variant_id, categorie, customs_confirmed").eq("shop_domain", shop).in("variant_id", batch);
    for (const r of (data ?? [])) prev.set(r.variant_id, r);
  }
  for (const u of upserts) {
    const s = prev.get(u.variant_id);
    u.customs_confirmed = resolveCustomsConfirmedOnWrite(s?.categorie, u.categorie, s?.customs_confirmed);
  }
  return upserts;
}

// Confirmer la classification d'un PRODUIT : UN SEUL UPDATE atomique (fan-out sans boucle) qui écrit la
// catégorie choisie ET customs_confirmed=true sur TOUTES ses variantes. rateChanged (pur) dit si le taux
// a bougé → l'UI PROPOSE le recalcul existant (jamais silencieux). Validation enumField sur la catégorie.
export async function confirmCustomsCategory({ supabase, shop, productId, categorie }) {
  const pid = productId ? String(productId) : null;
  const cat = CATEGORIE_KEYS.includes(String(categorie)) ? String(categorie) : null;
  if (!pid) return { success: false, error: "Produit manquant." };
  if (!cat)  return { success: false, error: "Catégorie invalide : choisissez une catégorie explicite." };
  // Taux AVANT : catégories actuelles des variantes → le taux change-t-il pour au moins une ?
  const { data: before } = await supabase.from("variant_costs")
    .select("categorie").eq("shop_domain", shop).eq("product_id", pid);
  if (!before || before.length === 0) return { success: false, error: "Aucune variante à confirmer pour ce produit." };
  const rateChanged = before.some((r) => customsRateChanged(r.categorie, cat));
  const { error, count } = await supabase.from("variant_costs")
    .update({ categorie: cat, customs_confirmed: true, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("shop_domain", shop).eq("product_id", pid);
  if (error) return { success: false, error: error.message };
  return { success: true, updated: count ?? 0, rateChanged };
}
