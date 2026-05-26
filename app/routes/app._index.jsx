import { useState, useCallback, useEffect, useRef } from "react";
import { useFetcher, useLoaderData, useRouteError, useSubmit, useNavigation } from "react-router";
import { authenticate, PLAN_PRO, PLAN_EXPERT } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { supabase } from "../supabase.server";

// ── Constants ─────────────────────────────────────────────────────────────────

const FREE_LIMIT = 3;
const DEFAULT_ALERT_THRESHOLD = 25;

const CUSTOMS_RATES = {
  Textile: 0.12, Électronique: 0.05, Cosmétique: 0.10,
  Accessoires: 0.07, Sport: 0.05, Alimentation: 0.15,
  Maroquinerie: 0.03, Jouets: 0, Mobilier: 0.027, Autre: 0.03,
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

function validateOptionalAmount(raw, label, errors) {
  const s = normalizeDecimal(raw);
  if (s === "" || s === "0") return 0;
  if (!/^\d+(\.\d*)?$/.test(s)) { errors.push(`${label} : saisissez un montant valide (ex : 1.50).`); return null; }
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) { errors.push(`${label} : valeur invalide.`); return null; }
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

function FieldGroup({ label, tooltip, direction = "right", children }) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>
        {tooltip && (
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setShowTip(v => !v)}
              style={{ width: "16px", height: "16px", borderRadius: "50%", background: showTip ? "#008060" : "#E4E5E7", border: "none", cursor: "pointer", fontSize: "10px", fontWeight: "700", color: showTip ? "#fff" : "#6D7175", fontFamily: "inherit", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >?</button>
            {showTip && (
              <div style={{ position: "absolute", ...(direction === "left" ? { right: "22px" } : { left: "22px" }), top: "-8px", background: "#202223", color: "#fff", borderRadius: "8px", padding: "12px 14px", fontSize: "12px", zIndex: 50, width: "260px", lineHeight: "1.6", boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>
                {tooltip}
              </div>
            )}
          </div>
        )}
      </div>
      {children}
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

// Feature 2: SVG sparkline — enhanced with tooltip for Expert plan
function SparklineChart({ data, isExpert, annotations = [], onAnnotate, alertThreshold = 25 }) {
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);

  if (!data || data.length < 2) return null;
  const W = 600, H = 120, PAD = 12;
  const values = data.map(d => d.net_margin_percent);
  const minY = Math.min(0, ...values) - 3;
  const maxY = Math.max(50, alertThreshold, ...values) + 5;
  const rangeY = maxY - minY || 1;
  const toX = (i) => PAD + (i / (data.length - 1)) * (W - PAD * 2);
  const toY = (v) => PAD + (1 - (v - minY) / rangeY) * (H - PAD * 2);
  const points = values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");

  const handleMouseMove = (e) => {
    if (!isExpert || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < data.length; i++) {
      if (Math.abs(toX(i) - mx) < Math.abs(toX(best) - mx)) best = i;
    }
    const d = data[best];
    setTooltip({ idx: best, date: d.created_at, product: d.product_title, margin: values[best], diff: values[best] - alertThreshold, calcId: d.id });
  };

  return (
    <div style={{ position: "relative" }} onMouseLeave={() => setTooltip(null)}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "120px", display: "block", cursor: isExpert ? "crosshair" : "default" }}
        onMouseMove={handleMouseMove}>
        <line x1={PAD} y1={toY(0).toFixed(1)} x2={W-PAD} y2={toY(0).toFixed(1)} stroke="#E4E5E7" strokeWidth="0.8" strokeDasharray="3,3" />
        <line x1={PAD} y1={toY(alertThreshold).toFixed(1)} x2={W-PAD} y2={toY(alertThreshold).toFixed(1)} stroke="#00806033" strokeWidth="1" strokeDasharray="3,3" />
        <defs>
          <linearGradient id="cg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#008060" stopOpacity="0.12"/>
            <stop offset="100%" stopColor="#008060" stopOpacity="0.01"/>
          </linearGradient>
        </defs>
        <polygon points={`${PAD},${H-PAD} ${points} ${W-PAD},${H-PAD}`} fill="url(#cg)" />
        <polyline points={points} fill="none" stroke="#008060" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {values.map((v, i) => {
          const c = v < 10 ? "#D72C0D" : v < 25 ? "#B98900" : "#008060";
          const hov = tooltip?.idx === i;
          const hasAnnot = annotations.some(a => a.calculation_id === data[i]?.id);
          return (
            <g key={i}>
              <circle cx={toX(i)} cy={toY(v)} r={hov ? 5 : 3} fill={c} stroke="#fff" strokeWidth={hov ? 2 : 1.5} />
              {hasAnnot && <circle cx={toX(i)} cy={toY(v) - 8} r={3} fill="#7C3AED" stroke="#fff" strokeWidth="1" />}
            </g>
          );
        })}
        {tooltip && <line x1={tooltip.idx > 0 ? toX(tooltip.idx) : toX(0)} y1={PAD} x2={tooltip.idx > 0 ? toX(tooltip.idx) : toX(0)} y2={H-PAD} stroke="#20222333" strokeWidth="1" strokeDasharray="2,2" />}
      </svg>
      {tooltip && isExpert && (
        <div style={{ position: "absolute", left: `${Math.min(85, Math.max(10, (toX(tooltip.idx)/W)*100))}%`, top: "4px", transform: "translateX(-50%)", background: "#202223", color: "#fff", borderRadius: "8px", padding: "10px 14px", fontSize: "12px", zIndex: 10, whiteSpace: "nowrap", boxShadow: "0 4px 12px rgba(0,0,0,0.25)", minWidth: "170px" }}>
          <div style={{ fontWeight: "700", marginBottom: "3px", color: tooltip.margin < 10 ? "#FF8A80" : tooltip.margin < 25 ? "#FFD54F" : "#69F0AE" }}>{pct(tooltip.margin)}%</div>
          <div style={{ color: "#aaa", fontSize: "11px", marginBottom: "2px" }}>{formatDate(tooltip.date)}</div>
          {tooltip.product && <div style={{ color: "#ddd", fontSize: "11px", marginBottom: "4px", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis" }}>{tooltip.product}</div>}
          <div style={{ color: tooltip.diff >= 0 ? "#69F0AE" : "#FF8A80", fontSize: "11px" }}>
            {tooltip.diff >= 0 ? "+" : ""}{pct(tooltip.diff)} pts vs seuil
          </div>
          {onAnnotate && (
            <button onClick={() => onAnnotate(tooltip.calcId)} style={{ marginTop: "7px", width: "100%", padding: "4px 0", background: "#7C3AED", color: "#fff", border: "none", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}>
              + Annoter ce point
            </button>
          )}
        </div>
      )}
    </div>
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

// Expert-only gate component
function ExpertGate({ onUpgrade }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 32px", borderRadius: "12px", background: "linear-gradient(135deg, #faf8ff 0%, #f0ecff 100%)", border: "1px solid #7C3AED33" }}>
      <div style={{ fontSize: "32px", marginBottom: "14px" }}>🔒</div>
      <div style={{ fontSize: "17px", fontWeight: "700", color: "#202223", marginBottom: "8px" }}>Fonctionnalité Expert</div>
      <div style={{ fontSize: "14px", color: "#6D7175", marginBottom: "24px", lineHeight: "1.6" }}>
        Réservée au plan <strong>Expert — 29$/mois</strong>.
      </div>
      <button onClick={onUpgrade} style={{ padding: "12px 28px", background: "linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 12px rgba(124,58,237,0.3)" }}>
        Voir le plan Expert →
      </button>
    </div>
  );
}

// Break-Even ROAS (Expert feature)
// Formula: PV / (PV - CoutRendu - FraisShopify - FraisStripe - ProvisionRetours)
// Ads excluded from denominator — we compute available margin BEFORE ad spend
const AD_PLATFORMS = [
  {
    name: "Meta Ads", sub: "Facebook / Instagram", min: 2.5, max: 3.5,
    logoBg: "#1877F2",
    logo: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
        <path d="M17 2h-3a5 5 0 00-5 5v3H6v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/>
      </svg>
    ),
  },
  {
    name: "TikTok Ads", sub: "TikTok For Business", min: 1.8, max: 2.5,
    logoBg: "#010101",
    logo: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V9.07a8.16 8.16 0 004.77 1.52V7.14a4.85 4.85 0 01-1-.45z"/>
      </svg>
    ),
  },
  {
    name: "Google Shopping", sub: "Performance Max", min: 3.0, max: 5.0,
    logoBg: "#fff",
    logo: (
      <svg width="16" height="16" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
    ),
  },
];

function platformStatus(roas, min, max) {
  // roas < min  → platform typically exceeds break-even → viable (green)
  // roas ≤ max  → break-even is within platform range   → limit  (orange)
  // roas > max  → platform typically can't reach BE      → hard   (red)
  if (roas < min) return {
    color: "#008060", bg: "#F1F8F5", border: "#00806033",
    icon: "✓", label: "Viable",
    hint: "Votre seuil est sous le ROAS moyen — cette plateforme peut couvrir vos coûts.",
  };
  if (roas <= max) return {
    color: "#B98900", bg: "#FFF9EC", border: "#B9890033",
    icon: "⚠", label: "Limite",
    hint: "Votre seuil est dans la fourchette — les campagnes devront être bien optimisées.",
  };
  return {
    color: "#D72C0D", bg: "#FFF4F4", border: "#D72C0D33",
    icon: "✗", label: "Difficile",
    hint: "Votre seuil dépasse le ROAS habituel de cette plateforme.",
  };
}

function BreakEvenROAS({ results }) {
  if (!results) return null;
  const { prixVente, coutRendu, shopifyCost, stripeCost, retoursCost } = results;
  const available = prixVente - coutRendu - shopifyCost - stripeCost - retoursCost;

  if (available <= 0) return (
    <div style={{ marginTop: "20px", padding: "14px 18px", borderRadius: "10px", background: "#FFF4F4", border: "1px solid #D72C0D44", display: "flex", gap: "10px", alignItems: "center" }}>
      <span style={{ padding: "2px 8px", borderRadius: "10px", background: "linear-gradient(135deg,#7C3AED,#5B21B6)", color: "#fff", fontSize: "10px", fontWeight: "700" }}>EXPERT</span>
      <span style={{ fontSize: "13px", color: "#D72C0D" }}>Break-Even ROAS incalculable : marge disponible avant pub nulle ou négative.</span>
    </div>
  );

  const roas      = prixVente / available;
  const roasColor = roas < 2 ? "#008060" : roas < 4 ? "#B98900" : "#D72C0D";
  const roasLabel = roas < 2 ? "Facile à atteindre" : roas < 4 ? "Atteignable" : "Difficile";
  const roasPhrase = roas < 2
    ? "Ce seuil est très réaliste — même une campagne basique peut l'atteindre."
    : roas < 4
    ? "Ce seuil est atteignable avec une campagne Meta bien optimisée."
    : "Ce seuil est difficile à maintenir — votre marge publicitaire est très serrée.";

  const cpaColor = available < 5 ? "#D72C0D" : available <= 15 ? "#B98900" : "#008060";
  const cpaAdvice = available < 5
    ? "CPA très serré — privilégiez le contenu organique (UGC, SEO) plutôt que la publicité payante."
    : available <= 15
    ? "CPA correct pour TikTok Ads et Meta avec une créative bien optimisée."
    : "Excellent — vous avez une marge confortable pour scaler vos campagnes Meta et Google.";

  return (
    <div style={{ marginTop: "28px", display: "flex", flexDirection: "column", gap: "12px", animation: "fsu 0.4s ease-out" }}>
      <style>{`@keyframes fsu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* ── Carte principale ROAS ── */}
      <div style={{ padding: "24px 28px", borderRadius: "12px", background: "linear-gradient(135deg,rgba(255,255,255,0.97) 0%,rgba(250,248,255,0.97) 100%)", border: `1px solid ${roasColor}44`, boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px" }}>
          <span style={{ fontSize: "16px" }}>📈</span>
          <span style={{ fontSize: "13px", fontWeight: "700", color: "#202223", textTransform: "uppercase", letterSpacing: "0.6px" }}>Break-Even ROAS</span>
          <span style={{ padding: "2px 8px", borderRadius: "10px", background: "linear-gradient(135deg,#7C3AED,#5B21B6)", color: "#fff", fontSize: "10px", fontWeight: "700" }}>EXPERT</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "16px", marginBottom: "14px" }}>
          <span style={{ fontSize: "56px", fontWeight: "800", color: roasColor, lineHeight: 1, letterSpacing: "-2px" }}>{roas.toFixed(2)}x</span>
          <div>
            <div style={{ fontSize: "15px", fontWeight: "700", color: roasColor }}>{roasLabel}</div>
            <div style={{ fontSize: "12px", color: "#6D7175", marginTop: "2px" }}>ROAS minimum requis</div>
          </div>
        </div>
        <div style={{ fontSize: "13px", color: "#6D7175", lineHeight: "1.6", marginBottom: "14px", fontStyle: "italic" }}>"{roasPhrase}"</div>
        <div style={{ padding: "12px 16px", borderRadius: "8px", background: `${roasColor}0D`, border: `1px solid ${roasColor}22`, fontSize: "13px", color: "#202223", lineHeight: "1.6" }}>
          Vos campagnes doivent générer au minimum <strong style={{ color: roasColor }}>{roas.toFixed(2)}€ de CA</strong> pour chaque euro dépensé en pub afin d'être rentables.
        </div>
      </div>

      {/* ── Viabilité par plateforme ── */}
      <div style={{ padding: "20px 24px", borderRadius: "12px", background: "linear-gradient(135deg,rgba(255,255,255,0.97),rgba(248,250,255,0.97))", border: "1px solid #E4E5E7", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "12px", fontWeight: "700", color: "#202223", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: "3px" }}>Viabilité par plateforme</div>
          <div style={{ fontSize: "11px", color: "#6D7175", fontStyle: "italic" }}>
            Votre ROAS break-even comparé aux performances moyennes du marché.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {AD_PLATFORMS.map(({ name, sub, min, max, logo, logoBg }) => {
            const s = platformStatus(roas, min, max);
            return (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", borderRadius: "10px", background: s.bg, border: `1px solid ${s.border}` }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: logoBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: logoBg === "#fff" ? "1px solid #E4E5E7" : "none" }}>
                  {logo}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#202223", marginBottom: "1px" }}>{name}</div>
                  <div style={{ fontSize: "11px", color: "#6D7175" }}>{sub} · ROAS moyen marché : <strong>{min}x – {max}x</strong></div>
                </div>
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", borderRadius: "20px", background: s.color + "18", border: `1px solid ${s.color}33`, marginBottom: "3px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "700" }}>{s.icon}</span>
                    <span style={{ fontSize: "12px", fontWeight: "700", color: s.color }}>{s.label}</span>
                  </div>
                  <div style={{ fontSize: "10px", color: "#6D7175", maxWidth: "150px", lineHeight: "1.4", fontStyle: "italic" }}>{s.hint}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CPA Maximum ── */}
      <div style={{ padding: "20px 24px", borderRadius: "12px", background: `linear-gradient(135deg,${cpaColor}08 0%,${cpaColor}04 100%)`, border: `1px solid ${cpaColor}33`, boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "20px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "15px" }}>🎯</span>
              <span style={{ fontSize: "12px", fontWeight: "700", color: "#202223", textTransform: "uppercase", letterSpacing: "0.7px" }}>CPA Maximum</span>
            </div>
            <div style={{ fontSize: "11px", color: "#6D7175", marginBottom: "12px", fontStyle: "italic", lineHeight: "1.5" }}>
              Budget acquisition maximum par client avant de perdre de l'argent.
            </div>
            <div style={{ padding: "10px 14px", borderRadius: "8px", background: cpaColor + "10", border: `1px solid ${cpaColor}22`, fontSize: "12px", color: "#202223", lineHeight: "1.6" }}>
              <strong style={{ color: cpaColor }}>Conseil :</strong> {cpaAdvice}
            </div>
            <div style={{ marginTop: "8px", fontSize: "11px", color: "#6D7175", fontStyle: "italic" }}>
              Ne dépassez jamais ce seuil dans votre Business Manager.
            </div>
          </div>
          <div style={{ textAlign: "center", flexShrink: 0, paddingTop: "4px" }}>
            <div style={{ fontSize: "46px", fontWeight: "800", color: cpaColor, lineHeight: 1, letterSpacing: "-1.5px" }}>{fmt(available)}€</div>
            <div style={{ fontSize: "11px", color: "#6D7175", marginTop: "5px", fontWeight: "500" }}>par acquisition</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Server exports ────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session, billing, admin } = await authenticate.admin(request);

  // Run billing check and product fetch concurrently
  const [billingResult, productsResult] = await Promise.allSettled([
    billing.check({ plans: [PLAN_PRO, PLAN_EXPERT], isTest: true }),
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

  let isPro = false, isExpert = false;
  if (billingResult.status === "fulfilled" && billingResult.value.hasActivePayment) {
    const subs = billingResult.value.appSubscriptions ?? [];
    isExpert = subs.some(s => s.name === PLAN_EXPERT);
    isPro = isExpert || subs.some(s => s.name === PLAN_PRO);
  }

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
  const [countResult, historyResult, alertResult, annotationsResult] = await Promise.allSettled([
    !isPro
      ? supabase.from("usage").select("calculation_count").eq("shop_domain", session.shop).eq("month", currentMonth).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("calculations")
      .select("id, product_id, product_title, category, country, purchase_price, selling_price, net_margin_percent, net_margin_euros, created_at")
      .eq("shop_domain", session.shop)
      .order("created_at", { ascending: false })
      .limit(isExpert ? 200 : isPro ? 50 : 0),
    supabase.from("margin_alerts").select("threshold").eq("shop_domain", session.shop).maybeSingle(),
    isExpert
      ? supabase.from("calculation_annotations").select("*").eq("shop_domain", session.shop)
      : Promise.resolve({ data: [], error: null }),
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

  const annotations = annotationsResult.status === "fulfilled"
    ? (annotationsResult.value.data ?? []) : [];

  const showWelcome = new URL(request.url).searchParams.get("subscribed") === "true";

  return { isPro, isExpert, monthlyCount, history, products, alertThreshold, violations, showWelcome, annotations };
};

export const action = async ({ request }) => {
  const { session, billing, admin } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return { success: false, error: "Corps de requête invalide." };
  }

  // ── Subscribe Pro ─────────────────────────────────────────────────────────
  if (body._action === "subscribe") {
    await billing.request({
      plan: PLAN_PRO,
      isTest: true,
      returnUrl: `${process.env.SHOPIFY_APP_URL}/app?subscribed=true`,
    });
    return null;
  }

  // ── Subscribe Expert ──────────────────────────────────────────────────────
  if (body._action === "subscribe_expert") {
    await billing.request({
      plan: PLAN_EXPERT,
      isTest: true,
      returnUrl: `${process.env.SHOPIFY_APP_URL}/app?subscribed=true`,
    });
    return null;
  }

  // ── Save annotation ────────────────────────────────────────────────────────
  if (body._action === "save_annotation") {
    const { calculation_id, note } = body;
    if (!calculation_id || !note?.trim()) return { success: false, error: "Données invalides." };
    await supabase.from("calculation_annotations").upsert(
      { shop_domain: session.shop, calculation_id, note: note.trim() },
      { onConflict: "shop_domain,calculation_id" }
    );
    return { success: true };
  }

  // ── Run catalog audit ─────────────────────────────────────────────────────
  if (body._action === "run_audit") {
    const customsRate  = parseFloat(body.customs_rate  ?? "0.12");
    const shopifyFee   = parseFloat(body.shopify_fee   ?? "0.02");
    const stripeFee    = parseFloat(body.stripe_fee    ?? "0.025");
    const returnsRate  = parseFloat(body.returns_rate  ?? "0.05");
    const shippingCost = parseFloat(body.shipping_cost ?? "8");

    let allProducts = [], cursor = null, hasNextPage = true, pages = 0;
    while (hasNextPage && pages < 10) {
      pages++;
      try {
        const resp = await admin.graphql(
          `query AuditProducts($cursor: String) {
            products(first: 50, after: $cursor, query: "status:active") {
              edges {
                node {
                  id title
                  variants(first: 1) {
                    edges { node { price inventoryItem { unitCost { amount } } } }
                  }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }`,
          { variables: { cursor } }
        );
        const json = await resp.json();
        const page = json.data?.products;
        if (!page) break;
        allProducts = [...allProducts, ...page.edges.map(e => e.node)];
        hasNextPage = page.pageInfo.hasNextPage;
        cursor = page.pageInfo.endCursor;
      } catch (e) {
        console.error("[Audit] GraphQL error:", e?.message);
        break;
      }
    }

    const products = allProducts
      .map(node => {
        const variant = node.variants.edges[0]?.node;
        const price = parseFloat(variant?.price ?? "0");
        const cost = parseFloat(variant?.inventoryItem?.unitCost?.amount ?? "0");
        if (!cost || !price) return null;
        const douane   = cost * customsRate;
        const tva      = (cost + douane) * 0.20;
        const coutRendu = cost + douane + tva + shippingCost;
        const shopify  = price * shopifyFee;
        const stripe   = price * stripeFee;
        const returns  = price * returnsRate;
        const netMargin = price - coutRendu - shopify - stripe - returns;
        const netPct    = (netMargin / price) * 100;
        return { id: node.id, title: node.title, price, cost, coutRendu, netMargin, netPct };
      })
      .filter(Boolean)
      .sort((a, b) => b.netPct - a.netPct);

    const losers  = products.filter(p => p.netPct < 0);
    const risky   = products.filter(p => p.netPct >= 0 && p.netPct < 15);
    const winners = products.filter(p => p.netPct >= 15);

    return { auditProducts: products, losers: losers.length, risky: risky.length, winners: winners.length, totalScanned: allProducts.length };
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
    const result = await billing.check({ plans: [PLAN_PRO, PLAN_EXPERT], isTest: true });
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
  const { isPro, isExpert, monthlyCount: initialCount, history, products, alertThreshold: initialThreshold, violations, showWelcome, annotations: initialAnnotations } = useLoaderData();

  const saveFetcher  = useFetcher();
  const aiFetcher    = useFetcher();
  const alertFetcher = useFetcher();
  const auditFetcher = useFetcher();
  const annotFetcher = useFetcher();

  // Billing uses useSubmit (full-page navigation) so App Bridge can intercept
  // the redirect thrown by billing.request() and open Shopify billing in the
  // parent frame — useFetcher would follow the redirect inside the iframe.
  const billingSubmit = useSubmit();
  const navigation    = useNavigation();

  // ── Form state ─────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    selectedProductId: "", selectedProductTitle: "",
    prixAchat: "20", prixVente: "49.99",
    categorie: "Textile", paysImport: "Chine",
    shopifyFee: "2", stripeFee: "2.5", retours: "5", ads: "15",
    fraisRetour: "0", coutEmballage: "0",
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

  // History filters (Expert)
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historyCategory, setHistoryCategory] = useState("all");

  // Annotations (Expert)
  const [annotations, setAnnotations] = useState(initialAnnotations ?? []);
  const [annotModal, setAnnotModal]   = useState(null); // calcId being annotated
  const [annotText, setAnnotText]     = useState("");

  // Catalog audit (Expert)
  const [auditParams, setAuditParams] = useState({ customs_rate: "0.12", shopify_fee: "0.02", stripe_fee: "0.025", returns_rate: "0.05", shipping_cost: "8" });

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

  // Sync annotations after save
  useEffect(() => {
    if (annotFetcher.data?.success && annotModal) {
      setAnnotations(prev => {
        const filtered = prev.filter(a => a.calculation_id !== annotModal);
        return [...filtered, { calculation_id: annotModal, note: annotText }];
      });
      setAnnotModal(null);
      setAnnotText("");
    }
  }, [annotFetcher.data]);

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
    const fraisRetourVal   = validateOptionalAmount(form.fraisRetour,   "Frais de retour",  errs);
    const coutEmballageVal = validateOptionalAmount(form.coutEmballage, "Coût d'emballage", errs);

    if (errs.length > 0) { setErrors(errs); setWarnings([]); setResults(null); return null; }

    if (prixAchat > prixVente) warns.push("Attention : vous vendez moins cher que vous achetez.");
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
    const fraisFixes         = fraisRetourVal + coutEmballageVal;
    const margeBrute         = prixVente - coutRendu;
    const margeBrutePercent  = (margeBrute / prixVente) * 100;
    const margeNette         = margeBrute - totalFraisVente - fraisFixes;
    const margeNettePercent  = (margeNette / prixVente) * 100;
    const margeApparente     = ((prixVente - prixAchat) / prixVente) * 100;

    const computed = { margeBrutePercent, margeNettePercent, margeApparente, coutRendu, margeNette };
    const bad = Object.entries(computed).find(([, v]) => !Number.isFinite(v));
    if (bad) { setErrors([`Erreur de calcul (${bad[0]}).`]); setResults(null); return null; }

    const r = {
      prixAchat, prixVente, douane, tvaImport, shipping, coutRendu,
      shopifyCost, stripeCost, retoursCost, adsCost, totalFraisVente,
      fraisRetour: fraisRetourVal, coutEmballage: coutEmballageVal, fraisFixes,
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
    billingSubmit({ _action: "subscribe" }, { method: "POST", encType: "application/json" });
  };
  const handleSubscribeExpert = () => {
    billingSubmit({ _action: "subscribe_expert" }, { method: "POST", encType: "application/json" });
  };
  const handleAnnotate = (calcId) => { setAnnotModal(calcId); setAnnotText(annotations.find(a => a.calculation_id === calcId)?.note ?? ""); };
  const handleSaveAnnotation = () => {
    annotFetcher.submit({ _action: "save_annotation", calculation_id: annotModal, note: annotText }, { method: "POST", encType: "application/json" });
  };
  const handleRunAudit = () => {
    auditFetcher.submit({ _action: "run_audit", ...auditParams }, { method: "POST", encType: "application/json" });
  };

  // ── Derived display ────────────────────────────────────────────────────────
  const marginColor = results
    ? results.margeNettePercent < 10 ? "#D72C0D" : results.margeNettePercent < 25 ? "#B98900" : "#008060"
    : "#008060";
  const marginBg = results
    ? results.margeNettePercent < 10 ? "#FFF4F4" : results.margeNettePercent < 25 ? "#FFF9EC" : "#F1F8F5"
    : "#F1F8F5";
  const marginLabel = results
    ? results.margeNettePercent < 0 ? "Perte nette" : results.margeNettePercent < 10 ? "Rentabilité insuffisante" : results.margeNettePercent < 25 ? "Marge à surveiller" : "Marge saine"
    : "";
  const gaugeWidth = results ? `${Math.max(0, Math.min(100, safeNum(results.margeNettePercent)))}%` : "0%";
  const customsRateDisplay = ((CUSTOMS_RATES[form.categorie] ?? 0.03) * 100).toFixed(0);
  const shippingDisplay    = SHIPPING_ESTIMATES[form.paysImport] ?? 5;
  const isSaving    = saveFetcher.state !== "idle";
  const saveStatus  = saveFetcher.data;
  // Show loading when a billing navigation is in progress
  const isSubscribing = navigation.state !== "idle" &&
    ["subscribe", "subscribe_expert"].includes(navigation.json?._action);
  const isSavingAlert = alertFetcher.state !== "idle";

  const subscribeBtn = (label = "Passer au Pro — 9$/mois") => (
    <button onClick={handleSubscribe} disabled={isSubscribing}
      style={{ padding: "10px 24px", background: "#008060", color: "#fff", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: "600", cursor: isSubscribing ? "default" : "pointer", fontFamily: "inherit", opacity: isSubscribing ? 0.7 : 1 }}>
      {isSubscribing ? "Redirection…" : label}
    </button>
  );
  const subscribeExpertBtn = (label = "Passer au Expert — 29$/mois") => (
    <button onClick={handleSubscribeExpert} disabled={isSubscribing}
      style={{ padding: "10px 24px", background: "linear-gradient(135deg,#7C3AED 0%,#5B21B6 100%)", color: "#fff", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: "600", cursor: isSubscribing ? "default" : "pointer", fontFamily: "inherit", opacity: isSubscribing ? 0.7 : 1, boxShadow: "0 4px 12px rgba(124,58,237,0.3)" }}>
      {isSubscribing ? "Redirection…" : label}
    </button>
  );

  return (
    <s-page heading="Calculateur de Vraie Marge">
      <style>{`
        @media (max-width: 768px) {
          .tcc-form-grid    { grid-template-columns: 1fr !important; }
          .tcc-cost-grid    { grid-template-columns: 1fr !important; }
          .tcc-margin-cards { grid-template-columns: 1fr !important; }
          .tcc-upgrade-plans{ grid-template-columns: 1fr !important; max-width: 360px !important; }
          .tcc-history-container { overflow-x: hidden; width: 100%; }
          .tcc-hist-row     { grid-template-columns: 1.6fr 1.8fr 1fr 1.2fr !important; }
          .tcc-hist-col-cat, .tcc-hist-col-pays { display: none !important; }
          .tcc-audit-kpi    { grid-template-columns: 1fr 1fr !important; }
          .tcc-audit-row    { grid-template-columns: 2.5fr 1fr 1.2fr 1fr !important; }
          .tcc-audit-col-cost { display: none !important; }
        }
      `}</style>

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
        <div style={{ display: "flex", gap: "0", marginBottom: "24px", borderBottom: "2px solid #E4E5E7", flexWrap: "wrap" }}>
          {[
            { id: "calculator", label: "Calculateur", badge: null },
            { id: "simulate",   label: "Simulation",  badge: null },
            { id: "history",    label: isPro ? "Historique" : "Historique 🔒", badge: null },
            { id: "alerts",     label: "Alertes",     badge: null },
            { id: "audit",      label: "Audit Catalogue", badge: "EXPERT" },
          ].map(({ id, label, badge }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              style={{ padding: "10px 16px", background: "none", border: "none", borderBottom: activeTab === id ? `2px solid ${id === "audit" ? "#7C3AED" : "#008060"}` : "2px solid transparent", marginBottom: "-2px", cursor: "pointer", fontSize: "13px", fontWeight: activeTab === id ? "600" : "400", color: activeTab === id ? (id === "audit" ? "#7C3AED" : "#008060") : "#6D7175", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px" }}>
              {label}
              {badge && <span style={{ padding: "1px 6px", borderRadius: "8px", background: "#7C3AED", color: "#fff", fontSize: "9px", fontWeight: "700" }}>{badge}</span>}
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
            {isExpert && <span style={{ padding: "3px 10px", borderRadius: "12px", background: "linear-gradient(135deg,#7C3AED,#5B21B6)", color: "#fff", fontSize: "11px", fontWeight: "700" }}>EXPERT</span>}
            {!isExpert && isPro && <span style={{ padding: "3px 10px", borderRadius: "12px", background: "#008060", color: "#fff", fontSize: "11px", fontWeight: "700" }}>PRO</span>}
          </div>
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

            {showUpgrade && !isPro ? (
              <div style={{ padding: "24px 0" }}>
                <div style={{ textAlign: "center", marginBottom: "24px" }}>
                  <div style={{ fontSize: "36px", marginBottom: "12px" }}>🔒</div>
                  <div style={{ fontSize: "20px", fontWeight: "700", color: "#202223", marginBottom: "6px" }}>Passez au niveau supérieur</div>
                  <div style={{ fontSize: "14px", color: "#6D7175" }}>Calculs illimités, historique avancé, audit catalogue et ROAS.</div>
                </div>
                <div className="tcc-upgrade-plans" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px", maxWidth: "780px", margin: "0 auto 28px" }}>
                  {/* Free */}
                  <div style={{ padding: "20px", borderRadius: "10px", background: "#F9FAFB", border: "2px solid #E4E5E7", textAlign: "left" }}>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>Gratuit</div>
                    <div style={{ fontSize: "24px", fontWeight: "700", color: "#202223", marginBottom: "14px" }}>0€/mois</div>
                    {[`${FREE_LIMIT} calculs/mois`, "Sans historique", "Support standard"].map(f => (
                      <div key={f} style={{ fontSize: "12px", color: "#6D7175", marginBottom: "5px" }}>✓ {f}</div>
                    ))}
                  </div>
                  {/* Pro */}
                  <div style={{ padding: "20px", borderRadius: "10px", background: "#F1F8F5", border: "2px solid #008060", textAlign: "left", position: "relative" }}>
                    <div style={{ position: "absolute", top: "-1px", right: "12px", background: "#008060", color: "#fff", fontSize: "10px", fontWeight: "700", padding: "3px 8px", borderRadius: "0 0 6px 6px" }}>POPULAIRE</div>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#008060", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>Pro</div>
                    <div style={{ fontSize: "24px", fontWeight: "700", color: "#202223", marginBottom: "14px" }}>9$/mois</div>
                    {["Calculs illimités", "Historique + graphe", "Alertes de marge", "Recommandations IA", "Support prioritaire"].map(f => (
                      <div key={f} style={{ fontSize: "12px", color: "#008060", marginBottom: "5px" }}>✓ {f}</div>
                    ))}
                    <div style={{ marginTop: "16px" }}>{subscribeBtn("Choisir Pro")}</div>
                  </div>
                  {/* Expert */}
                  <div style={{ padding: "20px", borderRadius: "10px", background: "linear-gradient(135deg,#faf8ff 0%,#f0ecff 100%)", border: "2px solid #7C3AED", textAlign: "left", position: "relative", boxShadow: "0 0 0 1px #7C3AED22, 0 8px 24px rgba(124,58,237,0.15)" }}>
                    <div style={{ position: "absolute", top: "-1px", right: "12px", background: "linear-gradient(135deg,#7C3AED,#5B21B6)", color: "#fff", fontSize: "10px", fontWeight: "700", padding: "3px 8px", borderRadius: "0 0 6px 6px" }}>RECOMMANDÉ</div>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#7C3AED", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>Expert</div>
                    <div style={{ fontSize: "24px", fontWeight: "700", color: "#202223", marginBottom: "14px" }}>29$/mois</div>
                    {["Tout le plan Pro", "Break-Even ROAS", "Audit Catalogue complet", "Graphe avancé + tooltips", "Annotations historique", "Support dédié"].map(f => (
                      <div key={f} style={{ fontSize: "12px", color: "#7C3AED", marginBottom: "5px" }}>✓ {f}</div>
                    ))}
                    <div style={{ marginTop: "16px" }}>{subscribeExpertBtn("Choisir Expert")}</div>
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
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

                <div className="tcc-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "14px" }}>Données produit</div>
                    <FieldGroup label="Prix d'achat fournisseur (€)" tooltip="Prix hors taxes payé au fournisseur, livraison fournisseur non incluse. À retrouver sur votre facture pro-forma ou votre commande AliExpress / Alibaba.">
                      <input type="text" inputMode="decimal" value={form.prixAchat} onChange={update("prixAchat")} style={inputStyle} placeholder="ex : 20.00" />
                    </FieldGroup>
                    <FieldGroup label="Prix de vente (€)" tooltip="Prix public de vente sur votre boutique, frais de livraison client exclus. C'est le montant que vous encaissez.">
                      <input type="text" inputMode="decimal" value={form.prixVente} onChange={update("prixVente")} style={inputStyle} placeholder="ex : 49.99" />
                    </FieldGroup>
                    <FieldGroup label="Catégorie produit" tooltip="Utilisée pour estimer vos droits de douane selon la nomenclature TARIC (tarif douanier intégré de l'UE). Choisissez la catégorie la plus proche de votre produit.">
                      <select value={form.categorie} onChange={update("categorie")} style={inputStyle}>
                        {Object.entries(CUSTOMS_RATES).map(([cat, rate]) => (
                          <option key={cat} value={cat}>{cat} — douane {parseFloat((rate * 100).toFixed(1))}%</option>
                        ))}
                      </select>
                      <div style={hintStyle}>Taux appliqué : {customsRateDisplay}%</div>
                    </FieldGroup>
                    <FieldGroup label="Pays d'import" tooltip="Pays d'expédition du fournisseur. Détermine les frais de port estimés. Ces estimations sont des moyennes marché — renseignez votre coût réel si vous le connaissez.">
                      <select value={form.paysImport} onChange={update("paysImport")} style={inputStyle}>
                        {Object.entries(SHIPPING_ESTIMATES).map(([pays, cost]) => (
                          <option key={pays} value={pays}>{pays} — shipping ~{cost}€</option>
                        ))}
                      </select>
                      <div style={hintStyle}>Frais de port estimés : ~{shippingDisplay}€</div>
                    </FieldGroup>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "14px" }}>Frais & déductions</div>
                    <FieldGroup label="Frais Shopify (% du CA)" direction="left" tooltip="Commission prélevée par Shopify sur chaque transaction. Basic 2% · Shopify 1% · Advanced 0,5%. Modifiez ce champ si vous avez négocié un taux différent. Source : shopify.com/fr/pricing">
                      <input type="text" inputMode="decimal" value={form.shopifyFee} onChange={update("shopifyFee")} style={inputStyle} placeholder="ex : 2" />
                    </FieldGroup>
                    <FieldGroup label="Frais Stripe (% du CA)" direction="left" tooltip="Frais de traitement de paiement prélevés par Stripe. En France : 1,5% + 0,25€ par transaction (≈ 2% sur une commande de 50€). Source : stripe.com/fr/pricing">
                      <input type="text" inputMode="decimal" value={form.stripeFee} onChange={update("stripeFee")} style={inputStyle} placeholder="ex : 2.5" />
                    </FieldGroup>
                    <FieldGroup label="Taux de retours (%)" direction="left" tooltip="Pourcentage du CA provisionné pour couvrir les retours et remboursements. E-commerce mode : 15–30%. Électronique : 5–15%. Autres : 5–10%. Source : estimations sectorielles Fevad.">
                      <input type="text" inputMode="decimal" value={form.retours} onChange={update("retours")} style={inputStyle} placeholder="ex : 5" />
                    </FieldGroup>
                    <FieldGroup label="Budget ads (% du CA)" direction="left" tooltip="Pourcentage du CA réinvesti en publicité payante. Une campagne Meta rentable nécessite généralement 15–25% pour un ROAS 4–6. Google Shopping : 10–20% pour un ROAS 5–8.">
                      <input type="text" inputMode="decimal" value={form.ads} onChange={update("ads")} style={inputStyle} placeholder="ex : 15" />
                    </FieldGroup>
                    <FieldGroup label="Frais de retour (€)" direction="left" tooltip="Coût logistique d'un retour (colissimo retour, réemballage, etc.). Laissez à 0 si vous ne traitez pas les retours ou s'ils sont à la charge du client.">
                      <input type="text" inputMode="decimal" value={form.fraisRetour} onChange={update("fraisRetour")} style={inputStyle} placeholder="0" />
                    </FieldGroup>
                    <FieldGroup label="Coût d'emballage (€)" direction="left" tooltip="Coût de l'emballage par commande (boîte, papier de soie, sticker, etc.). Typiquement 0,50€–2€ selon le niveau de marque.">
                      <input type="text" inputMode="decimal" value={form.coutEmballage} onChange={update("coutEmballage")} style={inputStyle} placeholder="0" />
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

            <div className="tcc-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
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
                <FieldGroup label="Marge nette cible (%)" tooltip="La marge nette que vous souhaitez atteindre après tous les frais (Shopify, Stripe, retours, ads inclus).">
                  <input type="text" inputMode="decimal" value={simForm.targetMargin} onChange={updateSim("targetMargin")} style={{ ...inputStyle, borderColor: "#008060", fontWeight: "600" }} placeholder="ex : 35" />
                </FieldGroup>
              </div>
              <div>
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "14px" }}>Frais à déduire</div>
                <FieldGroup label="Frais Shopify (%)" direction="left" tooltip="Basic 2% · Shopify 1% · Advanced 0,5%. Source : shopify.com/fr/pricing">
                  <input type="text" inputMode="decimal" value={simForm.shopifyFee} onChange={updateSim("shopifyFee")} style={inputStyle} placeholder="2" />
                </FieldGroup>
                <FieldGroup label="Frais Stripe (%)" direction="left" tooltip="Frais de traitement Stripe. En France : 1,5% + 0,25€ par transaction. Source : stripe.com/fr/pricing">
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

        {/* ════════ HISTORY TAB ════════════════════════════════════════════ */}
        {activeTab === "history" && (
          !isPro ? (
            <div style={{ textAlign: "center", padding: "48px 24px" }}>
              <div style={{ fontSize: "36px", marginBottom: "16px" }}>🔒</div>
              <div style={{ fontSize: "16px", fontWeight: "600", color: "#202223", marginBottom: "8px" }}>Fonctionnalité Pro</div>
              <div style={{ fontSize: "14px", color: "#6D7175", marginBottom: "24px" }}>L'historique et les graphes sont disponibles avec le plan Pro à 9$/mois.</div>
              {subscribeBtn()}
            </div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 24px", color: "#6D7175" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>📊</div>
              <div style={{ fontSize: "15px", fontWeight: "500" }}>Aucun calcul sauvegardé pour l'instant.</div>
            </div>
          ) : (() => {
            // Filter history client-side
            const now = Date.now();
            const days = historyFilter === "7d" ? 7 : historyFilter === "30d" ? 30 : historyFilter === "90d" ? 90 : 0;
            let filtered = days > 0
              ? history.filter(c => (now - new Date(c.created_at).getTime()) < days * 86400000)
              : history;
            if (historyCategory !== "all") filtered = filtered.filter(c => c.category === historyCategory);
            const chartData = [...filtered].reverse();
            const categories = [...new Set(history.map(c => c.category))];
            return (
              <div className="tcc-history-container">
                {/* Expert filters */}
                {isExpert ? (
                  <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: "4px" }}>
                      {["7d","30d","90d","all"].map(f => (
                        <button key={f} onClick={() => setHistoryFilter(f)}
                          style={{ padding: "5px 12px", borderRadius: "20px", border: "1px solid", borderColor: historyFilter === f ? "#7C3AED" : "#E4E5E7", background: historyFilter === f ? "#7C3AED" : "#fff", color: historyFilter === f ? "#fff" : "#6D7175", fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
                          {f === "all" ? "Tout" : f === "7d" ? "7 jours" : f === "30d" ? "30 jours" : "90 jours"}
                        </button>
                      ))}
                    </div>
                    <select value={historyCategory} onChange={e => setHistoryCategory(e.target.value)}
                      style={{ padding: "5px 10px", borderRadius: "6px", border: "1px solid #E4E5E7", fontSize: "12px", color: "#202223", fontFamily: "inherit", cursor: "pointer" }}>
                      <option value="all">Toutes catégories</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ) : (
                  <div style={{ marginBottom: "14px", padding: "8px 14px", borderRadius: "8px", background: "linear-gradient(135deg,#faf8ff,#f0ecff)", border: "1px solid #7C3AED22", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "12px", color: "#6D7175" }}>Débloquez les filtres temporels, tooltips et annotations avec Expert.</span>
                    <button onClick={() => setShowUpgrade(true)} style={{ padding: "4px 12px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: "4px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>Expert</button>
                  </div>
                )}

                {/* Chart */}
                <div style={{ marginBottom: "24px" }}>
                  <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>
                    Évolution de la marge nette {filtered.length !== history.length ? `(${filtered.length} calculs filtrés)` : ""}
                  </div>
                  <div style={{ border: "1px solid #E4E5E7", borderRadius: "8px", padding: "12px 16px", background: "#FAFBFB" }}>
                    {chartData.length >= 2 ? (
                      <>
                        <SparklineChart data={chartData} isExpert={isExpert} annotations={annotations} onAnnotate={isExpert ? handleAnnotate : null} alertThreshold={parseFloat(alertThreshold) || 25} />
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                          <span style={{ fontSize: "10px", color: "#6D7175" }}>{formatDate(chartData[0]?.created_at)}</span>
                          <span style={{ fontSize: "10px", color: "#6D7175" }}>{formatDate(chartData[chartData.length - 1]?.created_at)}</span>
                        </div>
                      </>
                    ) : <div style={{ textAlign: "center", padding: "20px", color: "#6D7175", fontSize: "13px" }}>Pas assez de données pour le graphe avec ce filtre.</div>}
                  </div>
                  {isExpert && annotations.length > 0 && (
                    <div style={{ marginTop: "8px", fontSize: "11px", color: "#7C3AED" }}>
                      ● Les points violets indiquent des annotations sauvegardées.
                    </div>
                  )}
                </div>

                {/* Table */}
                <div style={{ fontSize: "13px", color: "#6D7175", marginBottom: "12px" }}>
                  {filtered.length} calcul{filtered.length > 1 ? "s" : ""}
                </div>
                <div style={{ border: "1px solid #E4E5E7", borderRadius: "8px", overflow: "hidden" }}>
                  <div className="tcc-hist-row" style={{ display: "grid", gridTemplateColumns: "1.6fr 1.8fr 1fr 1fr 1fr 1.2fr", background: "#F9FAFB", borderBottom: "1px solid #E4E5E7" }}>
                    {["Date", "Produit", "Catégorie", "Pays", "Prix vente", "Marge nette"].map((h, idx) => (
                      <div key={h} className={idx === 2 ? "tcc-hist-col-cat" : idx === 3 ? "tcc-hist-col-pays" : ""} style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px" }}>{h}</div>
                    ))}
                  </div>
                  {filtered.map((calc, i) => {
                    const mc = calc.net_margin_percent < 10 ? "#D72C0D" : calc.net_margin_percent < 25 ? "#B98900" : "#008060";
                    const annot = annotations.find(a => a.calculation_id === calc.id);
                    return (
                      <div key={calc.id} className="tcc-hist-row" style={{ display: "grid", gridTemplateColumns: "1.6fr 1.8fr 1fr 1fr 1fr 1.2fr", background: i % 2 === 0 ? "#fff" : "#FAFBFB", borderBottom: i < filtered.length - 1 ? "1px solid #F1F2F3" : "none" }}>
                        <div style={{ padding: "11px 12px", fontSize: "11px", color: "#6D7175" }}>{formatDate(calc.created_at)}</div>
                        <div style={{ padding: "11px 12px", fontSize: "13px", color: "#202223", fontWeight: "500" }}>
                          {calc.product_title ?? "—"}
                          {annot && <div style={{ fontSize: "10px", color: "#7C3AED", marginTop: "2px" }}>● {annot.note}</div>}
                        </div>
                        <div className="tcc-hist-col-cat" style={{ padding: "11px 12px", fontSize: "12px", color: "#202223" }}>{calc.category}</div>
                        <div className="tcc-hist-col-pays" style={{ padding: "11px 12px", fontSize: "12px", color: "#202223" }}>{calc.country}</div>
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
            );
          })()
        )}

        {/* ════════ ALERTS TAB (Feature 4) ════════════════════════════════ */}
        {activeTab === "alerts" && (
          <div>
            {/* Encadré explicatif */}
            <div style={{ padding: "14px 18px", borderRadius: "8px", background: "#F9FAFB", border: "1px solid #E4E5E7", marginBottom: "16px", fontSize: "13px", color: "#202223", lineHeight: "1.6" }}>
              Les alertes de marge vous notifient automatiquement quand un produit calculé tombe en dessous de votre seuil de rentabilité cible. Le seuil par défaut est 25% — c'est le minimum recommandé en e-commerce selon le Fevad pour maintenir une activité saine après charges fixes.
            </div>

            <div style={{ fontSize: "13px", color: "#6D7175", marginBottom: "20px", lineHeight: "1.6" }}>
              L'alerte apparaît en rouge en haut de l'app à chaque connexion, sur les 20 derniers calculs.
            </div>

            <div style={{ maxWidth: "420px", marginBottom: "28px" }}>
              <FieldGroup label="Seuil de rentabilité cible (%)">
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
              <div style={{ fontSize: "11px", color: "#6D7175", marginTop: "6px", lineHeight: "1.6" }}>
                Références marché : E-commerce généraliste 20–25% · Mode 15–20% · Électronique 8–12% · Cosmétique 30–40%
              </div>
              {alertFetcher.data?.success && (
                <div style={{ fontSize: "13px", color: "#008060", marginTop: "8px" }}>✓ Seuil mis à jour</div>
              )}
              {alertFetcher.data?.error && (
                <div style={{ fontSize: "13px", color: "#D72C0D", marginTop: "8px" }}>{alertFetcher.data.error}</div>
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

        {/* ════════ AUDIT CATALOGUE TAB (Expert) ══════════════════════════ */}
        {activeTab === "audit" && (
          !isExpert ? <ExpertGate onUpgrade={() => setShowUpgrade(true)} /> : (() => {
            const auditData = auditFetcher.data;
            const isAuditing = auditFetcher.state !== "idle";
            const products = auditData?.auditProducts ?? [];
            const losers  = products.filter(p => p.netPct < 0);
            const risky   = products.filter(p => p.netPct >= 0 && p.netPct < 15);
            const winners = products.filter(p => p.netPct >= 15);
            return (
              <div>
                {/* Guide: how to set unit cost in Shopify */}
                <div style={{ padding: "16px 20px", borderRadius: "10px", background: "linear-gradient(135deg,#f8f6ff,#f0ecff)", border: "1px solid #7C3AED33", marginBottom: "20px" }}>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: "#7C3AED", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "12px" }}>Avant de lancer l'audit : renseigner le coût par article dans Shopify</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                    {[
                      "Ouvrez votre admin Shopify et cliquez sur Produits dans le menu latéral.",
                      "Sélectionnez le produit à mettre à jour.",
                      "Faites défiler jusqu'à la section Variantes.",
                      "Cliquez sur la variante (ou sur Modifier si vous avez plusieurs variantes).",
                      "Dans la section Expédition, remplissez le champ Coût par article (votre prix fournisseur HT).",
                      "Cliquez sur Enregistrer. Répétez pour chaque produit.",
                    ].map((step, i) => (
                      <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                        <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "#7C3AED", color: "#fff", fontSize: "11px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
                        <div style={{ fontSize: "13px", color: "#202223", lineHeight: "1.5", paddingTop: "2px" }}>{step}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: "12px", color: "#7C3AED", fontStyle: "italic" }}>
                    Seuls les produits avec un coût renseigné apparaîtront dans les résultats de l'audit.
                  </div>
                </div>

                {/* Params */}
                <div style={{ padding: "16px 20px", borderRadius: "10px", background: "#F9FAFB", border: "1px solid #E4E5E7", marginBottom: "20px" }}>
                  <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "14px" }}>Paramètres de l'audit</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px", marginBottom: "16px" }}>
                    {[
                      { key: "customs_rate", label: "Douane (taux)", placeholder: "0.12" },
                      { key: "shopify_fee",  label: "Frais Shopify", placeholder: "0.02" },
                      { key: "stripe_fee",   label: "Frais Stripe",  placeholder: "0.025" },
                      { key: "returns_rate", label: "Retours",        placeholder: "0.05" },
                      { key: "shipping_cost",label: "Port (€)",       placeholder: "8" },
                    ].map(({ key, label, placeholder }) => (
                      <div key={key}>
                        <div style={{ fontSize: "11px", color: "#6D7175", marginBottom: "4px" }}>{label}</div>
                        <input type="text" value={auditParams[key]} onChange={e => setAuditParams(p => ({ ...p, [key]: e.target.value }))}
                          style={{ ...inputStyle, fontSize: "13px" }} placeholder={placeholder} />
                      </div>
                    ))}
                  </div>
                  <button onClick={handleRunAudit} disabled={isAuditing}
                    style={{ padding: "10px 24px", background: "linear-gradient(135deg,#7C3AED,#5B21B6)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: "600", cursor: isAuditing ? "default" : "pointer", fontFamily: "inherit", opacity: isAuditing ? 0.8 : 1 }}>
                    {isAuditing ? "Analyse en cours…" : "Lancer l'audit →"}
                  </button>
                </div>

                {/* Progress */}
                {isAuditing && (
                  <div style={{ marginBottom: "20px" }}>
                    <div style={{ fontSize: "13px", color: "#7C3AED", marginBottom: "8px", fontWeight: "500" }}>Récupération des produits via Shopify API…</div>
                    <div style={{ height: "6px", borderRadius: "3px", background: "#E4E5E7", overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "linear-gradient(90deg,#7C3AED,#5B21B6)", borderRadius: "3px", animation: "auditBar 1.5s ease-in-out infinite" }} />
                    </div>
                    <style>{`@keyframes auditBar{0%{width:10%;margin-left:0}50%{width:50%;margin-left:25%}100%{width:10%;margin-left:90%}}`}</style>
                  </div>
                )}

                {/* Summary */}
                {auditData && !isAuditing && (
                  <>
                    <div className="tcc-audit-kpi" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px", marginBottom: "20px" }}>
                      <StatCard label="Produits scannés"    value={auditData.totalScanned} sub="avec coût renseigné" color="#202223" bg="#F9FAFB" />
                      <StatCard label="Top Performers ✅"  value={winners.length} sub="marge > 15%"  color="#008060" bg="#F1F8F5" />
                      <StatCard label="Produits à risque ⚠️" value={risky.length}  sub="marge 0–15%"  color="#B98900" bg="#FFF9EC" />
                      <StatCard label="Money Losers 🔴"    value={losers.length}  sub="marge < 0%"   color="#D72C0D" bg="#FFF4F4" />
                    </div>

                    {losers.length > 0 && (
                      <div style={{ padding: "14px 18px", borderRadius: "8px", background: "#FFF4F4", border: "1px solid #D72C0D44", marginBottom: "16px" }}>
                        <div style={{ fontSize: "14px", fontWeight: "700", color: "#D72C0D", marginBottom: "6px" }}>
                          🚨 ALERTE : {losers.length} produit{losers.length > 1 ? "s" : ""} vous font perdre de l'argent
                        </div>
                        <div style={{ fontSize: "12px", color: "#6D7175" }}>{losers.slice(0,3).map(p => p.title).join(", ")}{losers.length > 3 ? ` et ${losers.length - 3} autres…` : ""}</div>
                      </div>
                    )}

                    {winners.length > 0 && (
                      <div style={{ padding: "14px 18px", borderRadius: "8px", background: "#F1F8F5", border: "1px solid #00806044", marginBottom: "20px" }}>
                        <div style={{ fontSize: "14px", fontWeight: "700", color: "#008060", marginBottom: "8px" }}>🏆 TOP 10 produits les plus rentables</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          {winners.slice(0,10).map((p,i) => (
                            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px" }}>
                              <span style={{ width: "20px", fontWeight: "700", color: "#008060" }}>#{i+1}</span>
                              <span style={{ flex: 1, color: "#202223" }}>{p.title}</span>
                              <span style={{ fontWeight: "700", color: "#008060" }}>{pct(p.netPct)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Full table */}
                    <div style={{ fontSize: "13px", color: "#6D7175", marginBottom: "10px" }}>{products.length} produit{products.length > 1 ? "s" : ""} avec coût fournisseur renseigné</div>
                    <div style={{ border: "1px solid #E4E5E7", borderRadius: "8px", overflow: "hidden" }}>
                      <div className="tcc-audit-row" style={{ display: "grid", gridTemplateColumns: "2.5fr 1fr 1fr 1.2fr 1fr", background: "#F9FAFB", borderBottom: "1px solid #E4E5E7" }}>
                        {["Produit", "Prix vente", "Coût fournisseur", "Marge nette %", "Statut"].map((h, idx) => (
                          <div key={h} className={idx === 2 ? "tcc-audit-col-cost" : ""} style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</div>
                        ))}
                      </div>
                      {products.map((p, i) => {
                        const statusColor = p.netPct < 0 ? "#D72C0D" : p.netPct < 15 ? "#B98900" : "#008060";
                        const statusBg    = p.netPct < 0 ? "#FFF4F4" : p.netPct < 15 ? "#FFF9EC" : "#F1F8F5";
                        const statusLabel = p.netPct < 0 ? "Perte" : p.netPct < 15 ? "Risque" : "OK";
                        return (
                          <div key={p.id} className="tcc-audit-row" style={{ display: "grid", gridTemplateColumns: "2.5fr 1fr 1fr 1.2fr 1fr", background: i % 2 === 0 ? "#fff" : "#FAFBFB", borderBottom: i < products.length - 1 ? "1px solid #F1F2F3" : "none" }}>
                            <div style={{ padding: "10px 12px", fontSize: "13px", color: "#202223", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                            <div style={{ padding: "10px 12px", fontSize: "12px", color: "#202223" }}>{fmt(p.price)}€</div>
                            <div className="tcc-audit-col-cost" style={{ padding: "10px 12px", fontSize: "12px", color: "#202223" }}>{fmt(p.cost)}€</div>
                            <div style={{ padding: "10px 12px" }}><span style={{ fontSize: "13px", fontWeight: "700", color: statusColor }}>{pct(p.netPct)}%</span></div>
                            <div style={{ padding: "10px 12px" }}><span style={{ padding: "3px 10px", borderRadius: "10px", background: statusBg, color: statusColor, fontSize: "11px", fontWeight: "700" }}>{statusLabel}</span></div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Analyse et recommandations */}
                {auditData && !isAuditing && (losers.length > 0 || risky.length > 0) && (
                  <div style={{ marginTop: "28px" }}>
                    <div style={{ fontSize: "14px", fontWeight: "700", color: "#202223", marginBottom: "16px" }}>Analyse et recommandations</div>
                    {losers.length > 0 && (
                      <div style={{ padding: "16px 20px", borderRadius: "10px", background: "#FFF4F4", border: "1px solid #D72C0D33", marginBottom: "12px" }}>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#D72C0D", marginBottom: "10px" }}>🚨 {losers.length} produit{losers.length > 1 ? "s" : ""} à marge négative — action immédiate requise</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "7px", fontSize: "13px", color: "#202223", lineHeight: "1.6" }}>
                          <div>• <strong>Vérifiez le coût fournisseur</strong> dans Shopify : une saisie incorrecte peut fausser le calcul.</div>
                          <div>• <strong>Augmentez le prix de vente</strong> : ces produits sont actuellement vendus à perte. Utilisez l'onglet Simulateur pour calculer le prix minimum.</div>
                          <div>• <strong>Renégociez avec votre fournisseur</strong> ou changez de source d'approvisionnement si le prix de vente ne peut pas être augmenté.</div>
                          <div>• <strong>Envisagez de désactiver ces produits</strong> jusqu'à résolution — chaque vente aggrave vos pertes.</div>
                        </div>
                      </div>
                    )}
                    {risky.length > 0 && (
                      <div style={{ padding: "16px 20px", borderRadius: "10px", background: "#FFF9EC", border: "1px solid #B9890033" }}>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#B98900", marginBottom: "10px" }}>⚠️ {risky.length} produit{risky.length > 1 ? "s" : ""} à marge insuffisante (0–15%) — à optimiser</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "7px", fontSize: "13px", color: "#202223", lineHeight: "1.6" }}>
                          <div>• <strong>Marge insuffisante pour absorber les charges fixes</strong> (loyer, salaires, logistique). Ciblez au minimum 20–25% de marge nette.</div>
                          <div>• <strong>Réduisez vos frais d'acquisition</strong> : ces produits ne peuvent pas supporter un budget publicitaire significatif.</div>
                          <div>• <strong>Groupez les commandes</strong> pour réduire les frais de port fournisseur et améliorer le coût rendu.</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!auditData && !isAuditing && (
                  <div style={{ textAlign: "center", padding: "40px 24px", color: "#6D7175" }}>
                    <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔍</div>
                    <div style={{ fontSize: "15px", fontWeight: "500", marginBottom: "8px" }}>Prêt à auditer votre catalogue</div>
                    <div style={{ fontSize: "13px" }}>Cliquez sur "Lancer l'audit" pour analyser tous vos produits actifs ayant un coût fournisseur renseigné dans Shopify.</div>
                  </div>
                )}
              </div>
            );
          })()
        )}

      </s-section>

      {/* Annotation modal */}
      {annotModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: "12px", padding: "28px", width: "400px", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#202223", marginBottom: "16px" }}>Annoter ce point de données</div>
            <textarea value={annotText} onChange={e => setAnnotText(e.target.value)} rows={3}
              placeholder="Ex: Changement de fournisseur, Hausse des droits de douane…"
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
            <div style={{ display: "flex", gap: "10px", marginTop: "16px", justifyContent: "flex-end" }}>
              <button onClick={() => setAnnotModal(null)} style={{ padding: "8px 18px", background: "none", border: "1px solid #E4E5E7", borderRadius: "6px", fontSize: "13px", cursor: "pointer", fontFamily: "inherit", color: "#6D7175" }}>Annuler</button>
              <button onClick={handleSaveAnnotation} disabled={!annotText.trim() || annotFetcher.state !== "idle"}
                style={{ padding: "8px 18px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit", opacity: !annotText.trim() ? 0.5 : 1 }}>
                Sauvegarder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RESULTS (Feature 1 integrated + Feature 5) ───────────────────── */}
      {activeTab === "calculator" && !showUpgrade && results && (
        <s-section heading="Résultats — Votre vraie marge">
          <MessageBlock items={warnings} color="#B98900" bg="#FFF9EC" borderColor="#B98900" />

          <div style={{ padding: "20px 24px", borderRadius: "8px", background: marginBg, borderLeft: `5px solid ${marginColor}`, marginBottom: "28px" }}>
            {results.margeNettePercent < 0 ? (
              <>
                <div style={{ fontSize: "17px", fontWeight: "700", color: "#D72C0D", marginBottom: "8px" }}>Perte nette — vous perdez de l'argent à chaque vente.</div>
                <div style={{ fontSize: "14px", color: "#6D7175", lineHeight: "1.6" }}>
                  Votre marge apparente : <strong style={{ color: "#202223" }}>{pct(results.margeApparente)}%</strong>
                  {" → "}Votre marge nette réelle : <strong style={{ color: "#D72C0D" }}>{pct(results.margeNettePercent)}%</strong>
                  {" "}(<strong style={{ color: "#D72C0D" }}>−{fmt(Math.abs(results.margeNette))}€ par vente</strong>).
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "17px", fontWeight: "700", color: marginColor, marginBottom: "8px" }}>{marginLabel}</div>
                <div style={{ fontSize: "14px", color: "#6D7175", lineHeight: "1.6" }}>
                  Votre marge apparente : <strong style={{ color: "#202223" }}>{pct(results.margeApparente)}%</strong>
                  {" → "}Votre marge nette réelle : <strong style={{ color: marginColor }}>{pct(results.margeNettePercent)}%</strong>
                  {" "}(<strong style={{ color: marginColor }}>{fmt(results.margeNette)}€ par vente</strong>).
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

          <div className="tcc-margin-cards" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "32px" }}>
            <StatCard label="Marge apparente"    value={`${pct(results.margeApparente)}%`}    sub="Marge apparente calculée"        color="#6D7175"   bg="#F9FAFB" />
            <StatCard label="Marge brute"         value={`${pct(results.margeBrutePercent)}%`} sub={`${fmt(results.margeBrute)}€ / vente`} color="#202223"   bg="#F9FAFB" />
            <StatCard label="Marge nette réelle"  value={`${pct(results.margeNettePercent)}%`} sub={`${fmt(results.margeNette)}€ / vente`} color={marginColor} bg={marginBg} />
          </div>

          <div className="tcc-cost-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
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
                ...(results.fraisRetour > 0 ? [{ label: "— Frais de retour", value: results.fraisRetour }] : []),
                ...(results.coutEmballage > 0 ? [{ label: "— Coût d'emballage", value: results.coutEmballage }] : []),
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

          {/* Expert: Break-Even ROAS */}
          {isExpert ? (
            <BreakEvenROAS results={results} />
          ) : (
            <div style={{ marginTop: "20px", padding: "14px 18px", borderRadius: "10px", background: "linear-gradient(135deg,#faf8ff,#f0ecff)", border: "1px solid #7C3AED33", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "20px" }}>📈</span>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#202223" }}>Break-Even ROAS</div>
                  <div style={{ fontSize: "12px", color: "#6D7175" }}>Calculez le ROAS minimum rentable pour vos campagnes pub.</div>
                </div>
              </div>
              <button onClick={() => setShowUpgrade(true)} style={{ flexShrink: 0, padding: "8px 16px", background: "linear-gradient(135deg,#7C3AED,#5B21B6)", color: "#fff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
                Passer au plan Expert
              </button>
            </div>
          )}
        </s-section>
      )}

      {/* ── ASIDE ────────────────────────────────────────────────────────── */}
      <s-section slot="aside" heading="Votre abonnement">
        <div style={{ padding: "14px 16px", borderRadius: "8px", background: isExpert ? "linear-gradient(135deg,#faf8ff,#f0ecff)" : isPro ? "#F1F8F5" : "#F9FAFB", border: `1px solid ${isExpert ? "#7C3AED" : isPro ? "#008060" : "#E4E5E7"}`, marginBottom: "12px" }}>
          <div style={{ fontSize: "13px", fontWeight: "600", color: isExpert ? "#7C3AED" : isPro ? "#008060" : "#6D7175", marginBottom: "4px" }}>
            {isExpert ? "✦ Plan Expert actif" : isPro ? "★ Plan Pro actif" : "Plan Gratuit"}
          </div>
          <div style={{ fontSize: "12px", color: "#6D7175" }}>
            {isExpert ? "Calculs illimités · Audit · ROAS · IA" : isPro ? "Calculs illimités · Historique · IA" : `${localCount}/${FREE_LIMIT} calculs ce mois`}
          </div>
        </div>
        {!isExpert && !isPro && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {subscribeBtn()}
            {subscribeExpertBtn()}
          </div>
        )}
        {!isExpert && isPro && (
          <div>
            <div style={{ fontSize: "12px", color: "#6D7175", marginBottom: "8px" }}>Passez à Expert pour le Break-Even ROAS et l'audit catalogue.</div>
            {subscribeExpertBtn("Upgrader vers Expert")}
          </div>
        )}
      </s-section>

      <s-section slot="aside" heading="Méthodologie">
        <s-unordered-list>
          <s-list-item><strong>Prix fournisseur</strong> — Ce que vous payez pour acheter le produit à votre fournisseur.</s-list-item>
          <s-list-item><strong>Droits de douane</strong> — Les taxes que vous devez payer quand vous faites entrer un produit en France depuis l'étranger (Chine, Turquie, etc.).</s-list-item>
          <s-list-item><strong>TVA import 20%</strong> — La TVA payée à l'importation — vous pouvez la récupérer si vous êtes assujetti à la TVA.</s-list-item>
          <s-list-item><strong>Frais de port</strong> — Le coût d'expédition depuis le pays de votre fournisseur jusqu'en France.</s-list-item>
          <s-list-item><strong>Commissions plateformes</strong> — Ce que Shopify et Stripe prélèvent sur chaque vente que vous réalisez.</s-list-item>
          <s-list-item><strong>Provision retours</strong> — Une réserve calculée pour couvrir les remboursements et retours clients.</s-list-item>
        </s-unordered-list>
        <s-paragraph>
          <strong>Sources :</strong> Tarif douanier TARIC (CE 2658/87), barèmes Shopify et Stripe publics, estimations sectorielles basées sur les tendances marché actuelles pour les taux de retour.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Taux de douane">
        <s-paragraph>
          Chaque produit importé depuis l'étranger est soumis à une taxe douanière calculée sur sa valeur. Ce taux varie selon la catégorie du produit. Il est automatiquement intégré dans votre calcul de marge.
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>Vêtements & Textile : 12%</s-list-item>
          <s-list-item>Électronique & High-tech : 5%</s-list-item>
          <s-list-item>Cosmétique & Beauté : 10%</s-list-item>
          <s-list-item>Accessoires & Bijoux : 7%</s-list-item>
          <s-list-item>Sport & Fitness : 5%</s-list-item>
          <s-list-item>Alimentation & Nutrition : 15%</s-list-item>
          <s-list-item>Maroquinerie & Sacs : 3%</s-list-item>
          <s-list-item>Jouets & Enfants : 0%</s-list-item>
          <s-list-item>Mobilier & Décoration : 2.7%</s-list-item>
          <s-list-item>Autre : 3%</s-list-item>
        </s-unordered-list>
        <div style={{ fontSize: "12px", color: "#6D7175", fontStyle: "italic", marginTop: "10px", lineHeight: "1.5" }}>
          Taux moyens indicatifs. Le montant exact dépend de l'origine du produit et de sa sous-catégorie douanière.
        </div>
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
