// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Alerting — rendu du mail digest (app/lib/profitabilityAlert.js, PUR)
//  Structure IMPOSÉE (ère XV, commit 8) : ligne 1 factuelle, liste par produit (nom,
//  marge nette, écart vs objectif), cause en une ligne, CONTRAT DE DÉCLENCHEMENT, bouton.
//  Parité texte ≡ HTML. engine.js intouché. node tests/lot10_loss_alert_email.mjs
//
//  Changements vs ère précédente (sévérité ≥, aucun assert supprimé sans remplaçant) :
//   • RETIRÉ : poste de coût dominant (topCost) + note fallback breakdown — hors de la
//     structure imposée. Remplacés par les locks sur la liste imposée (marge + écart).
//   • INVERSÉ : « aucune fenêtre datée » → la cause imposée cite « 30 derniers jours »
//     VOLONTAIREMENT ; on verrouille désormais sa présence.
//   • AJOUTÉ : cause, contrat de déclenchement, ligne 1 exacte, écart vs objectif.
// ════════════════════════════════════════════════════════════════════════════════

import { renderLossAlertEmail } from "../app/lib/profitabilityAlert.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

const b = (o) => ({ product_id: o.id, to: o.to, margin: o.margin, marginPct: o.pct, currency: o.cur ?? "USD", title: o.title });

// ── Ligne 1 imposée + objet + sections ──
console.log("\n── ligne 1 imposée + objet ──");
{
  const { subject, html, text } = renderLossAlertEmail({
    shop: "demo.myshopify.com", thresholdPct: 15,
    basculements: [
      b({ id: "gid://shopify/Product/1", to: "loss", margin: -12.4, pct: -8, title: "Snowboard Hydrogen" }),
      b({ id: "gid://shopify/Product/2", to: "profitable", margin: 8.1, pct: 20, title: "Bonnet" }),
    ],
  });
  // Objet INCHANGÉ : mène avec la perte, factuel, sans emoji.
  ok(subject.includes("demo.myshopify.com") && /à perte/.test(subject), `objet mène avec la perte (${subject})`);
  ok(!/[\u{2600}-\u{27BF}\u{1F000}-\u{1FAFF}️]/u.test(subject), "objet FACTUEL sans emoji (anti-spam)");
  ok(/1 produit vendu à perte/.test(subject) && !/produits vendus/.test(subject), "objet : singulier correct");
  // Ligne 1 imposée, mot pour mot (1 produit sous objectif ici : la perte).
  ok(/D'après vos commandes analysées, 1 produit est sous votre objectif de marge \(15 %\)\./.test(html)
    && text.includes("D'après vos commandes analysées, 1 produit est sous votre objectif de marge (15 %)."),
    "ligne 1 imposée présente en HTML ET texte");
  ok(/Repassés au-dessus de votre objectif/.test(html), "section retours au-dessus de l'objectif présente");
  ok(html.includes("Snowboard Hydrogen") && html.includes("Bonnet"), "titres produits affichés");
  ok(!/marge nette cumulée/.test(text), "plus de jargon 'marge nette cumulée'");
  ok(!/[—–]/.test(html) && !/[—–]/.test(text), "typo : le gabarit n'ajoute aucun tiret cadratin/demi-cadratin");
}

