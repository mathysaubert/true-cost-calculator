// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOUS PERMANENTS — couche affichage / payload (BUG 1, BUG 2, cpaColor)
//  Les preuves de ces bugs étaient des scripts jetables. Elles sont désormais
//  PERMANENTES : si quelqu'un réintroduit une dérivation inline dans le payload IA
//  ou re-hardcode un nom de plateforme dans le conseil, npm test casse → build bloqué.
//  Importe le VRAI code (app/lib/roas.js, app/lib/aiPayload.js, app/lib/engine.js),
//  pas une réimplémentation.
//  Pour lancer : node tests/lot4_display_guardrails.mjs
// ════════════════════════════════════════════════════════════════════════════════

import {
  AD_PLATFORM_RANGES, platformLabel, roasInviable, roasReachability,
  computeCpaAdvice, computeCpaColor, computeRoasPhrase, computeRoasLabel,
} from "../app/lib/roas.js";
import { buildMargeLine } from "../app/lib/aiPayload.js";
import { computeMargin, formatEur } from "../app/lib/engine.js";
import { formatMoney } from "../app/lib/orderHistory.js";

const GREEN = "#008060", RED = "#D72C0D";
let failures = 0;
const ok   = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

// Balayage ROAS couvrant les trois verdicts (Viable / Limite / Difficile) + irréaliste.
const ROAS_SWEEP = [];
for (let r = 0.5; r <= 12.0 + 1e-9; r = +(r + 0.1).toFixed(1)) ROAS_SWEEP.push(r);

const labelsAt   = (roas) => AD_PLATFORM_RANGES.map((p) => platformLabel(roas, p.min, p.max));
const namesAt    = (roas) => AD_PLATFORM_RANGES.map((p) => p.name);
const difficileAt = (roas) => AD_PLATFORM_RANGES.filter((p) => platformLabel(roas, p.min, p.max) === "Difficile");

// ── TEST BUG 2 : le conseil ne nomme JAMAIS une plateforme « Difficile » ─────
console.log("\n── BUG 2 : cpaAdvice ne nomme aucune plateforme Difficile (balayage ROAS) ──");
{
  let offenders = 0;
  for (const roas of ROAS_SWEEP) {
    const advice = computeCpaAdvice(roas);
    for (const p of difficileAt(roas)) {
      if (advice.includes(p.name)) {
        offenders++;
        console.log(`  ✗ ROAS ${roas}: conseil nomme « ${p.name} » marquée Difficile → "${advice}"`);
      }
    }
  }
  ok(offenders === 0, `aucun conseil ne nomme une plateforme Difficile sur ${ROAS_SWEEP.length} ROAS testés`);

  // Même garde-fou pour la phrase d'ambiance ROAS (ex-« Meta » figé).
  let phraseOffenders = 0;
  for (const roas of ROAS_SWEEP) {
    const phrase = computeRoasPhrase(roas);
    for (const p of difficileAt(roas)) {
      if (phrase.includes(p.name) || phrase.split(" ").includes(p.name.split(" ")[0])) {
        phraseOffenders++;
        console.log(`  ✗ ROAS ${roas}: roasPhrase nomme « ${p.name} » marquée Difficile → "${phrase}"`);
      }
    }
  }
  ok(phraseOffenders === 0, `roasPhrase ne nomme jamais une plateforme Difficile sur ${ROAS_SWEEP.length} ROAS testés`);

  // Couverture : le balayage traverse bien les trois verdicts.
  const seen = new Set();
  for (const roas of ROAS_SWEEP) for (const l of labelsAt(roas)) seen.add(l);
  ok(seen.has("Viable") && seen.has("Limite") && seen.has("Difficile"),
     `le balayage couvre les trois verdicts (${[...seen].sort().join(", ")})`);
}

