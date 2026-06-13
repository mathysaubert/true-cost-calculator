/**
 * test-ai-scenarios.mjs
 *
 * Runs computeScenarios (same logic as production) for 5 test cases,
 * calls the Anthropic API with the production prompt, and prints:
 *   1. The computeScenarios table
 *   2. The raw AI JSON response
 *   3. A reconciliation table (AI figures vs pre-computed figures)
 *
 * Usage (PowerShell):
 *   $env:ANTHROPIC_API_KEY="sk-ant-api03-..."; node test-ai-scenarios.mjs
 *
 * Usage (bash):
 *   ANTHROPIC_API_KEY=sk-ant-api03-... node test-ai-scenarios.mjs
 */

const DE_MINIMIS_DUTY_THRESHOLD = 150;

const CUSTOMS_RATES = {
  Textile: 0.12, Électronique: 0.05, Cosmétique: 0.10,
  Accessoires: 0.07, Sport: 0.05, Alimentation: 0.15,
  Maroquinerie: 0.03, Jouets: 0, Mobilier: 0.027, Autre: 0.03,
};
// Shipping estimates — Test 5 uses "Test5" mapped to 15€
const SHIPPING_ESTIMATES = { Chine: 8, Inde: 6, Turquie: 4, UE: 2, Autre: 5, Test5: 15 };
const VAT_RATES = {
  Textile: 0.20, Électronique: 0.20, Cosmétique: 0.20,
  Accessoires: 0.20, Sport: 0.20, Alimentation: 0.20,
  Maroquinerie: 0.20, Jouets: 0.20, Mobilier: 0.20, Autre: 0.20, Test5: 0.20,
};

