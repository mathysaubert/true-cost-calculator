// ── Envoi d'email (Resend) — module SERVEUR uniquement ──────────────────────
// Jamais importé côté client. Le rendu du template est PUR (renderLossAlertEmail,
// lib/profitabilityAlert.js, testé) ; ici on ne fait que l'appel réseau Resend.
// Robustesse cron : un échec d'envoi LOGUE et retourne false, ne THROW JAMAIS — le job
// continue et l'état des produits basculés n'est pas avancé (réessai au run suivant).
import { Resend } from "resend";
import { renderLossAlertEmail } from "./profitabilityAlert.js";
import { renderDunningEmail, renderDunningResolvedEmail } from "./dunning.js";

// Expéditeur de TEST : onboarding@resend.dev (autorisé sans domaine vérifié).
// Prod : remplacer par une adresse d'un domaine vérifié Resend avant envoi à de vrais marchands.
const FROM = process.env.RESEND_FROM || "True Cost Calculator <onboarding@resend.dev>";

export async function sendLossAlert({ to, shop, basculements, thresholdPct = 0 }) {
  if (!to) { console.warn(`[Alert] email absent pour ${shop} — envoi ignoré`); return false; }
  if (!process.env.RESEND_API_KEY) { console.error("[Alert] RESEND_API_KEY manquant — envoi ignoré"); return false; }
  if (!basculements?.length) return false;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { subject, html, text } = renderLossAlertEmail({ shop, thresholdPct, basculements });
    const { error } = await resend.emails.send({ from: FROM, to, subject, html, text });
    if (error) { console.error(`[Alert] envoi KO pour ${shop} :`, error?.message ?? error); return false; }
    return true;
  } catch (e) {
    console.error(`[Alert] exception envoi pour ${shop} :`, e?.message ?? e);
    return false;
  }
}

// ── Dunning : relance d'un abonnement frozen ────────────────────────────────
// Ne THROW JAMAIS (retourne bool) → le cron n'avance compteur/date qu'après un true (G2).
// Refuse d'envoyer SANS lien de régularisation (un mail de relance sans lien est inutile).
export async function sendDunningEmail({ to, shop, plan, confirmationUrl }) {
  if (!to) { console.warn(`[Dunning] email absent pour ${shop} — envoi ignoré`); return false; }
  if (!process.env.RESEND_API_KEY) { console.error("[Dunning] RESEND_API_KEY manquant — envoi ignoré"); return false; }
  if (!confirmationUrl) { console.error(`[Dunning] lien de régularisation absent pour ${shop} — envoi ignoré`); return false; }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { subject, html, text } = renderDunningEmail({ shop, plan, confirmationUrl });
    const { error } = await resend.emails.send({ from: FROM, to, subject, html, text });
    if (error) { console.error(`[Dunning] envoi KO pour ${shop} :`, error?.message ?? error); return false; }
    return true;
  } catch (e) {
    console.error(`[Dunning] exception envoi pour ${shop} :`, e?.message ?? e);
    return false;
  }
}

// ── Dunning : confirmation "c'est réglé" (retour à active) ───────────────────
export async function sendDunningResolved({ to, shop, plan }) {
  if (!to) { console.warn(`[Dunning] email absent pour ${shop} — confirmation ignorée`); return false; }
  if (!process.env.RESEND_API_KEY) { console.error("[Dunning] RESEND_API_KEY manquant — confirmation ignorée"); return false; }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { subject, html, text } = renderDunningResolvedEmail({ shop, plan });
    const { error } = await resend.emails.send({ from: FROM, to, subject, html, text });
    if (error) { console.error(`[Dunning] confirmation KO pour ${shop} :`, error?.message ?? error); return false; }
    return true;
  } catch (e) {
    console.error(`[Dunning] exception confirmation pour ${shop} :`, e?.message ?? e);
    return false;
  }
}