// ── TEST BUG 1 : marge brute du payload = m.margeBrute (moteur), pas re-dérivée ─
console.log("\n── BUG 1 : marge brute du payload IA = m.margeBrute (assujetti + taxesIncluded) ──");
{
  // Cas exact où le bug frappait : assujetti + prix TTC → revenu HT ≠ prixVente.
  const m = computeMargin({
    prixAchat: 40, prixVente: 100, categorie: "Sport", paysImport: "Chine",
    shopifyFee: 2, stripeFee: 1.5, processorFixedFee: 0.25, retours: 3, ads: 10,
    vatRegime: "assujetti", shopTaxesIncluded: true, shippingModel: "stock",
  });
  const line = buildMargeLine(m);
  const reDerivedTTC = formatEur(100 - m.coutRendu); // l'ANCIENNE valeur buggée (base TTC)

  ok(m.margeBrute.toFixed(2) !== (100 - m.coutRendu).toFixed(2),
     `pré-condition : base HT ≠ base TTC (sinon le test ne prouve rien) — HT ${formatEur(m.margeBrute)} vs TTC ${reDerivedTTC}`);
  ok(line.includes(`(${formatEur(m.margeBrute)})`),
     `le payload cite la marge brute moteur ${formatEur(m.margeBrute)}`);
  ok(!line.includes(`(${reDerivedTTC})`),
     `le payload ne contient PAS la valeur re-dérivée TTC ${reDerivedTTC}`);

  // Robustesse : sur plusieurs régimes, la marge brute citée == moteur, toujours.
  const cases = [
    { nom: "franchise/stock",       p: { vatRegime: "franchise",  shopTaxesIncluded: true,  shippingModel: "stock" } },
    { nom: "assujetti/non-TTC",     p: { vatRegime: "assujetti",  shopTaxesIncluded: false, shippingModel: "stock" } },
    { nom: "assujetti/dropship",    p: { vatRegime: "assujetti",  shopTaxesIncluded: true,  shippingModel: "dropshipping" } },
  ];
  for (const c of cases) {
    const mm = computeMargin({ prixAchat: 12, prixVente: 49.99, categorie: "Cosmétique", paysImport: "Turquie",
      shopifyFee: 2, stripeFee: 2.5, processorFixedFee: 0.25, retours: 4, ads: 15, ...c.p });
    ok(buildMargeLine(mm).includes(`(${formatEur(mm.margeBrute)})`),
       `${c.nom} : marge brute citée = moteur (${formatEur(mm.margeBrute)})`);
  }

  // DEVISE : buildMargeLine formate dans la devise passée (défaut EUR = legacy). Le prompt IA n'est
  // donc plus en € en dur pour un marchand USD.
  ok(buildMargeLine(m) === buildMargeLine(m, "EUR"), "défaut = EUR (rétro-compat : identique à formatEur)");
  ok(buildMargeLine(m, "USD").includes(formatMoney(m.margeBrute, "USD")) && !buildMargeLine(m, "USD").includes("€"),
     "devise USD → montants en $, aucun € dans la ligne de marges du prompt");
}

// ── TEST cpaColor : cohérence stricte des deux canaux (couleur ⟺ conseil) ─────
console.log("\n── cpaColor : assert croisé couleur ⟺ conseil (balayage ROAS) ──");
{
  let v1 = 0, v2 = 0;
  for (const roas of ROAS_SWEEP) {
    const color  = computeCpaColor(roas);
    const advice = computeCpaAdvice(roas);
    const nommeUnePlateforme = namesAt(roas).some((n) => advice.includes(n));
    const labels = labelsAt(roas);
    const troisDifficiles = labels.every((l) => l === "Difficile");

    // (1) vert ⟺ le conseil nomme ≥ 1 plateforme (anti-contradiction d'écran)
    if ((color === GREEN) !== nommeUnePlateforme) {
      v1++;
      console.log(`  ✗ ROAS ${roas}: vert=${color === GREEN} mais nomme≥1=${nommeUnePlateforme} → "${advice}"`);
    }
    // (2) rouge ⟺ 3× Difficile ou ROAS irréaliste (frontière orange/rouge)
    if ((color === RED) !== (troisDifficiles || roasInviable(roas))) {
      v2++;
      console.log(`  ✗ ROAS ${roas}: rouge=${color === RED} mais (3×Difficile||irréaliste)=${troisDifficiles || roasInviable(roas)}`);
    }
  }
  ok(v1 === 0, "vert ⟺ le conseil nomme ≥ 1 plateforme (donc non-vert ⟺ organique)");
  ok(v2 === 0, "rouge ⟺ 3× Difficile ou ROAS irréaliste");
}

