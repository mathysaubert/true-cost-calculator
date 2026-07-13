// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Dunning — rendu PUR des mails (app/lib/dunning.js). Asserts sur
//  subject/html/text. LIEN de régularisation TOUJOURS présent dans la relance ;
//  ton FACTUEL (aucun dark pattern). Aucun envoi réseau (Resend isolé). engine.js intouché.
//  Pour lancer : node tests/lot12_dunning_email.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { renderDunningEmail, renderDunningResolvedEmail } from "../app/lib/dunning.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

const URL = "https://demo.myshopify.com/admin/charges/123/456/RecurringApplicationCharge/confirm?signature=abc";

// ── mail de relance : lien TOUJOURS présent (html + texte) ──
console.log("\n── relance : lien de régularisation présent ──");
{
  const { subject, html, text } = renderDunningEmail({ shop: "demo.myshopify.com", plan: "True Cost Calculator Pro", confirmationUrl: URL });
  ok(html.includes(URL), "lien présent dans le HTML (bouton + lien copiable)");
  ok(text.includes(URL), "lien présent dans le texte brut");
  ok(/href="https:\/\/demo\.myshopify\.com[^"]*"/.test(html), "lien cliquable (href)");
  ok(/paiement/i.test(subject) && /plus actif/i.test(subject), `sujet factuel : paiement échoué + plus actif (${subject})`);
  ok(/True Cost Calculator Pro/.test(text), "plan nommé (le bon plan)");
}

// ── ATTRIBUTION EXACTE + échéance honnête + aucun dark pattern ──
console.log("\n── attribution correcte, échéance honnête, aucun dark pattern ──");
{
  const { subject, html, text } = renderDunningEmail({ shop: "s", plan: "True Cost Calculator Expert", confirmationUrl: URL });
  const blob = (subject + " " + html + " " + text).toLowerCase();
  // Conséquence réelle énoncée (accès verrouillé car abonnement plus actif) + rassurance données.
  ok(blob.includes("plus actif") && blob.includes("verrouillé"), "conséquence : abonnement plus actif → accès verrouillé");
  ok(blob.includes("vos données sont conservées"), "rassurance données conservées (pas de dark pattern par peur)");
  // Attribution : on n'accuse PAS Shopify d'avoir suspendu/coupé (faux en frozen).
  ok(!/shopify a suspendu|shopify a coupé|shopify a résilié/.test(blob), "pas d'attribution fausse à Shopify (frozen ≠ coupure Shopify)");
  // Échéance : honnête, pas de fausse date.
  ok(blob.includes("politique de facturation"), "échéance honnête (délai selon Shopify), aucune fausse date inventée");
  // Aucun terme de fausse urgence / manipulation.
  const darkTerms = ["dernière chance", "derniere chance", "urgent", "immédiatement", "compte à rebours", "expire dans", "plus que", "agissez maintenant", "!!!"];
  const found = darkTerms.filter((t) => blob.includes(t));
  ok(found.length === 0, `aucun terme dark-pattern (trouvés: ${found.join(", ") || "aucun"})`);
  // Pas d'emphase criée (pas de mot tout en capitales ≥ 4 lettres).
  ok(!/\b[A-ZÀ-Ý]{4,}\b/.test(text.replace(/TVA|CA/g, "")), "aucun mot en CAPITALES");
}

// ── mail "resolved" : sobre, pas de lien d'action, remerciement ──
console.log("\n── resolved : sobre ──");
{
  const { subject, html, text } = renderDunningResolvedEmail({ shop: "s", plan: "True Cost Calculator Pro" });
  ok(/rétabli|réglé/i.test(subject), `sujet : c'est réglé / accès rétabli (${subject})`);
  ok(/réactivé/i.test(text) && /merci/i.test(text), "corps : abonnement réactivé + merci");
  ok(!/RecurringApplicationCharge|confirm\?signature/.test(html), "pas de lien de charge dans le 'resolved' (rien à régulariser)");
}

// ── robustesse : plan absent → wording neutre, lien toujours là ──
console.log("\n── plan absent (fallback neutre) ──");
{
  const { html, text } = renderDunningEmail({ shop: "s", plan: null, confirmationUrl: URL });
  ok(text.includes("votre abonnement") && html.includes(URL), "fallback 'votre abonnement' + lien conservé");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 12 (mail dunning) : ✓ Tous les tests passent"
  : ` BILAN LOT 12 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
