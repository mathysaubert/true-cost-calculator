// ── Alerting produit-à-perte — diff d'état PUR (aucun I/O, aucun React) ──────
// Compare l'état de rentabilité COURANT par produit (sortie aggregateOrderMargins.byProduct)
// à l'état STOCKÉ au dernier run (product_profitability_state). AUCUNE marge recalculée :
// on COMPARE des sommes déjà produites par le moteur/l'agrégat (net_margin, net_revenue).
//
// Décisions produit (cf. Phase 0) :
//   • SEUIL configurable (% global boutique) : sous le seuil ⟺ net_margin < (T/100) × net_revenue.
//     Pure comparaison de deux sommes stockées — jamais de division, jamais de null.
//     T = 0 (défaut) → net_margin < 0 : EXACTEMENT le legacy (perte STRICTE). Non-régression.
//   • état BINAIRE conservé : 'profitable' | 'loss'. La FRONTIÈRE bouge (0 → T), pas le
//     vocabulaire → zéro migration des lignes existantes, zéro faux basculement au déploiement.
//   • produits multi-devises ('MIXED') : JAMAIS suivis (somme cross-devise interdite).
//   • product_id null (produit supprimé) : non suivi (clé non stockable, non actionnable).
//   • basculement = état courant ≠ état stocké (uniquement si un état existait).
//   • produit sans état antérieur (nouveau / premier passage) → SEED, jamais d'alerte.
//
// Entrées :
//   current      : aggregateOrderMargins(...).byProduct
//                  [{ product_id, net_margin, net_revenue, marginPct, currency, ... }]
//   prevStateMap : Map(product_id → { last_state: 'profitable'|'loss' })
//   thresholdPct : seuil % global boutique (shop_plans.profitability_threshold_pct), défaut 0.
// Sortie (3 listes DISJOINTES) :
//   basculements : { product_id, state, margin, marginPct, currency, from, to } → mail + écriture (après envoi)
//   seeds        : { product_id, state, margin, marginPct, currency }            → écriture, PAS d'alerte
//   majNormales  : { product_id, state, margin, marginPct, currency }            → écriture (maj), PAS d'alerte
import { formatMoney } from "./orderHistory.js";
import { emailShell } from "./emailLayout.js";

const num = (v) => { const n = +v; return Number.isFinite(n) ? n : 0; };

// Nom lisible d'un produit : titre résolu par l'appelant (Admin API) sinon fin du gid.
const productName = (b) => b.title ?? `Produit ${String(b.product_id ?? "").split("/").pop()}`;

// ── Poste de coût dominant d'un produit — PUR (aucune re-dérivation, BUG 1) ───
// Entrée : costPosts agrégés par aggregateOrderMargins (€ produit). On EXCLUT le coût d'achat+port
// (structurel, connu = coutRendu − douane − TVA import) du classement et on l'expose à part ;
// on classe les SURCHARGES (ce que le marchand ne voit pas venir) et on renvoie la plus lourde.
// CONSTAT, jamais conseil : le libellé n'est qu'un nom de poste + un montant.
const POST_LABELS = {
  douane:      "la douane",
  tvaNetCost:  "la TVA à l'import non récupérable",
  shopifyCost: "les frais Shopify",
  stripeCost:  "les frais de paiement",
  retoursCost: "les retours",
  fraisFixes:  "les frais fixes (emballage, retour)",
};
export function dominantCostPost(costPosts) {
  if (!costPosts) return null;
  const achatPort = num(costPosts.coutRendu) - num(costPosts.douane) - num(costPosts.tvaNetCost);
  let top = null;
  for (const k of Object.keys(POST_LABELS)) {
    const v = num(costPosts[k]);
    if (v > 0 && (!top || v > top.amount)) top = { label: POST_LABELS[k], amount: v };
  }
  return top ? { ...top, achatPort } : null;  // null si aucune surcharge > 0 → mail n'affiche rien
}

