// ── Recalcul des marges historiques — DÉCISIONS PURES (Brique 1, fondation) ──────────────
// Code PUR (aucun I/O / React / Supabase). Rien n'appelle encore ces fonctions : cette brique
// ne fait QUE poser et tester les décisions, elle ne branche ni bouton ni DELETE ni sync.
//
// Contexte : une ligne order_margins ingérée avec un coût ESTIMÉ ou MANQUANT garde une marge
// fausse à vie (le snapshot est figé). On laissera le marchand la corriger en SUPPRIMANT les
// lignes recalculables puis en re-synchronisant. Les lignes 'confirmed'/'imported' font AUTORITÉ
// (saisie / CSV du marchand) et sont IMMUABLES — jamais supprimées, jamais recalculées.
//
// Deux définitions verrouillées ici, cohérentes avec le reste de l'app :
//   • recalculable = cost_source ∈ {estimated, missing}  (cf. variantsNeedingCost, orderHistory.js)
//   • perte STRICTE = net_margin < 0                       (cf. unprofitable, orderHistory.js ; SQL PPS)
// Toute autre valeur de cost_source (confirmed, imported, inconnue, null) ⇒ IMMUABLE : le défaut
// SÛR est « ne touche pas » — on ne détruit jamais une ligne par méconnaissance de son origine.

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };

// ── Décision 1 : cette origine de coût est-elle recalculable ? ────────────────────────────
// true UNIQUEMENT pour 'estimated' et 'missing'. Tout le reste (confirmed, imported, valeur
// inconnue, null/undefined) ⇒ false = IMMUABLE. Le défaut penche vers l'immuabilité : on ne
// supprime une ligne que si on est CERTAIN qu'elle est recalculable.
export function isRecalcableCostSource(costSource) {
  return costSource === "estimated" || costSource === "missing";
}

// ── Timestamp → epoch ms, ou null si non parsable ─────────────────────────────────────────
// Accepte Date, ISO string, epoch number. Ne fait AUCUN appel à l'horloge (déterminisme :
// `now` est toujours injecté par l'appelant, comme la « douane historique » du moteur).
function toEpochMs(ts) {
  if (ts == null) return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

// ── Décision 2 : quelles lignes supprimer (recalculables ET dans la fenêtre) ───────────────
// Une ligne n'est SUPPRIMÉE que si (a) son origine est recalculable ET (b) son computed_at
// tombe dans la fenêtre de re-synchronisation (30j par défaut). Hors fenêtre = la re-sync ne
// la recréerait pas ⇒ on la GARDE (ne jamais orpheliner un historique irrécupérable). Ligne
// sans computed_at ⇒ on ne touche pas (défaut sûr). Retour : lignes minimales à cibler pour
// le DELETE, dans l'ordre d'entrée (aucun tri, aucune dédup — l'appelant a la clé unique).
export function selectDeletableLines(rows, now, { windowDays = 30 } = {}) {
  const nowMs = toEpochMs(now);
  if (nowMs == null) return [];                          // horloge invalide ⇒ ne rien supprimer
  const cutoff = nowMs - Math.max(0, num(windowDays)) * 86_400_000; // 30j en ms
  const out = [];
  for (const r of rows ?? []) {
    if (!isRecalcableCostSource(r?.cost_source)) continue;   // confirmed/imported/inconnu ⇒ immuable
    const t = toEpochMs(r?.computed_at);
    if (t == null) continue;                                 // sans computed_at ⇒ on ne touche pas
    if (t < cutoff) continue;                                // hors fenêtre ⇒ non re-synchronisable, on garde
    out.push({ order_id: r.order_id ?? null, line_item_id: r.line_item_id ?? null });
  }
  return out;
}

// ── Nom lisible d'un produit — repli aligné sur l'UI (app._index.jsx) ─────────────────────
// name non vide > « Produit <dernier segment du gid> » > « Produit inconnu ». Jamais de nom vide
// dans un message marchand.
function productName(p) {
  const raw = typeof p?.name === "string" ? p.name.trim() : "";
  if (raw) return raw;
  if (p?.product_id) return `Produit ${String(p.product_id).split("/").pop()}`;
  return "Produit inconnu";
}

// ── Décision 3 (extractible) : liste de noms tronquée « A, B, C, D, E et N autres » ───────
// PURE, réutilisable. 0 nom ⇒ "" (l'appelant décide de masquer la ligne). ≤ max ⇒ liste simple.
// > max ⇒ les `max` premiers + « et N autres ». Comme validé : max 5 par défaut.
export function formatProductNames(names, max = 5) {
  const list = (names ?? []).filter((n) => typeof n === "string" && n.length > 0);
  if (list.length === 0) return "";
  if (list.length <= max) return list.join(", ");
  const autres = list.length - max;
  return `${list.slice(0, max).join(", ")} et ${autres} autre${autres > 1 ? "s" : ""}`;
}

// État de rentabilité d'un produit à partir de sa marge. net_margin non fini ⇒ null (INCONNU) :
// un état inconnu n'entre dans AUCUNE transition (ni « passé à perte » ni « redevenu rentable »),
// même prudence que l'immuabilité — on n'invente pas un basculement.
const etatRentabilite = (netMargin) => {
  const n = typeof netMargin === "number" ? netMargin : parseFloat(netMargin);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? "perte" : "rentable";        // perte STRICTE : < 0 (aligné orderHistory / SQL)
};

// ── Résumé destiné au marchand : compare deux ÉTATS produit (avant / après recalcul) ──────
// PURE. Un « état » = { lignes: <nb de lignes order_margins>, produits: [{ product_id, name,
// net_margin }] }. On apparie les produits par product_id et on ne retient que les VRAIS
// basculements (les deux états connus) :
//   • produitsPassesAPerte       : rentable AVANT → perte APRÈS (le recalcul a révélé une perte)
//   • produitsRedevenusRentables : perte AVANT → rentable APRÈS
// Un produit dont l'état avant OU après est inconnu (marge non finie, produit absent d'un côté)
// n'est JAMAIS compté comme un basculement. Ordre des noms = ordre d'apparition dans `apres`.
export function buildRecalcSummary(avant, apres) {
  const produitsAvant = avant?.produits ?? [];
  const produitsApres = apres?.produits ?? [];

  const etatAvantById = new Map();
  for (const p of produitsAvant) {
    if (p?.product_id != null) etatAvantById.set(p.product_id, etatRentabilite(p.net_margin));
  }

  const passesAPerte = [];
  const redevenusRentables = [];
  for (const p of produitsApres) {
    if (p?.product_id == null) continue;
    const avantEtat = etatAvantById.get(p.product_id);
    const apresEtat = etatRentabilite(p.net_margin);
    if (avantEtat == null || apresEtat == null) continue;         // un côté inconnu ⇒ pas de basculement
    if (avantEtat === "rentable" && apresEtat === "perte") passesAPerte.push(productName(p));
    else if (avantEtat === "perte" && apresEtat === "rentable") redevenusRentables.push(productName(p));
  }

  return {
    lignesRecalculees: num(apres?.lignes),         // lignes re-synchronisées après recalcul
    produitsPassesAPerte: passesAPerte,             // noms complets (l'UI tronque via formatProductNames)
    produitsRedevenusRentables: redevenusRentables,
    // Textes prêts à l'emploi, tronqués « max 5 + et N autres ».
    resume: {
      passesAPerte: formatProductNames(passesAPerte),
      redevenusRentables: formatProductNames(redevenusRentables),
    },
  };
}
