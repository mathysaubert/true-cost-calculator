// ── D2-2 (Z3) — E-mail UNIQUE de dépassement de volume — PUR (aucun env, aucune I/O) ────────────
// Envoyé une seule fois par mois dépassé (dédoublonné par alert_state côté cron). Constat, jamais de
// blocage : tout reste accessible. Lien vers l'écran Offre de l'app (appUrl construit par le serveur).
import { emailShell, EMAIL_TEXT, EMAIL_MUTED } from "./emailLayout.js";
import { CONTACT_EMAIL } from "./plans.js";

const NAMES = { free: "Gratuit", pro: "Pro", expert: "Expert" };
const fmt = (n) => Number(n).toLocaleString("fr-FR");
const monthLabel = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

export function renderOverageEmail({ shop, usage, appUrl = null }) {
  const { prevMonth, count, cap, plan, suggest } = usage;
  const subject = `${shop} : ${fmt(count)} commandes en ${monthLabel(prevMonth)}, au-delà de votre offre ${NAMES[plan]}`;
  const lead = `En ${monthLabel(prevMonth)}, votre boutique a reçu ${fmt(count)} commandes, au-delà des ${fmt(cap)} comprises dans l'offre ${NAMES[plan]}.`;
  const reassure = "Rien n'est bloqué : le suivi de vos marges, vos alertes et toutes vos pages restent accessibles.";
  const next = suggest === "custom"
    ? `Au-delà de 3 000 commandes par mois, une offre sur mesure est possible sur demande, à ${CONTACT_EMAIL}.`
    : `L'offre adaptée à ce volume est l'offre ${NAMES[suggest]}. Vous pouvez la choisir depuis l'écran Offre de l'app.`;
  const lines = [lead, "", reassure, "", next];
  if (appUrl) lines.push("", `Voir les offres : ${appUrl}`);
  const text = lines.join("\n");
  const html = emailShell(`<p style="${EMAIL_TEXT}">${lead}</p>
    <p style="${EMAIL_TEXT}">${reassure}</p>
    <p style="${EMAIL_TEXT}">${next}</p>
    ${appUrl ? `<p style="margin:20px 0;${EMAIL_TEXT}"><a href="${appUrl}" style="display:inline-block;padding:10px 18px;background-color:#008060;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600">Voir les offres</a></p>
    <p style="font-size:12px;${EMAIL_MUTED}">Ou copiez ce lien : <a href="${appUrl}" style="color:#008060">${appUrl}</a></p>` : ""}`);
  return { subject, html, text };
}