// ── Liste par produit : nom, marge nette, écart vs objectif (imposé) ──
console.log("\n── liste par produit : marge + écart vs objectif ──");
{
  const { html, text } = renderLossAlertEmail({
    shop: "s.myshopify.com", thresholdPct: 15,
    basculements: [
      b({ id: "gid://shopify/Product/1", to: "loss", margin: -4.5, pct: -9, cur: "EUR", title: "Tasse" }),
      b({ id: "gid://shopify/Product/2", to: "loss", margin: 2.1, pct: 8, cur: "EUR", title: "Carnet" }),
    ],
  });
  ok(/2 produits sont sous votre objectif de marge \(15 %\)/.test(text), "ligne 1 : pluriel « 2 produits sont »");
  // Tasse : marge négative + son % + écart en points (15 − (−9) = 24).
  ok(text.includes("Tasse : vendu à perte, marge -4,50") && text.includes("-9,0 %") && text.includes("24 points sous votre objectif"),
    "Tasse (perte) : préfixe « vendu à perte » + marge + % + écart 24 points");
  // Carnet : marge positive sous l'objectif + écart (15 − 8 = 7).
  ok(text.includes("Carnet : marge 2,10") && text.includes("8,0 %") && text.includes("7 points sous votre objectif"),
    "Carnet : marge + % + écart 7 points");
  ok(html.includes("Tasse") && html.includes("Carnet"), "produits présents en HTML");
}

// ── Poste de coût dominant (topCost) réinjecté sur les lignes à perte + suffixe douane estimé (option b) ──
console.log("\n── poste de coût dominant + suffixe douane ──");
{
  const { text, html } = renderLossAlertEmail({
    shop: "s", thresholdPct: 15,
    basculements: [{ product_id: "p", to: "loss", margin: -12.4, marginPct: -6, currency: "EUR", title: "Bonnet",
      topCost: { key: "douane", label: "la douane", amount: 6.24, achatPort: 32 }, customsEstimated: true }],
  });
  ok(text.includes("Bonnet : vendu à perte, marge -12,40"), "ligne perte : préfixe « vendu à perte » + marge");
  ok(text.includes("Coût d'achat et port : 32,00") && text.includes("votre plus gros coût : la douane, 6,24"), "poste dominant réinjecté (achat/port + surcharge)");
  ok(/taux de douane estimé/.test(text) && /taux de douane estimé/.test(html), "suffixe « (taux de douane estimé) » présent (texte + HTML, parité)");
}

// ── Suffixe douane : ABSENT si confirmé, ou poste dominant ≠ douane ──
console.log("\n── suffixe douane : conditions négatives ──");
{
  const conf = renderLossAlertEmail({ shop: "s", basculements: [{ product_id: "p", to: "loss", margin: -5, currency: "EUR", title: "X", topCost: { key: "douane", label: "la douane", amount: 3, achatPort: 8 }, customsEstimated: false }] });
  ok(!/taux de douane estimé/.test(conf.text), "douane confirmée → aucun suffixe");
  const other = renderLossAlertEmail({ shop: "s", basculements: [{ product_id: "p", to: "loss", margin: -5, currency: "EUR", title: "X", topCost: { key: "stripeCost", label: "les frais de paiement", amount: 3, achatPort: 8 }, customsEstimated: true }] });
  ok(!/taux de douane estimé/.test(other.text), "poste dominant ≠ douane → aucun suffixe (même si estimé)");
}