const fmt = n => (Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2);
const pct = n => (Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(1);

function getVatRate(cat) { return VAT_RATES[cat] ?? 0.20; }

function getCustomsDuty({ supplierPrice, shippingCost, dutyRate }) {
  if (supplierPrice <= DE_MINIMIS_DUTY_THRESHOLD) return 0;
  return (supplierPrice + shippingCost) * dutyRate;
}

function computeLandedCost(prixAchat, shipping, customsRate, vatRate, vatRegime = "assujetti") {
  const valeurEnDouane = prixAchat + shipping;
  const droitsDouane   = getCustomsDuty({ supplierPrice: prixAchat, shippingCost: shipping, dutyRate: customsRate });
  const baseTVA        = valeurEnDouane + droitsDouane;
  const tvaImport      = baseTVA * vatRate;
  const tvaNetCost     = vatRegime === "franchise" ? tvaImport : 0;
  const coutRendu      = prixAchat + shipping + droitsDouane + tvaNetCost;
  return { valeurEnDouane, droitsDouane, baseTVA, tvaImport, tvaNetCost, coutRendu };
}

function simulateSellingPrice(prixAchat, categorie, paysImport, targetMarginPct, fees) {
  const { shopifyFee, stripeFee, retours, ads, fraisRetour = 0, coutEmballage = 0, processorFixedFee = 0, vatRegime = "assujetti" } = fees;
  const customsRate = CUSTOMS_RATES[categorie] ?? 0.03;
  const vatRate     = getVatRate(categorie);
  const shipping    = SHIPPING_ESTIMATES[paysImport] ?? 5;
  const { coutRendu } = computeLandedCost(prixAchat, shipping, customsRate, vatRate, vatRegime);
  const fraisFixes    = fraisRetour + coutEmballage + processorFixedFee;
  const totalFeeRate  = (shopifyFee + stripeFee + retours + ads) / 100;
  const denominator   = 1 - totalFeeRate - targetMarginPct / 100;
  if (denominator <= 0) return null;
  return { prixVenteMin: (coutRendu + fraisFixes) / denominator };
}

function calcNetMargin(prixAchat, prixVente, categorie, paysImport, shopifyFee, stripeFee, processorFixedFee, retours, ads, fraisRetour, coutEmballage, vatRegime) {
  const customsRate = CUSTOMS_RATES[categorie] ?? 0.03;
  const vatRate     = getVatRate(categorie);
  const shipping    = SHIPPING_ESTIMATES[paysImport] ?? 5;
  const { coutRendu } = computeLandedCost(prixAchat, shipping, customsRate, vatRate, vatRegime);
  const shopifyCost   = prixVente * (shopifyFee / 100);
  const stripeCost    = (prixVente * (stripeFee / 100)) + processorFixedFee;
  const retoursCost   = prixVente * (retours / 100);
  const adsCost       = prixVente * (ads / 100);
  const fraisFixes    = fraisRetour + coutEmballage;
  const margeNette    = (prixVente - coutRendu) - shopifyCost - stripeCost - retoursCost - adsCost - fraisFixes;
  const margeNettePercent = prixVente > 0 ? (margeNette / prixVente) * 100 : 0;
  return { margeNette, margeNettePercent, coutRendu, rentable: margeNette > 0 };
}

function computeScenarios({ prixAchat, prixVente, categorie, paysImport, shopifyFee, stripeFee, processorFixedFee, retours, ads, fraisRetour, coutEmballage, vatRegime }) {
  const run = (o = {}) => {
    const p = { prixAchat, prixVente, shopifyFee, stripeFee, processorFixedFee, retours, ads, fraisRetour, coutEmballage, ...o };
    return calcNetMargin(p.prixAchat, p.prixVente, categorie, paysImport, p.shopifyFee, p.stripeFee, p.processorFixedFee, p.retours, p.ads, p.fraisRetour, p.coutEmballage, vatRegime);
  };

  const current = run();
  const list = [];

  if (coutEmballage > 1.50)
    list.push({ levier: `Emballage réduit à 1,50€ (−${fmt(coutEmballage - 1.50)}€/vente)`, ...run({ coutEmballage: 1.50 }) });
  if (coutEmballage > 3.00)
    list.push({ levier: `Emballage réduit au seuil 3,00€ (−${fmt(coutEmballage - 3.00)}€/vente)`, ...run({ coutEmballage: 3.00 }) });

  const pa80 = parseFloat((prixAchat * 0.80).toFixed(2));
  list.push({ levier: `Fournisseur −20% → ${fmt(pa80)}€`, ...run({ prixAchat: pa80 }) });
  const pa70 = parseFloat((prixAchat * 0.70).toFixed(2));
  list.push({ levier: `Fournisseur −30% → ${fmt(pa70)}€`, ...run({ prixAchat: pa70 }) });

  const pv125 = parseFloat((prixVente * 1.25).toFixed(2));
  list.push({ levier: `Prix de vente +25% → ${fmt(pv125)}€`, ...run({ prixVente: pv125 }) });
  const pv150 = parseFloat((prixVente * 1.50).toFixed(2));
  list.push({ levier: `Prix de vente +50% → ${fmt(pv150)}€`, ...run({ prixVente: pv150 }) });

  if (ads > 0)
    list.push({ levier: `Budget ads suspendu (${pct(ads)}% → 0%)`, ...run({ ads: 0 }) });

  const seuilSim = simulateSellingPrice(prixAchat, categorie, paysImport, 0, { shopifyFee, stripeFee, retours, ads, fraisRetour, coutEmballage, processorFixedFee, vatRegime });
  if (seuilSim && seuilSim.prixVenteMin > 0)
    list.push({ levier: `Prix seuil rentabilité (marge nette = 0,00€)`, prixCible: seuilSim.prixVenteMin, margeNette: 0, margeNettePercent: 0, rentable: false });

  if (coutEmballage > 1.50)
    list.push({ levier: `Combo : emballage 1,50€ + prix +25% (${fmt(pv125)}€)`, ...run({ coutEmballage: 1.50, prixVente: pv125 }) });

  if (current.margeNette < 0 && coutEmballage > 1.50) {
    const seuilCombo = simulateSellingPrice(prixAchat, categorie, paysImport, 0, { shopifyFee, stripeFee, retours, ads, fraisRetour, coutEmballage: 1.50, processorFixedFee, vatRegime });
    if (seuilCombo && seuilCombo.prixVenteMin > 0)
      list.push({ levier: `Combo seuil : emballage 1,50€ + prix minimum → ${fmt(seuilCombo.prixVenteMin)}€`, prixCible: seuilCombo.prixVenteMin, margeNette: 0, margeNettePercent: 0, rentable: false });
  }

  return { current, scenarios: list };
}

function buildPrompt(inputs) {
  const { prixAchat, prixVente, categorie, paysImport, shopifyFee, stripeFee, processorFixedFee, retours, ads, fraisRetour, coutEmballage, vatRegime } = inputs;
  const { current: scenCurrent, scenarios: scenList } = computeScenarios(inputs);

  const scenariosBlock = scenList.map((s, i) =>
    s.prixCible !== undefined
      ? `S${i+1}. ${s.levier}\n   → Marge nette : 0,00€ / 0,0% | Rentable : NON | Prix cible : ${fmt(s.prixCible)}€`
      : `S${i+1}. ${s.levier}\n   → Marge nette : ${fmt(s.margeNette)}€ / ${pct(s.margeNettePercent)}% | Rentable : ${s.rentable ? 'OUI' : 'NON'}`
  ).join('\n\n');

  const customsRate = CUSTOMS_RATES[categorie] ?? 0.03;
  const vatRate     = getVatRate(categorie);
  const shipping    = SHIPPING_ESTIMATES[paysImport] ?? 5;
  const { droitsDouane, tvaImport, coutRendu } = computeLandedCost(prixAchat, shipping, customsRate, vatRate, vatRegime);
  const shopifyCost = prixVente * (shopifyFee / 100);
  const stripeCost  = (prixVente * (stripeFee / 100)) + processorFixedFee;
  const retoursCost = prixVente * (retours / 100);
  const adsCost     = prixVente * (ads / 100);
  const margeBrute  = prixVente - coutRendu;
  const margeBrutePercent = (margeBrute / prixVente) * 100;
  const fraisFixes  = fraisRetour + coutEmballage;
  const margeNette  = margeBrute - shopifyCost - stripeCost - retoursCost - adsCost - fraisFixes;
  const margeNettePercent = (margeNette / prixVente) * 100;
  const margeApparente = ((prixVente - prixAchat) / prixVente) * 100;

  return `Tu es un expert en e-commerce et rentabilité.

DÉFINITIONS CANONIQUES (emploie-les strictement) :
• Marge apparente = (Prix vente − Prix fournisseur) / Prix vente
• Marge brute = (Prix vente − Coût rendu total) / Prix vente — exclut Shopify, Stripe, emballage, retours, ads
• Marge nette = (Prix vente − Coût rendu − TOUS frais vente − Frais fixes) / Prix vente

DONNÉES DU CALCUL :
- Régime TVA : ${vatRegime === "franchise" ? "Franchise en base" : "Assujetti"}
- Prix fournisseur : ${fmt(prixAchat)}€ | Prix de vente : ${fmt(prixVente)}€
- Douane : ${fmt(droitsDouane)}€${prixAchat <= DE_MINIMIS_DUTY_THRESHOLD ? " (exonéré de minimis)" : ""} | TVA import : ${fmt(tvaImport)}€${vatRegime !== "franchise" ? " (récupérable)" : ""} | Port : ${fmt(shipping)}€ | Coût rendu net : ${fmt(coutRendu)}€
- Stripe EU : ${stripeFee}%+${fmt(processorFixedFee)}€ → ${fmt(stripeCost)}€ | Shopify : ${shopifyFee}% → ${fmt(shopifyCost)}€ | Retours : ${retours}% → ${fmt(retoursCost)}€ | Ads : ${ads}% → ${fmt(adsCost)}€
- Emballage : ${fmt(coutEmballage)}€ | Frais retour : ${fmt(fraisRetour)}€
- Marge apparente : ${pct(margeApparente)}% | Marge brute : ${pct(margeBrutePercent)}% (${fmt(margeBrute)}€) | Marge nette : ${pct(margeNettePercent)}% (${fmt(margeNette)}€/vente)

ÉTAT ACTUEL : Marge nette = ${fmt(scenCurrent.margeNette)}€ / ${pct(scenCurrent.margeNettePercent)}% | Rentable : ${scenCurrent.rentable ? 'OUI' : 'NON'}

SCÉNARIOS PRÉ-CALCULÉS PAR LE MOTEUR (chiffres définitifs) :
${scenariosBlock}

INSTRUCTION STRICTE : Tu ne dois effectuer AUCUN calcul arithmétique. Tous les chiffres (€, %) que tu cites doivent être copiés exactement depuis les données ou scénarios fournis ci-dessus. Si un chiffre n'est pas fourni, tu ne le cites pas. Ne projette jamais une marge que tu calcules toi-même.

Sélectionne les 3 scénarios les plus pertinents, ordonnés par marge nette résultante décroissante. Pour chaque action, cite sa marge nette exacte et précise Rentable=OUI/NON. Si marge actuelle ≤ 0 et qu'aucun scénario seul ne la rend positive, recommande la combinaison listée.

Réponds UNIQUEMENT avec ce JSON (sans markdown) :
{"analyse":"2 phrases max sur les 2 postes dominants — cite leurs montants exacts depuis les données","actions":["levier → marge nette X€ (Y%) | Rentable=Z — contexte métier concis","...","..."]}`;
}

// ── Build the full reference set of legitimate values for a given input set ───
// Includes: all inputs, every state-actuel line item, common derived sums,
// and every scenario figure. A number from the AI text is legitimate iff it
// is within ±TOLERANCE of at least one value in this set.
const TOLERANCE = 0.10; // covers € rounding (±0.01) and % display (±0.1pp)

function buildRefSet(inputs) {
  const {
    prixAchat, prixVente, categorie, paysImport,
    shopifyFee, stripeFee, processorFixedFee,
    retours, ads, fraisRetour, coutEmballage, vatRegime,
  } = inputs;

  const customsRate = CUSTOMS_RATES[categorie] ?? 0.03;
  const vatRate     = getVatRate(categorie);
  const shipping    = SHIPPING_ESTIMATES[paysImport] ?? 5;
  const { droitsDouane, tvaImport, coutRendu } = computeLandedCost(prixAchat, shipping, customsRate, vatRate, vatRegime);
  const shopifyCost     = prixVente * (shopifyFee / 100);
  const stripeCost      = (prixVente * (stripeFee / 100)) + processorFixedFee;
  const retoursCost     = prixVente * (retours / 100);
  const adsCost         = prixVente * (ads / 100);
  const totalFraisVente = shopifyCost + stripeCost + retoursCost + adsCost;
  const fraisFixes      = fraisRetour + coutEmballage;
  const margeBrute      = prixVente - coutRendu;
  const margeBrutePercent = (margeBrute / prixVente) * 100;
  const { current, scenarios } = computeScenarios(inputs);
  const margeApparente  = ((prixVente - prixAchat) / prixVente) * 100;
  // "total des charges" = tout ce qui est déduit du prix de vente
  const totalCharges    = prixVente - current.margeNette;

  const refs = new Set();
  const add  = v => { if (Number.isFinite(v)) refs.add(v); };

  // Raw inputs (rates and amounts)
  [prixAchat, prixVente, coutEmballage, fraisRetour, shipping,
   shopifyFee, stripeFee, processorFixedFee, retours, ads,
   customsRate * 100].forEach(add);

  // État actuel — every line item the AI might cite
  [droitsDouane, tvaImport, coutRendu,
   shopifyCost, stripeCost, retoursCost, adsCost,
   totalFraisVente, fraisFixes,
   margeBrute, margeBrutePercent,
   current.margeNette, current.margeNettePercent, current.coutRendu,
   margeApparente, totalCharges].forEach(add);

  // Derived partial sums the AI legitimately uses in narrative
  [adsCost + retoursCost,                            // ex. "ads + retours = 80€"
   shopifyCost + stripeCost,                         // platform fees total
   totalFraisVente + fraisFixes,                     // all variable costs
   coutRendu + totalFraisVente,                      // before fixed costs
   coutRendu + fraisFixes,                           // fixed-cost total
   prixVente - coutRendu,                            // margeBrute (redundant but explicit)
  ].forEach(add);

  // All scenario figures
  for (const s of scenarios) {
    [s.margeNette, s.margeNettePercent, s.coutRendu].forEach(add);
    if (s.prixCible !== undefined) add(s.prixCible);
    // Improvement delta vs current (AI might say "gain de X€")
    if (Number.isFinite(s.margeNette))
      add(s.margeNette - current.margeNette);
  }

  return refs;
}

function isLegitimate(f, refs) {
  for (const r of refs) {
    if (Math.abs(f - r) <= TOLERANCE) return true;
  }
  return false;
}

// ── Reconcile AI output against the full reference set ────────────────────────
// A divergence is a number cited by the AI that is not within ±TOLERANCE of
// any value in the reference set (inputs + state actuel + scenarios + sums).
// For each divergence, the surrounding context is shown.
function reconcile(aiText, inputs) {
  const refs = buildRefSet(inputs);
  const divergences = [];
  const seenVals = new Set();

  // Extract numbers; lookbehind prevents matching "1" in "S1" or "V2"
  const regex = /(?<![a-zA-Z])(-?\d+(?:[.,]\d+)?)/g;
  let m;
  while ((m = regex.exec(aiText)) !== null) {
    const raw = m[1];
    const f   = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(f) || Math.abs(f) < 0.5) continue;

    const key = f.toFixed(3);
    if (seenVals.has(key)) continue;

    if (!isLegitimate(f, refs)) {
      seenVals.add(key);
      const pos   = m.index;
      const start = Math.max(0, pos - 65);
      const end   = Math.min(aiText.length, pos + 65);
      const ctx   = aiText.slice(start, end).replace(/\n/g, ' ').trim();
      divergences.push({ value: raw, context: `"...${ctx}..."` });
    }
  }
  return { divergences };
}

