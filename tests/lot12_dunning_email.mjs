// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Dunning — rendu PUR des mails (app/lib/dunning.js). Asserts sur
//  subject/html/text. LIEN de régularisation TOUJOURS présent dans la relance ;
//  ton FACTUEL (aucun dark pattern). Aucun envoi réseau (Resend isolé). engine.js intouché.
//  Pour lancer : node tests/lot12_dunning_email.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { renderDunningEmail, renderDunningResolvedEmail } from "../app/lib/dunning.js";
import { FROZEN_GRACE_DAYS } from "../app/lib/plan.js"; // MÊME source que la borne (pas de redéf)

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
  ok(/paiement/i.test(subject) && /échou/i.test(subject), `sujet factuel : paiement échoué (${subject})`);
  ok(/True Cost Calculator Pro/.test(text), "plan nommé (le bon plan)");
}

// ── VÉRITÉ DE L'ÉTAT : accès MAINTENU en grâce, coupure À VENIR, aucun dark pattern (Chantier B) ──
console.log("\n── accès maintenu, coupure à venir, honnête, aucun dark pattern ──");
{
  const { subject, html, text } = renderDunningEmail({ shop: "s", plan: "True Cost Calculator Expert", confirmationUrl: URL });
  const blob = (subject + " " + html + " " + text).toLowerCase();
  // Chantier B : le mail NE prétend PLUS un verrouillage actuel — suivi de marge/alertes n'ont
  // AUCUNE garde de plan, et l'audit (Expert) reste ouvert en FROZEN via la grâce (D2). Il n'énonce
  // donc AUCUN verrou présent.
  ok(!blob.includes("verrouillé"), "aucune affirmation de verrouillage actuel (faux : rien n'est coupé en grâce)");
  ok(!/n['’ ]est\s+(donc\s+)?plus actif/.test(blob), "ne prétend pas que l'abonnement/accès est déjà inactif");
  // Vérité : l'accès CONTINUE pendant la grâce ; la coupure est CONDITIONNELLE et À VENIR.
  ok(blob.includes("votre accès à true cost calculator continue"), "vérité : l'accès continue pendant la grâce");
  ok(blob.includes("si le paiement n'aboutit pas"), "coupure présentée comme conditionnelle / à venir, pas actuelle");
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

// ── Chantier B (suite) : mail CONDITIONNEL à l'âge du gel — une seule source de vérité ──
// frozenSince + now injectés EXACTEMENT comme planEntitlement ; MÊME FROZEN_GRACE_DAYS (importée),
// MÊME borne inclusive → mail et gating ne peuvent pas diverger. Les DEUX branches sont EXÉCUTÉES.
console.log("\n── Chantier B suite : mail conditionnel à l'âge du gel ──");
{
  const DAY = 86_400_000;
  const NOW = Date.now();
  const cont = "votre accès à true cost calculator continue"; // branche grâce en cours
  const susp = "est maintenant suspendu";                     // branche grâce expirée
  const mk = (frozenSince) => renderDunningEmail({ shop: "s", plan: "True Cost Calculator Pro", confirmationUrl: URL, frozenSince, now: NOW });

  // (1) gel 5 j → grâce EN COURS → "accès continue", pas de suspension.
  {
    const { html, text } = mk(NOW - 5 * DAY);
    const blob = (html + " " + text).toLowerCase();
    ok(blob.includes(cont) && !blob.includes(susp), "gel 5 j (grâce en cours) → 'accès continue', pas de suspension");
  }

  // (2) gel 30 j → grâce EXPIRÉE → ABSENCE de "accès continue" + texte de suspension vrai + aidant.
  {
    const { html, text } = mk(NOW - 30 * DAY);
    const blob = (html + " " + text).toLowerCase();
    ok(!blob.includes(cont), "gel 30 j (grâce expirée) → ABSENCE de 'votre accès continue' (fin de la contre-vérité)");
    ok(blob.includes(susp), "gel 30 j → 'est maintenant suspendu' (état réel)");
    ok(blob.includes("rétabli dès que votre paiement"), "gel 30 j → rétablissement dès régularisation (aidant)");
    ok(blob.includes(URL.toLowerCase()), "gel 30 j → confirmationUrl TOUJOURS présent (action principale)");
    const darkTerms = ["dernière chance", "derniere chance", "urgent", "immédiatement", "compte à rebours", "expire dans", "plus que", "agissez maintenant", "!!!"];
    ok(darkTerms.every((t) => !blob.includes(t)), "gel 30 j → aucun terme dark-pattern");
    ok(!/shopify a suspendu|shopify a coupé|shopify a résilié/.test(blob), "gel 30 j → pas de fausse attribution à Shopify");
    ok(!/\b[A-ZÀ-Ý]{4,}\b/.test(text.replace(/TVA|CA/g, "")), "gel 30 j → aucun mot en CAPITALES");
  }

  // (3) PILE à la borne (now - 28 j exactement) → INCLUSIF = encore en grâce (cohérent D2, <=).
  {
    const { html, text } = mk(NOW - FROZEN_GRACE_DAYS * DAY);
    const blob = (html + " " + text).toLowerCase();
    ok(blob.includes(cont) && !blob.includes(susp), `pile à ${FROZEN_GRACE_DAYS} j → borne INCLUSIVE = encore en grâce (comme la borne d'entitlement D2)`);
  }

  // (4) frozenSince null (edge : hors épisode / R1 non stampé) → défaut SÛR = "accès continue".
  {
    const { html, text } = mk(null);
    const blob = (html + " " + text).toLowerCase();
    ok(blob.includes(cont) && !blob.includes(susp), "frozenSince null → défaut SÛR 'accès continue' (jamais annoncer une suspension à tort)");
  }

  // (5) PARITÉ HTML≡texte sur les fragments des DEUX branches.
  {
    const a = mk(NOW - 5 * DAY);
    ok(a.html.includes("votre accès à True Cost Calculator continue") && a.text.includes("votre accès à True Cost Calculator continue"), "parité branche grâce : fragment dans HTML ET texte");
    const b = mk(NOW - 30 * DAY);
    for (const frag of ["est maintenant suspendu", "rétabli dès que votre paiement est régularisé", URL]) {
      ok(b.html.includes(frag) && b.text.includes(frag), `parité branche suspension : « ${frag.slice(0, 24)}… » dans HTML ET texte`);
    }
  }
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

// ── DÉLIVRABILITÉ : texte brut ≡ HTML (lien, plan, conséquence dans les DEUX) ──
console.log("\n── texte brut ≡ HTML ──");
{
  const { html, text } = renderDunningEmail({ shop: "s", plan: "True Cost Calculator Pro", confirmationUrl: URL });
  ok(html.length > 0 && text.length > 0, "relance : html ET texte non vides (jamais HTML-only)");
  for (const frag of [URL, "True Cost Calculator Pro", "votre accès à True Cost Calculator continue", "Vos données sont conservées"]) {
    ok(html.includes(frag) && text.includes(frag), `« ${frag.slice(0, 28)}… » dans le HTML ET le texte`);
  }
  const r = renderDunningResolvedEmail({ shop: "s", plan: "True Cost Calculator Pro" });
  ok(r.html.length > 0 && r.text.length > 0 && r.html.includes("réactivé") && r.text.includes("réactivé"), "resolved : html ET texte non vides, 'réactivé' dans les deux");
}

// ── Chantier langage : aucun tiret cadratin/demi-cadratin (ponctuation) dans les mails ──
//    Entrées sans tiret (plan/URL) → prouve que les gabarits eux-mêmes n'en produisent aucun.
console.log("\n── typo : 0 tiret cadratin dans les mails dunning ──");
{
  const DAY = 86_400_000, NOW = Date.now();
  const grace = renderDunningEmail({ shop: "s", plan: "True Cost Calculator Pro", confirmationUrl: URL, frozenSince: NOW - 5 * DAY, now: NOW });
  const susp  = renderDunningEmail({ shop: "s", plan: "True Cost Calculator Pro", confirmationUrl: URL, frozenSince: NOW - 30 * DAY, now: NOW });
  const res   = renderDunningResolvedEmail({ shop: "s", plan: "True Cost Calculator Pro" });
  for (const [nom, m] of [["relance/grâce", grace], ["relance/suspension", susp], ["resolved", res]]) {
    ok(![m.subject, m.html, m.text].some((s) => /[—–]/.test(s)), `${nom} : 0 tiret cadratin (sujet/html/texte)`);
  }
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 12 (mail dunning) : ✓ Tous les tests passent"
  : ` BILAN LOT 12 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