// ── 4 surfaces verrouillées sur UN verdict : couleur chiffre = cpaColor, et
//    label/phrase/couleur dérivent tous de la même reachability ──────────────
console.log("\n── Cohérence des 4 surfaces ROAS (couleur chiffre / label / phrase / cpaColor) ──");
{
  const colorToReach = { "#008060": "facile", "#B98900": "tendu", "#D72C0D": "difficile" };
  const labelToReach = { "Atteignable": "facile", "Tendu": "tendu", "Difficile": "difficile" };
  const phraseToReach = (p) => p.includes("atteignable") ? "facile" : p.includes("tendu") ? "tendu" : "difficile";

  let diverge = 0;
  for (const roas of ROAS_SWEEP) {
    const ref = roasReachability(roas);
    const surfaces = {
      "couleur chiffre (=cpaColor)": colorToReach[computeCpaColor(roas)],
      "label chiffre":              labelToReach[computeRoasLabel(roas)],
      "phrase":                     phraseToReach(computeRoasPhrase(roas)),
    };
    for (const [nom, val] of Object.entries(surfaces)) {
      if (val !== ref) {
        diverge++;
        console.log(`  ✗ ROAS ${roas}: ${nom}=${val} ≠ verdict ${ref}`);
      }
    }
  }
  ok(diverge === 0, "couleur chiffre, label et phrase dérivent tous du même verdict agrégé");
}

// ── Langage simplifié : aucune phrase/conseil ROAS ne porte de tiret cadratin ─
//    (chantier langage : le tiret cadratin en ponctuation est banni des chaînes marchand)
console.log("\n── Typo : 0 tiret cadratin/demi-cadratin dans conseils & phrases ROAS ──");
{
  let dash = 0;
  for (const roas of ROAS_SWEEP) {
    for (const s of [computeCpaAdvice(roas), computeRoasPhrase(roas)]) {
      if (s.includes("—") || s.includes("–")) { dash++; console.log(`  ✗ ROAS ${roas}: tiret cadratin dans "${s}"`); }
    }
  }
  ok(dash === 0, `aucun tiret cadratin dans conseil/phrase ROAS sur ${ROAS_SWEEP.length} ROAS`);
}

// ── Table des bascules (lecture humaine) ─────────────────────────────────────
console.log("\n── Bascules cpaColor (PV=100€ pour mémoire) ──");
console.log("  ROAS  | Meta/TikTok/Google           | couleur | conseil");
let prevColor = null;
for (const roas of [1.5, 2.0, 2.6, 2.9, 3.0, 4.0, 5.0, 5.1, 6.7, 11.0]) {
  const color = computeCpaColor(roas);
  const verd  = labelsAt(roas).map((l, i) => `${AD_PLATFORM_RANGES[i].name.split(" ")[0]}:${l[0]}`).join(" ");
  const cName = color === GREEN ? "VERT  " : color === RED ? "ROUGE " : "ORANGE";
  const advC  = computeCpaAdvice(roas).startsWith("Aucune") ? "organique" : "nomme plateformes";
  const flag  = prevColor && prevColor !== color ? " ◄ bascule" : "";
  console.log(`  ${String(roas).padEnd(5)} | ${verd.padEnd(28)} | ${cName} | ${advC}${flag}`);
  prevColor = color;
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 4 (garde-fous affichage) : ✓ Tous les tests passent"
  : ` BILAN LOT 4 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