// ── Main ───────────────────────────────────────────────────────────────────────
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('\nERREUR : ANTHROPIC_API_KEY non définie.\n');
  console.error('Usage PowerShell : $env:ANTHROPIC_API_KEY="sk-ant-..."; node test-ai-scenarios.mjs');
  console.error('Usage bash      : ANTHROPIC_API_KEY=sk-ant-... node test-ai-scenarios.mjs\n');
  process.exit(1);
}

const TEST_CASES = [
  {
    name: "Test 1 — 8,60/19,90/Sport/Chine/emb=5€/assujetti",
    inputs: { prixAchat:8.60, prixVente:19.90, categorie:"Sport", paysImport:"Chine", shopifyFee:2, stripeFee:1.5, processorFixedFee:0.25, retours:5, ads:15, fraisRetour:0, coutEmballage:5, vatRegime:"assujetti" },
  },
  {
    name: "Test 2 — même cas / franchise en base",
    inputs: { prixAchat:8.60, prixVente:19.90, categorie:"Sport", paysImport:"Chine", shopifyFee:2, stripeFee:1.5, processorFixedFee:0.25, retours:5, ads:15, fraisRetour:0, coutEmballage:5, vatRegime:"franchise" },
  },
  {
    name: "Test 3 — 5/40/Textile/Chine/emb=1€/assujetti (cas rentable)",
    inputs: { prixAchat:5, prixVente:40, categorie:"Textile", paysImport:"Chine", shopifyFee:2, stripeFee:1.5, processorFixedFee:0.25, retours:5, ads:15, fraisRetour:0, coutEmballage:1, vatRegime:"assujetti" },
  },
  {
    name: "Test 4 — 8,60/19,90/Sport/Chine/emb=5€/ads=20%/retours=8%",
    inputs: { prixAchat:8.60, prixVente:19.90, categorie:"Sport", paysImport:"Chine", shopifyFee:2, stripeFee:1.5, processorFixedFee:0.25, retours:8, ads:20, fraisRetour:0, coutEmballage:5, vatRegime:"assujetti" },
  },
  {
    name: "Test 5 — 160/400/Sport/port=15€/emb=8€/assujetti (franchissement de minimis)",
    // paysImport:"Test5" maps to shipping=15€ (added to SHIPPING_ESTIMATES above)
    inputs: { prixAchat:160, prixVente:400, categorie:"Sport", paysImport:"Test5", shopifyFee:2, stripeFee:1.5, processorFixedFee:0.25, retours:5, ads:15, fraisRetour:0, coutEmballage:8, vatRegime:"assujetti" },
  },
];

