// ── Travail après la réponse (B5c) : waitUntil de @vercel/functions prolonge l'invocation jusqu'à
// la fin de la promesse, dans la limite de maxDuration de la route. Hors Vercel (dev local, tests),
// la promesse continue seule ; une erreur est journalisée, jamais propagée à la réponse.
import { waitUntil } from "@vercel/functions";

export function background(promise, label = "background") {
  const p = Promise.resolve(promise).catch((e) => console.error(`[Sync] ${label} :`, e?.message));
  try { waitUntil(p); } catch { /* contexte Vercel absent : rien à prolonger */ }
  return p;
}
