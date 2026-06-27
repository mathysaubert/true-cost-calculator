// ── Envoi d'email (Resend) — module SERVEUR uniquement ──────────────────────
// Jamais importé côté client. Le rendu du template est PUR (renderLossAlertEmail,
// lib/profitabilityAlert.js, testé) ; ici on ne fait que l'appel réseau Resend.
// Robustesse cron : un échec d'envoi LOGUE et retourne false, ne THROW JAMAIS — le job
// continue et l'état des produits basculés n'est pas avancé (réessai au run suivant).
import { Resend } from "resend";
import { renderLossAlertEmail } from "./profitabilityAlert.js";

// Expéditeur de TEST : onboarding@resend.dev (autorisé sans domaine vérifié).
// Prod : remplacer par une adresse d'un domaine vérifié Resend avant envoi à de vrais marchands.
const FROM = process.env.RESEND_FROM || "True Cost Calculator <onboarding@resend.dev>";

export async function sendLossAlert({ to, shop, basculements }) {
  if (!to) { console.warn(`[Alert] email absent pour ${shop} — envoi ignoré`); return false; }
  if (!process.env.RESEND_API_KEY) { console.error("[Alert] RESEND_API_KEY manquant — envoi ignoré"); return false; }
  if (!basculements?.length) return false;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { subject, html, text } = renderLossAlertEmail({ shop, basculements });
    const { error } = await resend.emails.send({ from: FROM, to, subject, html, text });
    if (error) { console.error(`[Alert] envoi KO pour ${shop} :`, error?.message ?? error); return false; }
    return true;
  } catch (e) {
    console.error(`[Alert] exception envoi pour ${shop} :`, e?.message ?? e);
    return false;
  }
}
