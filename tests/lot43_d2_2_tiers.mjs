// ════════════════════════════════════════════════════════════════════════════════
//  LOT 43 — D2-2 lot C (2026-09-27) : paliers de volume.
//  1. Palier pur : bornes de mois, mois précédent, dépassement et offre adaptée (Y2, Z5).
//  2. Comptage depuis `orders` (Z2) : mois de création local, test et brouillons exclus.
//  3. Dépassement (Z3) : bandeau (Aujourd'hui, Offre), UN e-mail par mois dépassé, jamais sur un doute.
//  4. Fin de la coupure des alertes au volume (Y3) ; ancien compteur usage.orders_count plus lu.
//  Pour lancer : node tests/lot43_d2_2_tiers.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { overageOf, monthRange, prevMonthOf, planLabelOf, PLAN_ORDER_CAPS } from "../app/lib/plan.js";
import { renderOverageEmail } from "../app/lib/overageEmail.js";
import { CONTACT_EMAIL, customPlanMailto } from "../app/lib/plans.js";
import { CATALOGS } from "../app/locales/index.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (p) => read(p).replace(/\/\/.*$/gm, "");

console.log("\n── 1. Palier pur ──");
{
  ok(JSON.stringify(monthRange("2026-09")) === '{"from":"2026-09-01","to":"2026-10-01"}' && monthRange("2026-12").to === "2027-01-01", "bornes du mois (fin exclue), passage d'année");
  ok(prevMonthOf("2026-10") === "2026-09" && prevMonthOf("2026-01") === "2025-12", "mois précédent, passage d'année");
  const o = (plan, count) => overageOf({ plan, count });
  ok(!o("free", 50).over && o("free", 51).over && o("free", 51).suggest === "pro", "Gratuit : 50 compris (borne incluse), 51 → dépassement, offre adaptée Pro");
  ok(o("free", 501).suggest === "expert" && o("free", 3001).suggest === "custom", "Gratuit à 501 → Expert ; à 3 001 → sur mesure");
  ok(!o("pro", 500).over && o("pro", 501).suggest === "expert" && o("pro", 4000).suggest === "custom", "Pro : 500 compris, 501 → Expert, 4 000 → sur mesure");
  ok(!o("expert", 3000).over && o("expert", 3001).suggest === "custom", "Expert : 3 000 compris, au-delà → sur mesure (Z5)");
  ok(o("inconnu", 60).plan === "free" && o("free", undefined).count === 0 && !o("free", undefined).over, "offre inconnue → Gratuit ; compteur absent → 0");
  ok(planLabelOf({ isPro: true, isExpert: true }) === "expert" && planLabelOf({ isPro: true }) === "pro" && planLabelOf({}) === "free", "libellé d'offre");
  ok(PLAN_ORDER_CAPS.free === 50 && PLAN_ORDER_CAPS.pro === 500 && PLAN_ORDER_CAPS.expert === 3000, "volumes Y2");
}

console.log("\n── 2. Comptage depuis orders (Z2) ──");
{
  const { monthOrderCount, loadPlanUsage } = await import("../app/lib/usage.server.js");
  const calls = [];
  const fake = (count = 42, error = null) => ({ from: (t) => { const q = { t, ops: [] }; calls.push(q); const chain = { select: (...a) => { q.ops.push(["select", ...a]); return chain; }, eq: (...a) => { q.ops.push(["eq", ...a]); return chain; }, gte: (...a) => { q.ops.push(["gte", ...a]); return chain; }, lt: (...a) => { q.ops.push(["lt", ...a]); return chain; }, or: (...a) => { q.ops.push(["or", ...a]); return Promise.resolve({ count, error }); } }; return chain; } });
  const n = await monthOrderCount({ supabase: fake(42), shop: "s.myshopify.com", month: "2026-09" });
  const ops = calls[0].ops.map((x) => JSON.stringify(x)).join(" ");
  ok(n === 42 && calls[0].t === "orders", "compte lu dans orders");
  ok(/\["eq","shop_domain","s\.myshopify\.com"\]/.test(ops) && /\["gte","day_local","2026-09-01"\]/.test(ops) && /\["lt","day_local","2026-10-01"\]/.test(ops), "mois de création selon la date locale de la boutique (day_local), fin exclue");
  ok(/\["or","excluded_reason\.is\.null,excluded_reason\.not\.in\.\(test,draft\)"\]/.test(ops), "commandes de test et brouillons exclues ; annulées, B2B et cartes cadeaux comptent");
  ok(/\{"count":"exact","head":true\}/.test(ops), "comptage sans lecture des lignes (head)");
  calls.length = 0;
  const u = await loadPlanUsage({ supabase: fake(73), shop: "s.myshopify.com", plan: "free", timeZone: "Europe/Paris", now: new Date("2026-10-01T00:30:00+02:00") });
  ok(u.month === "2026-10" && u.prevMonth === "2026-09" && u.over && u.suggest === "pro" && calls.length === 2, "1er octobre 0 h 30 à Paris : mois courant octobre (fuseau de la boutique), dépassement de septembre constaté");
  const bad = await loadPlanUsage({ supabase: fake(0, { message: "boom" }), shop: "s.myshopify.com", plan: "free" });
  ok(bad === null, "échec de lecture → null (aucun bandeau plutôt qu'un bandeau faux)");
}

