import { useState, useCallback, useEffect, useRef } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { authenticate, PLAN_PRO } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { supabase } from "../supabase.server";

// ── Constants ─────────────────────────────────────────────────────────────────

const FREE_LIMIT = 3;
const DEFAULT_ALERT_THRESHOLD = 25;

const CUSTOMS_RATES = {
  Textile: 0.12, Électronique: 0.05, Cosmétique: 0.10,
  Accessoires: 0.07, Sport: 0.05, Alimentation: 0.15, Autre: 0.03,
};
const SHIPPING_ESTIMATES = { Chine: 8, Inde: 6, Turquie: 4, UE: 2, Autre: 5 };

// ── Helpers ───────────────────────────────────────────────────────────────────

const normalizeDecimal = (raw) => String(raw ?? "").trim().replace(/,/g, ".");
const safeNum = (n) => (Number.isFinite(n) ? n : 0);
const fmt = (n) => safeNum(n).toFixed(2);
const pct = (n) => safeNum(n).toFixed(1);

function validatePrice(raw, label, errors) {
  const s = normalizeDecimal(raw);
  if (s === "") { errors.push(`${label} est requis.`); return null; }
  if (!/^\d+(\.\d*)?$/.test(s)) { errors.push(`${label} : saisissez un nombre valide (ex : 19.99 ou 19,99).`); return null; }
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) { errors.push(`${label} : valeur invalide.`); return null; }
  if (n === 0) { errors.push(`${label} ne peut pas être 0.`); return null; }
  return n;
}

function validatePercentage(raw, label, errors) {
  const s = normalizeDecimal(raw);
  if (s === "") return 0;
  if (!/^\d+(\.\d*)?$/.test(s)) { errors.push(`${label} : saisissez un nombre entre 0 et 100.`); return null; }
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) { errors.push(`${label} : valeur invalide.`); return null; }
  if (n > 100) { errors.push(`${label} ne peut pas dépasser 100%.`); return null; }
  return n;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Feature 3: solve for selling price given a target net margin
function simulateSellingPrice(prixAchat, categorie, paysImport, targetMarginPct, fees) {
  const { shopifyFee, stripeFee, retours, ads } = fees;
  const customsRate = CUSTOMS_RATES[categorie] ?? 0.03;
  const shipping    = SHIPPING_ESTIMATES[paysImport] ?? 5;
  const douane      = prixAchat * customsRate;
  const tvaImport   = (prixAchat + douane) * 0.20;
  const coutRendu   = prixAchat + douane + tvaImport + shipping;
  const totalFeeRate = (shopifyFee + stripeFee + retours + ads) / 100;
  const denominator = 1 - totalFeeRate - targetMarginPct / 100;
  if (denominator <= 0) return null;
  return { prixVenteMin: coutRendu / denominator, coutRendu, totalFeeRate, customsRate, shipping };
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputStyle = {
  width: "100%", padding: "8px 12px", fontSize: "14px",
  border: "1px solid #c9cccf", borderRadius: "6px", background: "#fff",
  color: "#202223", outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};
const labelStyle = { display: "block", fontSize: "13px", fontWeight: "500", color: "#202223", marginBottom: "6px" };
const hintStyle  = { fontSize: "11px", color: "#6D7175", marginTop: "3px" };

// ── Sub-components ────────────────────────────────────────────────────────────

function FieldGroup({ label, hint, children }) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}

function MessageBlock({ items, color, bg, borderColor }) {
  if (!items.length) return null;
  return (
    <div style={{ padding: "12px 16px", borderRadius: "6px", background: bg, border: `1px solid ${borderColor}`, marginBottom: "16px" }}>
      {items.map((msg, i) => (
        <div key={i} style={{ fontSize: "13px", color, lineHeight: "1.6" }}>
          {items.length > 1 && "• "}{msg}
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, color, bg }) {
  return (
    <div style={{ padding: "16px 12px", borderRadius: "8px", background: bg, textAlign: "center", border: `1px solid ${color}22` }}>
      <div style={{ fontSize: "11px", fontWeight: "500", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "6px" }}>{label}</div>
      <div style={{ fontSize: "22px", fontWeight: "700", color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: "12px", color: "#6D7175", marginTop: "6px" }}>{sub}</div>
    </div>
  );
}

// Feature 2: simple SVG sparkline chart for margin evolution
function SparklineChart({ data }) {
  if (!data || data.length < 2) return null;
  const W = 100, H = 60, PAD = 4;
  const values = data.map(d => d.net_margin_percent);
  const minY = Math.min(0, ...values);
  const maxY = Math.max(50, ...values);
  const rangeY = maxY - minY || 1;
  const toX = (i) => PAD + (i / (data.length - 1)) * (W - PAD * 2);
  const toY = (v) => PAD + (1 - (v - minY) / rangeY) * (H - PAD * 2);
  const points = values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const zeroY = toY(0).toFixed(1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "64px", display: "block" }}>
      {/* Zero line */}
      <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#E4E5E7" strokeWidth="0.5" strokeDasharray="2,2" />
      {/* 25% reference line */}
      <line x1={PAD} y1={toY(25).toFixed(1)} x2={W - PAD} y2={toY(25).toFixed(1)} stroke="#00806022" strokeWidth="0.5" strokeDasharray="2,2" />
      {/* Sparkline */}
      <polyline points={points} fill="none" stroke="#008060" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* Dots */}
      {values.map((v, i) => (
        <circle key={i} cx={toX(i)} cy={toY(v)} r="2.5"
          fill={v < 10 ? "#D72C0D" : v < 25 ? "#B98900" : "#008060"} />
      ))}
    </svg>
  );
}

// Feature 4: alert banner shown when violations detected
function AlertBanner({ violations, threshold }) {
  if (!violations || violations.length === 0) return null;
  return (
    <div style={{ padding: "14px 18px", borderRadius: "8px", background: "#FFF4F4", border: "1px solid #D72C0D", marginBottom: "20px", display: "flex", gap: "12px", alignItems: "flex-start" }}>
      <span style={{ fontSize: "18px", flexShrink: 0 }}>⚠️</span>
      <div>
        <div style={{ fontSize: "14px", fontWeight: "600", color: "#D72C0D", marginBottom: "4px" }}>
          {violations.length} produit{violations.length > 1 ? "s" : ""} en dessous du seuil de {threshold}%
        </div>
        <div style={{ fontSize: "13px", color: "#6D7175", lineHeight: "1.6" }}>
          {violations.slice(0, 3).map((v, i) => (
            <div key={i}>
              <strong>{v.product_title ?? v.category}</strong> — marge actuelle : <strong style={{ color: "#D72C0D" }}>{pct(v.net_margin_percent)}%</strong>
            </div>
          ))}
          {violations.length > 3 && <div>et {violations.length - 3} autre{violations.length - 3 > 1 ? "s" : ""}…</div>}
        </div>
      </div>
    </div>
  );
}

