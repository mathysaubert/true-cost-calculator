import { useState, useCallback, useEffect } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { authenticate, PLAN_PRO } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { supabase } from "../supabase.server";

// ── Constants ─────────────────────────────────────────────────────────────────

const FREE_LIMIT = 3;

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
  if (!Number.isFinite(n)) { errors.push(`${label} : valeur invalide.`); return null; }
  if (n < 0) { errors.push(`${label} ne peut pas être négatif.`); return null; }
  if (n === 0) { errors.push(`${label} ne peut pas être 0.`); return null; }
  return n;
}

function validatePercentage(raw, label, errors) {
  const s = normalizeDecimal(raw);
  if (s === "") return 0;
  if (!/^\d+(\.\d*)?$/.test(s)) { errors.push(`${label} : saisissez un nombre entre 0 et 100.`); return null; }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) { errors.push(`${label} : valeur invalide.`); return null; }
  if (n < 0) { errors.push(`${label} ne peut pas être négatif.`); return null; }
  if (n > 100) { errors.push(`${label} ne peut pas dépasser 100%.`); return null; }
  return n;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
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

// ── Server exports ────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);

  // Defensive billing check — any SDK/network error defaults to free plan
  // so a transient Shopify API failure never crashes the whole page.
  let isPro = false;
  try {
    const { hasActivePayment } = await billing.check({ plans: [PLAN_PRO], isTest: true });
    isPro = hasActivePayment;
  } catch (e) {
    console.error("[Billing] check failed, defaulting to free plan:", e?.message ?? e);
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  let monthlyCount = 0;
  if (!isPro) {
    try {
      const { data } = await supabase
        .from("usage")
        .select("calculation_count")
        .eq("shop_domain", session.shop)
        .eq("month", currentMonth)
        .maybeSingle();
      monthlyCount = data?.calculation_count ?? 0;
    } catch (e) {
      console.error("[Supabase] usage fetch failed:", e?.message ?? e);
    }
  }

  let history = [];
  if (isPro) {
    try {
      const { data } = await supabase
        .from("calculations")
        .select("id, category, country, purchase_price, selling_price, net_margin_percent, net_margin_euros, created_at")
        .eq("shop_domain", session.shop)
        .order("created_at", { ascending: false })
        .limit(20);
      history = data ?? [];
    } catch (e) {
      console.error("[Supabase] history fetch failed:", e?.message ?? e);
    }
  }

  const url = new URL(request.url);
  const showWelcome = url.searchParams.get("subscribed") === "true";

  return { isPro, monthlyCount, history, showWelcome };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return { success: false, error: "Corps de requête invalide." };
  }

  // ── Subscription request ───────────────────────────────────────────────────
  if (body._action === "subscribe") {
    // Throws a redirect (App Bridge intercepts and navigates to billing page)
    await billing.request({
      plan: PLAN_PRO,
      isTest: true,
      returnUrl: `${process.env.SHOPIFY_APP_URL}/app?subscribed=true`,
    });
    return null; // never reached
  }

  // ── Calculation save ───────────────────────────────────────────────────────
  let hasActivePayment = false;
  try {
    const result = await billing.check({ plans: [PLAN_PRO], isTest: true });
    hasActivePayment = result.hasActivePayment;
  } catch (e) {
    console.error("[Billing] action check failed, defaulting to free plan:", e?.message ?? e);
  }
  const currentMonth = new Date().toISOString().slice(0, 7);

  if (!hasActivePayment) {
    const { data: usage } = await supabase
      .from("usage")
      .select("calculation_count")
      .eq("shop_domain", session.shop)
      .eq("month", currentMonth)
      .maybeSingle();

    const count = usage?.calculation_count ?? 0;

    if (count >= FREE_LIMIT) {
      return { success: false, limitReached: true };
    }

    await supabase.from("usage").upsert(
      { shop_domain: session.shop, month: currentMonth, calculation_count: count + 1, updated_at: new Date().toISOString() },
      { onConflict: "shop_domain,month" }
    );

    return { success: true, monthlyCount: count + 1 };
  }

  // Pro user: persist to calculations table
  const { error } = await supabase.from("calculations").insert({
    shop_domain:        session.shop,
    purchase_price:     body.purchase_price,
    selling_price:      body.selling_price,
    category:           body.category,
    country:            body.country,
    net_margin_percent: body.net_margin_percent,
    net_margin_euros:   body.net_margin_euros,
  });

  if (error) {
    console.error("[Supabase] Insert error:", error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
};

// ── Main component ────────────────────────────────────────────────────────────

export default function Index() {
  const { isPro, monthlyCount: initialCount, history, showWelcome } = useLoaderData();
  const saveFetcher       = useFetcher();
  const subscribeFetcher  = useFetcher();

  const [form, setForm] = useState({
    prixAchat: "20", prixVente: "49.99",
    categorie: "Textile", paysImport: "Chine",
    shopifyFee: "2", stripeFee: "2.5", retours: "5", ads: "15",
  });
  const [results,     setResults]     = useState(null);
  const [errors,      setErrors]      = useState([]);
  const [warnings,    setWarnings]    = useState([]);
  const [activeTab,   setActiveTab]   = useState("calculator");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [localCount,  setLocalCount]  = useState(initialCount);

  // Sync usage counter and limit-reached state from server action
  useEffect(() => {
    if (!saveFetcher.data) return;
    if (saveFetcher.data.monthlyCount !== undefined) {
      setLocalCount(saveFetcher.data.monthlyCount);
    }
    if (saveFetcher.data.limitReached) {
      setShowUpgrade(true);
      setResults(null);
    }
  }, [saveFetcher.data]);

  const update = useCallback((field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setResults(null); setErrors([]); setWarnings([]); setShowUpgrade(false);
  }, []);

  const calculate = useCallback(() => {
    const errs = [], warns = [];
    const prixAchat     = validatePrice(form.prixAchat,   "Le prix d'achat", errs);
    const prixVente     = validatePrice(form.prixVente,   "Le prix de vente", errs);
    const shopifyFeeVal = validatePercentage(form.shopifyFee, "Frais Shopify", errs);
    const stripeFeeVal  = validatePercentage(form.stripeFee,  "Frais Stripe",  errs);
    const retoursVal    = validatePercentage(form.retours,    "Taux de retours", errs);
    const adsVal        = validatePercentage(form.ads,        "Budget ads",    errs);

    if (errs.length > 0) { setErrors(errs); setWarnings([]); setResults(null); return null; }

    if (prixAchat > prixVente) warns.push("Attention : tu vends moins cher que tu achètes.");
    else if (prixAchat === prixVente) warns.push("Prix achat = prix vente : ta marge est 0% avant les frais.");
    const totalPct = shopifyFeeVal + stripeFeeVal + retoursVal + adsVal;
    if (totalPct > 100) warns.push(`Tes frais cumulés (${totalPct.toFixed(1)}%) dépassent 100% du CA.`);

    const customsRate = CUSTOMS_RATES[form.categorie] ?? 0.03;
    const shipping    = SHIPPING_ESTIMATES[form.paysImport] ?? 5;
    const douane        = prixAchat * customsRate;
    const tvaImport     = (prixAchat + douane) * 0.20;
    const coutRendu     = prixAchat + douane + tvaImport + shipping;
    const shopifyCost   = prixVente * (shopifyFeeVal / 100);
    const stripeCost    = prixVente * (stripeFeeVal  / 100);
    const retoursCost   = prixVente * (retoursVal    / 100);
    const adsCost       = prixVente * (adsVal        / 100);
    const totalFraisVente   = shopifyCost + stripeCost + retoursCost + adsCost;
    const margeBrute        = prixVente - coutRendu;
    const margeBrutePercent = (margeBrute / prixVente) * 100;
    const margeNette        = margeBrute - totalFraisVente;
    const margeNettePercent = (margeNette / prixVente) * 100;
    const margeApparente    = ((prixVente - prixAchat) / prixVente) * 100;

    const computed = { margeBrutePercent, margeNettePercent, margeApparente, coutRendu, margeNette };
    const bad = Object.entries(computed).find(([, v]) => !Number.isFinite(v));
    if (bad) { setErrors([`Erreur de calcul (${bad[0]}).`]); setResults(null); return null; }

    const r = { prixAchat, prixVente, douane, tvaImport, shipping, coutRendu, shopifyCost, stripeCost, retoursCost, adsCost, totalFraisVente, margeBrute, margeBrutePercent, margeNette, margeNettePercent, margeApparente, customsRate };
    setErrors([]); setWarnings(warns); setResults(r);

    return {
      purchase_price:     parseFloat(prixAchat.toFixed(2)),
      selling_price:      parseFloat(prixVente.toFixed(2)),
      category:           form.categorie,
      country:            form.paysImport,
      net_margin_percent: parseFloat(margeNettePercent.toFixed(2)),
      net_margin_euros:   parseFloat(margeNette.toFixed(2)),
    };
  }, [form]);

  const handleReveal = () => {
    // Block on free plan limit (client-side fast-path; server enforces too)
    if (!isPro && localCount >= FREE_LIMIT) {
      setShowUpgrade(true);
      setResults(null);
      return;
    }
    const saveData = calculate();
    if (saveData) {
      saveFetcher.submit(saveData, { method: "POST", encType: "application/json" });
    }
  };

  const handleSubscribe = () => {
    subscribeFetcher.submit({ _action: "subscribe" }, { method: "POST", encType: "application/json" });
  };

  // ── Derived display values ─────────────────────────────────────────────────
  const marginColor = results
    ? results.margeNettePercent < 10 ? "#D72C0D" : results.margeNettePercent < 25 ? "#B98900" : "#008060"
    : "#008060";
  const marginBg = results
    ? results.margeNettePercent < 10 ? "#FFF4F4" : results.margeNettePercent < 25 ? "#FFF9EC" : "#F1F8F5"
    : "#F1F8F5";
  const marginLabel = results
    ? results.margeNettePercent < 0 ? "Marge négative" : results.margeNettePercent < 10 ? "Marge critique" : results.margeNettePercent < 25 ? "Marge faible" : "Marge saine"
    : "";
  const gaugeWidth = results
    ? `${Math.max(0, Math.min(100, safeNum(results.margeNettePercent)))}%`
    : "0%";

  const customsRateDisplay = ((CUSTOMS_RATES[form.categorie] ?? 0.03) * 100).toFixed(0);
  const shippingDisplay    = SHIPPING_ESTIMATES[form.paysImport] ?? 5;
  const isSaving    = saveFetcher.state !== "idle";
  const saveStatus  = saveFetcher.data;
  const isSubscribing = subscribeFetcher.state !== "idle";

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
            Calculs illimités activés. Vos simulations sont désormais sauvegardées automatiquement et consultables dans l'onglet <strong>Historique</strong>.
          </div>
        </s-section>
      )}

      {/* ── MAIN SECTION ─────────────────────────────────────────────────── */}
      <s-section heading={activeTab === "history" ? "Historique de vos calculs" : "Simulateur"}>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: "0", marginBottom: "24px", borderBottom: "2px solid #E4E5E7" }}>
          {[
            { id: "calculator", label: "Calculateur" },
            { id: "history", label: isPro ? "Historique" : "Historique 🔒" },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => setActiveTab(id)} style={{ padding: "10px 20px", background: "none", border: "none", borderBottom: activeTab === id ? "2px solid #008060" : "2px solid transparent", marginBottom: "-2px", cursor: "pointer", fontSize: "14px", fontWeight: activeTab === id ? "600" : "400", color: activeTab === id ? "#008060" : "#6D7175", fontFamily: "inherit" }}>
              {label}
            </button>
          ))}
          {isPro && (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
              <span style={{ padding: "3px 10px", borderRadius: "12px", background: "#008060", color: "#fff", fontSize: "11px", fontWeight: "700", letterSpacing: "0.5px" }}>PRO</span>
            </div>
          )}
        </div>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* CALCULATOR TAB                                                   */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {activeTab === "calculator" && (
          <>
            {/* Free plan usage counter */}
            {!isPro && !showUpgrade && (
              <div style={{ padding: "10px 16px", borderRadius: "6px", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", background: localCount >= FREE_LIMIT ? "#FFF4F4" : localCount >= FREE_LIMIT - 1 ? "#FFF9EC" : "#F1F8F5", border: `1px solid ${localCount >= FREE_LIMIT ? "#D72C0D" : localCount >= FREE_LIMIT - 1 ? "#B98900" : "#8DC8A8"}` }}>
                <span style={{ fontSize: "13px", color: "#202223" }}>
                  Plan gratuit ·{" "}
                  <strong>{localCount}/{FREE_LIMIT}</strong> calculs utilisés ce mois
                  {localCount >= FREE_LIMIT ? " — limite atteinte" : localCount >= FREE_LIMIT - 1 ? " — dernier calcul gratuit" : ""}
                </span>
                {localCount >= FREE_LIMIT && (
                  <button onClick={() => setShowUpgrade(true)} style={{ padding: "4px 12px", background: "#008060", color: "#fff", border: "none", borderRadius: "4px", fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
                    Voir les plans
                  </button>
                )}
              </div>
            )}

            {/* ── UPGRADE SCREEN ──────────────────────────────────────────── */}
            {showUpgrade ? (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <div style={{ fontSize: "36px", marginBottom: "16px" }}>🔒</div>
                <div style={{ fontSize: "20px", fontWeight: "700", color: "#202223", marginBottom: "8px" }}>
                  Tu as utilisé tes {FREE_LIMIT} calculs gratuits ce mois-ci.
                </div>
                <div style={{ fontSize: "14px", color: "#6D7175", marginBottom: "32px" }}>
                  Passe au Pro pour des calculs illimités et l'historique complet de tes simulations.
                </div>

                {/* Plan comparison */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", maxWidth: "480px", margin: "0 auto 32px" }}>
                  {/* Free */}
                  <div style={{ padding: "20px", borderRadius: "8px", background: "#F9FAFB", border: "2px solid #E4E5E7", textAlign: "left" }}>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>Plan Gratuit</div>
                    <div style={{ fontSize: "22px", fontWeight: "700", color: "#202223", marginBottom: "14px" }}>0 €/mois</div>
                    {[`${FREE_LIMIT} calculs/mois`, "Pas d'historique", "Support standard"].map(f => (
                      <div key={f} style={{ fontSize: "13px", color: "#6D7175", marginBottom: "5px" }}>✓ {f}</div>
                    ))}
                  </div>
                  {/* Pro */}
                  <div style={{ padding: "20px", borderRadius: "8px", background: "#F1F8F5", border: "2px solid #008060", textAlign: "left", position: "relative" }}>
                    <div style={{ position: "absolute", top: "-1px", right: "12px", background: "#008060", color: "#fff", fontSize: "10px", fontWeight: "700", padding: "3px 8px", borderRadius: "0 0 6px 6px", letterSpacing: "0.5px" }}>RECOMMANDÉ</div>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#008060", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>Plan Pro</div>
                    <div style={{ fontSize: "22px", fontWeight: "700", color: "#202223", marginBottom: "14px" }}>9 $/mois</div>
                    {["Calculs illimités", "Historique sauvegardé", "20 derniers calculs", "Support prioritaire"].map(f => (
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
              /* ── FORM ────────────────────────────────────────────────────── */
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "14px" }}>Données produit</div>
                    <FieldGroup label="Prix d'achat fournisseur (€)">
                      <input type="text" inputMode="decimal" value={form.prixAchat} onChange={update("prixAchat")} style={inputStyle} placeholder="ex : 20.00 ou 20,00" />
                    </FieldGroup>
                    <FieldGroup label="Prix de vente (€)">
                      <input type="text" inputMode="decimal" value={form.prixVente} onChange={update("prixVente")} style={inputStyle} placeholder="ex : 49.99 ou 49,99" />
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
                    <FieldGroup label="Frais Stripe (% du CA)" hint="Stripe standard ≈ 1.5–2.5% selon le plan">
                      <input type="text" inputMode="decimal" value={form.stripeFee} onChange={update("stripeFee")} style={inputStyle} placeholder="ex : 2.5" />
                    </FieldGroup>
                    <FieldGroup label="Taux de retours (%)" hint="Moyenne e-commerce : 5–15% selon la niche">
                      <input type="text" inputMode="decimal" value={form.retours} onChange={update("retours")} style={inputStyle} placeholder="ex : 5" />
                    </FieldGroup>
                    <FieldGroup label="Budget ads (% du CA)" hint="Meta/TikTok Ads : typiquement 15–30% pour un débutant">
                      <input type="text" inputMode="decimal" value={form.ads} onChange={update("ads")} style={inputStyle} placeholder="ex : 15" />
                    </FieldGroup>
                  </div>
                </div>

                <MessageBlock items={errors} color="#D72C0D" bg="#FFF4F4" borderColor="#D72C0D" />

                <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                  <s-button onClick={handleReveal}>Révéler ma vraie marge →</s-button>
                  {isSaving && <span style={{ fontSize: "12px", color: "#6D7175" }}>Sauvegarde en cours…</span>}
                  {!isSaving && saveStatus?.success === true && (
                    <span style={{ fontSize: "12px", color: "#008060", fontWeight: "500" }}>
                      ✓ {isPro ? "Calcul sauvegardé dans l'historique" : "Calcul enregistré"}
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

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* HISTORY TAB                                                      */}
        {/* ════════════════════════════════════════════════════════════════ */}
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
                <div style={{ fontSize: "13px", color: "#6D7175", marginBottom: "12px" }}>
                  {history.length} dernier{history.length > 1 ? "s" : ""} calcul{history.length > 1 ? "s" : ""}
                </div>
                <div style={{ border: "1px solid #E4E5E7", borderRadius: "8px", overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 1fr 1fr 1.2fr", background: "#F9FAFB", borderBottom: "1px solid #E4E5E7" }}>
                    {["Date", "Catégorie", "Pays", "Prix vente", "Marge nette"].map(h => (
                      <div key={h} style={{ padding: "10px 14px", fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px" }}>{h}</div>
                    ))}
                  </div>
                  {history.map((calc, i) => {
                    const mc = calc.net_margin_percent < 10 ? "#D72C0D" : calc.net_margin_percent < 25 ? "#B98900" : "#008060";
                    return (
                      <div key={calc.id} style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 1fr 1fr 1.2fr", background: i % 2 === 0 ? "#fff" : "#FAFBFB", borderBottom: i < history.length - 1 ? "1px solid #F1F2F3" : "none" }}>
                        <div style={{ padding: "11px 14px", fontSize: "12px", color: "#6D7175" }}>{formatDate(calc.created_at)}</div>
                        <div style={{ padding: "11px 14px", fontSize: "13px", color: "#202223" }}>{calc.category}</div>
                        <div style={{ padding: "11px 14px", fontSize: "13px", color: "#202223" }}>{calc.country}</div>
                        <div style={{ padding: "11px 14px", fontSize: "13px", color: "#202223" }}>{fmt(calc.selling_price)}€</div>
                        <div style={{ padding: "11px 14px" }}>
                          <span style={{ fontSize: "13px", fontWeight: "700", color: mc }}>{pct(calc.net_margin_percent)}%</span>
                          <span style={{ fontSize: "11px", color: "#6D7175", marginLeft: "6px" }}>{fmt(calc.net_margin_euros)}€</span>
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
                L'historique de vos simulations est disponible avec le plan Pro à 9$/mois.
              </div>
              {subscribeBtn()}
            </div>
          )
        )}
      </s-section>

      {/* ── RESULTS ──────────────────────────────────────────────────────── */}
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
              <div style={{ width: gaugeWidth, height: "100%", background: `linear-gradient(90deg, ${marginColor}CC, ${marginColor})`, borderRadius: "11px", transition: "width 0.7s cubic-bezier(0.4, 0, 0.2, 1)" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px" }}>
              <span style={{ fontSize: "11px", color: "#D72C0D", fontWeight: "500" }}>0% — Danger</span>
              <span style={{ fontSize: "11px", color: "#B98900", fontWeight: "500" }}>10% — Faible</span>
              <span style={{ fontSize: "11px", color: "#008060", fontWeight: "500" }}>25%+ — Saine</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "32px" }}>
            <StatCard label="Marge apparente"  value={`${pct(results.margeApparente)}%`}    sub="Ce que tu croyais faire"        color="#6D7175"   bg="#F9FAFB" />
            <StatCard label="Marge brute"       value={`${pct(results.margeBrutePercent)}%`} sub={`${fmt(results.margeBrute)}€ / vente`} color="#202223"   bg="#F9FAFB" />
            <StatCard label="Marge nette réelle" value={`${pct(results.margeNettePercent)}%`} sub={`${fmt(results.margeNette)}€ / vente`} color={marginColor} bg={marginBg} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            <div>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "12px" }}>Structure du coût d'achat</div>
              {[
                { label: "Prix fournisseur", value: `${fmt(results.prixAchat)}€`, color: "#202223" },
                { label: `+ Droits de douane (${(results.customsRate * 100).toFixed(0)}%)`, value: `+${fmt(results.douane)}€`, color: "#6D7175" },
                { label: "+ TVA à l'import (20%)", value: `+${fmt(results.tvaImport)}€`, color: "#6D7175" },
                { label: `+ Frais de port (${form.paysImport})`, value: `+${fmt(results.shipping)}€`, color: "#6D7175" },
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
                { label: `— Budget ads (${form.ads}% du CA)`,      value: results.adsCost },
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
        </s-section>
      )}

      {/* ── ASIDE ────────────────────────────────────────────────────────── */}
      <s-section slot="aside" heading="Votre abonnement">
        <div style={{ padding: "14px 16px", borderRadius: "8px", background: isPro ? "#F1F8F5" : "#F9FAFB", border: `1px solid ${isPro ? "#008060" : "#E4E5E7"}`, marginBottom: "12px" }}>
          <div style={{ fontSize: "13px", fontWeight: "600", color: isPro ? "#008060" : "#6D7175", marginBottom: "4px" }}>
            {isPro ? "★ Plan Pro actif" : "Plan Gratuit"}
          </div>
          <div style={{ fontSize: "12px", color: "#6D7175" }}>
            {isPro
              ? "Calculs illimités · Historique activé"
              : `${localCount}/${FREE_LIMIT} calculs utilisés ce mois`}
          </div>
        </div>
        {!isPro && subscribeBtn()}
      </s-section>

      <s-section slot="aside" heading="Comment ça marche ?">
        <s-paragraph>
          Ce calculateur révèle votre <strong>vraie marge nette</strong> en intégrant tous les coûts que la majorité des marchands débutants ignorent.
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>Droits de douane selon la catégorie</s-list-item>
          <s-list-item>TVA à l'import (20%)</s-list-item>
          <s-list-item>Frais de port estimés selon pays</s-list-item>
          <s-list-item>Commissions Shopify & Stripe</s-list-item>
          <s-list-item>Provision retours & budget ads</s-list-item>
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

// Route-level error boundary — catches loader/action errors before they reach
// app.jsx's boundary.error() which re-throws non-ErrorResponse errors and
// would crash the React tree entirely (showing Shopify's "sad face").
export function ErrorBoundary() {
  const error = useRouteError();
  const message =
    error instanceof Error ? error.message : "Une erreur inattendue est survenue.";
  return (
    <s-page heading="Calculateur de Vraie Marge">
      <s-section heading="Erreur de chargement">
        <div style={{
          padding: "20px 24px", borderRadius: "8px",
          background: "#FFF4F4", border: "1px solid #D72C0D",
          fontSize: "14px", color: "#D72C0D", lineHeight: "1.6",
        }}>
          <strong>L'application n'a pas pu se charger.</strong>
          <br />
          {message}
          <br /><br />
          <span style={{ fontSize: "12px", color: "#6D7175" }}>
            Rechargez la page. Si le problème persiste, vérifiez les variables
            d'environnement Supabase et relancez <code>shopify app dev</code>.
          </span>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