console.log("\n── 3. Dépassement (Z3) ──");
{
  const usage = { prevMonth: "2026-09", count: 73, cap: 50, plan: "free", suggest: "pro" };
  const m = renderOverageEmail({ shop: "s.myshopify.com", usage, appUrl: "https://s.myshopify.com/admin/apps/k/app/settings/plan" });
  ok(/73 commandes en septembre 2026, au-delà de votre offre Gratuit/.test(m.subject) && /au-delà des 50 comprises dans l'offre Gratuit/.test(m.text), "e-mail : constat chiffré, mois en toutes lettres");
  ok(/Rien n'est bloqué/.test(m.text) && /offre Pro/.test(m.text) && /Voir les offres : https:\/\/s\.myshopify\.com\/admin\/apps\/k\/app\/settings\/plan/.test(m.text) && m.html.includes("Voir les offres"), "e-mail : jamais de blocage, offre adaptée, lien vers l'écran Offre (texte et HTML)");
  const c = renderOverageEmail({ shop: "s.myshopify.com", usage: { ...usage, count: 3412, cap: 3000, plan: "expert", suggest: "custom" } });
  ok(c.text.includes(`une offre sur mesure est possible sur demande, à ${CONTACT_EMAIL}.`) && !/répondez/.test(c.text) && !/Voir les offres/.test(c.text), "sur mesure : adresse de contact publique (l'expéditeur ne reçoit pas de réponse), sans lien si absent");
  ok(customPlanMailto("s.myshopify.com") === `mailto:${CONTACT_EMAIL}?subject=Offre%20sur%20mesure%20-%20s.myshopify.com` && read("app/routes/privacy.jsx").includes(CONTACT_EMAIL), "demande d'offre sur mesure : mailto du contact déjà publié (page de confidentialité)");
  const cron = code("app/routes/api.cron.profitability.jsx");
  ok(/if \(ent\.source !== "indeterminate"\) \{[\s\S]*?loadPlanUsage\(/.test(cron), "cron : dépassement évalué seulement sur une offre connue (jamais sur un doute)");
  ok(/from\("alert_state"\)\.select\("last_notified_at"\)[\s\S]*?\.eq\("alert_type", "plan_overage"\)\.eq\("subject_key", usage\.prevMonth\)/.test(cron) && /if \(!sent\?\.last_notified_at\)/.test(cron), "cron : un seul e-mail par mois dépassé (alert_state plan_overage / mois)");
  ok(/if \(await sendOverageEmail\(\{ to, shop, usage \}\)\) \{[\s\S]*?from\("alert_state"\)\.upsert\(/.test(cron), "cron : le mois n'est marqué notifié qu'après un envoi réussi");
  ok(/PlanOverageBanner usage=\{view\.planUsage\}/.test(read("app/routes/app.overview.jsx")) && /from\("shop_plans"\)\.select\("plan"\)/.test(read("app/routes/app.overview.jsx")) && /known\?\.plan \? await loadPlanUsage/.test(read("app/routes/app.overview.jsx")), "Aujourd'hui : bandeau d'après la dernière offre connue, aucun sans offre connue");
  const offre = read("app/routes/app.settings.plan.jsx");
  ok(/ent\.source === "indeterminate" \? null : await loadPlanUsage/.test(offre) && /suggest: usage\?\.over && usage\.suggest !== "custom" \? usage\.suggest : null/.test(offre), "Offre : volume face à l'offre reconnue ; carte adaptée mise en avant");
  const keys = ["overage.title", "overage.body", "overage.suggest", "overage.custom", "overage.cta", "overage.custom_cta", "plan.badge.suggested"];
  ok(keys.every((k) => CATALOGS.fr[k] && CATALOGS.en[k]), "textes du dépassement traduits en/fr");
}

console.log("\n── 4. Fin de la coupure des alertes (Y3), ancien compteur ──");
{
  const cron = code("app/routes/api.cron.profitability.jsx");
  ok(!/planToOrderCap|alertingEnabled\(|previousMonth|from\("usage"\)/.test(cron), "cron : plus de plafond 200 / 1 000, plus de lecture de usage.orders_count");
  ok(/const enabled = true;/.test(cron), "alertes jamais coupées au volume (Y3)");
  ok(!/planToOrderCap|export function alertingEnabled/.test(read("app/lib/plan.js")), "ancien plafond retiré de plan.js");
  ok(read("package.json").includes("lot43_d2_2_tiers"), "lot 43 dans la chaîne de tests");
}

console.log(`\n══════════════════════════════════════════════════════════════════\n BILAN LOT 43 (D2-2 C) : ${failures === 0 ? "✓ Tous les tests passent" : `✗ ${failures} assertion(s) en échec`}\n══════════════════════════════════════════════════════════════════`);
process.exit(failures === 0 ? 0 : 1);