// ── Note fallback : produit à perte SANS breakdown → note honnête réinjectée (conditionnelle) ──
console.log("\n── fallback : détail de coûts absent ──");
{
  const { text, html } = renderLossAlertEmail({ shop: "s", basculements: [{ product_id: "p", to: "loss", margin: -3, currency: "EUR", title: "Mug", breakdownAvailable: false }] });
  ok(/détail des coûts n'apparaît/.test(text) && /Suivi des coûts/.test(text), "note fallback présente (explique l'absence + remède)");
  ok(!text.includes("votre plus gros coût"), "aucune ligne de poste dominant (topCost absent)");
  ok(/détail des coûts n'apparaît/.test(html), "note fallback aussi en HTML (parité)");
  // Breakdown dispo (topCost présent) → PAS de note fallback.
  const withBd = renderLossAlertEmail({ shop: "s", basculements: [{ product_id: "p", to: "loss", margin: -3, currency: "EUR", title: "Mug", topCost: { key: "retoursCost", label: "les retours", amount: 2, achatPort: 5 }, breakdownAvailable: true }] });
  ok(!withBd.text.includes("détail des coûts n'apparaît"), "breakdown dispo → aucune note fallback");
}

// ── Cause en une ligne + CONTRAT DE DÉCLENCHEMENT (imposés) ──
console.log("\n── cause + contrat de déclenchement ──");
{
  const { html, text } = renderLossAlertEmail({
    shop: "s", thresholdPct: 10,
    basculements: [b({ id: "gid://shopify/Product/9", to: "loss", margin: -3, pct: -2, title: "Mug" })],
  });
  const cause = "Calcul basé sur vos coûts enregistrés dans l'app et vos commandes des 30 derniers jours.";
  ok(html.includes(cause) && text.includes(cause), "cause en une ligne présente (HTML + texte)");
  ok(/30 derniers jours/.test(text), "la cause cite VOLONTAIREMENT la fenêtre 30 jours (contrat de calcul)");
  const contrat = "Vous recevez cette alerte quand une nouvelle commande ou un changement de coûts fait passer un produit sous votre objectif.";
  ok(html.includes(contrat) && text.includes(contrat), "contrat de déclenchement : la condition présente (HTML + texte)");
  ok(/mettez-les à jour dans l'app : vos marges et alertes resteront justes\./.test(text), "contrat : l'instruction de mise à jour des coûts présente");
  // CONSTAT : pas de verbe d'action sur la MARGE (le contrat parle de mettre à jour des COÛTS, pas d'agir sur le prix).
  ok(!/réduisez|augmentez|arrêtez|baissez|négociez/i.test((html + text).toLowerCase()), "aucun verbe d'action sur la marge (constat, pas conseil)");
  ok(!/fait perdre|dernière vente/i.test((html + text).toLowerCase()), "aucune causalité inventée");
}

// ── Retours seuls (aucun produit sous objectif) → ligne 1 positive ──
console.log("\n── retours au-dessus de l'objectif, seuls ──");
{
  const { html, text } = renderLossAlertEmail({
    shop: "s", thresholdPct: 20,
    basculements: [b({ id: "gid://shopify/Product/3", to: "profitable", margin: 9, pct: 30, title: "Bonnet" })],
  });
  ok(/1 produit est repassé au-dessus de votre objectif de marge \(20 %\)/.test(text), "ligne 1 adaptée : repassé au-dessus");
  ok(!/est sous votre objectif/.test(text), "aucune mention « sous l'objectif » quand il n'y a que des retours");
}

// ── Pertes seules → aucune section « repassés au-dessus » ──
console.log("\n── pertes seules ──");
{
  const { html } = renderLossAlertEmail({ shop: "s", thresholdPct: 15, basculements: [b({ id: "gid://shopify/Product/5", to: "loss", margin: -2, pct: -3 })] });
  ok(/sous votre objectif de marge/.test(html) && !/Repassés au-dessus/.test(html), "sous objectif seul, pas de section retours");
}

// ── Fallback nom produit (titre absent) ──
console.log("\n── fallback nom produit ──");
{
  const { text } = renderLossAlertEmail({ shop: "s", basculements: [b({ id: "gid://shopify/Product/4242", to: "loss", margin: -1 })] });
  ok(text.includes("Produit 4242"), "titre absent → 'Produit 4242'");
}

// ── Devise respectée ──
console.log("\n── devise par produit ──");
{
  const { text } = renderLossAlertEmail({ shop: "s", basculements: [b({ id: "gid://shopify/Product/6", to: "loss", margin: -5, cur: "EUR" })] });
  ok(text.includes("€"), "EUR formaté en €");
}

// ── Marge % inconnue → pas de % ni d'écart inventé ──
console.log("\n── marge % absente ──");
{
  const { text } = renderLossAlertEmail({ shop: "s", thresholdPct: 15, basculements: [b({ id: "gid://shopify/Product/7", to: "loss", margin: -2, title: "Sans%" })] });
  ok(text.includes("Sans% : vendu à perte, marge") && !/point.? sous votre objectif/.test(text), "marge % absente → montant seul, aucun écart inventé");
}

// ── DÉLIVRABILITÉ : texte brut ≡ HTML (mêmes chiffres) — jamais de mail HTML-only ──
console.log("\n── texte brut ≡ HTML : mêmes chiffres ──");
{
  const { html, text } = renderLossAlertEmail({
    shop: "s", thresholdPct: 80,
    basculements: [
      b({ id: "gid://shopify/Product/1", to: "loss", margin: -4.05, pct: -3, cur: "USD", title: "Coque" }),
      b({ id: "gid://shopify/Product/2", to: "loss", margin: 729.27, pct: 60.8, cur: "USD", title: "Snow" }),
    ],
  });
  ok(html.length > 0 && text.length > 0, "html ET texte non vides (jamais HTML-only)");
  for (const fig of ["-4,05", "-3,0", "729,27", "60,8", "19,2 points"]) { // 19,2 = 80 − 60,8
    ok(html.includes(fig) && text.includes(fig), `« ${fig} » présent dans le HTML ET le texte`);
  }
}

// ── DARK MODE : couleurs de texte ET de fond posées ; bouton fond plein + texte contrasté ──
console.log("\n── dark mode : fond + texte explicites, bouton contrasté ──");
{
  const url = "https://demo.myshopify.com/admin/apps/abc123?tab=costs";
  const { html } = renderLossAlertEmail({ shop: "s", appUrl: url, thresholdPct: 15, basculements: [b({ id: "gid://shopify/Product/1", to: "loss", margin: -3, pct: -2, title: "X" })] });
  ok(/background-color:#ffffff/.test(html), "conteneur : fond blanc EXPLICITE (jamais inversé en dark)");
  ok(/color:#202223 !important/.test(html), "corps : couleur de texte foncée EXPLICITE avec !important");
  ok(/background-color:#008060;color:#ffffff/.test(html), "bouton : fond plein + texte blanc EXPLICITES");
  ok(/color:#008060/.test(html), "lien de repli : couleur EXPLICITE (jamais un bleu illisible en dark)");
}

// ── LIEN VERS L'APP : présent dans HTML ET texte si fourni ; absent proprement sinon (best-effort) ──
console.log("\n── lien app : parité HTML/texte + envoi jamais bloqué ──");
{
  const url = "https://demo.myshopify.com/admin/apps/abc123?tab=costs";
  const withUrl = renderLossAlertEmail({ shop: "demo.myshopify.com", appUrl: url, thresholdPct: 15, basculements: [b({ id: "gid://shopify/Product/1", to: "loss", margin: -12.4, pct: -5, title: "Snowboard" })] });
  ok(withUrl.html.includes(url) && withUrl.text.includes(url), "appUrl fourni → lien dans le HTML ET le texte (parité)");
  ok(/Voir le suivi de marge/.test(withUrl.html), "libellé de bouton « Voir le suivi de marge » (HTML, inchangé)");
  ok(withUrl.text.includes("Voir le suivi de marge dans l'app"), "libellé + lien en texte brut");

  const noUrl = renderLossAlertEmail({ shop: "demo.myshopify.com", thresholdPct: 15, basculements: [b({ id: "gid://shopify/Product/1", to: "loss", margin: -12.4, pct: -5, title: "Snowboard" })] });
  ok(!/\/admin\/apps\//.test(noUrl.html) && !/\/admin\/apps\//.test(noUrl.text), "appUrl absent → aucun lien d'app (ni HTML ni texte)");
  ok(noUrl.html.length > 0 && noUrl.text.length > 0 && noUrl.html.includes("Snowboard"), "email rendu QUAND MÊME sans lien (envoi jamais bloqué)");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 10 (mail alerte) : ✓ Tous les tests passent"
  : ` BILAN LOT 10 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
