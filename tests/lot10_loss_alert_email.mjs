// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Alerting — rendu du mail digest (app/lib/profitabilityAlert.js, PUR)
//  Écrit pour un marchand novice : "vous perdez X" + poste de coût dominant (CONSTAT jamais
//  conseil). Jamais causal ni daté. engine.js intouché. node tests/lot10_loss_alert_email.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { renderLossAlertEmail } from "../app/lib/profitabilityAlert.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

const b = (o) => ({ product_id: o.id, to: o.to, margin: o.margin, marginPct: o.pct, currency: o.cur ?? "USD", title: o.title, topCost: o.topCost, breakdownAvailable: o.bdAvail });

// ── digest mixte : perte + rentable ──
console.log("\n── digest mixte ──");
{
  const { subject, html, text } = renderLossAlertEmail({
    shop: "demo.myshopify.com",
    basculements: [
      b({ id: "gid://shopify/Product/1", to: "loss", margin: -12.4, title: "Snowboard Hydrogen" }),
      b({ id: "gid://shopify/Product/2", to: "profitable", margin: 8.1, pct: 20, title: "Bonnet" }),
    ],
  });
  ok(subject.includes("demo.myshopify.com") && /à perte/.test(subject), `sujet mène avec la perte (${subject})`);
  ok(/Vous perdez de l'argent/.test(html) && /Repassés au-dessus de votre objectif/.test(html), "html : 2 sections (perte / rétabli)");
  ok(html.includes("Snowboard Hydrogen") && html.includes("Bonnet"), "titres produits affichés");
  ok(text.includes("-12,40") && text.includes("+8,10"), "montants : perte signée, rétabli avec +");
  ok(!/marge nette cumulée/.test(text), "plus de jargon 'marge nette cumulée'");
}

// ── GARDE anti-wording trompeur : ni causalité, ni date, ni verbe de conseil ──
console.log("\n── wording : constat, jamais causal/daté/conseil ──");
{
  const { html, text } = renderLossAlertEmail({
    shop: "s.myshopify.com",
    basculements: [b({ id: "gid://shopify/Product/9", to: "loss", margin: -3, topCost: { label: "les retours", amount: 5, achatPort: 10 }, bdAvail: true })],
  });
  const blob = (html + " " + text).toLowerCase();
  ok(!blob.includes("30 jour") && !blob.includes("30 derniers"), "aucune fenêtre datée");
  ok(!blob.includes("dernière vente") && !blob.includes("fait perdre"), "aucune causalité inventée");
  ok(!/réduisez|augmentez|arrêtez|baissez|négociez/i.test(blob), "CONSTAT : aucun verbe d'action (le poste dominant n'est pas un conseil déguisé)");
}

// ── POSTE DOMINANT : coût d'achat exposé à part + surcharge dominante ──
console.log("\n── poste de coût dominant (topCost) ──");
{
  const { text } = renderLossAlertEmail({
    shop: "s", basculements: [b({ id: "gid://shopify/Product/7", to: "loss", margin: -12.4, cur: "EUR", title: "Bonnet",
      topCost: { label: "la douane", amount: 6.24, achatPort: 32 }, bdAvail: true })],
  });
  ok(text.includes("la douane") && text.includes("6,24"), "surcharge dominante affichée (douane, 6,24)");
  ok(text.includes("Coût d'achat + port") && text.includes("32,00"), "coût d'achat + port exposé séparément");
  ok(!text.includes("détail des coûts n'apparaît"), "breakdown dispo → pas de note fallback");
}

// ── FALLBACK : produit à perte SANS breakdown → note honnête, pas de ligne de coût ──
console.log("\n── fallback : breakdown absent ──");
{
  const { text } = renderLossAlertEmail({
    shop: "s", basculements: [b({ id: "gid://shopify/Product/8", to: "loss", margin: -3, cur: "EUR", title: "Mug", bdAvail: false })],
  });
  ok(/détail des coûts n'apparaît/.test(text) && /Suivi des coûts/.test(text), "note fallback présente (explique l'absence + remède)");
  ok(!text.includes("le poste le plus lourd"), "aucune ligne de coût dominant (topCost absent)");
}

// ── fallback nom produit (titre absent) ──
console.log("\n── fallback nom produit ──");
{
  const { text } = renderLossAlertEmail({ shop: "s", basculements: [b({ id: "gid://shopify/Product/4242", to: "loss", margin: -1 })] });
  ok(text.includes("Produit 4242"), "titre absent → 'Produit 4242'");
}

// ── pertes seules → pas de section 'objectif' ──
console.log("\n── pertes seules ──");
{
  const { html } = renderLossAlertEmail({ shop: "s", basculements: [b({ id: "gid://shopify/Product/5", to: "loss", margin: -2 })] });
  ok(/Vous perdez/.test(html) && !/au-dessus de votre objectif/i.test(html), "section perte seule, pas de section rétabli");
}

// ── devise respectée ──
console.log("\n── devise par produit ──");
{
  const { text } = renderLossAlertEmail({ shop: "s", basculements: [b({ id: "gid://shopify/Product/6", to: "loss", margin: -5, cur: "EUR" })] });
  ok(text.includes("€"), "EUR formaté en €");
}

// ── SEUIL : 2 niveaux (perte réelle / sous l'objectif) + % sur le sous-objectif ──
console.log("\n── seuil : perte vs sous l'objectif ──");
{
  const { html, text } = renderLossAlertEmail({
    shop: "s.myshopify.com", thresholdPct: 15,
    basculements: [
      b({ id: "gid://shopify/Product/1", to: "loss", margin: -4.5, pct: -9, cur: "EUR", title: "Tasse" }),
      b({ id: "gid://shopify/Product/2", to: "loss", margin: 2.1, pct: 8, cur: "EUR", title: "Carnet" }),
    ],
  });
  ok(/Vous perdez de l'argent/.test(html) && /sous votre objectif de 15 %/i.test(html), "2 sections : perte / sous l'objectif de 15 %");
  ok(text.includes("Tasse : -4,50") && !text.includes("-9,0"), "Tasse (margin<0) → montant seul, PAS de % (le -9,0 % n'apparaît pas)");
  ok(text.includes("Carnet : +2,10") && text.includes("8,0 %"), "Carnet (0≤margin<seuil) → montant + % vs objectif");
}

// ── seuil=0 : aucune section 'sous l'objectif' ──
console.log("\n── seuil=0 : pas de bande 'sous l'objectif' ──");
{
  const { html } = renderLossAlertEmail({ shop: "s", basculements: [b({ id: "gid://shopify/Product/3", to: "loss", margin: -2, pct: -5 })] });
  ok(/Vous perdez/.test(html) && !/sous votre objectif/i.test(html), "seuil 0 : perte seule");
}

// ── DÉLIVRABILITÉ : texte brut ≡ HTML (mêmes chiffres) — jamais de mail HTML-only ──
console.log("\n── texte brut ≡ HTML : mêmes chiffres ──");
{
  const { html, text } = renderLossAlertEmail({
    shop: "s", thresholdPct: 80,
    basculements: [
      b({ id: "gid://shopify/Product/1", to: "loss", margin: -4.05, cur: "USD", title: "Coque",
        topCost: { label: "la TVA à l'import non récupérable", amount: 9.2, achatPort: 40 }, bdAvail: true }),
      b({ id: "gid://shopify/Product/2", to: "loss", margin: 729.27, pct: 60.8, cur: "USD", title: "Snow" }),
    ],
  });
  ok(html.length > 0 && text.length > 0, "html ET texte non vides (jamais HTML-only)");
  for (const fig of ["-4,05", "40,00", "9,20", "TVA à l'import non récupérable", "+729,27", "60,8"]) {
    ok(html.includes(fig) && text.includes(fig), `« ${fig} » présent dans le HTML ET le texte`);
  }
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 10 (mail alerte) : ✓ Tous les tests passent"
  : ` BILAN LOT 10 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