// Feature 5: AI recommendation display
function AIRecommendation({ fetcher }) {
  const isLoading = fetcher.state !== "idle";
  const data = fetcher.data;

  if (!isLoading && !data) return null;

  return (
    <div style={{ marginTop: "28px", padding: "20px 24px", borderRadius: "10px", background: "linear-gradient(135deg, #f8f6ff 0%, #f0f4ff 100%)", border: "1px solid #c5b8ff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
        <span style={{ fontSize: "18px" }}>✦</span>
        <span style={{ fontSize: "14px", fontWeight: "700", color: "#4f3dc8" }}>Recommandation Claude</span>
        {isLoading && (
          <span style={{ fontSize: "12px", color: "#8a7fd4", marginLeft: "4px" }}>Analyse en cours…</span>
        )}
      </div>

      {isLoading && (
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: "6px", height: "6px", borderRadius: "50%", background: "#8a7fd4",
              animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
          <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
        </div>
      )}

      {data?.error && (
        <div style={{ fontSize: "13px", color: "#D72C0D" }}>{data.error}</div>
      )}

      {data?.analyse && (
        <>
          <div style={{ fontSize: "14px", color: "#2d2360", lineHeight: "1.7", marginBottom: "16px" }}>
            {data.analyse}
          </div>
          <div style={{ fontSize: "12px", fontWeight: "600", color: "#4f3dc8", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "10px" }}>
            3 actions pour améliorer votre rentabilité
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {(data.actions ?? []).map((action, i) => (
              <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: "#4f3dc8", color: "#fff", fontSize: "11px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "1px" }}>
                  {i + 1}
                </div>
                <div style={{ fontSize: "13px", color: "#2d2360", lineHeight: "1.6" }}>{action}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Server exports ────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session, billing, admin } = await authenticate.admin(request);

  // Run billing check and product fetch concurrently
  const [billingResult, productsResult] = await Promise.allSettled([
    billing.check({ plans: [PLAN_PRO], isTest: true }),
    admin.graphql(`
      query {
        products(first: 100, sortKey: TITLE) {
          edges {
            node {
              id
              title
              variants(first: 1) {
                edges { node { price } }
              }
            }
          }
        }
      }
    `),
  ]);

  const isPro = billingResult.status === "fulfilled"
    ? billingResult.value.hasActivePayment
    : false;

  let products = [];
  if (productsResult.status === "fulfilled") {
    try {
      const json = await productsResult.value.json();
      products = (json.data?.products?.edges ?? []).map(({ node }) => ({
        id: node.id,
        title: node.title,
        price: parseFloat(node.variants.edges[0]?.node.price ?? "0"),
      }));
    } catch (e) {
      console.error("[Products] GraphQL parse failed:", e?.message);
    }
  } else {
    console.error("[Products] GraphQL failed:", productsResult.reason?.message);
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  // Fetch usage, history, and alert threshold concurrently
  const [countResult, historyResult, alertResult] = await Promise.allSettled([
    !isPro
      ? supabase.from("usage").select("calculation_count").eq("shop_domain", session.shop).eq("month", currentMonth).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("calculations")
      .select("id, product_id, product_title, category, country, purchase_price, selling_price, net_margin_percent, net_margin_euros, created_at")
      .eq("shop_domain", session.shop)
      .order("created_at", { ascending: false })
      .limit(isPro ? 50 : 0),
    supabase.from("margin_alerts").select("threshold").eq("shop_domain", session.shop).maybeSingle(),
  ]);

  const monthlyCount = countResult.status === "fulfilled"
    ? (countResult.value.data?.calculation_count ?? 0) : 0;

  const history = historyResult.status === "fulfilled" && isPro
    ? (historyResult.value.data ?? []) : [];

  const alertThreshold = alertResult.status === "fulfilled"
    ? (alertResult.value.data?.threshold ?? DEFAULT_ALERT_THRESHOLD)
    : DEFAULT_ALERT_THRESHOLD;

  // Feature 4: detect threshold violations in last 20 calculations
  const allRecent = historyResult.status === "fulfilled"
    ? (historyResult.value.data ?? []).slice(0, 20) : [];
  const violations = allRecent.filter(c => c.net_margin_percent < alertThreshold);

  const showWelcome = new URL(request.url).searchParams.get("subscribed") === "true";

  return { isPro, monthlyCount, history, products, alertThreshold, violations, showWelcome };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return { success: false, error: "Corps de requête invalide." };
  }

  // ── Subscribe ──────────────────────────────────────────────────────────────
  if (body._action === "subscribe") {
    await billing.request({
      plan: PLAN_PRO,
      isTest: true,
      returnUrl: `${process.env.SHOPIFY_APP_URL}/app?subscribed=true`,
    });
    return null;
  }

  // ── Feature 4: set alert threshold ────────────────────────────────────────
  if (body._action === "set_alert") {
    const threshold = parseFloat(body.threshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      return { success: false, error: "Seuil invalide (0–100)." };
    }
    await supabase.from("margin_alerts").upsert(
      { shop_domain: session.shop, threshold, updated_at: new Date().toISOString() },
      { onConflict: "shop_domain" }
    );
    return { success: true, newThreshold: threshold };
  }

  // ── Feature 5: AI recommendation ──────────────────────────────────────────
  if (body._action === "ai_recommend") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: "ANTHROPIC_API_KEY non configurée." };

    const { prixAchat, prixVente, category, country, productTitle,
            douane, tvaImport, shipping, coutRendu,
            shopifyCost, stripeCost, retoursCost, adsCost,
            shopifyFee, stripeFee, retours, ads,
            customsRate, margeBrutePercent, margeNettePercent, margeNette } = body;

    const prompt = `Tu es un expert en e-commerce et rentabilité.

Voici les données d'un calcul de marge pour un marchand Shopify :
- Produit : ${productTitle ?? "Non spécifié"}
- Catégorie : ${category} | Pays d'import : ${country}
- Prix fournisseur : ${fmt(prixAchat)}€ | Prix de vente : ${fmt(prixVente)}€
- Droits de douane : ${fmt(douane)}€ (taux ${(customsRate * 100).toFixed(0)}%)
- TVA à l'import : ${fmt(tvaImport)}€ | Frais de port : ${fmt(shipping)}€
- Coût rendu total : ${fmt(coutRendu)}€
- Frais Shopify : ${shopifyFee}% → ${fmt(shopifyCost)}€
- Frais Stripe : ${stripeFee}% → ${fmt(stripeCost)}€
- Provision retours : ${retours}% → ${fmt(retoursCost)}€
- Budget publicité : ${ads}% → ${fmt(adsCost)}€
- Marge brute : ${pct(margeBrutePercent)}% | Marge nette réelle : ${pct(margeNettePercent)}% (${fmt(margeNette)}€/vente)

Réponds UNIQUEMENT avec ce JSON (sans markdown) :
{"analyse":"2 phrases max expliquant pourquoi la marge est à ce niveau","actions":["action concrète 1 avec chiffres","action concrète 2 avec chiffres","action concrète 3 avec chiffres"]}`;

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 512,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        console.error("[AI] Anthropic error:", err);
        return { error: "Erreur API Claude." };
      }
      const aiData = await resp.json();
      const text = aiData.content?.[0]?.text ?? "";
      const parsed = JSON.parse(text);
      return { analyse: parsed.analyse, actions: parsed.actions };
    } catch (e) {
      console.error("[AI] Failed:", e?.message);
      return { error: "Impossible d'obtenir la recommandation IA." };
    }
  }

  // ── Save calculation ───────────────────────────────────────────────────────
  let hasActivePayment = false;
  try {
    const result = await billing.check({ plans: [PLAN_PRO], isTest: true });
    hasActivePayment = result.hasActivePayment;
  } catch (e) {
    console.error("[Billing] action check failed:", e?.message);
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  if (!hasActivePayment) {
    const { data: usage } = await supabase.from("usage")
      .select("calculation_count")
      .eq("shop_domain", session.shop)
      .eq("month", currentMonth)
      .maybeSingle();

    const count = usage?.calculation_count ?? 0;
    if (count >= FREE_LIMIT) return { success: false, limitReached: true };

    await supabase.from("usage").upsert(
      { shop_domain: session.shop, month: currentMonth, calculation_count: count + 1, updated_at: new Date().toISOString() },
      { onConflict: "shop_domain,month" }
    );
    return { success: true, monthlyCount: count + 1 };
  }

  const { error } = await supabase.from("calculations").insert({
    shop_domain:         session.shop,
    product_id:          body.product_id ?? null,
    product_title:       body.product_title ?? null,
    purchase_price:      body.purchase_price,
    selling_price:       body.selling_price,
    category:            body.category,
    country:             body.country,
    net_margin_percent:  body.net_margin_percent,
    net_margin_euros:    body.net_margin_euros,
    shopify_fee:         body.shopify_fee,
    stripe_fee:          body.stripe_fee,
    returns_rate:        body.returns_rate,
    ads_rate:            body.ads_rate,
    shipping_cost:       body.shipping_cost,
    customs_rate:        body.customs_rate,
    cout_rendu:          body.cout_rendu,
    marge_brute_percent: body.marge_brute_percent,
  });

  if (error) {
    console.error("[Supabase] Insert error:", error.message);
    return { success: false, error: error.message };
  }
  return { success: true };
};

// ── Main component ────────────────────────────────────────────────────────────

export default function Index() {
  const { isPro, monthlyCount: initialCount, history, products, alertThreshold: initialThreshold, violations, showWelcome } = useLoaderData();

  const saveFetcher      = useFetcher();
  const subscribeFetcher = useFetcher();
  const aiFetcher        = useFetcher();
  const alertFetcher     = useFetcher();

  // ── Form state ─────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    selectedProductId: "", selectedProductTitle: "",
    prixAchat: "20", prixVente: "49.99",
    categorie: "Textile", paysImport: "Chine",
    shopifyFee: "2", stripeFee: "2.5", retours: "5", ads: "15",
  });

  // Feature 3: simulation form
  const [simForm, setSimForm] = useState({
    prixAchat: "20", categorie: "Textile", paysImport: "Chine",
    targetMargin: "35",
    shopifyFee: "2", stripeFee: "2.5", retours: "5", ads: "15",
  });
  const [simResult, setSimResult] = useState(null);
  const [simErrors, setSimErrors] = useState([]);

  // Feature 4: alert threshold
  const [alertThreshold, setAlertThreshold] = useState(String(initialThreshold));

  const [results,     setResults]     = useState(null);
  const [errors,      setErrors]      = useState([]);
  const [warnings,    setWarnings]    = useState([]);
  const [activeTab,   setActiveTab]   = useState("calculator");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [localCount,  setLocalCount]  = useState(initialCount);
  const prevResults = useRef(null);

  // Sync state from server actions
  useEffect(() => {
    if (!saveFetcher.data) return;
    if (saveFetcher.data.monthlyCount !== undefined) setLocalCount(saveFetcher.data.monthlyCount);
    if (saveFetcher.data.limitReached) { setShowUpgrade(true); setResults(null); }
  }, [saveFetcher.data]);

  // Sync alert threshold after save
  useEffect(() => {
    if (alertFetcher.data?.newThreshold !== undefined) {
      setAlertThreshold(String(alertFetcher.data.newThreshold));
    }
  }, [alertFetcher.data]);

  // Feature 1: product selection fills price
  const handleProductSelect = useCallback((e) => {
    const id = e.target.value;
    const product = products.find(p => p.id === id);
    if (!product) {
      setForm(prev => ({ ...prev, selectedProductId: "", selectedProductTitle: "", prixVente: "" }));
      return;
    }
    setForm(prev => ({
      ...prev,
      selectedProductId: product.id,
      selectedProductTitle: product.title,
      prixVente: product.price > 0 ? String(product.price) : prev.prixVente,
    }));
    setResults(null); setErrors([]); setWarnings([]);
  }, [products]);

  const update = useCallback((field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
    setResults(null); setErrors([]); setWarnings([]); setShowUpgrade(false);
  }, []);

  const updateSim = useCallback((field) => (e) => {
    setSimForm(prev => ({ ...prev, [field]: e.target.value }));
    setSimResult(null); setSimErrors([]);
  }, []);

  // Core calculation (shared between calculator and AI call)
  const calculate = useCallback(() => {
    const errs = [], warns = [];
    const prixAchat     = validatePrice(form.prixAchat,    "Le prix d'achat", errs);
    const prixVente     = validatePrice(form.prixVente,    "Le prix de vente", errs);
    const shopifyFeeVal = validatePercentage(form.shopifyFee, "Frais Shopify", errs);
    const stripeFeeVal  = validatePercentage(form.stripeFee,  "Frais Stripe",  errs);
    const retoursVal    = validatePercentage(form.retours,    "Taux de retours", errs);
    const adsVal        = validatePercentage(form.ads,        "Budget ads",    errs);

    if (errs.length > 0) { setErrors(errs); setWarnings([]); setResults(null); return null; }

    if (prixAchat > prixVente) warns.push("Attention : tu vends moins cher que tu achètes.");
    else if (prixAchat === prixVente) warns.push("Prix achat = prix vente : marge 0% avant frais.");
    const totalPct = shopifyFeeVal + stripeFeeVal + retoursVal + adsVal;
    if (totalPct > 100) warns.push(`Frais cumulés (${totalPct.toFixed(1)}%) dépassent 100% du CA.`);

    const customsRate    = CUSTOMS_RATES[form.categorie] ?? 0.03;
    const shipping       = SHIPPING_ESTIMATES[form.paysImport] ?? 5;
    const douane         = prixAchat * customsRate;
    const tvaImport      = (prixAchat + douane) * 0.20;
    const coutRendu      = prixAchat + douane + tvaImport + shipping;
    const shopifyCost    = prixVente * (shopifyFeeVal / 100);
    const stripeCost     = prixVente * (stripeFeeVal  / 100);
    const retoursCost    = prixVente * (retoursVal    / 100);
    const adsCost        = prixVente * (adsVal        / 100);
    const totalFraisVente    = shopifyCost + stripeCost + retoursCost + adsCost;
    const margeBrute         = prixVente - coutRendu;
    const margeBrutePercent  = (margeBrute / prixVente) * 100;
    const margeNette         = margeBrute - totalFraisVente;
    const margeNettePercent  = (margeNette / prixVente) * 100;
    const margeApparente     = ((prixVente - prixAchat) / prixVente) * 100;

    const computed = { margeBrutePercent, margeNettePercent, margeApparente, coutRendu, margeNette };
    const bad = Object.entries(computed).find(([, v]) => !Number.isFinite(v));
    if (bad) { setErrors([`Erreur de calcul (${bad[0]}).`]); setResults(null); return null; }

    const r = {
      prixAchat, prixVente, douane, tvaImport, shipping, coutRendu,
      shopifyCost, stripeCost, retoursCost, adsCost, totalFraisVente,
      margeBrute, margeBrutePercent, margeNette, margeNettePercent,
      margeApparente, customsRate,
      shopifyFee: shopifyFeeVal, stripeFee: stripeFeeVal,
      retours: retoursVal, ads: adsVal,
    };
    setErrors([]); setWarnings(warns); setResults(r);
    return r;
  }, [form]);

  const handleReveal = () => {
    if (!isPro && localCount >= FREE_LIMIT) { setShowUpgrade(true); setResults(null); return; }
    const r = calculate();
    if (!r) return;

    const saveData = {
      product_id:          form.selectedProductId || null,
      product_title:       form.selectedProductTitle || null,
      purchase_price:      parseFloat(r.prixAchat.toFixed(2)),
      selling_price:       parseFloat(r.prixVente.toFixed(2)),
      category:            form.categorie,
      country:             form.paysImport,
      net_margin_percent:  parseFloat(r.margeNettePercent.toFixed(2)),
      net_margin_euros:    parseFloat(r.margeNette.toFixed(2)),
      shopify_fee:         parseFloat(r.shopifyFee.toFixed(2)),
      stripe_fee:          parseFloat(r.stripeFee.toFixed(2)),
      returns_rate:        parseFloat(r.retours.toFixed(2)),
      ads_rate:            parseFloat(r.ads.toFixed(2)),
      shipping_cost:       parseFloat(r.shipping.toFixed(2)),
      customs_rate:        parseFloat(r.customsRate.toFixed(4)),
      cout_rendu:          parseFloat(r.coutRendu.toFixed(2)),
      marge_brute_percent: parseFloat(r.margeBrutePercent.toFixed(2)),
    };
    saveFetcher.submit(saveData, { method: "POST", encType: "application/json" });

    // Feature 5: trigger AI recommendation automatically
    const aiData = {
      _action:          "ai_recommend",
      productTitle:     form.selectedProductTitle || null,
      prixAchat:        r.prixAchat,
      prixVente:        r.prixVente,
      category:         form.categorie,
      country:          form.paysImport,
      douane:           r.douane,
      tvaImport:        r.tvaImport,
      shipping:         r.shipping,
      coutRendu:        r.coutRendu,
      shopifyCost:      r.shopifyCost,
      stripeCost:       r.stripeCost,
      retoursCost:      r.retoursCost,
      adsCost:          r.adsCost,
      shopifyFee:       r.shopifyFee,
      stripeFee:        r.stripeFee,
      retours:          r.retours,
      ads:              r.ads,
      customsRate:      r.customsRate,
      margeBrutePercent: r.margeBrutePercent,
      margeNettePercent: r.margeNettePercent,
      margeNette:        r.margeNette,
    };
    aiFetcher.submit(aiData, { method: "POST", encType: "application/json" });
    prevResults.current = r;
  };

  // Feature 3: simulation
  const handleSimulate = useCallback(() => {
    const errs = [];
    const prixAchat    = validatePrice(simForm.prixAchat, "Prix d'achat", errs);
    const targetMargin = validatePercentage(simForm.targetMargin, "Marge cible", errs);
    const shopifyFee   = validatePercentage(simForm.shopifyFee,   "Frais Shopify", errs);
    const stripeFee    = validatePercentage(simForm.stripeFee,    "Frais Stripe",  errs);
    const retours      = validatePercentage(simForm.retours,      "Retours",       errs);
    const ads          = validatePercentage(simForm.ads,          "Ads",           errs);

    if (errs.length > 0) { setSimErrors(errs); setSimResult(null); return; }
    if (targetMargin >= 100) { setSimErrors(["La marge cible doit être < 100%."]); return; }

    const sim = simulateSellingPrice(prixAchat, simForm.categorie, simForm.paysImport, targetMargin, { shopifyFee, stripeFee, retours, ads });
    if (!sim) {
      setSimErrors(["Impossible d'atteindre cette marge avec ces paramètres (dénominateur ≤ 0)."]);
      setSimResult(null);
      return;
    }
    setSimErrors([]);
    setSimResult({ ...sim, prixAchat, targetMargin, shopifyFee, stripeFee, retours, ads, prixVenteRec: sim.prixVenteMin * 1.10 });
  }, [simForm]);

  // Alert threshold save
  const handleSaveAlert = () => {
    alertFetcher.submit({ _action: "set_alert", threshold: alertThreshold }, { method: "POST", encType: "application/json" });
  };

  const handleSubscribe = () => {
    subscribeFetcher.submit({ _action: "subscribe" }, { method: "POST", encType: "application/json" });
  };

  // ── Derived display ────────────────────────────────────────────────────────
  const marginColor = results
    ? results.margeNettePercent < 10 ? "#D72C0D" : results.margeNettePercent < 25 ? "#B98900" : "#008060"
    : "#008060";
  const marginBg = results
    ? results.margeNettePercent < 10 ? "#FFF4F4" : results.margeNettePercent < 25 ? "#FFF9EC" : "#F1F8F5"
    : "#F1F8F5";
  const marginLabel = results
    ? results.margeNettePercent < 0 ? "Marge négative" : results.margeNettePercent < 10 ? "Marge critique" : results.margeNettePercent < 25 ? "Marge faible" : "Marge saine"
    : "";
  const gaugeWidth = results ? `${Math.max(0, Math.min(100, safeNum(results.margeNettePercent)))}%` : "0%";
  const customsRateDisplay = ((CUSTOMS_RATES[form.categorie] ?? 0.03) * 100).toFixed(0);
  const shippingDisplay    = SHIPPING_ESTIMATES[form.paysImport] ?? 5;
  const isSaving    = saveFetcher.state !== "idle";
  const saveStatus  = saveFetcher.data;
  const isSubscribing = subscribeFetcher.state !== "idle";
  const isSavingAlert = alertFetcher.state !== "idle";

  const historyForChart = [...history].reverse(); // oldest → newest for chart

  const subscribeBtn = (label = "Passer au Pro — 9$/mois") => (
    <button
      onClick={handleSubscribe}
      disabled={isSubscribing}
      style={{ padding: "10px 24px", background: "#008060", color: "#fff", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: "600", cursor: isSubscribing ? "default" : "pointer", fontFamily: "inherit", opacity: isSubscribing ? 0.7 : 1 }}
    >
      {isSubscribing ? "Redirection vers Shopify…" : label}
    </button>
  );

  return (
    <s-page heading="Calculateur de Vraie Marge">

      {/* ── WELCOME BANNER ───────────────────────────────────────────────── */}
      {showWelcome && (
        <s-section heading="Bienvenue dans True Cost Calculator Pro !">
          <div style={{ padding: "16px 20px", borderRadius: "8px", background: "#F1F8F5", border: "1px solid #008060", fontSize: "14px", color: "#202223", lineHeight: "1.6" }}>
            Calculs illimités activés. Vos simulations sont sauvegardées automatiquement dans l'onglet <strong>Historique</strong>.
          </div>
        </s-section>
      )}

      {/* ── ALERT BANNER (Feature 4) ─────────────────────────────────────── */}
      {violations.length > 0 && (
        <s-section>
          <AlertBanner violations={violations} threshold={initialThreshold} />
        </s-section>
      )}

      {/* ── MAIN SECTION ─────────────────────────────────────────────────── */}
      <s-section heading={
        activeTab === "history" ? "Historique de vos calculs" :
        activeTab === "simulate" ? "Simulateur de prix" :
        activeTab === "alerts" ? "Alertes de marge" :
        "Simulateur"
      }>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: "0", marginBottom: "24px", borderBottom: "2px solid #E4E5E7" }}>
          {[
            { id: "calculator", label: "Calculateur" },
            { id: "simulate",   label: "Simulation" },
            { id: "history",    label: isPro ? "Historique" : "Historique 🔒" },
            { id: "alerts",     label: "Alertes" },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => setActiveTab(id)} style={{ padding: "10px 18px", background: "none", border: "none", borderBottom: activeTab === id ? "2px solid #008060" : "2px solid transparent", marginBottom: "-2px", cursor: "pointer", fontSize: "14px", fontWeight: activeTab === id ? "600" : "400", color: activeTab === id ? "#008060" : "#6D7175", fontFamily: "inherit" }}>
              {label}
            </button>
          ))}
          {isPro && (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
              <span style={{ padding: "3px 10px", borderRadius: "12px", background: "#008060", color: "#fff", fontSize: "11px", fontWeight: "700", letterSpacing: "0.5px" }}>PRO</span>
            </div>
          )}
        </div>

        {/* ════════ CALCULATOR TAB ════════════════════════════════════════ */}
        {activeTab === "calculator" && (
          <>
            {!isPro && !showUpgrade && (
              <div style={{ padding: "10px 16px", borderRadius: "6px", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", background: localCount >= FREE_LIMIT ? "#FFF4F4" : localCount >= FREE_LIMIT - 1 ? "#FFF9EC" : "#F1F8F5", border: `1px solid ${localCount >= FREE_LIMIT ? "#D72C0D" : localCount >= FREE_LIMIT - 1 ? "#B98900" : "#8DC8A8"}` }}>
                <span style={{ fontSize: "13px", color: "#202223" }}>
                  Plan gratuit · <strong>{localCount}/{FREE_LIMIT}</strong> calculs ce mois
                  {localCount >= FREE_LIMIT ? " — limite atteinte" : localCount >= FREE_LIMIT - 1 ? " — dernier calcul gratuit" : ""}
                </span>
                {localCount >= FREE_LIMIT && (
                  <button onClick={() => setShowUpgrade(true)} style={{ padding: "4px 12px", background: "#008060", color: "#fff", border: "none", borderRadius: "4px", fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
                    Voir les plans
                  </button>
                )}
              </div>
            )}

            {showUpgrade ? (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <div style={{ fontSize: "36px", marginBottom: "16px" }}>🔒</div>
                <div style={{ fontSize: "20px", fontWeight: "700", color: "#202223", marginBottom: "8px" }}>
                  Tu as utilisé tes {FREE_LIMIT} calculs gratuits ce mois-ci.
                </div>
                <div style={{ fontSize: "14px", color: "#6D7175", marginBottom: "32px" }}>
                  Passe au Pro pour des calculs illimités et l'historique complet.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", maxWidth: "480px", margin: "0 auto 32px" }}>
                  <div style={{ padding: "20px", borderRadius: "8px", background: "#F9FAFB", border: "2px solid #E4E5E7", textAlign: "left" }}>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>Plan Gratuit</div>
                    <div style={{ fontSize: "22px", fontWeight: "700", color: "#202223", marginBottom: "14px" }}>0 €/mois</div>
                    {[`${FREE_LIMIT} calculs/mois`, "Pas d'historique", "Support standard"].map(f => (
                      <div key={f} style={{ fontSize: "13px", color: "#6D7175", marginBottom: "5px" }}>✓ {f}</div>
                    ))}
                  </div>
                  <div style={{ padding: "20px", borderRadius: "8px", background: "#F1F8F5", border: "2px solid #008060", textAlign: "left", position: "relative" }}>
                    <div style={{ position: "absolute", top: "-1px", right: "12px", background: "#008060", color: "#fff", fontSize: "10px", fontWeight: "700", padding: "3px 8px", borderRadius: "0 0 6px 6px" }}>RECOMMANDÉ</div>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#008060", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>Plan Pro</div>
                    <div style={{ fontSize: "22px", fontWeight: "700", color: "#202223", marginBottom: "14px" }}>9 $/mois</div>
                    {["Calculs illimités", "Historique + graphe", "Alertes de marge", "Recommandations IA", "Support prioritaire"].map(f => (
                      <div key={f} style={{ fontSize: "13px", color: "#008060", marginBottom: "5px" }}>✓ {f}</div>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
                  {subscribeBtn("S'abonner pour 9$/mois")}
                  <button onClick={() => setShowUpgrade(false)} style={{ padding: "10px 20px", background: "none", color: "#6D7175", border: "1px solid #C9CCCF", borderRadius: "6px", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>
                    Pas maintenant
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Feature 1: product selector */}
                {products.length > 0 && (
                  <div style={{ marginBottom: "20px", padding: "16px", background: "#F9FAFB", borderRadius: "8px", border: "1px solid #E4E5E7" }}>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "10px" }}>
                      Importer depuis votre catalogue
                    </div>
                    <select
                      value={form.selectedProductId}
                      onChange={handleProductSelect}
                      style={{ ...inputStyle, background: "#fff" }}
                    >
                      <option value="">— Sélectionner un produit (auto-remplit le prix de vente) —</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.title}{p.price > 0 ? ` — ${p.price.toFixed(2)}€` : ""}
                        </option>
                      ))}
                    </select>
                    {form.selectedProductTitle && (
                      <div style={{ fontSize: "12px", color: "#008060", marginTop: "6px" }}>
                        ✓ {form.selectedProductTitle} sélectionné · prix de vente rempli automatiquement
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "14px" }}>Données produit</div>
                    <FieldGroup label="Prix d'achat fournisseur (€)">
                      <input type="text" inputMode="decimal" value={form.prixAchat} onChange={update("prixAchat")} style={inputStyle} placeholder="ex : 20.00" />
                    </FieldGroup>
                    <FieldGroup label="Prix de vente (€)">
                      <input type="text" inputMode="decimal" value={form.prixVente} onChange={update("prixVente")} style={inputStyle} placeholder="ex : 49.99" />
                    </FieldGroup>
                    <FieldGroup label="Catégorie produit" hint={`Taux de douane appliqué : ${customsRateDisplay}%`}>
                      <select value={form.categorie} onChange={update("categorie")} style={inputStyle}>
                        {Object.entries(CUSTOMS_RATES).map(([cat, rate]) => (
                          <option key={cat} value={cat}>{cat} — douane {(rate * 100).toFixed(0)}%</option>
                        ))}
                      </select>
                    </FieldGroup>
                    <FieldGroup label="Pays d'import" hint={`Frais de port estimés : ~${shippingDisplay}€`}>
                      <select value={form.paysImport} onChange={update("paysImport")} style={inputStyle}>
                        {Object.entries(SHIPPING_ESTIMATES).map(([pays, cost]) => (
                          <option key={pays} value={pays}>{pays} — shipping ~{cost}€</option>
                        ))}
                      </select>
                    </FieldGroup>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "14px" }}>Frais & déductions</div>
                    <FieldGroup label="Frais Shopify (% du CA)" hint="Basic : 2% — Shopify : 1% — Advanced : 0.5%">
                      <input type="text" inputMode="decimal" value={form.shopifyFee} onChange={update("shopifyFee")} style={inputStyle} placeholder="ex : 2" />
                    </FieldGroup>
                    <FieldGroup label="Frais Stripe (% du CA)" hint="Stripe standard ≈ 1.5–2.5%">
                      <input type="text" inputMode="decimal" value={form.stripeFee} onChange={update("stripeFee")} style={inputStyle} placeholder="ex : 2.5" />
                    </FieldGroup>
                    <FieldGroup label="Taux de retours (%)" hint="Moyenne e-commerce : 5–15%">
                      <input type="text" inputMode="decimal" value={form.retours} onChange={update("retours")} style={inputStyle} placeholder="ex : 5" />
                    </FieldGroup>
                    <FieldGroup label="Budget ads (% du CA)" hint="Meta/TikTok Ads : 15–30% typique">
                      <input type="text" inputMode="decimal" value={form.ads} onChange={update("ads")} style={inputStyle} placeholder="ex : 15" />
                    </FieldGroup>
                  </div>
                </div>

                <MessageBlock items={errors} color="#D72C0D" bg="#FFF4F4" borderColor="#D72C0D" />

                <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                  <s-button onClick={handleReveal}>Révéler ma vraie marge →</s-button>
                  {isSaving && <span style={{ fontSize: "12px", color: "#6D7175" }}>Sauvegarde…</span>}
                  {!isSaving && saveStatus?.success === true && (
                    <span style={{ fontSize: "12px", color: "#008060", fontWeight: "500" }}>
                      ✓ {isPro ? "Calcul sauvegardé" : "Calcul enregistré"}
                    </span>
                  )}
                  {!isSaving && saveStatus?.success === false && !saveStatus?.limitReached && (
                    <span style={{ fontSize: "12px", color: "#D72C0D" }}>Erreur — {saveStatus.error}</span>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ════════ SIMULATION TAB (Feature 3) ════════════════════════════ */}
        {activeTab === "simulate" && (
          <div>
            <div style={{ fontSize: "14px", color: "#6D7175", marginBottom: "20px", lineHeight: "1.6" }}>
              Entrez votre prix fournisseur et votre <strong>marge nette cible</strong>. L'app calcule le prix de vente minimum à appliquer.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
              <div>
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "14px" }}>Paramètres produit</div>
                <FieldGroup label="Prix d'achat fournisseur (€)">
                  <input type="text" inputMode="decimal" value={simForm.prixAchat} onChange={updateSim("prixAchat")} style={inputStyle} placeholder="ex : 20.00" />
                </FieldGroup>
                <FieldGroup label="Catégorie produit">
                  <select value={simForm.categorie} onChange={updateSim("categorie")} style={inputStyle}>
                    {Object.entries(CUSTOMS_RATES).map(([cat, rate]) => (
                      <option key={cat} value={cat}>{cat} — douane {(rate * 100).toFixed(0)}%</option>
                    ))}
                  </select>
                </FieldGroup>
                <FieldGroup label="Pays d'import">
                  <select value={simForm.paysImport} onChange={updateSim("paysImport")} style={inputStyle}>
                    {Object.entries(SHIPPING_ESTIMATES).map(([pays, cost]) => (
                      <option key={pays} value={pays}>{pays} — shipping ~{cost}€</option>
                    ))}
                  </select>
                </FieldGroup>
                <FieldGroup label="Marge nette cible (%)" hint="La marge nette que vous souhaitez atteindre après tous les frais">
                  <input type="text" inputMode="decimal" value={simForm.targetMargin} onChange={updateSim("targetMargin")} style={{ ...inputStyle, borderColor: "#008060", fontWeight: "600" }} placeholder="ex : 35" />
                </FieldGroup>
              </div>
              <div>
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "14px" }}>Frais à déduire</div>
                <FieldGroup label="Frais Shopify (%)" hint="Basic : 2%">
                  <input type="text" inputMode="decimal" value={simForm.shopifyFee} onChange={updateSim("shopifyFee")} style={inputStyle} placeholder="2" />
                </FieldGroup>
                <FieldGroup label="Frais Stripe (%)" hint="Standard ≈ 2.5%">
                  <input type="text" inputMode="decimal" value={simForm.stripeFee} onChange={updateSim("stripeFee")} style={inputStyle} placeholder="2.5" />
                </FieldGroup>
                <FieldGroup label="Taux de retours (%)">
                  <input type="text" inputMode="decimal" value={simForm.retours} onChange={updateSim("retours")} style={inputStyle} placeholder="5" />
                </FieldGroup>
                <FieldGroup label="Budget ads (%)">
                  <input type="text" inputMode="decimal" value={simForm.ads} onChange={updateSim("ads")} style={inputStyle} placeholder="15" />
                </FieldGroup>
              </div>
            </div>

            <MessageBlock items={simErrors} color="#D72C0D" bg="#FFF4F4" borderColor="#D72C0D" />
            <s-button onClick={handleSimulate}>Calculer le prix minimum →</s-button>

            {simResult && (
              <div style={{ marginTop: "28px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
                  <div style={{ padding: "24px", borderRadius: "10px", background: "#F1F8F5", border: "2px solid #008060", textAlign: "center" }}>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Prix de vente minimum</div>
                    <div style={{ fontSize: "32px", fontWeight: "800", color: "#008060", marginBottom: "6px" }}>{simResult.prixVenteMin.toFixed(2)}€</div>
                    <div style={{ fontSize: "12px", color: "#6D7175" }}>pour {simResult.targetMargin}% de marge nette</div>
                  </div>
                  <div style={{ padding: "24px", borderRadius: "10px", background: "#F9FAFB", border: "2px solid #E4E5E7", textAlign: "center" }}>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Prix de vente recommandé</div>
                    <div style={{ fontSize: "32px", fontWeight: "800", color: "#202223", marginBottom: "6px" }}>{simResult.prixVenteRec.toFixed(2)}€</div>
                    <div style={{ fontSize: "12px", color: "#6D7175" }}>+10% de sécurité ({(parseFloat(simResult.targetMargin) + 4.5).toFixed(1)}% marge estimée)</div>
                  </div>
                </div>
                <div style={{ padding: "14px 18px", borderRadius: "8px", background: "#F9FAFB", border: "1px solid #E4E5E7", fontSize: "13px", color: "#6D7175", lineHeight: "1.8" }}>
                  <strong style={{ color: "#202223" }}>Détail du calcul :</strong><br />
                  Coût rendu (achat + douane + TVA import + port) = <strong>{simResult.coutRendu.toFixed(2)}€</strong><br />
                  Taux de frais variables (Shopify + Stripe + retours + ads) = <strong>{(simResult.totalFeeRate * 100).toFixed(1)}%</strong><br />
                  Formule : {simResult.coutRendu.toFixed(2)} ÷ (1 − {(simResult.totalFeeRate * 100).toFixed(1)}% − {simResult.targetMargin}%) = {simResult.prixVenteMin.toFixed(2)}€
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════ HISTORY TAB (Feature 2) ════════════════════════════════ */}
        {activeTab === "history" && (
          isPro ? (
            history.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 24px", color: "#6D7175" }}>
                <div style={{ fontSize: "32px", marginBottom: "12px" }}>📊</div>
                <div style={{ fontSize: "15px", fontWeight: "500" }}>Aucun calcul sauvegardé pour l'instant.</div>
                <div style={{ fontSize: "13px", marginTop: "8px" }}>Lance une simulation depuis l'onglet Calculateur.</div>
              </div>
            ) : (
              <div>
                {/* Chart */}
                <div style={{ marginBottom: "24px" }}>
                  <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>
                    Évolution de la marge nette
                  </div>
                  <div style={{ border: "1px solid #E4E5E7", borderRadius: "8px", padding: "12px 16px", background: "#FAFBFB" }}>
                    <SparklineChart data={historyForChart} />
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                      <span style={{ fontSize: "10px", color: "#6D7175" }}>{formatDate(historyForChart[0]?.created_at)}</span>
                      <span style={{ fontSize: "10px", color: "#6D7175" }}>{formatDate(historyForChart[historyForChart.length - 1]?.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Table */}
                <div style={{ fontSize: "13px", color: "#6D7175", marginBottom: "12px" }}>
                  {history.length} dernier{history.length > 1 ? "s" : ""} calcul{history.length > 1 ? "s" : ""}
                </div>
                <div style={{ border: "1px solid #E4E5E7", borderRadius: "8px", overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.8fr 1fr 1fr 1fr 1.2fr", background: "#F9FAFB", borderBottom: "1px solid #E4E5E7" }}>
                    {["Date", "Produit", "Catégorie", "Pays", "Prix vente", "Marge nette"].map(h => (
                      <div key={h} style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px" }}>{h}</div>
                    ))}
                  </div>
                  {history.map((calc, i) => {
                    const mc = calc.net_margin_percent < 10 ? "#D72C0D" : calc.net_margin_percent < 25 ? "#B98900" : "#008060";
                    return (
                      <div key={calc.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 1.8fr 1fr 1fr 1fr 1.2fr", background: i % 2 === 0 ? "#fff" : "#FAFBFB", borderBottom: i < history.length - 1 ? "1px solid #F1F2F3" : "none" }}>
                        <div style={{ padding: "11px 12px", fontSize: "11px", color: "#6D7175" }}>{formatDate(calc.created_at)}</div>
                        <div style={{ padding: "11px 12px", fontSize: "13px", color: "#202223", fontWeight: "500" }}>{calc.product_title ?? "—"}</div>
                        <div style={{ padding: "11px 12px", fontSize: "12px", color: "#202223" }}>{calc.category}</div>
                        <div style={{ padding: "11px 12px", fontSize: "12px", color: "#202223" }}>{calc.country}</div>
                        <div style={{ padding: "11px 12px", fontSize: "13px", color: "#202223" }}>{fmt(calc.selling_price)}€</div>
                        <div style={{ padding: "11px 12px" }}>
                          <span style={{ fontSize: "13px", fontWeight: "700", color: mc }}>{pct(calc.net_margin_percent)}%</span>
                          <span style={{ fontSize: "11px", color: "#6D7175", marginLeft: "4px" }}>{fmt(calc.net_margin_euros)}€</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          ) : (
            <div style={{ textAlign: "center", padding: "48px 24px" }}>
              <div style={{ fontSize: "36px", marginBottom: "16px" }}>🔒</div>
              <div style={{ fontSize: "16px", fontWeight: "600", color: "#202223", marginBottom: "8px" }}>Fonctionnalité Pro</div>
              <div style={{ fontSize: "14px", color: "#6D7175", marginBottom: "24px" }}>
                L'historique et les graphes sont disponibles avec le plan Pro à 9$/mois.
              </div>
              {subscribeBtn()}
            </div>
          )
        )}

        {/* ════════ ALERTS TAB (Feature 4) ════════════════════════════════ */}
        {activeTab === "alerts" && (
          <div>
            <div style={{ fontSize: "14px", color: "#6D7175", marginBottom: "20px", lineHeight: "1.6" }}>
              Définissez un seuil de marge nette minimum. L'app affiche une alerte dès qu'un calcul est en dessous de ce seuil.
            </div>

            <div style={{ maxWidth: "360px", marginBottom: "28px" }}>
              <FieldGroup label="Seuil de marge minimum (%)" hint="Par défaut : 25%. L'alerte s'affiche si votre marge nette tombe en dessous.">
                <div style={{ display: "flex", gap: "10px" }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={alertThreshold}
                    onChange={e => setAlertThreshold(e.target.value)}
                    style={{ ...inputStyle, width: "120px" }}
                    placeholder="25"
                  />
                  <button
                    onClick={handleSaveAlert}
                    disabled={isSavingAlert}
                    style={{ padding: "8px 20px", background: "#008060", color: "#fff", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit", opacity: isSavingAlert ? 0.7 : 1 }}
                  >
                    {isSavingAlert ? "Sauvegarde…" : "Enregistrer"}
                  </button>
                </div>
              </FieldGroup>
              {alertFetcher.data?.success && (
                <div style={{ fontSize: "13px", color: "#008060", marginTop: "4px" }}>✓ Seuil mis à jour</div>
              )}
              {alertFetcher.data?.error && (
                <div style={{ fontSize: "13px", color: "#D72C0D", marginTop: "4px" }}>{alertFetcher.data.error}</div>
              )}
            </div>

            {violations.length > 0 ? (
              <div>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#D72C0D", marginBottom: "12px" }}>
                  ⚠️ {violations.length} produit{violations.length > 1 ? "s" : ""} en dessous du seuil ({initialThreshold}%)
                </div>
                <div style={{ border: "1px solid #D72C0D22", borderRadius: "8px", overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", background: "#FFF4F4", borderBottom: "1px solid #F1D0D0" }}>
                    {["Produit", "Catégorie", "Marge nette", "Écart"].map(h => (
                      <div key={h} style={{ padding: "10px 14px", fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px" }}>{h}</div>
                    ))}
                  </div>
                  {violations.map((v, i) => (
                    <div key={v.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", background: i % 2 === 0 ? "#fff" : "#FFF8F8", borderBottom: i < violations.length - 1 ? "1px solid #F1F2F3" : "none" }}>
                      <div style={{ padding: "11px 14px", fontSize: "13px", fontWeight: "500", color: "#202223" }}>{v.product_title ?? v.category}</div>
                      <div style={{ padding: "11px 14px", fontSize: "12px", color: "#6D7175" }}>{v.category}</div>
                      <div style={{ padding: "11px 14px", fontSize: "13px", fontWeight: "700", color: "#D72C0D" }}>{pct(v.net_margin_percent)}%</div>
                      <div style={{ padding: "11px 14px", fontSize: "12px", color: "#D72C0D" }}>−{pct(initialThreshold - v.net_margin_percent)} pts</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ padding: "32px 24px", textAlign: "center", background: "#F1F8F5", borderRadius: "8px", border: "1px solid #8DC8A8" }}>
                <div style={{ fontSize: "24px", marginBottom: "10px" }}>✅</div>
                <div style={{ fontSize: "14px", fontWeight: "500", color: "#008060" }}>
                  Toutes vos marges récentes sont au-dessus du seuil de {initialThreshold}%.
                </div>
              </div>
            )}
          </div>
        )}

      </s-section>

      {/* ── RESULTS (Feature 1 integrated + Feature 5) ───────────────────── */}
      {activeTab === "calculator" && !showUpgrade && results && (
        <s-section heading="Résultats — Votre vraie marge">
          <MessageBlock items={warnings} color="#B98900" bg="#FFF9EC" borderColor="#B98900" />

          <div style={{ padding: "20px 24px", borderRadius: "8px", background: marginBg, borderLeft: `5px solid ${marginColor}`, marginBottom: "28px" }}>
            {results.margeNettePercent < 0 ? (
              <>
                <div style={{ fontSize: "17px", fontWeight: "700", color: "#D72C0D", marginBottom: "8px" }}>Attention : tu perds de l'argent sur chaque vente.</div>
                <div style={{ fontSize: "14px", color: "#6D7175", lineHeight: "1.6" }}>
                  Tu pensais faire <strong style={{ color: "#202223" }}>{pct(results.margeApparente)}%</strong> de marge.
                  Tu fais en réalité <strong style={{ color: "#D72C0D" }}>{pct(results.margeNettePercent)}%</strong>.
                  Chaque vente te coûte <strong style={{ color: "#D72C0D" }}>{fmt(Math.abs(results.margeNette))}€</strong>.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "17px", fontWeight: "700", color: marginColor, marginBottom: "8px" }}>{marginLabel}</div>
                <div style={{ fontSize: "14px", color: "#6D7175", lineHeight: "1.6" }}>
                  Tu pensais faire <strong style={{ color: "#202223" }}>{pct(results.margeApparente)}%</strong> de marge.
                  Tu fais en réalité <strong style={{ color: marginColor }}>{pct(results.margeNettePercent)}%</strong> de marge nette,
                  soit <strong style={{ color: marginColor }}>{fmt(results.margeNette)}€</strong> par vente.
                </div>
              </>
            )}
          </div>

          <div style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
              <span style={{ fontSize: "13px", fontWeight: "500", color: "#6D7175" }}>Marge nette réelle</span>
              <span style={{ fontSize: "26px", fontWeight: "800", color: marginColor, letterSpacing: "-0.5px" }}>{pct(results.margeNettePercent)}%</span>
            </div>
            <div style={{ height: "22px", background: "#F1F2F3", borderRadius: "11px", overflow: "hidden", position: "relative" }}>
              <div style={{ position: "absolute", left: "10%", top: 0, bottom: 0, width: "2px", background: "#D72C0D44" }} />
              <div style={{ position: "absolute", left: "25%", top: 0, bottom: 0, width: "2px", background: "#B9890044" }} />
              <div style={{ width: gaugeWidth, height: "100%", background: `linear-gradient(90deg, ${marginColor}CC, ${marginColor})`, borderRadius: "11px", transition: "width 0.7s cubic-bezier(0.4,0,0.2,1)" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px" }}>
              <span style={{ fontSize: "11px", color: "#D72C0D", fontWeight: "500" }}>0% — Danger</span>
              <span style={{ fontSize: "11px", color: "#B98900", fontWeight: "500" }}>10% — Faible</span>
              <span style={{ fontSize: "11px", color: "#008060", fontWeight: "500" }}>25%+ — Saine</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "32px" }}>
            <StatCard label="Marge apparente"    value={`${pct(results.margeApparente)}%`}    sub="Ce que tu croyais faire"        color="#6D7175"   bg="#F9FAFB" />
            <StatCard label="Marge brute"         value={`${pct(results.margeBrutePercent)}%`} sub={`${fmt(results.margeBrute)}€ / vente`} color="#202223"   bg="#F9FAFB" />
            <StatCard label="Marge nette réelle"  value={`${pct(results.margeNettePercent)}%`} sub={`${fmt(results.margeNette)}€ / vente`} color={marginColor} bg={marginBg} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            <div>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "12px" }}>Structure du coût d'achat</div>
              {[
                { label: "Prix fournisseur",                      value: `${fmt(results.prixAchat)}€`,  color: "#202223" },
                { label: `+ Droits de douane (${(results.customsRate*100).toFixed(0)}%)`, value: `+${fmt(results.douane)}€`, color: "#6D7175" },
                { label: "+ TVA à l'import (20%)",                value: `+${fmt(results.tvaImport)}€`, color: "#6D7175" },
                { label: `+ Frais de port (${form.paysImport})`,  value: `+${fmt(results.shipping)}€`,  color: "#6D7175" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F1F2F3" }}>
                  <span style={{ fontSize: "13px", color }}>{label}</span>
                  <span style={{ fontSize: "13px", fontWeight: "600", color }}>{value}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0 0" }}>
                <span style={{ fontSize: "14px", fontWeight: "700", color: "#202223" }}>= Coût rendu total</span>
                <span style={{ fontSize: "15px", fontWeight: "700", color: "#202223" }}>{fmt(results.coutRendu)}€</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "12px" }}>Déductions sur le prix de vente</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F1F2F3" }}>
                <span style={{ fontSize: "13px", color: "#008060" }}>Prix de vente</span>
                <span style={{ fontSize: "13px", fontWeight: "600", color: "#008060" }}>{fmt(results.prixVente)}€</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F1F2F3" }}>
                <span style={{ fontSize: "13px", color: "#D72C0D" }}>— Coût rendu</span>
                <span style={{ fontSize: "13px", fontWeight: "600", color: "#D72C0D" }}>-{fmt(results.coutRendu)}€</span>
              </div>
              {[
                { label: `— Frais Shopify (${form.shopifyFee}%)`, value: results.shopifyCost },
                { label: `— Frais Stripe (${form.stripeFee}%)`,   value: results.stripeCost },
                { label: `— Provision retours (${form.retours}%)`, value: results.retoursCost },
                { label: `— Budget ads (${form.ads}%)`,           value: results.adsCost },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F1F2F3" }}>
                  <span style={{ fontSize: "13px", color: "#D72C0D" }}>{label}</span>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "#D72C0D" }}>-{fmt(value)}€</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0 0" }}>
                <span style={{ fontSize: "14px", fontWeight: "700", color: marginColor }}>= Marge nette réelle</span>
                <span style={{ fontSize: "15px", fontWeight: "700", color: marginColor }}>{fmt(results.margeNette)}€</span>
              </div>
            </div>
          </div>

          {/* Feature 5: AI recommendation */}
          <AIRecommendation fetcher={aiFetcher} />
        </s-section>
      )}

      {/* ── ASIDE ────────────────────────────────────────────────────────── */}
      <s-section slot="aside" heading="Votre abonnement">
        <div style={{ padding: "14px 16px", borderRadius: "8px", background: isPro ? "#F1F8F5" : "#F9FAFB", border: `1px solid ${isPro ? "#008060" : "#E4E5E7"}`, marginBottom: "12px" }}>
          <div style={{ fontSize: "13px", fontWeight: "600", color: isPro ? "#008060" : "#6D7175", marginBottom: "4px" }}>
            {isPro ? "★ Plan Pro actif" : "Plan Gratuit"}
          </div>
          <div style={{ fontSize: "12px", color: "#6D7175" }}>
            {isPro ? "Calculs illimités · Historique · IA" : `${localCount}/${FREE_LIMIT} calculs ce mois`}
          </div>
        </div>
        {!isPro && subscribeBtn()}
      </s-section>

      <s-section slot="aside" heading="Comment ça marche ?">
        <s-paragraph>
          Ce calculateur révèle votre <strong>vraie marge nette</strong> en intégrant tous les coûts cachés.
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>Sélection depuis votre catalogue Shopify</s-list-item>
          <s-list-item>Droits de douane selon catégorie</s-list-item>
          <s-list-item>TVA à l'import (20%)</s-list-item>
          <s-list-item>Frais Shopify, Stripe, retours & ads</s-list-item>
          <s-list-item>Recommandation IA (Claude) après chaque calcul</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Taux de douane">
        <s-unordered-list>
          {Object.entries(CUSTOMS_RATES).map(([cat, rate]) => (
            <s-list-item key={cat}>{cat} : {(rate * 100).toFixed(0)}%</s-list-item>
          ))}
        </s-unordered-list>
      </s-section>

    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : "Une erreur inattendue est survenue.";
  return (
    <s-page heading="Calculateur de Vraie Marge">
      <s-section heading="Erreur de chargement">
        <div style={{ padding: "20px 24px", borderRadius: "8px", background: "#FFF4F4", border: "1px solid #D72C0D", fontSize: "14px", color: "#D72C0D", lineHeight: "1.6" }}>
          <strong>L'application n'a pas pu se charger.</strong><br />
          {message}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
