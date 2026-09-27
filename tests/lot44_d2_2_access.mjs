// ════════════════════════════════════════════════════════════════════════════════
//  LOT 44 — D2-2 lot D (2026-09-27) : accès par offre (Z4).
//  1. Alertes e-mail de perte : incluses en Pro et Expert ; en Gratuit l'état avance sans e-mail.
//  2. Simulateur (et mesure à 30 jours qu'il affiche) : Pro ; carte explicative sinon ; doute → rechargement.
//  3. Audit du catalogue : Expert (inchangé) ; décisions retenues depuis Aujourd'hui : toujours enregistrées.
//  Pour lancer : node tests/lot44_d2_2_access.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { decideAlertAction, shouldAdvanceState } from "../app/lib/profitabilityAlert.js";
import { CATALOGS } from "../app/locales/index.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (p) => read(p).replace(/\/\/.*$/gm, "");

console.log("\n── 1. Alertes e-mail de perte ──");
{
  const d = (o) => decideAlertAction({ alertingEnabled: true, hasBasculements: true, ...o });
  ok(d({ hasEmail: true, included: true }) === "send", "incluse (Pro, Expert) + e-mail → envoi");
  ok(d({ hasEmail: true, included: false }) === "advance_only" && shouldAdvanceState("advance_only"), "non incluse (Gratuit) → aucun e-mail, l'état avance (pas de rafale périmée au passage en Pro)");
  ok(d({ hasEmail: true }) === "send", "sans précision → incluse (défaut sûr : un doute n'avale jamais une alerte)");
  ok(decideAlertAction({ hasBasculements: false, included: false }) === "nothing", "aucun basculement → rien");
  const cron = code("app/routes/api.cron.profitability.jsx");
  ok(/const included = ent\.source === "indeterminate" \? true : ent\.isPro === true;/.test(cron), "cron : incluse si Pro ou Expert (dernière offre connue comprise) ; offre indéterminée → incluse");
  ok(/const to = included \? await resolveEmail\(admin\) : null;/.test(cron) && /decideAlertAction\(\{ alertingEnabled: enabled, hasEmail: !!to, hasBasculements: true, included \}\)/.test(cron), "cron : l'adresse n'est même pas lue quand l'alerte n'est pas incluse");
}

console.log("\n── 2. Simulateur ──");
{
  const r = code("app/routes/app.simulator.jsx");
  ok(/const simulatorLock = \(ent\) => \(ent\.source === "indeterminate" \? "indeterminate" : ent\.isPro \? null : "pro"\);/.test(r), "règle : Pro ou Expert → ouvert ; Gratuit → verrou ; indéterminé → rechargement");
  const loader = r.slice(r.indexOf("export const loader"), r.indexOf("export const action"));
  ok(loader.indexOf("simulatorLock(await loadEntitlement") < loader.indexOf("reviewDueDecisions") && /if \(lock\) return \{ locked: lock \};/.test(loader), "chargement : le verrou passe avant tout calcul et avant la revue des décisions à 30 jours");
  const action = r.slice(r.indexOf("export const action"), r.indexOf("export default"));
  ok(/if \(simulatorLock\(await loadEntitlement\(\{ admin, shop: session\.shop \}\)\)\) return \{ intent: "simulate", ok: false, error: "not_included" \};/.test(action) && action.indexOf("not_included") < action.indexOf("recordDecision"), "action : « Retenir » refusé hors Pro, avant tout enregistrement");
  ok(/if \(view\.locked\) \{[\s\S]*?<LockedFeature feature="simulator" plan="pro" indeterminate=\{view\.locked === "indeterminate"\} \/>/.test(r), "écran : carte explicative (Z4 a)");
  const ui = read("app/components/overview/LockedFeature.jsx");
  ok(/to="\/app\/settings\/plan"/.test(ui) && /indeterminate \?/.test(ui), "carte : lien vers l'écran Offre ; offre indéterminée → message, sans lien");
  ok(["locked.simulator.title", "locked.simulator.body", "locked.included", "locked.cta", "locked.indeterminate"].every((k) => CATALOGS.fr[k] && CATALOGS.en[k]) && /30 jours après/.test(CATALOGS.fr["locked.simulator.body"]), "textes en/fr ; la carte mentionne la mesure à 30 jours (incluse en Pro)");
}

console.log("\n── 3. Audit, décisions retenues ──");
{
  const p = code("app/routes/app.products.jsx");
  ok(/if \(ent\?\.isExpert !== true\) return \{ intent: "audit", ok: false, error: "expert_only" \};/.test(p), "audit : réservé à Expert (inchangé)");
  const o = code("app/routes/app.overview.jsx");
  ok(/recordDecision\(\{ supabase, shop: session\.shop, kind: "simulated"/.test(o) && !/loadEntitlement|simulatorLock/.test(o), "Aujourd'hui : une décision retenue est enregistrée quelle que soit l'offre (sa mesure s'affiche en Pro, Z4)");
  ok(read("package.json").includes("lot44_d2_2_access"), "lot 44 dans la chaîne de tests");
}

console.log(`\n══════════════════════════════════════════════════════════════════\n BILAN LOT 44 (D2-2 D) : ${failures === 0 ? "✓ Tous les tests passent" : `✗ ${failures} assertion(s) en échec`}\n══════════════════════════════════════════════════════════════════`);
process.exit(failures === 0 ? 0 : 1);