// ── Rendu PUR du mail d'alerte (digest) — aucun I/O, aucun envoi ────────────
// Écrit pour un marchand NOVICE : ce qu'il perd (en €), et où part son argent (poste de coût
// dominant, factuel — CONSTAT jamais conseil). Aucune causalité inventée, aucune date, aucun
// jargon ("marge nette cumulée" → "vous perdez X"). Trois niveaux :
//   • marge < 0          → "Vous perdez de l'argent sur"      (+ poste dominant si dispo)
//   • 0 ≤ marge < seuil  → "Rentables, mais sous votre objectif"
//   • repassé rentable   → "Repassés au-dessus de votre objectif"
// Entrée basculement : { to, margin, marginPct, currency, title?, topCost?:{label,amount,achatPort}, breakdownAvailable? }.
// topCost/breakdownAvailable sont fournis SERVEUR (cron) — le template ne fait que rendre (BUG 1).
export function renderLossAlertEmail({ shop, thresholdPct = 0, basculements = [] }) {
  const losses     = basculements.filter((b) => b.to === "loss");
  const realLosses = losses.filter((b) => num(b.margin) < 0);
  const thin       = losses.filter((b) => num(b.margin) >= 0);
  const recoveries = basculements.filter((b) => b.to === "profitable");

  const objLabel = num(thresholdPct) > 0
    ? ` de ${num(thresholdPct).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %` : "";
  const money = (v, cur) => formatMoney(v, cur);
  const signed = (b) => (num(b.margin) > 0 ? "+" : "") + money(b.margin, b.currency);
  const pct = (b) => b.marginPct == null ? "" : ` (${num(b.marginPct).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %)`;

  // Ligne perte : montant total + (si dispo) coût d'achat exposé à part + poste annexe dominant.
  const lossLine = (b) => {
    let s = `${productName(b)} : ${money(b.margin, b.currency)} (tout compris).`;
    if (b.topCost) s += ` Coût d'achat + port : ${money(b.topCost.achatPort, b.currency)} ; au-delà, le poste le plus lourd : ${b.topCost.label}, ${money(b.topCost.amount, b.currency)}.`;
    return s;
  };
  const thinLine = (b) => `${productName(b)} : ${signed(b)}${pct(b)}. Il rapporte, mais moins que la marge que vous visez.`;
  const recoLine = (b) => `${productName(b)} : ${signed(b)}${pct(b)}.`;

  // Objet adaptatif : mène avec le plus grave présent. FACTUEL, aucun emoji (un pictogramme
  // d'avertissement dans l'objet est un signal de spam ; la gravité est dans le contenu).
  const subject = realLosses.length
    ? `${shop} — ${realLosses.length} produit${realLosses.length > 1 ? "s" : ""} vendu${realLosses.length > 1 ? "s" : ""} à perte${thin.length ? `, ${thin.length} sous votre objectif` : ""}`
    : thin.length
    ? `${shop} — ${thin.length} produit${thin.length > 1 ? "s" : ""} sous votre objectif de marge`
    : `${shop} — ${recoveries.length} produit${recoveries.length > 1 ? "s" : ""} repassé${recoveries.length > 1 ? "s" : ""} rentable${recoveries.length > 1 ? "s" : ""}`;

  // Note fallback : au moins un produit à perte sans détail de coûts (commandes pré-Brique B).
  const missingDetail = realLosses.some((b) => b.breakdownAvailable === false);
  const noteText = "Le détail des coûts n'apparaît pas pour certains produits : leurs commandes ont été analysées avant cette fonctionnalité. Complétez-le depuis l'onglet « Suivi des coûts ».";
  const closing = (realLosses.length || thin.length) ? "À vous de décider quoi ajuster — vous seul connaissez votre marché." : "";

  const lines = ["D'après les commandes que True Cost Calculator suit pour vous :", ""];
  if (realLosses.length) lines.push("Vous perdez de l'argent sur :", ...realLosses.map((b) => `• ${lossLine(b)}`), "");
  if (thin.length)       lines.push(`Rentables, mais sous votre objectif${objLabel} :`, ...thin.map((b) => `• ${thinLine(b)}`), "");
  if (recoveries.length) lines.push("Repassés au-dessus de votre objectif :", ...recoveries.map((b) => `• ${recoLine(b)}`), "");
  if (closing) lines.push(closing);
  if (missingDetail) lines.push("", `— ${noteText}`);
  const text = lines.join("\n").trim();

  const section = (titre, items, render) => items.length
    ? `<h3 style="margin:16px 0 6px;font-size:14px">${titre}</h3><ul style="margin:0;padding-left:18px">${items.map((b) => `<li style="margin:4px 0">${render(b)}</li>`).join("")}</ul>`
    : "";
  const html = emailShell(`<p>D'après les commandes que True Cost Calculator suit pour vous :</p>
    ${section("Vous perdez de l'argent sur", realLosses, lossLine)}
    ${section(`Rentables, mais sous votre objectif${objLabel}`, thin, thinLine)}
    ${section("Repassés au-dessus de votre objectif", recoveries, recoLine)}
    ${closing ? `<p>${closing}</p>` : ""}
    ${missingDetail ? `<p style="font-size:12px;color:#6D7175">${noteText}</p>` : ""}`);

  return { subject, html, text };
}