async function callAI(prompt) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
  });
  if (!resp.ok) { const e = await resp.text(); throw new Error(e); }
  const data = await resp.json();
  return data.content?.[0]?.text ?? "";
}

function printScenariosTable(inputs) {
  const { current, scenarios } = computeScenarios(inputs);
  console.log(`  État actuel : margeNette=${fmt(current.margeNette)}€ / ${pct(current.margeNettePercent)}% | Rentable=${current.rentable ? 'OUI' : 'NON'}`);
  console.log('  ─────────────────────────────────────────────────────────────────────');
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    if (s.prixCible !== undefined) {
      console.log(`  S${i+1}. ${s.levier}`);
      console.log(`      → Marge nette : 0,00€ / 0,0% | Rentable : NON | Prix cible : ${fmt(s.prixCible)}€`);
    } else {
      console.log(`  S${i+1}. ${s.levier}`);
      console.log(`      → Marge nette : ${fmt(s.margeNette)}€ / ${pct(s.margeNettePercent)}% | Rentable : ${s.rentable ? 'OUI' : 'NON'}`);
    }
  }
}

for (const tc of TEST_CASES) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`${tc.name}`);
  console.log('═'.repeat(80));

  console.log('\n── 1. SCÉNARIOS computeScenarios (moteur déterministe) ──────────────────────');
  printScenariosTable(tc.inputs);

  console.log('\n── 2. TEXTE IA BRUT (sortie API Anthropic) ──────────────────────────────────');
  try {
    const prompt = buildPrompt(tc.inputs);
    const raw = await callAI(prompt);
    console.log(raw);

    console.log('\n── 3. RÉCONCILIATION chiffre-par-chiffre ────────────────────────────────────');
    const { divergences } = reconcile(raw, tc.inputs);
    if (divergences.length === 0) {
      console.log('  ✓ Tous les chiffres IA correspondent aux données pré-calculées.');
    } else {
      console.log(`  ✗ DIVERGENCES détectées (${divergences.length}) — chiffres absents des données moteur :`);
      for (const d of divergences) {
        console.log(`    • Valeur : ${d.value}`);
        console.log(`      Contexte : ${d.context}`);
      }
    }
  } catch (e) {
    console.log(`  ERREUR API : ${e.message}`);
  }
}

console.log('\n' + '═'.repeat(80));
console.log('Fin des tests.');
