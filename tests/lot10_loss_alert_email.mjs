// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Alerting — rendu du mail digest (app/lib/profitabilityAlert.js, PUR)
//  Asserts sur subject/html/text de renderLossAlertEmail. Wording NEUTRE : jamais causal
//  ni daté. Aucun envoi réseau (Resend isolé dans email.server.js). engine.js intouché.
//  Pour lancer : node tests/lot10_loss_alert_email.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { renderLossAlertEmail } from "../app/lib/profitabilityAlert.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

const b = (o) => ({ product_id: o.id, to: o.to, margin: o.margin, currency: o.cur ?? "USD", title: o.title });

// ── digest mixte : passés à perte + redevenus rentables ──
console.log("\n── digest mixte (2 sections) ──");
{
  const { subject, html, text } = renderLossAlertEmail({
    shop: "demo.myshopify.com",
    basculements: [
      b({ id: "gid://shopify/Product/1", to: "loss", margin: -12.4, title: "Snowboard Hydrogen" }),
      b({ id: "gid://shopify/Product/2", to: "profitable", margin: 8.1, title: "Bonnet" }),
    ],
  });
  ok(subject.includes("demo.myshopify.com") && subject.includes("2 produit"), `sujet : shop + compte (${subject})`);
  ok(/perte/i.test(html) && /redevenus rentables/i.test(html), "html : les 2 sections présentes");
  ok(html.includes("Snowboard Hydrogen") && html.includes("Bonnet"), "titres produits affichés");
  ok(/négative/.test(text) && /repassé rentable/.test(text), "wording état : 'négative' + 'repassé rentable'");
  ok(text.includes("12,40") && text.includes("8,10"), "montants au centime");
}

// ── GARDE anti-wording trompeur : jamais de causalité ni de fenêtre datée ──
console.log("\n── wording neutre (ni causal, ni '30 jours') ──");
{
  const { html, text } = renderLossAlertEmail({
    shop: "s.myshopify.com",
    basculements: [b({ id: "gid://shopify/Product/9", to: "loss", margin: -3 })],
  });
  const blob = (html + " " + text).toLowerCase();
  ok(!blob.includes("30 jour") && !blob.includes("30 derniers"), "aucun '30 jours' / '30 derniers'");
  ok(!blob.includes("dernière vente") && !blob.includes("derniere vente") && !blob.includes("fait perdre"), "aucune causalité ('dernière vente', 'fait perdre')");
}

// ── titre absent → fallback 'Produit {fin du gid}' ──
console.log("\n── fallback nom produit ──");
{
  const { text } = renderLossAlertEmail({
    shop: "s", basculements: [b({ id: "gid://shopify/Product/4242", to: "loss", margin: -1 })],
  });
  ok(text.includes("Produit 4242"), `fallback gid → 'Produit 4242' (${text.split("\\n")[1] ?? text})`);
}

// ── que des pertes → pas de section 'redevenus rentables' ──
console.log("\n── pertes seules : une seule section ──");
{
  const { html } = renderLossAlertEmail({
    shop: "s", basculements: [b({ id: "gid://shopify/Product/5", to: "loss", margin: -2 })],
  });
  ok(/perte/i.test(html) && !/redevenus rentables/i.test(html), "section perte seule, pas de section rentable");
}

// ── devise respectée (EUR ≠ USD) ──
console.log("\n── devise par produit ──");
{
  const { text } = renderLossAlertEmail({
    shop: "s", basculements: [b({ id: "gid://shopify/Product/6", to: "loss", margin: -5, cur: "EUR" })],
  });
  ok(text.includes("€"), `EUR formaté en € (${text})`);
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 10 (mail alerte) : ✓ Tous les tests passent"
  : ` BILAN LOT 10 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