export function computeProfitabilityChanges(current = [], prevStateMap = new Map(), thresholdPct = 0) {
  const basculements = [];
  const seeds = [];
  const majNormales = [];

  for (const p of current) {
    if (p.product_id == null) continue;        // produit supprimé → non stockable / non actionnable
    if (p.currency === "MIXED") continue;       // cross-devise → jamais suivi

    // Frontière SEUIL : sous le seuil ⟺ net_margin < (T/100) × net_revenue.
    // T = 0 → net_margin < 0 : reproduit le legacy AU CAS PRÈS (y compris CA = 0), sans /0 ni null.
    const below = num(p.net_margin) < (num(thresholdPct) / 100) * num(p.net_revenue);
    const state = below ? "loss" : "profitable";
    const entry = { product_id: p.product_id, state, margin: p.net_margin, marginPct: p.marginPct ?? null, currency: p.currency ?? null };

    const prev = prevStateMap.get(p.product_id);
    if (!prev) { seeds.push(entry); continue; }            // pas d'état antérieur → seed silencieux
    if (prev.last_state !== state) basculements.push({ ...entry, from: prev.last_state, to: state });
    else majNormales.push(entry);
  }

  return { basculements, seeds, majNormales };
}

// ── Décision d'alerting au volume — PURE (branchée par le cron en C4b-2) ─────────────────────
// Sépare la DÉCISION (testable) de l'I/O (cron), comme decideDunningAction. Deux fonctions :
//   decideAlertAction  : quelle action, selon (alerting activé ce mois ?, email destinataire ?,
//                        des basculements ?).
//   shouldAdvanceState : faut-il avancer product_profitability_state, selon l'action ET le succès
//                        d'envoi — porte l'invariant G2 (avancer SSI envoi réussi ; JAMAIS pendant OFF).
//
// Actions :
//   'nothing'      → aucun basculement → ne rien faire.
//   'suppress'     → alerting COUPÉ ce mois (dépassement le mois dernier) → ni envoi, NI avance d'état
//                    (comme le chemin mailFailed) → aucune alerte perdue, rafale-digest à la reprise.
//   'advance_only' → alerting actif mais pas d'email → on avance l'état sans envoyer (G3).
//   'send'         → alerting actif + email → tenter l'envoi ; l'avance (SSI succès) est résolue
//                    par shouldAdvanceState.
export function decideAlertAction({ alertingEnabled, hasEmail, hasBasculements } = {}) {
  if (!hasBasculements) return "nothing";
  if (!alertingEnabled) return "suppress";
  return hasEmail ? "send" : "advance_only";
}

// Avance-t-on product_profitability_state ? Porte l'invariant G2. sendOk n'a de sens que pour 'send'
// (ignoré ailleurs). 'suppress' → false : pendant OFF on n'avance JAMAIS → aucune alerte perdue.
export function shouldAdvanceState(action, sendOk = false) {
  switch (action) {
    case "advance_only": return true;
    case "send":         return sendOk === true;
    default:             return false; // 'nothing' | 'suppress' | inconnu → ne pas avancer
  }
}
