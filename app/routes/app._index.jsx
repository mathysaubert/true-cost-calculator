import { useState, useCallback, useEffect, useRef, useMemo, Fragment } from "react";
import { useFetcher, useLoaderData, useRouteError, useSubmit, useNavigation } from "react-router";
import { authenticate, PLAN_PRO, PLAN_EXPERT } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { supabase } from "../supabase.server";
import { captureException } from "../sentry.server";
import {
  LOW_VALUE_PARCEL_CEILING, EU_DROPSHIP_DUTY_REFORM_DATE,
  PAYMENT_PROCESSORS, CUSTOMS_RATES, SHIPPING_ESTIMATES,
  safeNum, formatEur, formatPct, formatNum,
  computeMargin, computeScenarios, simulateSellingPrice,
} from "../lib/engine.js";
import {
  AD_PLATFORM_RANGES, platformLabel, roasInviable,
  computeCpaAdvice, computeCpaColor, computeRoasPhrase, computeRoasLabel,
} from "../lib/roas.js";
import { buildMargeLine } from "../lib/aiPayload.js";
import {
  PAYS_KEYS, CATEGORIE_KEYS, VAT_REGIMES, SHIPPING_MODELS,
  shopifyTypeToCategory, estimateVariantCost, validateCostRow,
  parseCostsCsv, buildCostsCsv, CSV_COLUMNS,
} from "../lib/variantCosts.js";
import { backfillRowBreakdown } from "../lib/orderIngest.js";
import { syncShopOrders } from "../lib/orderSync.server.js";
import { aggregateOrderMargins, formatMoney, waterfallFromBreakdown } from "../lib/orderHistory.js";
import { computeCpaTargets } from "../lib/cpaTargets.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const FREE_LIMIT = 10;
const DEFAULT_ALERT_THRESHOLD = 25;
const HISTORY_LIMIT_EXPERT = 200;
const HISTORY_LIMIT_PRO = 50;
const HISTORY_LIMIT_FREE = 0;
// UI Monitor : plafond de lignes order_margins lues. Si le total dépasse, on lit les
// plus récentes ET on le SIGNALE (jamais de troncature silencieuse → chiffres faux).
const ORDER_MARGINS_CAP = 5000;
// Constantes réglementaires, barèmes (CUSTOMS_RATES, SHIPPING_ESTIMATES,
// PAYMENT_PROCESSORS) et helpers de formatage : importés depuis ../lib/engine.js
// (source unique partagée avec les tests).

// ── Helpers ───────────────────────────────────────────────────────────────────

const normalizeDecimal = (raw) => String(raw ?? "").replace(/\s/g, "").replace(/,/g, ".");

function validatePrice(raw, label, errors) {
  const s = normalizeDecimal(raw);
  if (s === "") { errors.push(`${label} est requis.`); return null; }
  if (!/^\d+(\.\d*)?$/.test(s)) { errors.push(`${label} : saisissez un nombre valide (ex : 19.99 ou 19,99).`); return null; }
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) { errors.push(`${label} : valeur invalide.`); return null; }
  if (n === 0) { errors.push(`${label} ne peut pas être 0.`); return null; }
  if (n > 999999) { errors.push(`${label} : valeur trop élevée (max 999 999€).`); return null; }
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

function sanitizeForPrompt(str) {
  if (!str) return "";
  return String(str)
    .slice(0, 100)
    .replace(/[\r\n\t]/g, " ")
    // eslint-disable-next-line no-useless-escape
    .replace(/[<>{}\[\]|\\^~`]/g, "");
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

function FieldGroup({ label, tooltip, direction = "right", children }) {
  const [tipPos, setTipPos] = useState(null);
  const btnRef = useRef(null);
  const tipRef = useRef(null);

  const openTip = () => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const W = 260;
    const margin = 8;
    let left = rect.left;
    if (left + W > window.innerWidth - margin) left = window.innerWidth - W - margin;
    if (left < margin) left = margin;
    setTipPos({ top: rect.bottom + 8, left });
  };

  const closeTip = () => setTipPos(null);

  // Close on any tap/click outside button or tooltip
  useEffect(() => {
    if (!tipPos) return;
    const handler = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (tipRef.current?.contains(e.target)) return;
      closeTip();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [tipPos]);

  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>
        {tooltip && (
          <div>
            <button
              ref={btnRef}
              type="button"
              onClick={() => tipPos ? closeTip() : openTip()}
              style={{ width: "16px", height: "16px", borderRadius: "50%", background: tipPos ? "#008060" : "#E4E5E7", border: "none", cursor: "pointer", fontSize: "10px", fontWeight: "700", color: tipPos ? "#fff" : "#6D7175", fontFamily: "inherit", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >?</button>
            {tipPos && (
              <div
                ref={tipRef}
                style={{ position: "fixed", top: tipPos.top, left: tipPos.left, width: "260px", background: "#202223", color: "#fff", borderRadius: "8px", padding: "12px 14px", fontSize: "12px", zIndex: 9999, lineHeight: "1.6", boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}
              >
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
    <div style={{ padding: "16px 12px", borderRadius: "8px", background: bg, border: `1px solid ${color}22`, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
      <div style={{ fontSize: "10px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.4px", minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: "22px", fontWeight: "700", color, lineHeight: 1, minHeight: "60px", display: "flex", alignItems: "center", justifyContent: "center" }}>{value}</div>
      <div style={{ fontSize: "12px", color: "#6D7175" }}>{sub}</div>
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
        <div style={{ position: "absolute", left: `${(toX(tooltip.idx)/W)*100}%`, top: "4px", transform: toX(tooltip.idx) < 150 ? "translateX(0)" : toX(tooltip.idx) > W - 150 ? "translateX(-100%)" : "translateX(-50%)", background: "#202223", color: "#fff", borderRadius: "8px", padding: "10px 14px", fontSize: "12px", zIndex: 10, maxWidth: "200px", wordWrap: "break-word", boxShadow: "0 4px 12px rgba(0,0,0,0.25)", minWidth: "170px" }}>
          <div style={{ fontWeight: "700", marginBottom: "3px", color: tooltip.margin < 10 ? "#FF8A80" : tooltip.margin < 25 ? "#FFD54F" : "#69F0AE" }}>{formatPct(tooltip.margin)} %</div>
          <div style={{ color: "#aaa", fontSize: "11px", marginBottom: "2px" }}>{formatDate(tooltip.date)}</div>
          {tooltip.product && <div style={{ color: "#ddd", fontSize: "11px", marginBottom: "4px", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis" }}>{tooltip.product}</div>}
          <div style={{ color: tooltip.diff >= 0 ? "#69F0AE" : "#FF8A80", fontSize: "11px" }}>
            {tooltip.diff >= 0 ? "+" : ""}{formatPct(tooltip.diff)} pts vs seuil
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
              <strong>{v.product_title ?? v.category}</strong> — marge actuelle : <strong style={{ color: "#D72C0D" }}>{formatPct(v.net_margin_percent)} %</strong>
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
        <span style={{ fontSize: "14px", fontWeight: "700", color: "#4f3dc8" }}>Recommandation IA</span>
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

      {data?.aiUnavailable && (
        <div style={{ fontSize: "13px", color: "#7c6fb0", lineHeight: "1.6" }}>
          Les recommandations personnalisées sont temporairement indisponibles. Votre calcul de marge ci-dessus reste exact.
        </div>
      )}

      {data?.error && (
        <div style={{ fontSize: "13px", color: "#7c6fb0", lineHeight: "1.6" }}>{data.error}</div>
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
        Réservée au plan <strong>Expert — 15$/mois</strong>.
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
// Seuils (min/max) : SOURCE UNIQUE = AD_PLATFORM_RANGES dans lib/roas.js (partagés
// avec conseil/couleur/phrase). Ici on n'ajoute que l'habillage (sous-titre, logo).
const AD_PLATFORM_DISPLAY = {
  "Meta Ads": {
    sub: "Facebook / Instagram", logoBg: "#1877F2",
    logo: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
        <path d="M17 2h-3a5 5 0 00-5 5v3H6v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/>
      </svg>
    ),
  },
  "TikTok Ads": {
    sub: "TikTok For Business", logoBg: "#010101",
    logo: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V9.07a8.16 8.16 0 004.77 1.52V7.14a4.85 4.85 0 01-1-.45z"/>
      </svg>
    ),
  },
  "Google Shopping": {
    sub: "Performance Max", logoBg: "#fff",
    logo: (
      <svg width="16" height="16" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
    ),
  },
};
const AD_PLATFORMS = AD_PLATFORM_RANGES.map((r) => ({ ...r, ...AD_PLATFORM_DISPLAY[r.name] }));

// Habillage (couleur/icône/hint) d'un statut plateforme. Le LABEL vient de
// platformLabel (lib/roas.js) — source unique, jamais re-décidé ici.
const PLATFORM_STYLE = {
  Viable:    { color: "#008060", bg: "#F1F8F5", border: "#00806033", icon: "✓", hint: "Votre seuil est sous le ROAS moyen — cette plateforme peut couvrir vos coûts." },
  Limite:    { color: "#B98900", bg: "#FFF9EC", border: "#B9890033", icon: "⚠", hint: "Votre seuil est dans la fourchette — les campagnes devront être bien optimisées." },
  Difficile: { color: "#D72C0D", bg: "#FFF4F4", border: "#D72C0D33", icon: "✗", hint: "Votre seuil dépasse le ROAS habituel de cette plateforme." },
};
function platformStatus(roas, min, max) {
  const label = platformLabel(roas, min, max);
  return { label, ...PLATFORM_STYLE[label] };
}

// ROAS viability tiers based on real ad platform benchmarks.
// Returns non-null message only for the inviable (>10x) case — the existing
// paliers (Viable / Difficile) below 10x are handled separately and unchanged.
function getRoasViability(roas) {
  if (roasInviable(roas)) return { // seuil > 10x : source unique lib/roas.js
    color: "#B98900", bg: "#FFF9EC", border: "#B98900",
    message: "ROAS requis irréaliste : aucune plateforme publicitaire ne permet d'atteindre ce seuil de manière durable. Votre seul levier de croissance est l'acquisition organique (SEO, réseaux sociaux, bouche-à-oreille).",
  };
  if (roas > 5)  return { color: "#D72C0D", bg: "#FFF4F4", border: "#D72C0D", message: null };
  if (roas > 3)  return { color: "#B98900", bg: "#FFF9EC", border: "#B98900", message: null };
  return           { color: "#008060", bg: "#F1F8F5", border: "#008060", message: null };
}

function BreakEvenROAS({ results, onGoToSimulation }) {
  if (!results) return null;
  const { prixVente, revenu, coutRendu, shopifyCost, stripeCost, retoursCost, fraisFixes = 0 } = results;
  // CPA_MAX = revenu HT - landed_cost - frais plateformes (TTC) - coûts fixes
  // revenu = prixVente / (1 + TVA) en assujetti ; = prixVente en franchise et non-TTC.
  // Shopify/Stripe restent sur TTC (base contractuelle). ROAS = prixVente / CPA_MAX.
  const revenuEffectif = revenu ?? prixVente; // fallback sûr si résultats anciens
  const available = revenuEffectif - coutRendu - shopifyCost - stripeCost - retoursCost - fraisFixes;

  if (available <= 0) return (
    <div style={{ marginTop: "20px", padding: "16px 20px", borderRadius: "10px", background: "#FFF4F4", border: "2px solid #D72C0D", display: "flex", gap: "12px", alignItems: "flex-start" }}>
      <span style={{ fontSize: "20px", flexShrink: 0 }}>🚫</span>
      <div>
        <div style={{ fontSize: "14px", fontWeight: "700", color: "#D72C0D", marginBottom: "4px" }}>Calcul impossible : Produit vendu à perte</div>
        <div style={{ fontSize: "13px", color: "#D72C0D" }}>Augmentez le prix ou réduisez les coûts fixes avant de dépenser en publicité.</div>
      </div>
    </div>
  );

  // Break-even ROAS : numérateur TTC (valeur de conversion remontée par le pixel
  // Meta/Shopify en B2C FR) / marge HT. Si le tracking du marchand remonte du HT,
  // le numérateur devrait alors être HT. Voir l'hypothèse détaillée dans lib/roas.js.
  const roas      = prixVente / available;
  // Couleur + label du grand chiffre branchés sur le MÊME verdict agrégé que le
  // tableau, la phrase et la pastille CPA (lib/roas.js) — fini les seuils roas<2/<4
  // propres qui contredisaient la ventilation (ex. titre 🔴 « Difficile » à ROAS 4,5
  // alors que Google y était encore « Limite »). Couleur partagée avec cpaColor.
  const roasColor = computeCpaColor(roas);
  const roasLabel = computeRoasLabel(roas);
  // Phrase branchée sur le verdict agrégé (lib/roas.js), sans nommer de plateforme —
  // l'ancienne version citait « Meta » même quand Meta était Difficile.
  const roasPhrase = computeRoasPhrase(roas);

  // Couleur CPA = ATTEIGNABILITÉ (agrégée sur les 3 plateformes, cohérente avec le
  // conseil et le tableau), plus « marge € disponible ». Le montant € reste affiché
  // en chiffre à côté → couleur = atteignable, chiffre = budget max. Source unique :
  // lib/roas.js (vert ≥1 Viable / orange 0 Viable+≥1 Limite / rouge 3×Difficile|irréaliste).
  const cpaColor = computeCpaColor(roas);
  // Conseil dérivé du verdict agrégé (lib/roas.js) : organique si aucune plateforme
  // Viable/ROAS irréaliste, sinon ne cite que les plateformes Viable/Limite.
  const cpaAdvice = computeCpaAdvice(roas);

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
          <span className="tcc-roas-num" style={{ fontSize: "56px", fontWeight: "800", color: roasColor, lineHeight: 1, letterSpacing: "-2px" }}>{formatNum(roas)}x</span>
          <div>
            <div style={{ fontSize: "15px", fontWeight: "700", color: roasColor }}>{roasLabel}</div>
            <div style={{ fontSize: "12px", color: "#6D7175", marginTop: "2px" }}>ROAS minimum requis</div>
          </div>
        </div>
        <div style={{ fontSize: "13px", color: "#6D7175", lineHeight: "1.6", marginBottom: "14px", fontStyle: "italic" }}>"{roasPhrase}"</div>
        <div style={{ padding: "12px 16px", borderRadius: "8px", background: `${roasColor}0D`, border: `1px solid ${roasColor}22`, fontSize: "13px", color: "#202223", lineHeight: "1.6" }}>
          Vos campagnes doivent générer au minimum <strong style={{ color: roasColor }}>{formatNum(roas)} € de CA</strong> pour chaque euro dépensé en pub afin d'être rentables.
        </div>
        <div style={{ marginTop: "8px", fontSize: "11px", color: "#8C9196", lineHeight: "1.5" }}>
          Calcul basé sur une valeur de conversion TTC (standard B2C FR).
        </div>
        {(() => { const v = getRoasViability(roas); return v.message ? (
          <div style={{ marginTop: "14px", padding: "12px 16px", borderRadius: "8px", background: v.bg, border: `1px solid ${v.border}`, display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <span style={{ fontSize: "16px", flexShrink: 0 }}>⚠️</span>
            <span style={{ fontSize: "13px", color: v.color, lineHeight: "1.6" }}>{v.message}</span>
          </div>
        ) : null; })()}
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

      {/* ── Conseil actionnable si ROAS difficile ── */}
      {AD_PLATFORMS.some(({ min, max }) => platformStatus(roas, min, max).label === "Difficile") && (
        <div style={{ padding: "16px 20px", borderRadius: "10px", background: "#F1F8F5", border: "1px solid #00806044" }}>
          <div style={{ fontSize: "13px", color: "#202223", lineHeight: "1.7", marginBottom: "12px" }}>
            Pour réduire votre ROAS break-even, deux leviers : <strong>baisser votre coût fournisseur</strong> ou <strong>augmenter votre prix de vente</strong>. Utilisez l'onglet Simulation pour calculer le prix minimum à appliquer.
          </div>
          {onGoToSimulation && (
            <button onClick={onGoToSimulation} style={{ padding: "8px 18px", background: "#008060", color: "#fff", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
              → Aller à la Simulation
            </button>
          )}
        </div>
      )}

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
            <div style={{ fontSize: "46px", fontWeight: "800", color: cpaColor, lineHeight: 1, letterSpacing: "-1.5px" }}>{formatEur(available)}</div>
            <div style={{ fontSize: "11px", color: "#6D7175", marginTop: "5px", fontWeight: "500" }}>par acquisition</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Server exports ────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  // Query active subscriptions and first product page concurrently.
  // Direct GraphQL avoids billing.check()'s isTest filter, which silently
  // excludes dev-store subscriptions when NODE_ENV=production on Vercel.
  const [subResp, productsResp1] = await Promise.allSettled([
    admin.graphql(`
      query ActiveSubscriptions {
        currentAppInstallation {
          activeSubscriptions { id name status }
        }
      }
    `),
    admin.graphql(`
      query ProductsPage1 {
        shop { taxesIncluded }
        products(first: 250, sortKey: TITLE) {
          edges {
            node {
              id
              title
              variants(first: 1) {
                edges { node { price } }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `),
  ]);

  let isPro = false, isExpert = false;
  if (subResp.status === "fulfilled") {
    try {
      const subJson = await subResp.value.json();
      const subs = subJson.data?.currentAppInstallation?.activeSubscriptions ?? [];
      isExpert = subs.some(s => s.name === PLAN_EXPERT && s.status === "ACTIVE");
      isPro = isExpert || subs.some(s => s.name === PLAN_PRO && s.status === "ACTIVE");
    } catch (e) {
      console.error("[Billing] subscription parse failed:", e?.message);
    }
  } else {
    console.error("[Billing] subscription query failed:", subResp.reason?.message);
  }

  // Persist detected plan to Supabase — audit trail and fast read path.
  supabase.from("shop_plans").upsert(
    { shop_domain: session.shop, plan: isExpert ? "expert" : isPro ? "pro" : "free", updated_at: new Date().toISOString() },
    { onConflict: "shop_domain" }
  ).then(() => {}).catch(e => console.error("[Plans] upsert failed:", e?.message));

  let products = [];
  let productsCapped = false;
  // Default true: French B2C Shopify stores almost always include taxes in displayed price.
  // Overridden below if shop.taxesIncluded is explicitly false.
  let shopTaxesIncluded = true;
  if (productsResp1.status === "fulfilled") {
    try {
      const json1 = await productsResp1.value.json();
      if (typeof json1.data?.shop?.taxesIncluded === "boolean") {
        shopTaxesIncluded = json1.data.shop.taxesIncluded;
      }
      const page1 = json1.data?.products;
      if (page1) {
        products = page1.edges.map(({ node }) => ({
          id: node.id,
          title: node.title,
          price: parseFloat(node.variants.edges[0]?.node.price ?? "0"),
        }));
        if (page1.pageInfo.hasNextPage) {
          try {
            const resp2 = await admin.graphql(
              `query ProductsPage2($cursor: String) {
                products(first: 250, after: $cursor, sortKey: TITLE) {
                  edges { node { id title variants(first: 1) { edges { node { price } } } } }
                  pageInfo { hasNextPage }
                }
              }`,
              { variables: { cursor: page1.pageInfo.endCursor } }
            );
            const json2 = await resp2.json();
            const page2 = json2.data?.products;
            if (page2) {
              for (const { node } of page2.edges) {
                products.push({ id: node.id, title: node.title, price: parseFloat(node.variants.edges[0]?.node.price ?? "0") });
              }
              productsCapped = page2.pageInfo.hasNextPage;
            }
          } catch (e) {
            console.error("[Products] Page 2 failed:", e?.message);
          }
        }
      }
    } catch (e) {
      console.error("[Products] GraphQL parse failed:", e?.message);
    }
  } else {
    console.error("[Products] GraphQL failed:", productsResp1.reason?.message);
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  // Fetch usage, history, alert threshold, and vat_regime concurrently
  const [countResult, historyResult, alertResult, annotationsResult, planResult, orderMarginsResult, orderMarginsCountResult] = await Promise.allSettled([
    !isPro
      ? supabase.from("usage").select("calculation_count").eq("shop_domain", session.shop).eq("month", currentMonth).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("calculations")
      .select("id, product_id, product_title, category, country, purchase_price, selling_price, net_margin_percent, net_margin_euros, created_at")
      .eq("shop_domain", session.shop)
      .order("created_at", { ascending: false })
      .limit(isExpert ? HISTORY_LIMIT_EXPERT : isPro ? HISTORY_LIMIT_PRO : HISTORY_LIMIT_FREE),
    supabase.from("margin_alerts").select("threshold").eq("shop_domain", session.shop).maybeSingle(),
    isExpert
      ? supabase.from("calculation_annotations").select("*").eq("shop_domain", session.shop)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("shop_plans").select("vat_regime, shipping_model, default_import_country, shopify_fee_pct, processor_fee_pct, processor_fixed_fee, profitability_threshold_pct, current_cpa, current_cpa_updated_at").eq("shop_domain", session.shop).maybeSingle(),
    // UI Monitor : N lignes order_margins les plus récentes + compte total (cap explicite).
    supabase.from("order_margins").select("*").eq("shop_domain", session.shop).order("order_created_at", { ascending: false }).limit(ORDER_MARGINS_CAP),
    supabase.from("order_margins").select("id", { count: "exact", head: true }).eq("shop_domain", session.shop),
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
  const vatRegime = planResult.status === "fulfilled"
    ? (planResult.value.data?.vat_regime ?? "assujetti")
    : "assujetti";
  const shippingModel = planResult.status === "fulfilled"
    ? (planResult.value.data?.shipping_model ?? "dropshipping")
    : "dropshipping";
  const defaultImportCountry = planResult.status === "fulfilled"
    ? (planResult.value.data?.default_import_country ?? "Chine")
    : "Chine";
  // D2 : taux fees éditables (intrants de la sync order_margins). Défauts = ceux du schéma.
  const fees = {
    shopifyFeePct:     planResult.status === "fulfilled" ? (planResult.value.data?.shopify_fee_pct     ?? 2.0)  : 2.0,
    processorFeePct:   planResult.status === "fulfilled" ? (planResult.value.data?.processor_fee_pct   ?? 1.5)  : 1.5,
    processorFixedFee: planResult.status === "fulfilled" ? (planResult.value.data?.processor_fixed_fee ?? 0.25) : 0.25,
  };
  // Seuil d'alerte de rentabilité (% global boutique). Défaut 0 = perte stricte (legacy).
  const profitabilityThresholdPct = planResult.status === "fulfilled"
    ? (planResult.value.data?.profitability_threshold_pct ?? 0) : 0;

  // UI Monitor : lignes (plus récentes) + total réel pour signaler le cap.
  const orderMargins = orderMarginsResult.status === "fulfilled"
    ? (orderMarginsResult.value.data ?? []) : [];
  const orderMarginsTotal = orderMarginsCountResult.status === "fulfilled"
    ? (orderMarginsCountResult.value.count ?? orderMargins.length) : orderMargins.length;
  const orderMarginsCapped = orderMarginsTotal > ORDER_MARGINS_CAP;

  // Devise d'affichage du frais fixe : celle des commandes synchronisées (sinon EUR).
  const feesCurrency = orderMargins.find(o => o.currency_code)?.currency_code ?? "EUR";

  // CPA prescriptif — CPA déclaré (null = jamais renseigné, distinct de 0) + date.
  const currentCpa = planResult.status === "fulfilled" ? (planResult.value.data?.current_cpa ?? null) : null;
  const currentCpaUpdatedAt = planResult.status === "fulfilled" ? (planResult.value.data?.current_cpa_updated_at ?? null) : null;
  // BUG 1 : toute la dérivation CPA vit ICI (serveur), pas dans le JSX. computeCpaTargets consomme
  // l'agrégat (net_margin = marge avant pub) ; le client n'affichera que formatMoney(...).
  const cpaTargets = computeCpaTargets(aggregateOrderMargins(orderMargins), { thresholdPct: profitabilityThresholdPct, currentCpa, currentCpaUpdatedAt });
  const cpaByProduct = Object.fromEntries(cpaTargets.perProduct.map(x => [x.product_id ?? "__unknown__", x]));

  return { isPro, isExpert, monthlyCount, history, products, productsCapped, alertThreshold, violations, showWelcome, annotations, vatRegime, shopTaxesIncluded, shippingModel, defaultImportCountry, fees, feesCurrency, profitabilityThresholdPct,
    currentCpa, currentCpaUpdatedAt, cpaTargets, cpaByProduct,
    orderMargins, orderMarginsTotal, orderMarginsCapped, orderMarginsCap: ORDER_MARGINS_CAP };
};

async function checkRateLimit(shop, action, maxPerDay) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await supabase.from("rate_limits")
      .select("count")
      .eq("shop_domain", shop)
      .eq("action", action)
      .eq("day", day)
      .maybeSingle();
    const current = data?.count ?? 0;
    if (current >= maxPerDay) return false;
    await supabase.from("rate_limits").upsert(
      { shop_domain: shop, action, day, count: current + 1, updated_at: new Date().toISOString() },
      { onConflict: "shop_domain,action,day" }
    );
  } catch (e) {
    // Fail open if rate_limits table doesn't exist yet
    console.error("[RateLimit] error:", e?.message);
  }
  return true;
}

export const action = async ({ request }) => {
  const { session, billing, admin } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return { success: false, error: "Corps de requête invalide." };
  }

  const isTestMode = process.env.NODE_ENV !== "production";

  // ── Subscribe Pro ─────────────────────────────────────────────────────────
  if (body._action === "subscribe") {
    // returnUrl must stay inside the Shopify Admin context so authenticate.admin()
    // can resolve the session on return. Using the Vercel URL directly causes a
    // redirect to /auth/login (manual shop input) because there is no App Bridge token.
    await billing.request({
      plan: PLAN_PRO,
      isTest: isTestMode,
      returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?subscribed=true`,
    });
    return null;
  }

  // ── Subscribe Expert ──────────────────────────────────────────────────────
  if (body._action === "subscribe_expert") {
    await billing.request({
      plan: PLAN_EXPERT,
      isTest: isTestMode,
      returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?subscribed=true`,
    });
    return null;
  }

  // Plan check for action handlers — direct GraphQL, same rationale as loader.
  let billingIsPro = false, billingIsExpert = false;
  try {
    const subResp = await admin.graphql(`
      query ActiveSubscriptions {
        currentAppInstallation {
          activeSubscriptions { id name status }
        }
      }
    `);
    const subJson = await subResp.json();
    const subs = subJson.data?.currentAppInstallation?.activeSubscriptions ?? [];
    billingIsExpert = subs.some(s => s.name === PLAN_EXPERT && s.status === "ACTIVE");
    billingIsPro = billingIsExpert || subs.some(s => s.name === PLAN_PRO && s.status === "ACTIVE");
  } catch (e) { console.error("[Billing] action check:", e?.message); }

  // ── Set VAT regime ────────────────────────────────────────────────────────
  if (body._action === "set_vat_regime") {
    const regime = body.vat_regime === "franchise" ? "franchise" : "assujetti";
    await supabase.from("shop_plans").upsert(
      { shop_domain: session.shop, vat_regime: regime, updated_at: new Date().toISOString() },
      { onConflict: "shop_domain" }
    );
    return { success: true };
  }

  // ── Set shipping model ────────────────────────────────────────────────────
  if (body._action === "set_shipping_model") {
    const model = body.shipping_model === "dropshipping" ? "dropshipping" : "stock";
    await supabase.from("shop_plans").upsert(
      { shop_domain: session.shop, shipping_model: model, updated_at: new Date().toISOString() },
      { onConflict: "shop_domain" }
    );
    return { success: true };
  }

  // ── D2 : taux fees de la boutique (intrants de la sync order_margins) ──────
  // On édite des INTRANTS lus par les FUTURES synchronisations, jamais une marge :
  // les order_margins déjà ingérés gardent leur snapshot figé (cf. ignoreDuplicates).
  if (body._action === "set_fees") {
    // Parsing tolérant virgule FR ("1,5" → 1.5) sur les TROIS champs.
    const parseFee = (v) => {
      const n = parseFloat(String(v ?? "").replace(",", ".").trim());
      return Number.isFinite(n) ? n : null;
    };
    const shopifyFee = parseFee(body.shopify_fee_pct);
    const procFee    = parseFee(body.processor_fee_pct);
    const fixedFee   = parseFee(body.processor_fixed_fee);
    // Bornes : pourcentages [0,100] ; fixe [0,10] (>10€/transaction = faute de frappe).
    if (shopifyFee === null || shopifyFee < 0 || shopifyFee > 100)
      return { success: false, error: "Le taux Shopify doit être compris entre 0 et 100 %." };
    if (procFee === null || procFee < 0 || procFee > 100)
      return { success: false, error: "Le taux du processeur doit être compris entre 0 et 100 %." };
    if (fixedFee === null || fixedFee < 0 || fixedFee > 10)
      return { success: false, error: "Le frais fixe doit être compris entre 0 et 10 par transaction." };
    await supabase.from("shop_plans").upsert(
      { shop_domain: session.shop, shopify_fee_pct: shopifyFee, processor_fee_pct: procFee, processor_fixed_fee: fixedFee, updated_at: new Date().toISOString() },
      { onConflict: "shop_domain" }
    );
    return { success: true };
  }

  // ── Seuil d'alerte de rentabilité (% global boutique, lu par le cron) ─────
  // On édite un INTRANT du diff d'alerting (computeProfitabilityChanges), jamais une marge :
  // la frontière devient net_margin < (seuil/100)×CA net. Défaut 0 = perte stricte (legacy).
  if (body._action === "set_profitability_threshold") {
    const n = parseFloat(String(body.profitability_threshold_pct ?? "").replace(",", ".").trim());
    if (!Number.isFinite(n) || n < 0 || n > 100)
      return { success: false, error: "Le seuil doit être compris entre 0 et 100 %." };
    await supabase.from("shop_plans").upsert(
      { shop_domain: session.shop, profitability_threshold_pct: n, updated_at: new Date().toISOString() },
      { onConflict: "shop_domain" }
    );
    return { success: true };
  }

  // ── CPA blended ACTUEL déclaré par le marchand (repère prescriptif, pas mesuré) ──
  // Saisi dans la devise BOUTIQUE (le champ l'indique). "" → null explicite (jamais 0) ; date
  // remise à null si effacé. Borne dure > 1000 (garbage) + avertissement non bloquant > 150 (typo).
  if (body._action === "set_current_cpa") {
    const raw = String(body.current_cpa ?? "").replace(",", ".").trim();
    const nowIso = new Date().toISOString();
    if (raw === "") {
      // Effacement : valeur ET date à null (pas de « déclaré le … » orphelin).
      await supabase.from("shop_plans").upsert(
        { shop_domain: session.shop, current_cpa: null, current_cpa_updated_at: null, updated_at: nowIso },
        { onConflict: "shop_domain" });
      return { success: true, cleared: true };
    }
    const n = parseFloat(raw); // "" déjà court-circuité → aucun NaN issu du vide ne traverse
    if (!Number.isFinite(n) || n < 0 || n > 1000)
      return { success: false, error: "Le CPA doit être compris entre 0 et 1000 par commande." };
    await supabase.from("shop_plans").upsert(
      { shop_domain: session.shop, current_cpa: n, current_cpa_updated_at: nowIso, updated_at: nowIso },
      { onConflict: "shop_domain" });
    // Avertissement non bloquant : au-delà du réaliste B2C FR/EU, probable faute de frappe.
    return n > 150
      ? { success: true, warning: "CPA inhabituellement élevé pour du e-commerce B2C — vérifiez la saisie." }
      : { success: true };
  }

  // ── Brique A : pays d'import par défaut de la boutique ────────────────────
  if (body._action === "set_default_country") {
    if (!PAYS_KEYS.includes(body.default_import_country)) return { success: false, error: "Pays d'import invalide." };
    await supabase.from("shop_plans").upsert(
      { shop_domain: session.shop, default_import_country: body.default_import_country, updated_at: new Date().toISOString() },
      { onConflict: "shop_domain" }
    );
    return { success: true };
  }

  // ── Brique A : liste des variantes + coûts (auto-estime et persiste les manquants) ──
  if (body._action === "costs_list") {
    const { data: plan } = await supabase.from("shop_plans")
      .select("vat_regime, shipping_model, default_import_country")
      .eq("shop_domain", session.shop).maybeSingle();
    const defaultCountry = plan?.default_import_country ?? "Chine";
    const vatRegime      = plan?.vat_regime ?? "assujetti";
    const shippingModel  = plan?.shipping_model ?? "dropshipping";

    // Toutes les variantes actives — variants(first:100) couvre la limite Shopify
    // (100 variantes/produit) ; variantsCapped signale un dépassement éventuel.
    const variants = [];
    let cursor = null, hasNext = true, pages = 0, variantsCapped = false;
    const startTime = Date.now();
    while (hasNext && pages < 20) {
      if (Date.now() - startTime > 8000) { console.error("[Costs] time budget exceeded"); break; }
      pages++;
      try {
        const resp = await admin.graphql(
          `query CostVariants($cursor: String) {
            products(first: 50, after: $cursor, query: "status:active") {
              edges { node {
                id title productType
                category { name }
                variants(first: 100) {
                  edges { node { id title price inventoryItem { unitCost { amount } } } }
                  pageInfo { hasNextPage }
                }
              } }
              pageInfo { hasNextPage endCursor }
            }
          }`,
          { variables: { cursor } }
        );
        const json = await resp.json();
        const page = json.data?.products;
        if (!page) break;
        for (const { node } of page.edges) {
          if (node.variants?.pageInfo?.hasNextPage) variantsCapped = true;
          for (const ve of node.variants.edges) {
            const v = ve.node;
            variants.push({
              variant_id: v.id, product_id: node.id,
              product_title: node.title, variant_title: v.title,
              price: parseFloat(v.price ?? "0"),
              unitCost: v.inventoryItem?.unitCost?.amount,
              categoryName: node.category?.name, productType: node.productType,
            });
          }
        }
        hasNext = page.pageInfo.hasNextPage;
        cursor = page.pageInfo.endCursor;
      } catch (e) { console.error("[Costs] variants query:", e?.message); break; }
    }

    const { data: stored } = await supabase.from("variant_costs").select("*").eq("shop_domain", session.shop);
    const storedMap = new Map((stored ?? []).map(r => [r.variant_id, r]));

    // Variantes sans coûts → estimation persistée en source='estimated' (insert-only :
    // ignoreDuplicates ne réécrit jamais une ligne confirmed/imported existante).
    const toInsert = [];
    const costs = variants.map(v => {
      const existing = storedMap.get(v.variant_id);
      const display = { variant_id: v.variant_id, product_id: v.product_id, product_title: v.product_title, variant_title: v.variant_title, price: v.price };
      if (existing) return { ...display, ...existing };
      const est = estimateVariantCost({
        unitCost: v.unitCost, categoryName: v.categoryName, productType: v.productType,
        title: v.product_title, defaultCountry, vatRegime, shippingModel,
      });
      toInsert.push({ shop_domain: session.shop, variant_id: v.variant_id, product_id: v.product_id, ...est, updated_at: new Date().toISOString() });
      return { ...display, ...est };
    });
    if (toInsert.length) {
      await supabase.from("variant_costs").upsert(toInsert, { onConflict: "shop_domain,variant_id", ignoreDuplicates: true });
    }

    return { success: true, costs, defaultCountry, variantsCapped };
  }

  // ── Brique A : enregistrer des coûts édités → source='confirmed' ───────────
  if (body._action === "costs_save") {
    const inputRows = Array.isArray(body.rows) ? body.rows : [];
    if (!inputRows.length) return { success: false, error: "Aucune ligne à enregistrer." };
    const upserts = [], errors = [];
    for (const row of inputRows) {
      if (!row.variant_id) { errors.push({ variant_id: null, messages: ["variant_id manquant"] }); continue; }
      const { value, errors: vErrors } = validateCostRow(row);
      if (vErrors.length) { errors.push({ variant_id: row.variant_id, messages: vErrors }); continue; }
      upserts.push({ shop_domain: session.shop, variant_id: row.variant_id, product_id: row.product_id ?? null, ...value, source: "confirmed", updated_at: new Date().toISOString() });
    }
    if (upserts.length) {
      const { error } = await supabase.from("variant_costs").upsert(upserts, { onConflict: "shop_domain,variant_id" });
      if (error) return { success: false, error: error.message };
    }
    return { success: true, saved: upserts.length, errors };
  }

  // ── Brique A : "Tout confirmer" — estimées → confirmées (choix actif) ─────
  if (body._action === "costs_confirm_all") {
    const { error } = await supabase.from("variant_costs")
      .update({ source: "confirmed", updated_at: new Date().toISOString() })
      .eq("shop_domain", session.shop).eq("source", "estimated");
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  // ── Brique A : import CSV → source='imported', erreurs ligne par ligne ────
  if (body._action === "costs_import_csv") {
    const { rows, errors } = parseCostsCsv(body.csv ?? "");
    const upserts = rows.map(r => ({ shop_domain: session.shop, variant_id: r.variant_id, ...r.value, source: "imported", updated_at: new Date().toISOString() }));
    let saved = 0;
    if (upserts.length) {
      const { error } = await supabase.from("variant_costs").upsert(upserts, { onConflict: "shop_domain,variant_id" });
      if (error) return { success: false, error: error.message };
      saved = upserts.length;
    }
    return { success: true, saved, errors };
  }

  // ── Brique B : backfill commandes 30 j → order_margins (effets de bord isolés) ──
  // engine.js n'est jamais réécrit : le mapping + l'appel computeMargin + l'agrégation
  // vivent dans lib/orderIngest.js (pur). Ici : bulk launch/poll/download/upsert seulement.
  if (body._action === "backfill_orders") {
    // Délègue à syncShopOrders (lib/orderSync.server.js) : MÊME chemin que le cron quotidien.
    // Le bouton fournit l'admin de session online ; le cron, l'admin offline. Comportement
    // strictement identique — extraction littérale, zéro changement de logique (cf. Brique 2).
    return await syncShopOrders({ admin, supabase, shop: session.shop });
  }

  // ── Brique B (re-run) : rétro-remplit margin_breakdown_json des lignes ANTÉRIEURES ──
  // Lit order_margins directement (snapshot figé suffit, aucun appel Shopify), rejoue
  // computeMargin via backfillRowBreakdown (AUTO-VALIDANT au centime), puis UPDATE CIBLÉ
  // de la SEULE colonne margin_breakdown_json — jamais unit_net_margin/line_net_margin.
  // Idempotent : ne sélectionne que les lignes encore null, UPDATE par id (pas d'upsert).
  if (body._action === "backfill_breakdowns") {
    const { data: plan } = await supabase.from("shop_plans")
      .select("shopify_fee_pct, processor_fee_pct, processor_fixed_fee")
      .eq("shop_domain", session.shop).maybeSingle();
    let shopTaxesIncluded = true;
    try {
      const sr = await admin.graphql(`{ shop { taxesIncluded } }`);
      const sj = await sr.json();
      if (typeof sj.data?.shop?.taxesIncluded === "boolean") shopTaxesIncluded = sj.data.shop.taxesIncluded;
    } catch (e) { console.error("[BackfillBreakdown] shop query:", e?.message); }
    const shopSettings = {
      shopTaxesIncluded,
      shopifyFee:        plan?.shopify_fee_pct     ?? 2.0,
      stripeFee:         plan?.processor_fee_pct   ?? 1.5,
      processorFixedFee: plan?.processor_fixed_fee ?? 0.25,
    };

    // Lignes déjà ingérées, sans breakdown (et avec coût → unit_net_margin non null).
    const { data: rows, error: selErr } = await supabase.from("order_margins")
      .select("id, net_unit_revenue, unit_net_margin, order_created_at, cost_source, cost_snapshot_json")
      .eq("shop_domain", session.shop).is("margin_breakdown_json", null);
    if (selErr) return { success: false, error: selErr.message };

    let filled = 0;
    const skips = { no_snapshot: 0, reconcile_mismatch: 0, update_error: 0 };
    for (const row of rows ?? []) {
      const res = backfillRowBreakdown(row, shopSettings);
      if (!res.ok) {
        skips[res.reason] = (skips[res.reason] ?? 0) + 1;
        if (res.reason === "reconcile_mismatch") console.warn(`[BackfillBreakdown] skip ${row.id} : rejoué ${res.replayed} ≠ stocké ${res.stored} (taux/taxesIncluded dérivé)`);
        continue;
      }
      const { error: updErr } = await supabase.from("order_margins")
        .update({ margin_breakdown_json: res.breakdown }).eq("id", row.id);
      if (updErr) { skips.update_error++; console.error(`[BackfillBreakdown] update ${row.id}:`, updErr.message); continue; }
      filled++;
    }
    const skipped = skips.no_snapshot + skips.reconcile_mismatch + skips.update_error;
    return { success: true, scanned: rows?.length ?? 0, filled, skipped, skips };
  }

  // ── Save annotation ────────────────────────────────────────────────────────
  if (body._action === "save_annotation") {
    if (!billingIsExpert) return { success: false, error: "Fonctionnalité réservée au plan Expert." };

    const { calculation_id, note } = body;
    if (!calculation_id || !note?.trim()) return { success: false, error: "Données invalides." };
    if (note.trim().length > 500) return { success: false, error: "Note trop longue (500 caractères max)." };

    // Verify the calculation belongs to this shop (prevent cross-shop data access)
    const { data: calc } = await supabase.from("calculations")
      .select("id")
      .eq("id", calculation_id)
      .eq("shop_domain", session.shop)
      .maybeSingle();
    if (!calc) return { success: false, error: "Calcul introuvable." };

    await supabase.from("calculation_annotations").upsert(
      { shop_domain: session.shop, calculation_id, note: note.trim() },
      { onConflict: "shop_domain,calculation_id" }
    );
    return { success: true };
  }

  // ── Run catalog audit ─────────────────────────────────────────────────────
  if (body._action === "run_audit") {
    if (!billingIsExpert) return { success: false, error: "Fonctionnalité réservée au plan Expert." };

    const auditAllowed = await checkRateLimit(session.shop, "run_audit", 10);
    if (!auditAllowed) return { success: false, error: "Limite atteinte : 10 audits par jour." };

    const clampRate = (v, def) => { const n = parseFloat(v ?? def); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : parseFloat(def); };
    const shopifyFee   = clampRate(body.shopify_fee,   "0.02");
    const returnsRate  = clampRate(body.returns_rate,  "0.05");
    const shippingCost = (() => { const n = parseFloat(body.shipping_cost ?? "8"); return Number.isFinite(n) && n >= 0 && n <= 9999 ? n : 8; })();
    const vatRegime    = ["assujetti", "franchise"].includes(body.vat_regime) ? body.vat_regime : "assujetti";
    const processor    = PAYMENT_PROCESSORS.find(p => p.id === body.payment_processor) ?? PAYMENT_PROCESSORS[0];
    const processorRate     = processor.rate / 100;
    const processorFixedFee = processor.fixedFee;
    // qty_per_shipment: units per inbound supplier shipment.
    // Division by qty is now handled inside computeLandedCost (forced to 1 in dropshipping mode).
    const qty = Math.max(1, parseInt(body.qty_per_shipment, 10) || 1);
    const shippingModel = ["dropshipping", "stock"].includes(body.shipping_model) ? body.shipping_model : "stock";
    const shopTaxesIncluded = body.shop_taxes_included !== false;

    const startTime = Date.now();
    let allProducts = [], cursor = null, hasNextPage = true, pages = 0;
    while (hasNextPage && pages < 10) {
      if (Date.now() - startTime > 7000) {
        console.error("[Audit] Time budget exceeded after", pages, "pages");
        break;
      }
      pages++;
      try {
        const resp = await admin.graphql(
          `query AuditProducts($cursor: String) {
            products(first: 50, after: $cursor, query: "status:active") {
              edges {
                node {
                  id title productType
                  category { name }
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
        allProducts.push(...page.edges.map(e => e.node));
        hasNextPage = page.pageInfo.hasNextPage;
        cursor = page.pageInfo.endCursor;
      } catch (e) {
        console.error("[Audit] GraphQL error:", e?.message);
        break;
      }
    }

    // Catégorisation auto : shopifyTypeToCategory importé de lib/variantCosts.js
    // (source unique, partagée avec la saisie des coûts — plus de copie locale).
    const products = allProducts
      .map(node => {
        const variant = node.variants.edges[0]?.node;
        const price = parseFloat(variant?.price ?? "0");
        const cost = parseFloat(variant?.inventoryItem?.unitCost?.amount ?? "0");
        if (!cost || !price) return null;
        const resolvedCategory  = shopifyTypeToCategory(node.category?.name, node.productType, node.title);
        const mappedCategory    = resolvedCategory ?? "Autre";
        const isDefaultCategory = !resolvedCategory;
        // Même moteur que le dashboard. Les taux audit sont en DÉCIMAL → ×100 pour computeMargin (percents).
        // shipping explicite (flat catalogue) + qty ; ni ads ni frais fixes en audit.
        const m = computeMargin({
          prixAchat: cost, prixVente: price,
          categorie: mappedCategory, shipping: shippingCost,
          shopifyFee: shopifyFee * 100, stripeFee: processorRate * 100, processorFixedFee,
          retours: returnsRate * 100,
          vatRegime, shopTaxesIncluded, shippingModel, qty,
        });
        return { id: node.id, title: node.title, price, cost, coutRendu: m.coutRendu, netMargin: m.margeNette, netPct: m.margeNettePercent, mappedCategory, isDefaultCategory, productType: node.productType ?? "" };
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
    if (!billingIsPro) return { error: "Fonctionnalité réservée aux plans Pro et Expert." };

    const aiAllowed = await checkRateLimit(session.shop, "ai_recommend", 50);
    if (!aiAllowed) return { error: "Limite atteinte : 50 recommandations IA par jour." };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { aiUnavailable: true };

    // Seuls les INTRANTS bruts sont lus depuis body ; tous les chiffres dérivés
    // (douane, coût rendu, marges, frais €…) sont recalculés par computeMargin ci-dessous.
    const { prixAchat, prixVente, category, country, productTitle,
            shopifyFee, stripeFee, paymentProcessor, retours, ads,
            coutEmballage, fraisRetour, processorFixedFee, vatRegime,
            shippingModel } = body;

    const safeTitle     = sanitizeForPrompt(productTitle) || "Non spécifié";
    const safeCategory  = sanitizeForPrompt(category);
    const safeCountry   = sanitizeForPrompt(country);
    const safeProcessor = sanitizeForPrompt(paymentProcessor) || "Stripe";

    // Source unique : le moteur déterministe. L'IA reçoit des chiffres finis et ne
    // recalcule jamais rien. On rejoue ICI computeMargin avec exactement les mêmes
    // intrants que le dashboard (mêmes que computeScenarios) : tous les nombres cités
    // dans le prompt viennent de `m`, plus aucune dérivation inline.
    const engineInput = {
      prixAchat:         parseFloat(prixAchat)         || 0,
      prixVente:         parseFloat(prixVente)          || 0,
      categorie:         category  || "Autre",
      paysImport:        country   || "Autre",
      shopifyFee:        parseFloat(shopifyFee)         || 0,
      stripeFee:         parseFloat(stripeFee)          || 0,
      processorFixedFee: parseFloat(processorFixedFee)  || 0,
      retours:           parseFloat(retours)            || 0,
      ads:               parseFloat(ads)                || 0,
      fraisRetour:       parseFloat(fraisRetour)        || 0,
      coutEmballage:     parseFloat(coutEmballage)      || 0,
      vatRegime:         vatRegime || "assujetti",
      shopTaxesIncluded: body.shopTaxesIncluded !== false,
      shippingModel:     ["dropshipping", "stock"].includes(body.shippingModel) ? body.shippingModel : "stock",
    };
    const m = computeMargin(engineInput);
    const { current: scenCurrent, scenarios: scenList } = computeScenarios(engineInput);

    const scenariosBlock = scenList.map((s, i) =>
      s.prixCible !== undefined
        ? `S${i+1}. ${s.levier}\n   → Marge nette : 0,00 € / 0,0 % | Rentable : NON | Prix cible : ${formatEur(s.prixCible)}`
        : `S${i+1}. ${s.levier}\n   → Marge nette : ${formatEur(s.margeNette)} / ${formatPct(s.margeNettePercent)} % | Rentable : ${s.rentable ? 'OUI' : 'NON'}`
    ).join('\n\n');

    const prompt = `Tu es un expert en e-commerce et rentabilité.

DÉFINITIONS CANONIQUES (emploie-les strictement) :
• Marge apparente = (Prix vente − Prix fournisseur) / Prix vente
• Marge brute = (Prix vente − Coût rendu total) / Prix vente — exclut Shopify, Stripe, emballage, retours, ads
• Marge nette = (Prix vente − Coût rendu − TOUS frais vente − Frais fixes) / Prix vente

DONNÉES DU CALCUL :
- Produit : ${safeTitle} | Catégorie : ${safeCategory} | Import : ${safeCountry}
- Régime TVA : ${vatRegime === "franchise" ? "Franchise en base (TVA import = coût sec)" : "Assujetti (TVA import récupérable, neutralisée)"}
- Prix fournisseur : ${formatEur(prixAchat)} | Prix de vente : ${formatEur(prixVente)}
- Douane : ${formatEur(m.douane)}${(() => {
      const sm = shippingModel ?? "stock";
      const pa = parseFloat(prixAchat);
      if (sm === "dropshipping") {
        if (pa > LOW_VALUE_PARCEL_CEILING) return " (haute valeur — tarif % plein)";
        return new Date() < EU_DROPSHIP_DUTY_REFORM_DATE
          ? " (faible valeur — exonéré jusqu'au 30/06/2026)"
          : " (faible valeur — forfait 3€ post-01/07/2026)";
      }
      return ""; // stock : tarif % standard, aucune note particulière
    })()} | TVA import : ${formatEur(m.tvaImport)}${vatRegime !== "franchise" ? " (récupérable)" : ""} | Port : ${formatEur(m.shipping)} | Coût rendu net : ${formatEur(m.coutRendu)}
- ${safeProcessor} : ${stripeFee} %+${formatEur(processorFixedFee)} → ${formatEur(m.stripeCost)} | Shopify : ${shopifyFee} % → ${formatEur(m.shopifyCost)} | Retours : ${retours} % → ${formatEur(m.retoursCost)} | Ads : ${ads} % → ${formatEur(m.adsCost)}
- Emballage : ${formatEur(coutEmballage)} | Frais retour : ${formatEur(fraisRetour)}
- ${buildMargeLine(m)}

ÉTAT ACTUEL : Marge nette = ${formatEur(scenCurrent.margeNette)} / ${formatPct(scenCurrent.margeNettePercent)} % | Rentable : ${scenCurrent.rentable ? 'OUI' : 'NON'}

SCÉNARIOS PRÉ-CALCULÉS PAR LE MOTEUR (chiffres définitifs) :
${scenariosBlock}

INSTRUCTION STRICTE : Tu ne dois effectuer AUCUN calcul arithmétique. Tous les chiffres (€, %) que tu cites doivent être copiés exactement depuis les données ou scénarios fournis ci-dessus. Si un chiffre n'est pas fourni, tu ne le cites pas. Ne projette jamais une marge que tu calcules toi-même. Les composants (prix fournisseur, prix de vente, coût rendu, frais) sont fournis pour le CONTEXTE uniquement : tu n'as pas le droit de les soustraire, additionner ou combiner pour en dériver une marge, un montant ou un pourcentage — la marge brute, la marge nette et tous leurs montants sont déjà donnés, cite-les tels quels.

Sélectionne les 3 scénarios les plus pertinents, ordonnés par marge nette résultante décroissante. Pour chaque action, cite sa marge nette exacte et précise Rentable=OUI/NON. Si marge actuelle ≤ 0 et qu'aucun scénario seul ne la rend positive, recommande la combinaison listée.

Réponds UNIQUEMENT avec ce JSON (sans markdown) :
{"analyse":"2 phrases max sur les 2 postes dominants — cite leurs montants exacts depuis les données","actions":["levier → marge nette X€ (Y%) | Rentable=Z — contexte métier concis","...","..."]}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);

    try {
      let resp;
      try {
        resp = await fetch("https://api.anthropic.com/v1/messages", {
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
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        // Credit exhaustion (402) must be tracked — owner needs to know before it silently breaks for all users
        if (resp.status === 402 || errText.toLowerCase().includes("credit") || errText.toLowerCase().includes("billing")) {
          captureException(new Error(`[AI] Crédits Anthropic épuisés — HTTP ${resp.status}: ${errText.slice(0, 300)}`));
        } else {
          console.error("[AI] Anthropic error:", resp.status, errText.slice(0, 200));
        }
        return { aiUnavailable: true };
      }
      const aiData = await resp.json();
      const text = aiData.content?.[0]?.text ?? "";
      const parsed = JSON.parse(text);
      return { analyse: parsed.analyse, actions: parsed.actions };
    } catch (e) {
      if (e?.name === "AbortError") {
        console.error("[AI] Timeout — pas de réponse Anthropic après 18s");
      } else {
        console.error("[AI] Failed:", e?.message);
      }
      return { aiUnavailable: true };
    }
  }

  // ── Save calculation ───────────────────────────────────────────────────────
  // Server-side numeric validation — reject malformed or out-of-range values
  const purchasePrice = parseFloat(body.purchase_price);
  const sellingPrice  = parseFloat(body.selling_price);
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0 || purchasePrice > 999999) {
    return { success: false, error: "Prix d'achat invalide." };
  }
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0 || sellingPrice > 999999) {
    return { success: false, error: "Prix de vente invalide." };
  }
  const shopifyFeeV   = parseFloat(body.shopify_fee);
  const stripeFeeV    = parseFloat(body.stripe_fee);
  const returnsRateV  = parseFloat(body.returns_rate);
  const adsRateV      = parseFloat(body.ads_rate);
  const customsRateV  = parseFloat(body.customs_rate);
  const shippingCostV = parseFloat(body.shipping_cost);
  if ([shopifyFeeV, stripeFeeV, returnsRateV, adsRateV, customsRateV].some(
    v => !Number.isFinite(v) || v < 0 || v > 100
  )) {
    return { success: false, error: "Taux invalide (0–100)." };
  }
  if (!Number.isFinite(shippingCostV) || shippingCostV < 0 || shippingCostV > 9999) {
    return { success: false, error: "Frais de port invalides." };
  }
  if (body.product_title && String(body.product_title).length > 255) {
    return { success: false, error: "Titre produit trop long." };
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  if (!billingIsPro) {
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

  const netMarginPct = parseFloat(body.net_margin_percent);
  const netMarginEur = parseFloat(body.net_margin_euros);
  const coutRendu    = parseFloat(body.cout_rendu);
  const margeBrute   = parseFloat(body.marge_brute_percent);

  const { error } = await supabase.from("calculations").insert({
    shop_domain:         session.shop,
    product_id:          body.product_id ? String(body.product_id).slice(0, 255) : null,
    product_title:       body.product_title ? String(body.product_title).slice(0, 255) : null,
    purchase_price:      purchasePrice,
    selling_price:       sellingPrice,
    category:            body.category ? String(body.category).slice(0, 100) : null,
    country:             body.country ? String(body.country).slice(0, 100) : null,
    net_margin_percent:  Number.isFinite(netMarginPct) ? netMarginPct : null,
    net_margin_euros:    Number.isFinite(netMarginEur) ? netMarginEur : null,
    shopify_fee:         shopifyFeeV,
    stripe_fee:          stripeFeeV,
    returns_rate:        returnsRateV,
    ads_rate:            adsRateV,
    shipping_cost:       shippingCostV,
    customs_rate:        customsRateV,
    cout_rendu:          Number.isFinite(coutRendu) ? coutRendu : null,
    marge_brute_percent: Number.isFinite(margeBrute) ? margeBrute : null,
  });

  if (error) {
    console.error("[Supabase] Insert error:", error.message);
    captureException(new Error(`[Supabase] Insert failed: ${error.message}`));
    return { success: false, error: "Erreur lors de la sauvegarde du calcul." };
  }
  return { success: true };
};

// ── UI Monitor : courbe bi-série CA net vs marge nette par jour (SVG inline) ──
// Lecture seule : trace byDay (sorties de aggregateOrderMargins), aucune marge recalculée.
function DualLineChart({ byDay, fmt }) {
  if (!byDay || byDay.length === 0) return null;
  const W = 640, H = 150, PAD = 28;
  const revs = byDay.map(d => d.net_revenue);
  const mgs  = byDay.map(d => d.net_margin);
  const vals = [...revs, ...mgs, 0];
  const minY = Math.min(...vals), maxY = Math.max(...vals);
  const rangeY = (maxY - minY) || 1;
  const toX = (i) => byDay.length === 1 ? W / 2 : PAD + (i / (byDay.length - 1)) * (W - PAD * 2);
  const toY = (v) => PAD + (1 - (v - minY) / rangeY) * (H - PAD * 2);
  const poly = (arr) => arr.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const zeroY = toY(0).toFixed(1);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "150px", display: "block" }}>
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#E4E5E7" strokeWidth="0.8" strokeDasharray="3,3" />
        {byDay.length >= 2 && <polyline points={poly(revs)} fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinejoin="round" />}
        {byDay.length >= 2 && <polyline points={poly(mgs)} fill="none" stroke="#008060" strokeWidth="2" strokeLinejoin="round" />}
        {byDay.map((d, i) => <circle key={"r" + i} cx={toX(i)} cy={toY(d.net_revenue)} r="3" fill="#7C3AED" />)}
        {byDay.map((d, i) => <circle key={"m" + i} cx={toX(i)} cy={toY(d.net_margin)} r="3" fill={d.net_margin < 0 ? "#D72C0D" : "#008060"} />)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
        <span style={{ fontSize: "10px", color: "#6D7175" }}>{byDay[0].day}</span>
        <span style={{ fontSize: "10px", color: "#6D7175" }}>{byDay[byDay.length - 1].day}</span>
      </div>
      <div style={{ display: "flex", gap: "16px", marginTop: "6px", fontSize: "11px" }}>
        <span style={{ color: "#7C3AED" }}>● CA net / jour</span>
        <span style={{ color: "#008060" }}>● Marge nette / jour</span>
      </div>
      {/* F9 : < 2 points → jamais une courbe qui semble cassée. Point unique intentionnel + message explicite. */}
      {byDay.length < 2 && (
        <div style={{ marginTop: "6px", fontSize: "11px", color: "#6D7175", fontStyle: "italic" }}>
          Une seule journée de données — la tendance apparaîtra avec plus de commandes.
        </div>
      )}
    </div>
  );
}

// ── Dépli auditable d'UNE ligne de commande — LECTURE PURE (option C) ─────────
// N'affiche QUE des valeurs STOCKÉES (lb = lineBreakdown). Deux identités d'agrégation
// réconcilient au centime ; les intrants figés (snapshot) sont du CONTEXTE, jamais sommés.
// Les postes douane/TVA import/frais Shopify/Stripe ne sont PAS stockés → non détaillés
// ici (les détailler exigerait de rejouer le moteur = BUG 1). On le DIT, on ne masque pas.
const REGIME_LABEL = { assujetti: "TVA assujetti", franchise: "TVA franchise" };
const MODEL_LABEL  = { dropshipping: "Dropshipping", stock: "Stock" };
// Waterfall (Brique B) : libellés des postes NIVEAU 1 (somment vers unit_net_margin).
const WF_DED_LABEL = {
  coutRendu:   "Coût rendu (CIF)",
  shopifyCost: "Frais Shopify",
  stripeCost:  "Frais Stripe",
  retoursCost: "Retours",
  fraisFixes:  "Frais fixes (emballage)",
};
function LineBreakdownCard({ lb }) {
  const m = (n) => formatMoney(n, lb.currency);
  const sub = lb.snapshot;
  const refunded = lb.refunded_qty > 0;
  const lblRow = { display: "flex", justifyContent: "space-between", gap: "12px", padding: "3px 0", fontSize: "12px" };
  const lbl = { color: "#6D7175" };
  const val = { color: "#202223", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const date = lb.order_created_at ? String(lb.order_created_at).slice(0, 10) : "—";
  const pill = SOURCE_PILL[lb.cost_source] ?? { label: lb.cost_source ?? "—", color: "#6D7175", bg: "#F1F2F4" };
  // Waterfall poste-par-poste : seulement si le breakdown est figé (lignes Brique B).
  const wf = lb.has_breakdown ? waterfallFromBreakdown(lb.breakdown, lb.snapshot) : null;
  return (
    <div style={{ padding: "12px 14px", borderRadius: "8px", border: "1px solid #E4E5E7", background: "#FAFAFB", marginBottom: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span style={{ fontSize: "11px", fontWeight: "600", color: "#202223" }}>Commande {lb.order_id ? lb.order_id.split("/").pop() : "—"}</span>
        <span style={{ fontSize: "11px", color: "#6D7175" }}>{date}</span>
        <span style={{ padding: "1px 7px", borderRadius: "9px", fontSize: "10px", fontWeight: "700", color: pill.color, background: pill.bg }}>{pill.label}</span>
      </div>

      {/* Identité MARGE — cible stockée = line_net_margin (réplique de l'agrégation D3/D4) */}
      <div style={{ marginBottom: "10px" }}>
        <div style={{ fontSize: "10px", fontWeight: "700", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: "2px" }}>Marge nette de ligne</div>
        <div style={lblRow}><span style={lbl}>Marge nette unitaire</span><span style={val}>{m(lb.unit_net_margin)}</span></div>
        <div style={lblRow}>
          <span style={lbl}>× Quantité effective{refunded ? ` (${lb.quantity} − ${lb.refunded_qty} remboursée${lb.refunded_qty > 1 ? "s" : ""})` : ""}</span>
          <span style={val}>{lb.effective_qty}</span>
        </div>
        <div style={lblRow}><span style={lbl}>− Fixe processeur (proraté commande)</span><span style={val}>−{m(lb.allocated_fixed_fee)}</span></div>
        <div style={{ ...lblRow, borderTop: "1px solid #E4E5E7", marginTop: "2px", paddingTop: "5px", fontWeight: "700" }}>
          <span style={{ color: "#202223" }}>= Marge nette de ligne</span>
          <span style={{ ...val, color: lb.line_net_margin < 0 ? "#D72C0D" : "#008060" }}>{m(lb.line_net_margin)}</span>
        </div>
      </div>

      {/* Identité REVENU — cible stockée = line_net_revenue */}
      <div style={{ marginBottom: refunded ? "6px" : "0" }}>
        <div style={{ fontSize: "10px", fontWeight: "700", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: "2px" }}>CA net de ligne</div>
        {/* « (TTC) » seulement si l'encaissé est réellement TTC (assujetti+TTC = revenue_is_ht).
            Franchise / sans TVA / pré-B (wf null) → neutre (on ne devine pas le régime). */}
        <div style={lblRow}><span style={lbl}>Prix de vente net unitaire{wf?.revenue_is_ht ? " (TTC)" : ""}</span><span style={val}>{m(lb.net_unit_revenue)}</span></div>
        <div style={lblRow}><span style={lbl}>× Quantité effective</span><span style={val}>{lb.effective_qty}</span></div>
        <div style={{ ...lblRow, borderTop: "1px solid #E4E5E7", marginTop: "2px", paddingTop: "5px", fontWeight: "600" }}>
          <span style={{ color: "#202223" }}>= CA net de ligne</span><span style={val}>{m(lb.line_net_revenue)}</span>
        </div>
      </div>

      {/* Waterfall poste-par-poste SOUS unit_net_margin (Brique B) — LECTURE PURE du JSON.
          Niveau 1 (somme) ; douane/TVA = sous-détail de coutRendu ; total ANCRÉ sur la
          valeur unit_net_margin STOCKÉE (jamais une somme client → zéro dérive). W1/W2/W3. */}
      {wf && (
        <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px dashed #E4E5E7" }}>
          <div style={{ fontSize: "10px", fontWeight: "700", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: "2px" }}>Décomposition de la marge nette unitaire</div>
          <div style={lblRow}><span style={lbl}>{wf.revenue_is_ht ? "Prix de vente net (HT)" : "Prix de vente net"}</span><span style={val}>{m(wf.revenu)}</span></div>
          {wf.deductions.map((d) => (
            <div key={d.key}>
              <div style={lblRow}><span style={lbl}>− {WF_DED_LABEL[d.key] ?? d.key}</span><span style={val}>−{m(d.amount)}</span></div>
              {d.key === "coutRendu" && wf.cost_detail.map((cd) => (
                <div key={cd.key} style={{ ...lblRow, paddingLeft: "14px", fontSize: "11px" }}>
                  <span style={{ color: "#8C9196" }}>
                    {cd.key === "douane" ? `dont douane${cd.rate ? ` (${formatPct(cd.rate * 100)} %)` : ""}` : `dont TVA import (non récupérable${cd.rate ? `, ${formatPct(cd.rate * 100)} %` : ""})`}
                  </span>
                  <span style={{ ...val, color: "#8C9196" }}>{m(cd.amount)}</span>
                </div>
              ))}
            </div>
          ))}
          {/* W1 : TVA import avancée puis récupérée (assujetti) — JAMAIS sommée, jamais "non récupérable". */}
          {wf.tva_advanced && (
            <div style={{ ...lblRow, fontSize: "11px" }}>
              <span style={{ color: "#8C9196" }}>TVA import — avancée puis récupérée, non déduite de la marge</span>
              <span style={{ ...val, color: "#8C9196" }}>{m(wf.tva_advanced.amount)}</span>
            </div>
          )}
          <div style={{ ...lblRow, borderTop: "1px solid #E4E5E7", marginTop: "2px", paddingTop: "5px", fontWeight: "700" }}>
            <span style={{ color: "#202223" }}>= Marge nette unitaire</span>
            <span style={{ ...val, color: lb.unit_net_margin < 0 ? "#D72C0D" : "#008060" }}>{m(lb.unit_net_margin)}</span>
          </div>
          {/* Note TVA collectée (gate W3) — note-only, aucun montant. Absente si non assujetti+TTC. */}
          {wf.collected_vat_note && (
            <div style={{ marginTop: "8px", padding: "8px 10px", borderRadius: "6px", background: "#F6F3FF", fontSize: "11px", color: "#202223", lineHeight: "1.5" }}>
              Prix TTC : inclut la TVA collectée, reversée et hors marge. La marge est calculée sur le HT.
            </div>
          )}
        </div>
      )}

      {/* Contexte : intrants figés (coûts SAISIS), jamais sommés — pas une décomposition */}
      {sub && (
        <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px dashed #E4E5E7" }}>
          <div style={{ fontSize: "10px", fontWeight: "700", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: "4px" }}>Intrants figés à l'ingestion (coûts saisis)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: "11px", color: "#6D7175" }}>
            <span>Prix d'achat&nbsp;<strong style={{ color: "#202223" }}>{m(sub.prix_achat)}</strong>{sub.qty_par_lot > 1 ? ` / lot de ${sub.qty_par_lot}` : ""}</span>
            <span>Port entrant&nbsp;<strong style={{ color: "#202223" }}>{m(sub.port_entrant)}</strong></span>
            <span>Emballage&nbsp;<strong style={{ color: "#202223" }}>{m(sub.cout_emballage)}</strong></span>
            {sub.categorie && <span>Catégorie&nbsp;<strong style={{ color: "#202223" }}>{sub.categorie}</strong></span>}
            {sub.pays_import && <span>Import&nbsp;<strong style={{ color: "#202223" }}>{sub.pays_import}</strong></span>}
            {sub.vat_regime && <span><strong style={{ color: "#202223" }}>{REGIME_LABEL[sub.vat_regime] ?? sub.vat_regime}</strong></span>}
            {sub.shipping_model && <span><strong style={{ color: "#202223" }}>{MODEL_LABEL[sub.shipping_model] ?? sub.shipping_model}</strong></span>}
          </div>
        </div>
      )}

      {/* F1/W4 : lignes pré-B (pas de breakdown figé). Sur les lignes B, le waterfall ci-dessus
          REMPLACE cette note (sinon elle le contredirait) → conditionnée à !has_breakdown. */}
      {!lb.has_breakdown && (
        <>
          <div style={{ marginTop: "8px", fontSize: "10px", color: "#8C9196", fontStyle: "italic", lineHeight: "1.5" }}>
            Douane, TVA import et frais Shopify/Stripe sont intégrés dans la marge nette unitaire et ne sont pas stockés séparément — non détaillés ici (lecture pure, aucun recalcul).
          </div>
          <div style={{ marginTop: "4px", fontSize: "10px", color: "#8C9196", lineHeight: "1.5" }}>
            Détail poste-par-poste indisponible sur les commandes antérieures à cette version.
          </div>
        </>
      )}
    </div>
  );
}

// ── UI Monitor : sous-bloc repliable (collapsed par défaut) — lecture seule ──
function MarginMonitor({ orderMargins, orderMarginsTotal, orderMarginsCapped, orderMarginsCap, productTitleById, cpaTargets, cpaByProduct, currentCpaUpdatedAt, thresholdPct, onGoToCosts }) {
  const [open, setOpen] = useState(false);
  const [sortBy, setSortBy] = useState("margin"); // margin | revenue
  const [openLines, setOpenLines] = useState(() => new Set()); // product_ids dépliés
  const agg = useMemo(() => aggregateOrderMargins(orderMargins ?? []), [orderMargins]);

  const cur0 = agg.currencies[0]; // devise unique (totaux affichés seulement si mono-devise)
  const fmt = (n) => n == null ? "—" : formatMoney(n, cur0);
  const title = (pid) => pid ? (productTitleById[pid] ?? `Produit ${pid.split("/").pop()}`) : "Produit supprimé";
  const products = [...agg.byProduct].sort((a, b) =>
    sortBy === "revenue" ? b.net_revenue - a.net_revenue : a.net_margin - b.net_margin);

  const th = { padding: "7px 8px", fontSize: "10px", fontWeight: "700", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.4px", textAlign: "left", whiteSpace: "nowrap" };
  const td = { padding: "7px 8px", fontSize: "12px", color: "#202223" };

  return (
    <div style={{ borderRadius: "8px", border: "1px solid #E4E5E7", marginBottom: "16px", overflow: "hidden" }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", background: "#FAFAFB", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
        <span style={{ fontSize: "12px", color: "#6D7175", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
        <span style={{ fontSize: "13px", fontWeight: "600", color: "#202223" }}>Historique de marge réelle</span>
        {agg.unprofitableCount > 0 && <span style={{ padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: "700", color: "#fff", background: "#D72C0D" }}>{agg.unprofitableCount} à perte</span>}
        {agg.missingCount > 0 && <span style={{ padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: "700", color: "#B98900", background: "#FFF9EC" }}>{agg.missingCount} coûts manquants</span>}
      </button>

      {open && (
        <div style={{ padding: "14px" }}>
          {orderMarginsCapped && (
            <div style={{ padding: "10px 14px", borderRadius: "8px", background: "#FFF9EC", border: "1px solid #B9890033", fontSize: "12px", color: "#B98900", marginBottom: "12px" }}>
              Affichage limité aux <strong>{orderMarginsCap}</strong> lignes les plus récentes sur <strong>{orderMarginsTotal}</strong> au total — les agrégats et la courbe ci-dessous <strong>ne couvrent pas toute la fenêtre</strong>.
            </div>
          )}

          {(orderMargins?.length ?? 0) === 0 ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#6D7175", fontSize: "13px" }}>Aucune commande synchronisée. Cliquez « Synchroniser les commandes » ci-dessus.</div>
          ) : (
            <>
              {/* CTA complétude (F3/F4) — EN VARIANTES, dénominateur = variantes avec commandes.
                  Ne promet un gain QUE pour ce qui est dans le monitor (pas le catalogue entier). */}
              {agg.costCompletion.needing > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", padding: "10px 14px", borderRadius: "8px", background: "#F6F3FF", border: "1px solid #7C3AED33", fontSize: "12px", color: "#202223", marginBottom: "12px" }}>
                  <strong style={{ color: "#7C3AED" }}>{agg.costCompletion.needing} sur {agg.costCompletion.total}</strong>
                  variante(s) suivie(s) tournent sur un coût estimé ou manquant — confirme-les pour une marge exacte.
                  <button onClick={onGoToCosts} style={{ background: "none", border: "none", color: "#7C3AED", cursor: "pointer", fontSize: "12px", fontWeight: "600", padding: 0, fontFamily: "inherit", textDecoration: "underline" }}>Confirmer les coûts ↑</button>
                </div>
              )}

              {agg.multiCurrency && (
                <div style={{ padding: "10px 14px", borderRadius: "8px", background: "#FFF4F4", border: "1px solid #D72C0D33", fontSize: "12px", color: "#202223", marginBottom: "12px" }}>
                  Plusieurs devises sur la fenêtre ({agg.currencies.join(", ")}) — totaux globaux et courbe désactivés (jamais de somme cross-devise). Voir le détail par produit, chacun dans sa devise.
                </div>
              )}

              {/* Agrégats globaux + courbe : uniquement si mono-devise (sinon somme à l'aveugle interdite) */}
              {!agg.multiCurrency && agg.validCount > 0 && (
                <>
                  <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "14px" }}>
                    <div><div style={{ fontSize: "11px", color: "#6D7175" }}>CA net ({agg.currencies[0] ?? ""})</div><div style={{ fontSize: "18px", fontWeight: "700", color: "#202223" }}>{fmt(agg.totals.net_revenue)}</div></div>
                    <div><div style={{ fontSize: "11px", color: "#6D7175" }}>Marge nette réelle</div><div style={{ fontSize: "18px", fontWeight: "700", color: agg.totals.net_margin < 0 ? "#D72C0D" : "#008060" }}>{fmt(agg.totals.net_margin)}</div></div>
                    <div><div style={{ fontSize: "11px", color: "#6D7175" }}>Commandes</div><div style={{ fontSize: "18px", fontWeight: "700", color: "#202223" }}>{agg.totals.orders}</div></div>
                  </div>
                  <DualLineChart byDay={agg.byDay} fmt={fmt} />
                </>
              )}

              {/* CPA prescriptif — signaux INCONDITIONNELS (indépendants du tri) + plafond blended.
                  Tout vient de cpaTargets (serveur) ; le JSX ne fait que rendre (BUG 1). */}
              {cpaTargets?.noAcqCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderRadius: "8px", background: "#FFF4F4", border: "1px solid #D72C0D33", fontSize: "12px", color: "#202223", marginBottom: "8px" }}>
                  <span style={{ padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: "700", color: "#fff", background: "#D72C0D" }}>{cpaTargets.noAcqCount}</span>
                  produit(s) ne peuvent financer aucune acquisition payante sans vendre à perte — repérez-les dans la colonne « Marge dispo/unité ».
                </div>
              )}
              {cpaTargets?.valueDestroyedCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderRadius: "8px", background: "#FFF9EC", border: "1px solid #B9890033", fontSize: "12px", color: "#202223", marginBottom: "8px" }}>
                  <span style={{ padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: "700", color: "#fff", background: "#B98900" }}>{cpaTargets.valueDestroyedCount}</span>
                  produit(s) entièrement remboursés à perte sur la fenêtre — voir la colonne « Marge dispo/unité ».
                </div>
              )}
              {cpaTargets?.blended && (
                <div style={{ padding: "12px 14px", borderRadius: "8px", background: "#F9FAFB", border: "1px solid #E4E5E7", marginBottom: "8px" }}>
                  <div style={{ fontSize: "11px", color: "#6D7175" }}>CPA max (blended)</div>
                  <div style={{ fontSize: "18px", fontWeight: "700", color: "#202223" }}>{formatMoney(cpaTargets.blended.cpaMax, cpaTargets.blended.currency)}</div>
                  {cpaTargets.ecart == null ? (
                    <div style={{ fontSize: "12px", color: "#6D7175", marginTop: "6px" }}>Renseignez votre CPA actuel (dans les réglages plus haut) pour situer votre marge de manœuvre.</div>
                  ) : cpaTargets.ecart.stale ? (
                    <div style={{ fontSize: "12px", color: "#8C9196", marginTop: "6px", fontStyle: "italic" }}>Écart non affiché : votre CPA déclaré date de plus de 30 jours. Remettez-le à jour pour une comparaison utile.</div>
                  ) : (
                    <div style={{ fontSize: "13px", fontWeight: cpaTargets.ecart.overspend ? "600" : "400", color: cpaTargets.ecart.overspend ? "#D72C0D" : "#008060", marginTop: "6px", padding: cpaTargets.ecart.overspend ? "8px 10px" : "0", background: cpaTargets.ecart.overspend ? "#FFF4F4" : "transparent", borderRadius: "6px" }}>
                      {cpaTargets.ecart.overspend ? "⚠ " : ""}{cpaTargets.ecart.gapLabel} : {formatMoney(cpaTargets.ecart.gapAmount, cpaTargets.blended.currency)}{cpaTargets.ecart.overspend ? " — vous dépensez au-dessus de votre plafond (vente à perte sur l'acquisition)." : ""}
                    </div>
                  )}
                  {currentCpaUpdatedAt && (
                    <div style={{ fontSize: "11px", color: "#6D7175", marginTop: "4px" }}>CPA déclaré le {new Date(currentCpaUpdatedAt).toLocaleDateString("fr-FR")} — valeur que vous avez saisie, comparée à une marge mesurée. Un repère, à réactualiser quand vos campagnes changent.</div>
                  )}
                  <div style={{ fontSize: "11px", color: "#6D7175", marginTop: "8px", lineHeight: "1.5" }}>Moyenne sur tout votre catalogue : un mix de marges très différentes rend ce plafond trompeur si vous concentrez vos pubs sur un produit. <strong>Descendez au produit (colonne « Marge dispo/unité ») pour enchérir juste.</strong></div>
                </div>
              )}

              {/* Liste par produit */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 8px" }}>
                <span style={{ fontSize: "12px", fontWeight: "600", color: "#202223" }}>Par produit</span>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: "4px 7px", border: "1px solid #C9CCCF", borderRadius: "5px", fontSize: "11px", fontFamily: "inherit" }}>
                  <option value="margin">Trier par marge ↑</option>
                  <option value="revenue">Trier par CA net ↓</option>
                </select>
              </div>
              <div style={{ overflowX: "auto", border: "1px solid #E4E5E7", borderRadius: "8px" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "480px" }}>
                  <thead><tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E4E5E7" }}>
                    <th style={th}>Produit</th><th style={th}>Cmd</th><th style={th}>Qté</th><th style={th}>CA net</th><th style={th}>Marge nette</th><th style={th}>% marge</th><th style={th}>Marge dispo/unité</th><th style={th}>État</th>
                  </tr></thead>
                  <tbody>
                    {products.map(p => {
                      const pkey = p.product_id ?? "__unknown__";
                      const expanded = openLines.has(pkey);
                      return (
                      <Fragment key={pkey}>
                      <tr style={{ borderBottom: "1px solid #F1F2F4", background: p.unprofitable ? "#FFF4F4" : "transparent", cursor: "pointer" }}
                          onClick={() => setOpenLines(s => { const n = new Set(s); n.has(pkey) ? n.delete(pkey) : n.add(pkey); return n; })}>
                        <td style={{ ...td, maxWidth: "200px" }}>
                          <span style={{ display: "inline-block", width: "12px", fontSize: "10px", color: "#6D7175", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
                          {title(p.product_id)}
                        </td>
                        <td style={td}>{p.orders}</td>
                        <td style={td}>{p.effective_qty}</td>
                        <td style={td}>{formatMoney(p.net_revenue, p.currency)}</td>
                        <td style={{ ...td, fontWeight: "600", color: p.net_margin < 0 ? "#D72C0D" : "#008060" }}>{formatMoney(p.net_margin, p.currency)}</td>
                        <td style={td}>{p.marginPct == null ? "—" : `${formatPct(p.marginPct)} %`}</td>
                        {/* Marge dispo/unité — switch PUR sur cpaByProduct[pkey].state (serveur). Zéro calcul. */}
                        <td style={td}>
                          {(() => {
                            const c = cpaByProduct?.[pkey];
                            if (!c) return <span style={{ color: "#6D7175" }}>—</span>;
                            if (c.state === "value_destroyed") return (
                              <span title="Toutes les unités vendues ont été remboursées et l'opération laisse une perte (frais/retours) — aucune marge par unité à calculer."
                                    style={{ padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: "700", color: "#fff", background: "#B98900" }}>Remboursé — perte</span>
                            );
                            if (c.state === "no_acquisition") return (
                              <span title={`La marge disponible par unité est ≤ 0 : la moindre dépense d'acquisition sur ce produit le fait vendre à perte, compte tenu de votre seuil de rentabilité (${thresholdPct} %).`}
                                    style={{ padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: "700", color: "#fff", background: "#D72C0D" }}>Acquisition impossible</span>
                            );
                            if (c.state === "ok") return formatMoney(c.margeDispoUnite, p.currency);
                            return <span title={c.state === "mixed_currency" ? "Produit vendu en plusieurs devises — pas de montant unique possible (aucune somme cross-devise)." : "Toutes les unités ont été remboursées (opération neutre) — pas de marge par unité à calculer."} style={{ color: "#6D7175" }}>—</span>;
                          })()}
                        </td>
                        <td style={td}>
                          <span style={{ padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: "700",
                            color: p.unprofitable ? "#D72C0D" : "#008060", background: p.unprofitable ? "#FFF4F4" : "#F1F8F5" }}>
                            {p.unprofitable ? "À perte" : "Rentable"}
                          </span>
                        </td>
                      </tr>
                      {expanded && (
                        <tr style={{ background: "#FFFFFF" }}>
                          <td colSpan={8} style={{ padding: "10px 14px" }}>
                            <div style={{ fontSize: "11px", color: "#6D7175", marginBottom: "8px" }}>
                              Détail par ligne de commande — chaque ligne affiche son propre snapshot figé (lecture pure, valeurs stockées).
                            </div>
                            {p.lines.map(lb => <LineBreakdownCard key={`${lb.order_id}-${lb.line_item_id}`} lb={lb} />)}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Coûts manquants — à part, jamais dans les sommes */}
              {agg.missingCount > 0 && (
                <div style={{ marginTop: "12px", padding: "12px 14px", borderRadius: "8px", background: "#FFF9EC", border: "1px solid #B9890033", fontSize: "12px", color: "#202223" }}>
                  <strong style={{ color: "#B98900" }}>{agg.missingCount} ligne(s) à coûts manquants</strong> — exclues des agrégats et de la courbe (aucune marge inventée).{" "}
                  <button onClick={onGoToCosts} style={{ background: "none", border: "none", color: "#7C3AED", cursor: "pointer", fontSize: "12px", fontWeight: "600", padding: 0, fontFamily: "inherit", textDecoration: "underline" }}>Renseigner les coûts ↑</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Brique A : Suivi des coûts (saisie par variante) ──────────────────────────
const SOURCE_PILL = {
  estimated: { label: "Estimé",   color: "#6D7175", bg: "#F1F2F4" },
  confirmed: { label: "Confirmé", color: "#008060", bg: "#F1F8F5" },
  imported:  { label: "Importé",  color: "#2C6ECB", bg: "#EEF4FF" },
};

function CostTracker({ defaultImportCountry, fees, feesCurrency, profitabilityThresholdPct, currentCpa, currentCpaUpdatedAt, cpaTargets, cpaByProduct, orderMargins, orderMarginsTotal, orderMarginsCapped, orderMarginsCap, productTitleById }) {
  const listFetcher    = useFetcher();
  const saveFetcher    = useFetcher();
  const confirmFetcher = useFetcher();
  const importFetcher  = useFetcher();
  const countryFetcher = useFetcher();
  const backfillFetcher = useFetcher();
  const breakdownFetcher = useFetcher();
  const feesFetcher    = useFetcher();
  const thresholdFetcher = useFetcher();
  const fileRef = useRef(null);

  // D2 : taux fees éditables, pré-remplis au format que le marchand reconnaît
  // (virgule FR, sans zéros superflus : 2 → "2", 1.5 → "1,5", 0.25 → "0,25").
  const feeStr = (n) => String(n).replace(".", ",");
  const [feeForm, setFeeForm] = useState({
    shopify_fee_pct:     feeStr(fees?.shopifyFeePct     ?? 2.0),
    processor_fee_pct:   feeStr(fees?.processorFeePct   ?? 1.5),
    processor_fixed_fee: feeStr(fees?.processorFixedFee ?? 0.25),
  });
  const setFee = (k) => (e) => setFeeForm(p => ({ ...p, [k]: e.target.value }));

  // Seuil d'alerte de rentabilité (% global boutique), même format FR que les fees.
  const [thresholdForm, setThresholdForm] = useState(feeStr(profitabilityThresholdPct ?? 0));

  // CPA prescriptif : CPA actuel DÉCLARÉ (repère). "" = jamais renseigné (≠ 0). Même format FR.
  const cpaFetcher = useFetcher();
  const [cpaForm, setCpaForm] = useState(currentCpa == null ? "" : feeStr(currentCpa));

  const [rows, setRows]       = useState(null);   // null = pas encore chargé
  const [dirty, setDirty]     = useState(() => new Set());
  const [country, setCountry] = useState(defaultImportCountry);
  const [capped, setCapped]   = useState(false);

  // Charge la liste à l'ouverture de l'onglet.
  useEffect(() => {
    listFetcher.submit({ _action: "costs_list" }, { method: "POST", encType: "application/json" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (listFetcher.data?.costs) { setRows(listFetcher.data.costs); setDirty(new Set()); setCapped(!!listFetcher.data.variantsCapped); }
  }, [listFetcher.data]);

  // Recharge après une sauvegarde / confirmation / import réussis.
  useEffect(() => { if (saveFetcher.data?.success)    reload(); }, [saveFetcher.data]);    // eslint-disable-line
  useEffect(() => { if (confirmFetcher.data?.success) reload(); }, [confirmFetcher.data]); // eslint-disable-line
  useEffect(() => { if (importFetcher.data?.success)  reload(); }, [importFetcher.data]);  // eslint-disable-line

  function reload() { listFetcher.submit({ _action: "costs_list" }, { method: "POST", encType: "application/json" }); }

  function editRow(variantId, field, value) {
    setRows(prev => prev.map(r => r.variant_id === variantId ? { ...r, [field]: value } : r));
    setDirty(prev => new Set(prev).add(variantId));
  }

  function saveDirty() {
    const toSave = rows.filter(r => dirty.has(r.variant_id)).map(r => ({
      variant_id: r.variant_id, product_id: r.product_id,
      prix_achat: r.prix_achat, port_entrant: r.port_entrant, qty_par_lot: r.qty_par_lot,
      cout_emballage: r.cout_emballage, vat_regime: r.vat_regime, shipping_model: r.shipping_model,
      pays_import: r.pays_import, categorie: r.categorie,
    }));
    if (toSave.length) saveFetcher.submit({ _action: "costs_save", rows: toSave }, { method: "POST", encType: "application/json" });
  }

  function exportTemplate() {
    if (!rows) return;
    const csv = buildCostsCsv(rows.map(r => Object.fromEntries(CSV_COLUMNS.map(c => [c, r[c]]))));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "couts-variantes.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importFetcher.submit({ _action: "costs_import_csv", csv: String(reader.result) }, { method: "POST", encType: "application/json" });
    reader.readAsText(file);
    e.target.value = ""; // permet de ré-importer le même fichier
  }

  function changeCountry(next) {
    setCountry(next);
    countryFetcher.submit({ _action: "set_default_country", default_import_country: next }, { method: "POST", encType: "application/json" });
  }

  const loading = rows === null;
  const estimatedCount = rows ? rows.filter(r => r.source === "estimated").length : 0;
  const importErrors = importFetcher.data?.errors ?? [];
  const saveErrors   = saveFetcher.data?.errors ?? [];

  const inputStyle = { width: "100%", padding: "5px 7px", border: "1px solid #C9CCCF", borderRadius: "5px", fontSize: "12px", fontFamily: "inherit", boxSizing: "border-box" };
  const th = { padding: "8px 8px", fontSize: "10px", fontWeight: "700", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.4px", textAlign: "left", whiteSpace: "nowrap" };

  return (
    <div>
      <div style={{ marginBottom: "16px", fontSize: "13px", color: "#6D7175", lineHeight: "1.6" }}>
        Renseignez une fois, par variante, les coûts que Shopify ne connaît pas. Ils alimenteront le suivi de marge réelle sur vos vraies commandes.
        Les valeurs <strong>estimées</strong> sont pré-remplies (coût Shopify, catégorie, réglages boutique) — toute marge qui en dépend sera signalée « coûts estimés » tant que vous ne les avez pas confirmées.
      </div>

      {/* Réglage boutique : pays d'import par défaut */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", padding: "12px 14px", borderRadius: "8px", background: "#F9FAFB", border: "1px solid #E4E5E7", marginBottom: "16px" }}>
        <span style={{ fontSize: "12px", fontWeight: "600", color: "#202223" }}>Pays d'import par défaut</span>
        <select value={country} onChange={e => changeCountry(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          {PAYS_KEYS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span style={{ fontSize: "11px", color: "#6D7175" }}>Les nouvelles variantes en héritent ; chaque variante reste surchargeable.</span>
      </div>

      {/* D2 : taux fees de la boutique (intrants de la sync marge réelle) */}
      <div style={{ padding: "12px 14px", borderRadius: "8px", background: "#F9FAFB", border: "1px solid #E4E5E7", marginBottom: "16px" }}>
        <div style={{ fontSize: "12px", fontWeight: "600", color: "#202223", marginBottom: "10px" }}>Vos taux de frais</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "14px", flexWrap: "wrap" }}>
          <label style={{ fontSize: "11px", color: "#6D7175" }}>
            <div style={{ marginBottom: "4px" }}>Frais Shopify (% du CA)</div>
            <input type="text" inputMode="decimal" value={feeForm.shopify_fee_pct} onChange={setFee("shopify_fee_pct")} style={{ ...inputStyle, width: "90px" }} placeholder="ex : 2" />
          </label>
          <label style={{ fontSize: "11px", color: "#6D7175" }}>
            <div style={{ marginBottom: "4px" }}>Taux processeur (% du CA)</div>
            <input type="text" inputMode="decimal" value={feeForm.processor_fee_pct} onChange={setFee("processor_fee_pct")} style={{ ...inputStyle, width: "90px" }} placeholder="ex : 1,5" />
          </label>
          <label style={{ fontSize: "11px", color: "#6D7175" }}>
            <div style={{ marginBottom: "4px" }}>Fixe processeur (par transaction)</div>
            <input type="text" inputMode="decimal" value={feeForm.processor_fixed_fee} onChange={setFee("processor_fixed_fee")} style={{ ...inputStyle, width: "90px" }} placeholder="ex : 0,25" />
            <div style={hintStyle}>{formatMoney(parseFloat(String(feeForm.processor_fixed_fee).replace(",", ".")) || 0, feesCurrency)}/transaction</div>
          </label>
          <button
            onClick={() => feesFetcher.submit({ _action: "set_fees", ...feeForm }, { method: "POST", encType: "application/json" })}
            disabled={feesFetcher.state !== "idle"}
            style={{ padding: "7px 14px", background: feesFetcher.state !== "idle" ? "#E4E5E7" : "#008060", color: feesFetcher.state !== "idle" ? "#6D7175" : "#fff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: feesFetcher.state !== "idle" ? "default" : "pointer", fontFamily: "inherit" }}>
            {feesFetcher.state !== "idle" ? "Enregistrement…" : "Enregistrer les taux"}
          </button>
          {feesFetcher.data?.success && <span style={{ fontSize: "12px", color: "#008060" }}>✓ Taux enregistrés.</span>}
          {feesFetcher.data?.error && <span style={{ fontSize: "12px", color: "#D72C0D" }}>{feesFetcher.data.error}</span>}
        </div>
        <div style={{ fontSize: "11px", color: "#6D7175", marginTop: "10px", lineHeight: "1.5" }}>
          Ces taux s'appliquent aux prochaines synchronisations. Les commandes déjà analysées conservent les taux en vigueur au moment de leur calcul.
        </div>
      </div>

      {/* Seuil d'alerte de rentabilité (% global boutique, lu par l'alerte quotidienne) */}
      <div style={{ padding: "12px 14px", borderRadius: "8px", background: "#F9FAFB", border: "1px solid #E4E5E7", marginBottom: "16px" }}>
        <div style={{ fontSize: "12px", fontWeight: "600", color: "#202223", marginBottom: "10px" }}>Seuil d'alerte de rentabilité</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "14px", flexWrap: "wrap" }}>
          <label style={{ fontSize: "11px", color: "#6D7175" }}>
            <div style={{ marginBottom: "4px" }}>Seuil de marge nette (% du CA)</div>
            <input type="text" inputMode="decimal" value={thresholdForm} onChange={e => setThresholdForm(e.target.value)} style={{ ...inputStyle, width: "90px" }} placeholder="ex : 15" />
          </label>
          <button
            onClick={() => thresholdFetcher.submit({ _action: "set_profitability_threshold", profitability_threshold_pct: thresholdForm }, { method: "POST", encType: "application/json" })}
            disabled={thresholdFetcher.state !== "idle"}
            style={{ padding: "7px 14px", background: thresholdFetcher.state !== "idle" ? "#E4E5E7" : "#008060", color: thresholdFetcher.state !== "idle" ? "#6D7175" : "#fff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: thresholdFetcher.state !== "idle" ? "default" : "pointer", fontFamily: "inherit" }}>
            {thresholdFetcher.state !== "idle" ? "Enregistrement…" : "Enregistrer le seuil"}
          </button>
          {thresholdFetcher.data?.success && <span style={{ fontSize: "12px", color: "#008060" }}>✓ Seuil enregistré.</span>}
          {thresholdFetcher.data?.error && <span style={{ fontSize: "12px", color: "#D72C0D" }}>{thresholdFetcher.data.error}</span>}
        </div>
        <div style={{ fontSize: "11px", color: "#6D7175", marginTop: "10px", lineHeight: "1.5" }}>
          L'alerte quotidienne se déclenche quand la marge nette cumulée d'un produit passe sous ce seuil. <strong>0 %</strong> = alerte uniquement à perte réelle (marge négative).
        </div>
      </div>

      {/* CPA prescriptif : CPA actuel déclaré — devise BOUTIQUE explicite (point A anti-erreur devise) */}
      <div style={{ padding: "12px 14px", borderRadius: "8px", background: "#F9FAFB", border: "1px solid #E4E5E7", marginBottom: "16px" }}>
        <div style={{ fontSize: "12px", fontWeight: "600", color: "#202223", marginBottom: "10px" }}>Votre CPA d'acquisition actuel</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "14px", flexWrap: "wrap" }}>
          <label style={{ fontSize: "11px", color: "#6D7175" }}>
            <div style={{ marginBottom: "4px" }}>CPA par commande ({feesCurrency})</div>
            <input type="text" inputMode="decimal" value={cpaForm} onChange={e => setCpaForm(e.target.value)} style={{ ...inputStyle, width: "110px" }} placeholder="ex : 25" />
          </label>
          <button
            onClick={() => cpaFetcher.submit({ _action: "set_current_cpa", current_cpa: cpaForm }, { method: "POST", encType: "application/json" })}
            disabled={cpaFetcher.state !== "idle"}
            style={{ padding: "7px 14px", background: cpaFetcher.state !== "idle" ? "#E4E5E7" : "#008060", color: cpaFetcher.state !== "idle" ? "#6D7175" : "#fff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: cpaFetcher.state !== "idle" ? "default" : "pointer", fontFamily: "inherit" }}>
            {cpaFetcher.state !== "idle" ? "Enregistrement…" : "Enregistrer le CPA"}
          </button>
          {cpaFetcher.data?.cleared && <span style={{ fontSize: "12px", color: "#6D7175" }}>CPA effacé.</span>}
          {cpaFetcher.data?.success && !cpaFetcher.data?.cleared && <span style={{ fontSize: "12px", color: "#008060" }}>✓ CPA enregistré.</span>}
          {cpaFetcher.data?.warning && <span style={{ fontSize: "12px", color: "#B98900" }}>⚠ {cpaFetcher.data.warning}</span>}
          {cpaFetcher.data?.error && <span style={{ fontSize: "12px", color: "#D72C0D" }}>{cpaFetcher.data.error}</span>}
        </div>
        <div style={{ fontSize: "11px", color: "#6D7175", marginTop: "10px", lineHeight: "1.5" }}>
          Saisissez le montant <strong>dans la devise de votre boutique ({feesCurrency})</strong>. Si votre compte publicitaire facture dans une autre devise, convertissez d'abord — sinon la comparaison avec votre plafond serait faussée. Laissez vide pour ne pas déclarer de CPA.
        </div>
      </div>

      {/* Brique B : synchronisation des vraies commandes (backfill 30 j) */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", padding: "12px 14px", borderRadius: "8px", background: "#F6F3FF", border: "1px solid #7C3AED33", marginBottom: "16px" }}>
        <span style={{ fontSize: "12px", fontWeight: "600", color: "#202223" }}>Marge réelle sur vos commandes</span>
        <button
          onClick={() => backfillFetcher.submit({ _action: "backfill_orders" }, { method: "POST", encType: "application/json" })}
          disabled={backfillFetcher.state !== "idle"}
          style={{ padding: "7px 14px", background: backfillFetcher.state !== "idle" ? "#E4E5E7" : "#7C3AED", color: backfillFetcher.state !== "idle" ? "#6D7175" : "#fff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: backfillFetcher.state !== "idle" ? "default" : "pointer", fontFamily: "inherit" }}>
          {backfillFetcher.state !== "idle" ? "Synchronisation…" : "Synchroniser les commandes (30 j)"}
        </button>
        {backfillFetcher.data?.success && <span style={{ fontSize: "12px", color: "#008060" }}>✓ {backfillFetcher.data.ingested ?? 0} ligne(s) sur {backfillFetcher.data.orders ?? 0} commande(s).</span>}
        {backfillFetcher.data?.error && <span style={{ fontSize: "12px", color: "#D72C0D" }}>{backfillFetcher.data.error}</span>}
        {/* Brique B : rétro-remplir le détail poste-par-poste des commandes déjà synchronisées. */}
        <button
          onClick={() => breakdownFetcher.submit({ _action: "backfill_breakdowns" }, { method: "POST", encType: "application/json" })}
          disabled={breakdownFetcher.state !== "idle"}
          style={{ padding: "7px 14px", background: "#fff", color: breakdownFetcher.state !== "idle" ? "#6D7175" : "#7C3AED", border: `1px solid ${breakdownFetcher.state !== "idle" ? "#C9CCCF" : "#7C3AED66"}`, borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: breakdownFetcher.state !== "idle" ? "default" : "pointer", fontFamily: "inherit" }}>
          {breakdownFetcher.state !== "idle" ? "Complétion…" : "Compléter le détail des marges"}
        </button>
        {breakdownFetcher.data?.success && <span style={{ fontSize: "12px", color: "#008060" }}>✓ {breakdownFetcher.data.filled ?? 0} détail(s) complété(s){(breakdownFetcher.data.skipped ?? 0) > 0 ? ` · ${breakdownFetcher.data.skipped} ignoré(s)` : ""} sur {breakdownFetcher.data.scanned ?? 0} ligne(s) sans détail.</span>}
        {breakdownFetcher.data?.error && <span style={{ fontSize: "12px", color: "#D72C0D" }}>{breakdownFetcher.data.error}</span>}
      </div>

      {/* UI Monitor : sous-bloc repliable (lecture seule) de l'historique order_margins */}
      <MarginMonitor
        orderMargins={orderMargins} orderMarginsTotal={orderMarginsTotal}
        orderMarginsCapped={orderMarginsCapped} orderMarginsCap={orderMarginsCap}
        productTitleById={productTitleById ?? {}}
        cpaTargets={cpaTargets} cpaByProduct={cpaByProduct} currentCpaUpdatedAt={currentCpaUpdatedAt} thresholdPct={profitabilityThresholdPct}
        onGoToCosts={() => window.scrollTo({ top: 0, behavior: "smooth" })} />

      {/* Barre d'actions */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
        <button onClick={exportTemplate} disabled={loading} style={{ padding: "7px 14px", background: "#fff", color: "#202223", border: "1px solid #C9CCCF", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>↓ Exporter le modèle CSV</button>
        <button onClick={() => fileRef.current?.click()} disabled={loading} style={{ padding: "7px 14px", background: "#fff", color: "#202223", border: "1px solid #C9CCCF", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>↑ Importer un CSV</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onImportFile} style={{ display: "none" }} />
        <button onClick={saveDirty} disabled={loading || dirty.size === 0} style={{ padding: "7px 14px", background: dirty.size ? "#008060" : "#E4E5E7", color: dirty.size ? "#fff" : "#6D7175", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: dirty.size ? "pointer" : "default", fontFamily: "inherit" }}>Enregistrer les modifications{dirty.size ? ` (${dirty.size})` : ""}</button>
        <button onClick={() => confirmFetcher.submit({ _action: "costs_confirm_all" }, { method: "POST", encType: "application/json" })} disabled={loading || estimatedCount === 0} style={{ padding: "7px 14px", background: "#fff", color: estimatedCount ? "#B98900" : "#6D7175", border: `1px solid ${estimatedCount ? "#B98900" : "#C9CCCF"}`, borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: estimatedCount ? "pointer" : "default", fontFamily: "inherit" }}>Tout confirmer{estimatedCount ? ` (${estimatedCount} estimées)` : ""}</button>
      </div>

      {capped && <div style={{ padding: "10px 14px", borderRadius: "8px", background: "#FFF9EC", border: "1px solid #B9890033", fontSize: "12px", color: "#B98900", marginBottom: "12px" }}>Certains produits ont plus de 100 variantes : seules les 100 premières sont listées.</div>}

      {/* Erreurs d'import / sauvegarde, ligne par ligne (jamais avalées) */}
      {importErrors.length > 0 && (
        <div style={{ padding: "12px 14px", borderRadius: "8px", background: "#FFF4F4", border: "1px solid #D72C0D33", fontSize: "12px", color: "#202223", marginBottom: "12px" }}>
          <strong style={{ color: "#D72C0D" }}>Import : {importErrors.length} ligne(s) rejetée(s)</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
            {importErrors.slice(0, 20).map((e, i) => <li key={i}>Ligne {e.line} : {e.messages.join(" · ")}</li>)}
          </ul>
          {importFetcher.data?.saved > 0 && <div style={{ marginTop: "6px", color: "#008060" }}>{importFetcher.data.saved} ligne(s) importée(s) avec succès.</div>}
        </div>
      )}
      {saveErrors.length > 0 && (
        <div style={{ padding: "12px 14px", borderRadius: "8px", background: "#FFF4F4", border: "1px solid #D72C0D33", fontSize: "12px", color: "#202223", marginBottom: "12px" }}>
          <strong style={{ color: "#D72C0D" }}>{saveErrors.length} ligne(s) non enregistrée(s)</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>{saveErrors.slice(0, 20).map((e, i) => <li key={i}>{e.variant_id ?? "?"} : {e.messages.join(" · ")}</li>)}</ul>
        </div>
      )}

      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "#6D7175", fontSize: "13px" }}>Chargement des variantes…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", color: "#6D7175", fontSize: "13px" }}>Aucune variante active trouvée dans la boutique.</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #E4E5E7", borderRadius: "10px" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "1000px" }}>
            <thead>
              <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E4E5E7" }}>
                <th style={th}>Produit / Variante</th>
                <th style={th}>Prix achat €</th>
                <th style={th}>Port lot €</th>
                <th style={th}>Qté/lot</th>
                <th style={th}>Emballage €</th>
                <th style={th}>TVA</th>
                <th style={th}>Logistique</th>
                <th style={th}>Pays</th>
                <th style={th}>Catégorie</th>
                <th style={th}>État</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const pill = SOURCE_PILL[r.source] ?? SOURCE_PILL.estimated;
                return (
                  <tr key={r.variant_id} style={{ borderBottom: "1px solid #F1F2F4" }}>
                    <td style={{ padding: "8px", fontSize: "12px", color: "#202223", maxWidth: "220px" }}>
                      <div style={{ fontWeight: "600" }}>{r.product_title}</div>
                      {r.variant_title && r.variant_title !== "Default Title" && <div style={{ color: "#6D7175", fontSize: "11px" }}>{r.variant_title}</div>}
                    </td>
                    <td style={{ padding: "6px" }}><input type="number" step="0.01" min="0" value={r.prix_achat} onChange={e => editRow(r.variant_id, "prix_achat", e.target.value)} style={inputStyle} /></td>
                    <td style={{ padding: "6px" }}><input type="number" step="0.01" min="0" value={r.port_entrant} onChange={e => editRow(r.variant_id, "port_entrant", e.target.value)} style={inputStyle} /></td>
                    <td style={{ padding: "6px", width: "70px" }}><input type="number" step="1" min="1" value={r.qty_par_lot} onChange={e => editRow(r.variant_id, "qty_par_lot", e.target.value)} style={inputStyle} /></td>
                    <td style={{ padding: "6px" }}><input type="number" step="0.01" min="0" value={r.cout_emballage} onChange={e => editRow(r.variant_id, "cout_emballage", e.target.value)} style={inputStyle} /></td>
                    <td style={{ padding: "6px" }}><select value={r.vat_regime} onChange={e => editRow(r.variant_id, "vat_regime", e.target.value)} style={inputStyle}>{VAT_REGIMES.map(v => <option key={v} value={v}>{v}</option>)}</select></td>
                    <td style={{ padding: "6px" }}><select value={r.shipping_model} onChange={e => editRow(r.variant_id, "shipping_model", e.target.value)} style={inputStyle}>{SHIPPING_MODELS.map(v => <option key={v} value={v}>{v}</option>)}</select></td>
                    <td style={{ padding: "6px" }}><select value={r.pays_import} onChange={e => editRow(r.variant_id, "pays_import", e.target.value)} style={inputStyle}>{PAYS_KEYS.map(v => <option key={v} value={v}>{v}</option>)}</select></td>
                    <td style={{ padding: "6px" }}><select value={r.categorie} onChange={e => editRow(r.variant_id, "categorie", e.target.value)} style={inputStyle}>{CATEGORIE_KEYS.map(v => <option key={v} value={v}>{v}</option>)}</select></td>
                    <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                      <span style={{ padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: "700", color: pill.color, background: pill.bg }}>{dirty.has(r.variant_id) ? "Modifié" : pill.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Index() {
  const { isPro, isExpert, monthlyCount: initialCount, history, products, productsCapped, alertThreshold: initialThreshold, violations, showWelcome, annotations: initialAnnotations, vatRegime: initialVatRegime, shopTaxesIncluded, shippingModel: initialShippingModel, defaultImportCountry, fees, feesCurrency, profitabilityThresholdPct,
    currentCpa, currentCpaUpdatedAt, cpaTargets, cpaByProduct,
    orderMargins, orderMarginsTotal, orderMarginsCapped, orderMarginsCap } = useLoaderData();

  const saveFetcher          = useFetcher();
  const aiFetcher            = useFetcher();
  const alertFetcher         = useFetcher();
  const auditFetcher         = useFetcher();
  const annotFetcher         = useFetcher();
  const regimeFetcher        = useFetcher();
  const shippingModelFetcher = useFetcher();

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
    shopifyFee: "2", paymentProcessor: "Stripe EU", stripeFee: "1.5", processorFixedFee: "0.25",
    retours: "5", ads: "15",
    fraisRetour: "0", coutEmballage: "0",
    vatRegime: initialVatRegime ?? "assujetti",
    shippingModel: initialShippingModel ?? "dropshipping",
  });

  // Feature 3: simulation form — persisted in localStorage
  const SIM_STORAGE_KEY = "tcc_simForm";
  const defaultSimForm = { prixAchat: "20", categorie: "Textile", paysImport: "Chine", targetMargin: "35", shopifyFee: "2", paymentProcessor: "Stripe EU", stripeFee: "1.5", processorFixedFee: "0.25", retours: "5", ads: "15", fraisRetour: "0", coutEmballage: "0", vatRegime: initialVatRegime ?? "assujetti", shippingModel: initialShippingModel ?? "dropshipping" };
  const [simForm, setSimForm] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = JSON.parse(localStorage.getItem(SIM_STORAGE_KEY) ?? "null");
        if (saved && typeof saved === "object") return { ...defaultSimForm, ...saved };
      } catch {}
    }
    return defaultSimForm;
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

  // ── Activation semaine 1 : parcours guidé install → marge réelle (Shape 1) ──
  // Réutilise les actions EXISTANTES sans les modifier : costs_list (estime + persiste les
  // coûts) PUIS backfill_orders (sync). L'ordre est impératif : synchroniser sans coûts
  // estimés produirait un monitor 100 % « coûts manquants » (orderSync ne lit que le stocké).
  const estimateFetcher     = useFetcher();
  const activateSyncFetcher = useFetcher();
  const [activationPhase, setActivationPhase] = useState("idle"); // idle | estimating | syncing | done

  const startActivation = () => {
    setActivationPhase("estimating");
    estimateFetcher.submit({ _action: "costs_list" }, { method: "POST", encType: "application/json" });
  };

  // Étape 1 finie (coûts estimés & persistés) → déclencher la sync des commandes.
  useEffect(() => {
    if (activationPhase !== "estimating" || estimateFetcher.state !== "idle" || !estimateFetcher.data) return;
    if (!estimateFetcher.data.costs) { setActivationPhase("idle"); return; }        // échec estimation
    setActivationPhase("syncing");
    activateSyncFetcher.submit({ _action: "backfill_orders" }, { method: "POST", encType: "application/json" });
  }, [estimateFetcher.state, estimateFetcher.data, activationPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Étape 2 finie (commandes analysées) → atterrir sur le monitor si des marges ont été produites.
  useEffect(() => {
    if (activationPhase !== "syncing" || activateSyncFetcher.state !== "idle" || !activateSyncFetcher.data) return;
    if (activateSyncFetcher.data.error) { setActivationPhase("idle"); return; }      // échec sync
    setActivationPhase("done");
    if ((activateSyncFetcher.data.ingested ?? 0) > 0) setActiveTab("costs");         // → marge réelle
  }, [activateSyncFetcher.state, activateSyncFetcher.data, activationPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  // History filters (Expert)
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historyCategory, setHistoryCategory] = useState("all");

  // Annotations (Expert)
  const [annotations, setAnnotations] = useState(initialAnnotations ?? []);
  const [annotModal, setAnnotModal]   = useState(null); // calcId being annotated
  const [annotText, setAnnotText]     = useState("");

  // Catalog audit (Expert)
  const [auditParams, setAuditParams] = useState({ shopify_fee: "0.02", payment_processor: "Stripe EU", returns_rate: "0.05", shipping_cost: "8", vat_regime: initialVatRegime ?? "assujetti", qty_per_shipment: "1", shipping_model: initialShippingModel ?? "dropshipping" });
  const [auditElapsed, setAuditElapsed] = useState(0);
  const [methOpen,   setMethOpen]   = useState(false);
  const [douaneOpen, setDouaneOpen] = useState(false);

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

  // Persist simulation form to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      try { localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(simForm)); } catch {}
    }
  }, [simForm]);

  // Audit elapsed timer — increments every second while auditing for honest progress display
  useEffect(() => {
    if (auditFetcher.state === "idle") { setAuditElapsed(0); return; }
    const interval = setInterval(() => setAuditElapsed(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [auditFetcher.state]);

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
    const shopifyFeeVal       = validatePercentage(form.shopifyFee,          "Frais Shopify",        errs);
    const stripeFeeVal        = validatePercentage(form.stripeFee,           "Frais Stripe",         errs);
    const retoursVal          = validatePercentage(form.retours,             "Taux de retours",      errs);
    const adsVal              = validatePercentage(form.ads,                 "Budget ads",           errs);
    const fraisRetourVal      = validateOptionalAmount(form.fraisRetour,         "Frais de retour",  errs);
    const coutEmballageVal    = validateOptionalAmount(form.coutEmballage,       "Coût d'emballage", errs);
    const processorFixedFeeVal = validateOptionalAmount(form.processorFixedFee ?? "0.25", "Frais fixes processeur", errs);

    if (errs.length > 0) { setErrors(errs); setWarnings([]); setResults(null); return null; }

    if (prixAchat > prixVente) warns.push("Attention : vous vendez moins cher que vous achetez.");
    else if (prixAchat === prixVente) warns.push("Prix achat = prix vente : marge 0% avant frais.");
    const totalPct = shopifyFeeVal + stripeFeeVal + retoursVal + adsVal;
    if (totalPct > 100) warns.push(`Frais cumulés (${formatPct(totalPct)} %) dépassent 100 % du CA.`);

    const shippingModel  = form.shippingModel ?? "stock"; // toggle ajouté en Lot 2
    // Source unique : le moteur partagé. Le dashboard n'a plus sa propre arithmétique.
    const m = computeMargin({
      prixAchat, prixVente,
      categorie: form.categorie, paysImport: form.paysImport,
      shopifyFee: shopifyFeeVal, stripeFee: stripeFeeVal, processorFixedFee: processorFixedFeeVal,
      retours: retoursVal, ads: adsVal, fraisRetour: fraisRetourVal, coutEmballage: coutEmballageVal,
      vatRegime: form.vatRegime ?? "assujetti", shopTaxesIncluded, shippingModel,
    });

    const computed = { margeBrutePercent: m.margeBrutePercent, margeNettePercent: m.margeNettePercent, margeApparente: m.margeApparente, coutRendu: m.coutRendu, margeNette: m.margeNette };
    const bad = Object.entries(computed).find(([, v]) => !Number.isFinite(v));
    if (bad) { setErrors([`Erreur de calcul (${bad[0]}).`]); setResults(null); return null; }

    const r = {
      prixAchat, prixVente, douane: m.douane, tvaImport: m.tvaImport, shipping: m.shipping, coutRendu: m.coutRendu,
      shopifyCost: m.shopifyCost, stripeCost: m.stripeCost, retoursCost: m.retoursCost, adsCost: m.adsCost, totalFraisVente: m.totalFraisVente,
      fraisRetour: fraisRetourVal, coutEmballage: coutEmballageVal, fraisFixes: m.fraisFixes,
      margeBrute: m.margeBrute, margeBrutePercent: m.margeBrutePercent, margeNette: m.margeNette, margeNettePercent: m.margeNettePercent,
      margeApparente: m.margeApparente, customsRate: m.customsRate, vatRate: m.vatRate,
      vatRegime: form.vatRegime ?? "assujetti", tvaNetCost: m.tvaNetCost,
      shippingModel, revenu: m.revenu,
      shopifyFee: shopifyFeeVal, stripeFee: stripeFeeVal, processorFixedFee: processorFixedFeeVal,
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
      paymentProcessor: form.paymentProcessor,
      retours:          r.retours,
      ads:              r.ads,
      customsRate:      r.customsRate,
      margeBrutePercent: r.margeBrutePercent,
      margeNettePercent: r.margeNettePercent,
      margeNette:        r.margeNette,
      coutEmballage:      r.coutEmballage,
      fraisRetour:        r.fraisRetour,
      processorFixedFee:  r.processorFixedFee,
      vatRegime:          r.vatRegime,
      margeApparente:     r.margeApparente,
      shopTaxesIncluded:  shopTaxesIncluded,
      shippingModel:      r.shippingModel ?? "stock",
    };
    aiFetcher.submit(aiData, { method: "POST", encType: "application/json" });
  };

  // Feature 3: simulation
  const handleSimulate = useCallback(() => {
    const errs = [];
    const prixAchat    = validatePrice(simForm.prixAchat, "Prix d'achat", errs);
    const targetMargin = validatePercentage(simForm.targetMargin, "Marge cible", errs);
    const shopifyFee        = validatePercentage(simForm.shopifyFee,          "Frais Shopify",        errs);
    const stripeFee         = validatePercentage(simForm.stripeFee,           "Frais Stripe",         errs);
    const retours           = validatePercentage(simForm.retours,             "Retours",              errs);
    const ads               = validatePercentage(simForm.ads,                 "Ads",                  errs);
    const fraisRetour       = validateOptionalAmount(simForm.fraisRetour   ?? "0",    "Frais de retour",        errs);
    const coutEmballage     = validateOptionalAmount(simForm.coutEmballage ?? "0",    "Coût d'emballage",       errs);
    const processorFixedFee = validateOptionalAmount(simForm.processorFixedFee ?? "0.25", "Frais fixes processeur", errs);

    if (errs.length > 0) { setSimErrors(errs); setSimResult(null); return; }
    if (targetMargin > 95) {
      setSimErrors([`Marge cible irréaliste : ${formatPct(targetMargin)} % dépasse le maximum conseillé de 95 %. Aucun modèle e-commerce ne peut atteindre durablement une marge nette aussi élevée. Réduisez la marge cible.`]);
      setSimResult(null); return;
    }

    const totalVarPct = (shopifyFee ?? 0) + (stripeFee ?? 0) + (retours ?? 0) + (ads ?? 0);
    const sim = simulateSellingPrice(prixAchat, simForm.categorie, simForm.paysImport, targetMargin, { shopifyFee, stripeFee, retours, ads, fraisRetour, coutEmballage, processorFixedFee, vatRegime: simForm.vatRegime ?? "assujetti", shippingModel: simForm.shippingModel ?? "dropshipping" });
    if (!sim) {
      setSimErrors([`Impossible : marge cible (${formatPct(targetMargin)} %) + frais variables (${formatPct(totalVarPct)} %) = ${formatPct(targetMargin + totalVarPct)} % ≥ 100 %. Le dénominateur est nul ou négatif — aucun prix de vente ne peut atteindre cet objectif. Réduisez les frais ou la marge cible.`]);
      setSimResult(null);
      return;
    }
    setSimErrors([]);
    setSimResult({ ...sim, prixAchat, targetMargin, shopifyFee, stripeFee, processorFixedFee, retours, ads, fraisRetour, coutEmballage, paymentProcessor: simForm.paymentProcessor, prixVenteRec: sim.prixVenteMin * 1.10 });
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
    auditFetcher.submit({ _action: "run_audit", ...auditParams, shop_taxes_included: shopTaxesIncluded }, { method: "POST", encType: "application/json" });
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
  const subscribeExpertBtn = (label = "Passer au plan Expert — 15$/mois") => (
    <button onClick={handleSubscribeExpert} disabled={isSubscribing}
      style={{ padding: "10px 24px", background: "linear-gradient(135deg,#7C3AED 0%,#5B21B6 100%)", color: "#fff", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: "600", cursor: isSubscribing ? "default" : "pointer", fontFamily: "inherit", opacity: isSubscribing ? 0.7 : 1, boxShadow: "0 4px 12px rgba(124,58,237,0.3)" }}>
      {isSubscribing ? "Redirection…" : label}
    </button>
  );

  return (
    <s-page heading="Calculateur de Vraie Marge">
      <style>{`
        @media (max-width: 768px) {
          /* ── Form / Calculator ── */
          .tcc-form-grid    { grid-template-columns: 1fr !important; }
          .tcc-cost-grid    { grid-template-columns: 1fr !important; }
          .tcc-margin-cards { grid-template-columns: 1fr !important; }
          .tcc-upgrade-plans{ grid-template-columns: 1fr !important; max-width: 360px !important; }
          .tcc-result-block { box-sizing: border-box !important; width: 100% !important; overflow-wrap: break-word !important; word-break: break-word !important; }

          /* ── Simulation ── */
          .tcc-sim-cards    { grid-template-columns: 1fr !important; }
          .tcc-sim-detail   { word-break: break-word !important; overflow-wrap: break-word !important; white-space: normal !important; }

          /* ── History ── */
          .tcc-history-container { overflow-x: hidden; width: 100%; }
          .tcc-hist-row     { grid-template-columns: 1.6fr 1.8fr 1fr 1.2fr !important; }
          .tcc-hist-col-cat, .tcc-hist-col-pays { display: none !important; }

          /* ── Alerts ── */
          .tcc-alert-row    { grid-template-columns: 2fr 1fr 1fr !important; }
          .tcc-alert-col-ecart { display: none !important; }
          .tcc-alert-input  { flex-direction: column !important; align-items: stretch !important; }
          .tcc-alert-input input { width: 100% !important; }

          /* ── Audit ── */
          .tcc-audit-kpi    { grid-template-columns: 1fr 1fr !important; }
          .tcc-audit-row    { grid-template-columns: 2.5fr 1fr 1.2fr 1fr !important; }
          .tcc-audit-col-cost { display: none !important; }
          .tcc-audit-params   { grid-template-columns: 1fr 1fr !important; }
          .tcc-audit-btn      { display: block !important; width: 100% !important; }

          /* ── ROAS ── */
          .tcc-roas-num     { font-size: 38px !important; letter-spacing: -1px !important; }

          /* ── Prevent iOS auto-zoom on input focus ── */
          input, select, textarea { font-size: 16px !important; }
        }
      `}</style>

      {/* ── WELCOME BANNER ───────────────────────────────────────────────── */}
      {showWelcome && (
        <s-section heading={`Bienvenue dans True Cost Calculator ${isExpert ? "Expert" : "Pro"} !`}>
          <div style={{ padding: "16px 20px", borderRadius: "8px", background: "#F1F8F5", border: "1px solid #008060", fontSize: "14px", color: "#202223", lineHeight: "1.6" }}>
            Calculs illimités activés. Vos simulations sont sauvegardées automatiquement dans l'onglet <strong>Historique</strong>.
          </div>
        </s-section>
      )}

      {/* ── ACTIVATION semaine 1 : carte guidée install → marge réelle ────────
          Visible tant qu'aucune commande n'est synchronisée (orderMarginsTotal === 0).
          Un clic orchestre estimation des coûts → sync → atterrissage sur le monitor. */}
      {orderMarginsTotal === 0 && (() => {
        const syncData = activateSyncFetcher.data;
        const busy     = activationPhase === "estimating" || activationPhase === "syncing";
        const done     = activationPhase === "done";
        const ingested = syncData?.ingested ?? 0;
        // Messages retryables (erreur d'estimation, échec/sync-déjà-en-cours) : ton informatif
        // (ambre = « à réessayer », pas rouge « cassé ») + bouton redevenu cliquable.
        const errMsg   = estimateFetcher.data?.error || syncData?.error
          || (activationPhase === "idle" && estimateFetcher.data && !estimateFetcher.data.costs
                ? "L'estimation des coûts a échoué. Réessayez." : null);
        const box   = { padding: "20px 24px", borderRadius: "10px", background: "#F1F8F5", border: "1px solid #008060", lineHeight: "1.6" };
        const title = { fontSize: "16px", fontWeight: "700", color: "#202223", marginBottom: "6px" };
        const text  = { fontSize: "14px", color: "#202223" };

        // Succès AVEC données : on a basculé sur le monitor ; la revalidation du loader masquera
        // la carte (orderMarginsTotal > 0). null → évite un flash du pitch entre-temps.
        if (done && !syncData?.error && ingested > 0) return null;

        // État terminal SANS données (sync OK, 0 ligne ingérée) : TOUJOURS un feedback explicite —
        // pas de cul-de-sac. orders === 0 → aucune commande ; orders > 0 → aucune ligne exploitable.
        if (done && !syncData?.error && ingested === 0) {
          const noOrders = (syncData?.orders ?? 0) === 0;
          return (
            <s-section>
              <div style={box}>
                <div style={title}>{noOrders ? "Aucune commande sur les 30 derniers jours" : "Analyse terminée"}</div>
                <div style={text}>
                  {noOrders
                    ? "Dès votre prochaine vente, revenez ici : vous verrez votre marge nette réelle — frais Shopify, paiement, retours et TVA compris — sur vos vraies commandes."
                    : "Vos commandes ont été analysées, mais aucune ligne exploitable n'a été trouvée sur les 30 derniers jours. Revenez après votre prochaine vente."}
                </div>
              </div>
            </s-section>
          );
        }

        // État initial / relançable (idle, y compris après une erreur ou « sync déjà en cours »).
        return (
          <s-section>
            <div style={box}>
              <div style={title}>Voyez votre marge nette réelle sur vos vraies commandes</div>
              <div style={text}>En un clic, on estime vos coûts et on analyse vos commandes des 30 derniers jours pour afficher votre <strong>vraie marge</strong> : frais Shopify, paiement, retours et TVA compris. Vous pourrez affiner les coûts ensuite.</div>
              <button onClick={startActivation} disabled={busy}
                style={{ marginTop: "14px", padding: "10px 20px", background: busy ? "#E4E5E7" : "#008060", color: busy ? "#6D7175" : "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: "700", cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}>
                {activationPhase === "estimating" ? "Estimation de vos coûts…" : activationPhase === "syncing" ? "Analyse de vos commandes…" : "Voir ma marge réelle"}
              </button>
              {errMsg && <div style={{ marginTop: "10px", fontSize: "12px", color: "#B98900" }}>{errMsg}</div>}
            </div>
          </s-section>
        );
      })()}

      {/* ── ALERT BANNER (Feature 4) ─────────────────────────────────────── */}
      {violations.length > 0 && (
        <s-section>
          <AlertBanner violations={violations} threshold={initialThreshold} />
        </s-section>
      )}

      {/* ── MAIN SECTION ─────────────────────────────────────────────────── */}
      <s-section heading={
        activeTab === "calculator" ? "Calculateur de marge" :
        activeTab === "simulate"   ? "Simulateur de prix" :
        activeTab === "history"    ? "Historique de vos calculs" :
        activeTab === "alerts"     ? "Alertes de marge" :
        activeTab === "audit"      ? "Audit Catalogue" :
        activeTab === "costs"      ? "Suivi des coûts" :
        "Calculateur de marge"
      }>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: "0", marginBottom: "24px", borderBottom: "2px solid #E4E5E7", flexWrap: "wrap" }}>
          {[
            { id: "calculator", label: "Calculateur", badge: null },
            { id: "simulate",   label: "Simulation",  badge: null },
            { id: "history",    label: isPro ? "Historique" : "Historique 🔒", badge: null },
            { id: "alerts",     label: "Alertes",     badge: null },
            { id: "audit",      label: "Audit Catalogue", badge: "EXPERT" },
            { id: "costs",      label: "Suivi des coûts", badge: null },
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
                    <div style={{ fontSize: "24px", fontWeight: "700", color: "#202223", marginBottom: "14px" }}>15$/mois</div>
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
                          {p.title}{p.price > 0 ? ` — ${formatEur(p.price)}` : ""}
                        </option>
                      ))}
                    </select>
                    {form.selectedProductTitle && (
                      <div style={{ fontSize: "12px", color: "#008060", marginTop: "6px" }}>
                        ✓ {form.selectedProductTitle} sélectionné · prix de vente rempli automatiquement
                      </div>
                    )}
                    {productsCapped && (
                      <div style={{ fontSize: "11px", color: "#B98900", marginTop: "6px" }}>
                        Votre catalogue dépasse 500 produits — seuls les 500 premiers sont affichés ici.
                      </div>
                    )}
                  </div>
                )}

                <div className="tcc-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "14px" }}>Données produit</div>
                    <FieldGroup label="Prix d'achat fournisseur (€)" tooltip="Prix hors taxes payé au fournisseur, livraison fournisseur non incluse. À retrouver sur votre facture pro-forma ou votre commande AliExpress / Alibaba.">
                      <input type="text" inputMode="decimal" value={form.prixAchat} onChange={update("prixAchat")} style={inputStyle} placeholder="ex : 12.00" />
                    </FieldGroup>
                    <FieldGroup label="Prix de vente (€)" tooltip="Prix public de vente sur votre boutique, frais de livraison client exclus. C'est le montant que vous encaissez.">
                      <input type="text" inputMode="decimal" value={form.prixVente} onChange={update("prixVente")} style={inputStyle} placeholder="ex : 34.99" />
                    </FieldGroup>
                    <FieldGroup label="Catégorie produit" tooltip="Utilisée pour estimer vos droits de douane selon la nomenclature TARIC (tarif douanier intégré de l'UE). Choisissez la catégorie la plus proche de votre produit.">
                      <select value={form.categorie} onChange={update("categorie")} style={inputStyle}>
                        {Object.entries(CUSTOMS_RATES).map(([cat, rate]) => (
                          <option key={cat} value={cat}>{cat} — douane {formatPct(rate * 100)} %</option>
                        ))}
                      </select>
                      <div style={hintStyle}>Taux appliqué : {customsRateDisplay}%</div>
                    </FieldGroup>
                    <FieldGroup label="Pays d'import" tooltip="Pays d'expédition du fournisseur. Détermine les frais de port estimés. Ces estimations sont des moyennes marché — renseignez votre coût réel si vous le connaissez.">
                      <select value={form.paysImport} onChange={update("paysImport")} style={inputStyle}>
                        {Object.entries(SHIPPING_ESTIMATES).map(([pays, cost]) => (
                          <option key={pays} value={pays}>{pays} — port ~{cost}€</option>
                        ))}
                      </select>
                      <div style={hintStyle}>Frais de port estimés : ~{shippingDisplay}€</div>
                    </FieldGroup>
                    <FieldGroup label="Régime de TVA" direction="left" tooltip="Assujetti (régime réel) : la TVA à l'import est déductible — elle n'est PAS un coût. Franchise en base / micro-entreprise : la TVA import est un coût sec définitif.">
                      <select
                        value={form.vatRegime ?? "assujetti"}
                        onChange={e => {
                          const regime = e.target.value;
                          setForm(prev => ({ ...prev, vatRegime: regime }));
                          setResults(null); setErrors([]); setWarnings([]);
                          regimeFetcher.submit({ _action: "set_vat_regime", vat_regime: regime }, { method: "POST", encType: "application/json" });
                        }}
                        style={inputStyle}
                      >
                        <option value="assujetti">Assujetti à la TVA (régime réel)</option>
                        <option value="franchise">Franchise en base / non assujetti</option>
                      </select>
                    </FieldGroup>
                    <FieldGroup label="Modèle logistique" direction="left" tooltip="Dropshipping : votre fournisseur expédie directement au client (douane 0€ jusqu'au 30/06/2026, puis forfait 3€/article à partir du 01/07/2026). Stock : vous importez en lot et stockez vous-même (tarif douanier standard en % sur CIF, inchangé par la réforme UE).">
                      <select
                        value={form.shippingModel ?? "dropshipping"}
                        onChange={e => {
                          const model = e.target.value;
                          setForm(prev => ({ ...prev, shippingModel: model }));
                          setResults(null); setErrors([]); setWarnings([]);
                          shippingModelFetcher.submit({ _action: "set_shipping_model", shipping_model: model }, { method: "POST", encType: "application/json" });
                        }}
                        style={inputStyle}
                      >
                        <option value="dropshipping">Dropshipping (colis direct au client)</option>
                        <option value="stock">Import en stock (réassort en lot)</option>
                      </select>
                    </FieldGroup>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "14px" }}>Frais & déductions</div>
                    <FieldGroup label="Frais Shopify (% du CA)" direction="left" tooltip="Commission prélevée par Shopify sur chaque transaction. Basic 2% · Shopify 1% · Advanced 0,5%. Modifiez ce champ si vous avez négocié un taux différent. Source : shopify.com/fr/pricing">
                      <input type="text" inputMode="decimal" value={form.shopifyFee} onChange={update("shopifyFee")} style={inputStyle} placeholder="ex : 2" />
                    </FieldGroup>
                    <FieldGroup label="Processeur de paiement" direction="left" tooltip="Stripe EU : 1,5% + 0,25€ · Stripe non-EU : 2,5% + 0,25€ · Shopify Payments Basic : 2% + 0,25€ · Avancé : 1% + 0,25€ · Plus : 0,5% + 0,25€">
                      <select
                        value={form.paymentProcessor}
                        onChange={e => {
                          const p = PAYMENT_PROCESSORS.find(x => x.id === e.target.value);
                          if (p) {
                            setForm(prev => ({ ...prev, paymentProcessor: p.id, stripeFee: String(p.rate), processorFixedFee: String(p.fixedFee) }));
                            setResults(null); setErrors([]); setWarnings([]); setShowUpgrade(false);
                          }
                        }}
                        style={inputStyle}
                      >
                        {PAYMENT_PROCESSORS.map(p => (
                          <option key={p.id} value={p.id}>{p.id} — {p.hint}</option>
                        ))}
                      </select>
                    </FieldGroup>
                    <FieldGroup label="Taux de retours (%)" direction="left" tooltip="Pourcentage du CA provisionné pour couvrir les retours et remboursements. E-commerce mode : 15–30%. Électronique : 5–15%. Autres : 5–10%. Source : estimations sectorielles Fevad.">
                      <input type="text" inputMode="decimal" value={form.retours} onChange={update("retours")} style={inputStyle} placeholder="ex : 8" />
                    </FieldGroup>
                    <FieldGroup label="Budget ads (% du CA)" direction="left" tooltip="Pourcentage du CA réinvesti en publicité payante. Une campagne Meta rentable nécessite généralement 15–25% pour un ROAS 4–6. Google Shopping : 10–20% pour un ROAS 5–8.">
                      <input type="text" inputMode="decimal" value={form.ads} onChange={update("ads")} style={inputStyle} placeholder="ex : 20" />
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
                      <option key={cat} value={cat}>{cat} — douane {formatPct(rate * 100)} %</option>
                    ))}
                  </select>
                </FieldGroup>
                <FieldGroup label="Pays d'import">
                  <select value={simForm.paysImport} onChange={updateSim("paysImport")} style={inputStyle}>
                    {Object.entries(SHIPPING_ESTIMATES).map(([pays, cost]) => (
                      <option key={pays} value={pays}>{pays} — port ~{cost}€</option>
                    ))}
                  </select>
                </FieldGroup>
                <FieldGroup label="Régime de TVA" direction="left" tooltip="Assujetti : TVA import récupérable (neutralisée). Franchise : TVA import = coût sec.">
                  <select
                    value={simForm.vatRegime ?? "assujetti"}
                    onChange={e => setSimForm(prev => ({ ...prev, vatRegime: e.target.value }))}
                    style={inputStyle}
                  >
                    <option value="assujetti">Assujetti à la TVA (régime réel)</option>
                    <option value="franchise">Franchise en base / non assujetti</option>
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
                <FieldGroup label="Processeur de paiement" direction="left" tooltip="Stripe EU : 1,5% + 0,25€ · Stripe non-EU : 2,5% + 0,25€ · Shopify Payments Basic : 2% + 0,25€ · Avancé : 1% + 0,25€ · Plus : 0,5% + 0,25€">
                  <select
                    value={simForm.paymentProcessor}
                    onChange={e => {
                      const p = PAYMENT_PROCESSORS.find(x => x.id === e.target.value);
                      if (p) setSimForm(prev => ({ ...prev, paymentProcessor: p.id, stripeFee: String(p.rate), processorFixedFee: String(p.fixedFee) }));
                    }}
                    style={inputStyle}
                  >
                    {PAYMENT_PROCESSORS.map(p => (
                      <option key={p.id} value={p.id}>{p.id} — {p.hint}</option>
                    ))}
                  </select>
                </FieldGroup>
                <FieldGroup label="Taux de retours (%)">
                  <input type="text" inputMode="decimal" value={simForm.retours} onChange={updateSim("retours")} style={inputStyle} placeholder="5" />
                </FieldGroup>
                <FieldGroup label="Budget ads (%)">
                  <input type="text" inputMode="decimal" value={simForm.ads} onChange={updateSim("ads")} style={inputStyle} placeholder="15" />
                </FieldGroup>
                <FieldGroup label="Frais de retour (€)" direction="left" tooltip="Coût logistique d'un retour (colissimo retour, réemballage, etc.). Laissez à 0 si vous ne traitez pas les retours ou s'ils sont à la charge du client.">
                  <input type="text" inputMode="decimal" value={simForm.fraisRetour ?? "0"} onChange={updateSim("fraisRetour")} style={inputStyle} placeholder="0" />
                </FieldGroup>
                <FieldGroup label="Coût d'emballage (€)" direction="left" tooltip="Coût de l'emballage par commande (boîte, papier de soie, sticker, etc.). Typiquement 0,50€–2€ selon le niveau de marque.">
                  <input type="text" inputMode="decimal" value={simForm.coutEmballage ?? "0"} onChange={updateSim("coutEmballage")} style={inputStyle} placeholder="0" />
                </FieldGroup>
              </div>
            </div>

            <MessageBlock items={simErrors} color="#D72C0D" bg="#FFF4F4" borderColor="#D72C0D" />
            <s-button onClick={handleSimulate}>Calculer le prix minimum →</s-button>

            {simResult && (
              <div style={{ marginTop: "28px" }}>
                <div className="tcc-sim-cards" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
                  <div style={{ padding: "24px", borderRadius: "10px", background: "#F1F8F5", border: "2px solid #008060", textAlign: "center" }}>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Prix de vente minimum</div>
                    <div style={{ fontSize: "32px", fontWeight: "800", color: "#008060", marginBottom: "6px" }}>{formatEur(simResult.prixVenteMin)}</div>
                    <div style={{ fontSize: "12px", color: "#6D7175" }}>pour {formatPct(parseFloat(simResult.targetMargin))} % de marge nette</div>
                    <div style={{ fontSize: "12px", color: "#008060", fontWeight: "600", marginTop: "4px" }}>({formatEur(simResult.prixVenteMin * parseFloat(simResult.targetMargin) / 100)} par vente)</div>
                  </div>
                  <div style={{ padding: "24px", borderRadius: "10px", background: "#F9FAFB", border: "2px solid #E4E5E7", textAlign: "center" }}>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Prix de vente recommandé</div>
                    <div style={{ fontSize: "32px", fontWeight: "800", color: "#202223", marginBottom: "6px" }}>{formatEur(simResult.prixVenteRec)}</div>
                    <div style={{ fontSize: "12px", color: "#6D7175" }}>+10 % de sécurité ({formatPct(parseFloat(simResult.targetMargin) + 4.5)} % marge estimée)</div>
                    <div style={{ fontSize: "12px", color: "#202223", fontWeight: "600", marginTop: "4px" }}>({formatEur(simResult.prixVenteRec * (parseFloat(simResult.targetMargin) + 4.5) / 100)} par vente)</div>
                  </div>
                </div>
                <div className="tcc-sim-detail" style={{ padding: "14px 18px", borderRadius: "8px", background: "#F9FAFB", border: "1px solid #E4E5E7", fontSize: "13px", color: "#6D7175", lineHeight: "1.8" }}>
                  <strong style={{ color: "#202223" }}>Détail du calcul :</strong><br />
                  Coût rendu (achat + douane + TVA import + port) = <strong>{formatEur(simResult.coutRendu)}</strong><br />
                  {simResult.fraisFixes > 0 && (() => {
                    const parts = [];
                    if ((simResult.fraisRetour ?? 0) + (simResult.coutEmballage ?? 0) > 0) parts.push("retour + emballage");
                    if ((simResult.processorFixedFee ?? 0) > 0) parts.push(`frais fixe ${simResult.paymentProcessor ?? "processeur"}`);
                    return <>Frais fixes ({parts.join(" + ") || "divers"}) = <strong>{formatEur(simResult.fraisFixes)}</strong><br /></>;
                  })()}
                  Taux de frais variables (Shopify + {simResult.paymentProcessor ?? "Paiement"} + retours + ads) = <strong>{formatPct(simResult.totalFeeRate * 100)} %</strong><br />
                  Formule : ({formatNum(simResult.coutRendu)}{simResult.fraisFixes > 0 ? ` + ${formatNum(simResult.fraisFixes)}` : ""}) ÷ (1 − {formatPct(simResult.totalFeeRate * 100)} % − {formatPct(parseFloat(simResult.targetMargin))} %) = {formatEur(simResult.prixVenteMin)}
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
                          {calc.product_title || "Calcul manuel"}
                          {annot && <div style={{ fontSize: "10px", color: "#7C3AED", marginTop: "2px" }}>● {annot.note}</div>}
                        </div>
                        <div className="tcc-hist-col-cat" style={{ padding: "11px 12px", fontSize: "12px", color: "#202223" }}>{calc.category}</div>
                        <div className="tcc-hist-col-pays" style={{ padding: "11px 12px", fontSize: "12px", color: "#202223" }}>{calc.country}</div>
                        <div style={{ padding: "11px 12px", fontSize: "13px", color: "#202223" }}>{formatEur(calc.selling_price)}</div>
                        <div style={{ padding: "11px 12px" }}>
                          <span style={{ fontSize: "13px", fontWeight: "700", color: mc }}>{formatPct(calc.net_margin_percent)} %</span>
                          <span style={{ fontSize: "11px", color: "#6D7175", marginLeft: "4px" }}>{formatEur(calc.net_margin_euros)}</span>
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
                <div className="tcc-alert-input" style={{ display: "flex", gap: "10px" }}>
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
                  <div className="tcc-alert-row" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", background: "#FFF4F4", borderBottom: "1px solid #F1D0D0" }}>
                    {["Produit", "Catégorie", "Marge nette", "Écart"].map((h, idx) => (
                      <div key={h} className={idx === 3 ? "tcc-alert-col-ecart" : ""} style={{ padding: "10px 14px", fontSize: "11px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.6px" }}>{h}</div>
                    ))}
                  </div>
                  {violations.map((v, i) => (
                    <div key={v.id} className="tcc-alert-row" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", background: i % 2 === 0 ? "#fff" : "#FFF8F8", borderBottom: i < violations.length - 1 ? "1px solid #F1F2F3" : "none" }}>
                      <div style={{ padding: "11px 14px", fontSize: "13px", fontWeight: "500", color: "#202223" }}>{v.product_title ?? v.category}</div>
                      <div style={{ padding: "11px 14px", fontSize: "12px", color: "#6D7175" }}>{v.category}</div>
                      <div style={{ padding: "11px 14px", fontSize: "13px", fontWeight: "700", color: "#D72C0D" }}>{formatPct(v.net_margin_percent)} %</div>
                      <div className="tcc-alert-col-ecart" style={{ padding: "11px 14px", fontSize: "12px", color: "#D72C0D" }}>−{formatPct(initialThreshold - v.net_margin_percent)} pts</div>
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
            // Dedup TOP by normalized title (same product created twice keeps only the best-ranked entry).
            const _seenTop = new Set();
            const topWinners = winners.filter(p => {
              const key = p.title.toLowerCase().trim();
              if (_seenTop.has(key)) return false;
              _seenTop.add(key); return true;
            }).slice(0, 10);
            // Detect normalized-title duplicates for table badges (data untouched, visual only).
            const _titleCounts = {};
            products.forEach(p => { const k = p.title.toLowerCase().trim(); _titleCounts[k] = (_titleCounts[k] || 0) + 1; });
            const duplicateTitles = new Set(Object.keys(_titleCounts).filter(k => _titleCounts[k] > 1));
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
                  <div className="tcc-audit-params" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "12px" }}>
                    <div>
                      <div style={{ fontSize: "11px", color: "#6D7175", marginBottom: "4px" }}>Modèle logistique</div>
                      <select value={auditParams.shipping_model} onChange={e => setAuditParams(p => ({ ...p, shipping_model: e.target.value }))} style={{ ...inputStyle, fontSize: "13px" }}>
                        <option value="dropshipping">Dropshipping</option>
                        <option value="stock">Import en stock</option>
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "#6D7175", marginBottom: "4px" }}>Régime TVA</div>
                      <select value={auditParams.vat_regime} onChange={e => setAuditParams(p => ({ ...p, vat_regime: e.target.value }))} style={{ ...inputStyle, fontSize: "13px" }}>
                        <option value="assujetti">Assujetti</option>
                        <option value="franchise">Franchise</option>
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "#6D7175", marginBottom: "4px" }}>Processeur paiement</div>
                      <select value={auditParams.payment_processor} onChange={e => setAuditParams(p => ({ ...p, payment_processor: e.target.value }))} style={{ ...inputStyle, fontSize: "13px" }}>
                        {PAYMENT_PROCESSORS.map(proc => <option key={proc.id} value={proc.id}>{proc.id}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "#6D7175", marginBottom: "4px" }}>Frais Shopify (taux)</div>
                      <input type="text" value={auditParams.shopify_fee} onChange={e => setAuditParams(p => ({ ...p, shopify_fee: e.target.value }))}
                        style={{ ...inputStyle, fontSize: "13px" }} placeholder="0.02" />
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "#6D7175", marginBottom: "4px" }}>Retours (taux)</div>
                      <input type="text" value={auditParams.returns_rate} onChange={e => setAuditParams(p => ({ ...p, returns_rate: e.target.value }))}
                        style={{ ...inputStyle, fontSize: "13px" }} placeholder="0.05" />
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "#6D7175", marginBottom: "4px" }}>Port fournisseur estimé (€)</div>
                      <input type="text" value={auditParams.shipping_cost} onChange={e => setAuditParams(p => ({ ...p, shipping_cost: e.target.value }))}
                        style={{ ...inputStyle, fontSize: "13px" }} placeholder="8" />
                    </div>
                    {auditParams.shipping_model === "stock" && (
                      <div>
                        <div style={{ fontSize: "11px", color: "#6D7175", marginBottom: "4px" }}>Unités / envoi fournisseur</div>
                        <input type="text" value={auditParams.qty_per_shipment} onChange={e => setAuditParams(p => ({ ...p, qty_per_shipment: e.target.value }))}
                          style={{ ...inputStyle, fontSize: "13px" }} placeholder="1" />
                        {(!auditParams.qty_per_shipment || auditParams.qty_per_shipment === "1") && (
                          <div style={{ fontSize: "10px", color: "#B98900", marginTop: "3px", lineHeight: "1.4" }}>
                            ⚠ Port imputé à 100 % sur chaque unité. Entrez votre vraie quantité de réassort (ex. 50).
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {auditParams.shipping_model === "dropshipping" && (
                    <div style={{ fontSize: "11px", color: "#7C3AED", background: "#f8f6ff", border: "1px solid #c5b8ff", borderRadius: "6px", padding: "8px 12px", marginBottom: "12px", lineHeight: "1.5" }}>
                      Régime UE : <strong>0€ de douane jusqu'au 30/06/2026</strong>, puis <strong>3€ forfaitaires par article dès le 01/07/2026</strong>. Hypothèse : 1 article = 1 colis = 1 position tarifaire. Si vous groupez plusieurs unités d'un même produit dans un colis, le coût réel par unité est plus bas.
                    </div>
                  )}
                  <button onClick={handleRunAudit} disabled={isAuditing} className="tcc-audit-btn"
                    style={{ padding: "10px 24px", background: "linear-gradient(135deg,#7C3AED,#5B21B6)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: "600", cursor: isAuditing ? "default" : "pointer", fontFamily: "inherit", opacity: isAuditing ? 0.8 : 1 }}>
                    {isAuditing ? "Analyse en cours…" : "Lancer l'audit →"}
                  </button>
                </div>

                {/* Progress */}
                {isAuditing && (
                  <div style={{ marginBottom: "20px" }}>
                    <div style={{ fontSize: "13px", color: "#7C3AED", marginBottom: "8px", fontWeight: "500" }}>
                      Récupération des produits via Shopify API… {auditElapsed}s
                    </div>
                    <div style={{ height: "6px", borderRadius: "3px", background: "#E4E5E7", overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "linear-gradient(90deg,#7C3AED,#5B21B6)", borderRadius: "3px", width: `${Math.min(95, (auditElapsed / 10) * 100)}%`, transition: "width 1s linear" }} />
                    </div>
                    <div style={{ fontSize: "11px", color: "#6D7175", marginTop: "4px" }}>
                      Peut prendre jusqu'à 10 secondes selon la taille de votre catalogue.
                    </div>
                  </div>
                )}

                {/* Error */}
                {auditData?.error && !isAuditing && (
                  <div style={{ padding: "14px 18px", borderRadius: "8px", background: "#FFF4F4", border: "1px solid #D72C0D44", marginBottom: "16px", fontSize: "13px", color: "#D72C0D" }}>
                    {auditData.error}
                  </div>
                )}

                {/* Summary */}
                {auditData && !auditData.error && !isAuditing && (
                  <>
                    <div className="tcc-audit-kpi" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px", marginBottom: "20px" }}>
                      <StatCard label="Produits analysés"   value={products.length} sub="avec coût renseigné" color="#202223" bg="#F9FAFB" />
                      <StatCard label="Top Performers ✅"  value={winners.length} sub="marge > 15%"  color="#008060" bg="#F1F8F5" />
                      <StatCard label="Produits à risque ⚠️" value={risky.length}  sub="marge 0–15%"  color="#B98900" bg="#FFF9EC" />
                      <StatCard label="Money Losers 🔴"    value={losers.length}  sub="marge < 0%"   color="#D72C0D" bg="#FFF4F4" />
                    </div>

                    {losers.length > 0 && (
                      <div style={{ padding: "14px 18px", borderRadius: "8px", background: "#FFF4F4", border: "1px solid #D72C0D44", marginBottom: "16px" }}>
                        <div style={{ fontSize: "14px", fontWeight: "700", color: "#D72C0D", marginBottom: "6px" }}>
                          🚨 ALERTE : {losers.length} produit{losers.length > 1 ? "s" : ""} vous {losers.length === 1 ? "fait" : "font"} perdre de l'argent
                        </div>
                        <div style={{ fontSize: "12px", color: "#6D7175" }}>{losers.slice(0,3).map(p => p.title).join(", ")}{losers.length > 3 ? ` et ${losers.length - 3} autres…` : ""}</div>
                      </div>
                    )}

                    {topWinners.length > 0 && (
                      <div style={{ padding: "14px 18px", borderRadius: "8px", background: "#F1F8F5", border: "1px solid #00806044", marginBottom: "20px" }}>
                        <div style={{ fontSize: "14px", fontWeight: "700", color: "#008060", marginBottom: "8px" }}>🏆 TOP {topWinners.length} produit{topWinners.length > 1 ? "s" : ""} les plus rentables</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          {topWinners.map((p,i) => (
                            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px" }}>
                              <span style={{ width: "20px", fontWeight: "700", color: "#008060" }}>#{i+1}</span>
                              <span style={{ flex: 1, color: "#202223" }}>{p.title}</span>
                              <span style={{ fontWeight: "700", color: "#008060" }}>{formatPct(p.netPct)} %</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Full table */}
                    <div style={{ fontSize: "13px", color: "#6D7175", marginBottom: "10px", lineHeight: "1.6" }}>
                      Seuls les <strong>{products.length}</strong> produit{products.length > 1 ? "s" : ""} ayant un coût fournisseur renseigné dans Shopify apparaissent ci-dessous.
                      {auditData.totalScanned - products.length > 0 && (
                        <> Les <strong>{auditData.totalScanned - products.length}</strong> autre{auditData.totalScanned - products.length > 1 ? "s" : ""} produit{auditData.totalScanned - products.length > 1 ? "s" : ""} de votre catalogue n'ont pas de coût renseigné.</>
                      )}
                    </div>
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
                            <div style={{ padding: "10px 12px", overflow: "hidden" }}>
                              <div style={{ fontSize: "13px", color: "#202223", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {p.title}
                                {duplicateTitles.has(p.title.toLowerCase().trim()) && (
                                  <span style={{ marginLeft: "6px", fontSize: "10px", color: "#B98900", background: "#FFF9EC", padding: "1px 5px", borderRadius: "4px", fontWeight: "600", verticalAlign: "middle" }}>doublon</span>
                                )}
                              </div>
                              <div style={{ fontSize: "11px", color: p.isDefaultCategory ? "#B98900" : "#8A8F98", marginTop: "2px" }}>
                                {p.mappedCategory}{p.isDefaultCategory ? " — estimation" : ""}
                              </div>
                            </div>
                            <div style={{ padding: "10px 12px", fontSize: "12px", color: "#202223" }}>{formatEur(p.price)}</div>
                            <div className="tcc-audit-col-cost" style={{ padding: "10px 12px", fontSize: "12px", color: "#202223" }}>{formatEur(p.cost)}</div>
                            <div style={{ padding: "10px 12px" }}><span style={{ fontSize: "13px", fontWeight: "700", color: statusColor }}>{formatPct(p.netPct)} %</span></div>
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
                          <div>• <strong>Augmentez le prix de vente</strong> : ces produits sont actuellement vendus à perte. Utilisez l'onglet Simulation pour calculer le prix minimum.</div>
                          <div>• <strong>Renégociez avec votre fournisseur</strong> ou changez de source d'approvisionnement si le prix de vente ne peut pas être augmenté.</div>
                          <div>• <strong>Envisagez de désactiver ces produits</strong> jusqu'à résolution — chaque vente aggrave vos pertes.</div>
                        </div>
                      </div>
                    )}
                    {risky.length > 0 && (
                      <div style={{ padding: "16px 20px", borderRadius: "10px", background: "#FFF9EC", border: "1px solid #B9890033" }}>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#B98900", marginBottom: "10px" }}>⚠️ {risky.length} produit{risky.length > 1 ? "s" : ""} à marge insuffisante (0–15%) — à optimiser</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "7px", fontSize: "13px", color: "#202223", lineHeight: "1.6" }}>
                          <div>• <strong>Marge insuffisante pour couvrir vos frais variables et dégager un bénéfice net réel.</strong> Ciblez au minimum 20–25% de marge nette.</div>
                          <div>• <strong>Évitez les campagnes publicitaires sur ces produits</strong> — chaque euro de pub réduit encore votre marge.</div>
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

        {/* ════════ SUIVI DES COÛTS (Brique A) ═══════════════════════════════ */}
        {activeTab === "costs" && <CostTracker defaultImportCountry={defaultImportCountry} fees={fees} feesCurrency={feesCurrency} profitabilityThresholdPct={profitabilityThresholdPct}
          currentCpa={currentCpa} currentCpaUpdatedAt={currentCpaUpdatedAt} cpaTargets={cpaTargets} cpaByProduct={cpaByProduct}
          orderMargins={orderMargins} orderMarginsTotal={orderMarginsTotal} orderMarginsCapped={orderMarginsCapped} orderMarginsCap={orderMarginsCap}
          productTitleById={Object.fromEntries((products ?? []).map(p => [p.id, p.title]))} />}

      </s-section>

      {/* Annotation modal */}
      {annotModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: "12px", padding: "28px", width: "400px", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#202223", marginBottom: "16px" }}>Annoter ce point de données</div>
            <textarea value={annotText} onChange={e => setAnnotText(e.target.value.slice(0, 500))} rows={3}
              placeholder="Ex: Changement de fournisseur, Hausse des droits de douane…"
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
            <div style={{ fontSize: "11px", textAlign: "right", marginTop: "3px", color: annotText.length > 450 ? "#D72C0D" : "#6D7175" }}>
              {annotText.length}/500
            </div>
            {annotFetcher.data?.error && (
              <div style={{ marginTop: "6px", fontSize: "12px", color: "#D72C0D" }}>{annotFetcher.data.error}</div>
            )}
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

          <div className="tcc-result-block" style={{ padding: "20px 24px", borderRadius: "8px", background: marginBg, borderLeft: `5px solid ${marginColor}`, marginBottom: "28px" }}>
            {results.margeNettePercent < 0 ? (
              <>
                <div style={{ fontSize: "17px", fontWeight: "700", color: "#D72C0D", marginBottom: "8px" }}>Perte nette — vous perdez de l'argent à chaque vente.</div>
                <div style={{ fontSize: "14px", color: "#6D7175", lineHeight: "1.6" }}>
                  Votre marge apparente : <strong style={{ color: "#202223" }}>{formatPct(results.margeApparente)} %</strong>
                  {" → "}Votre marge nette réelle : <strong style={{ color: "#D72C0D" }}>{formatPct(results.margeNettePercent)} %</strong>
                  <span style={{ display: "block" }}>(<strong style={{ color: "#D72C0D" }}>−{formatEur(Math.abs(results.margeNette))} par vente</strong>)</span>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "17px", fontWeight: "700", color: marginColor, marginBottom: "8px" }}>{marginLabel}</div>
                <div style={{ fontSize: "14px", color: "#6D7175", lineHeight: "1.6" }}>
                  Votre marge apparente : <strong style={{ color: "#202223" }}>{formatPct(results.margeApparente)} %</strong>
                  {" → "}Votre marge nette réelle : <strong style={{ color: marginColor }}>{formatPct(results.margeNettePercent)} %</strong>
                  <span style={{ display: "block" }}>(<strong style={{ color: marginColor }}>{formatEur(results.margeNette)} par vente</strong>)</span>
                </div>
              </>
            )}
          </div>

          <div style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
              <span style={{ fontSize: "13px", fontWeight: "500", color: "#6D7175" }}>Marge nette réelle</span>
              <span style={{ fontSize: "26px", fontWeight: "800", color: marginColor, letterSpacing: "-0.5px" }}>{formatPct(results.margeNettePercent)} %</span>
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
            <StatCard label="Marge apparente"    value={`${formatPct(results.margeApparente)} %`}    sub="Marge apparente calculée"        color="#6D7175"   bg="#F9FAFB" />
            <StatCard label="Marge brute"         value={`${formatPct(results.margeBrutePercent)} %`} sub={`${formatEur(results.margeBrute)} / vente`} color="#202223"   bg="#F9FAFB" />
            <StatCard label="Marge nette réelle"  value={`${formatPct(results.margeNettePercent)} %`} sub={`${formatEur(results.margeNette)} / vente`} color={marginColor} bg={marginBg} />
          </div>

          <div className="tcc-cost-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            <div>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "12px" }}>Structure du coût d'achat</div>
              {[
                { label: "Prix fournisseur",                      value: formatEur(results.prixAchat),  color: "#202223" },
                { label: (() => {
                    const sm = form.shippingModel ?? "stock";
                    const pa = results.prixAchat ?? 0;
                    if (results.douane === 0) {
                      if (sm === "dropshipping" && pa <= LOW_VALUE_PARCEL_CEILING) {
                        return new Date() < EU_DROPSHIP_DUTY_REFORM_DATE
                          ? `+ Droits de douane (exonéré jusqu'au 30/06/2026)`
                          : `+ Droits de douane (faible valeur — exonéré)`;
                      }
                      return `+ Droits de douane (exonéré)`;
                    }
                    if (sm === "dropshipping" && pa <= LOW_VALUE_PARCEL_CEILING) {
                      return `+ Droits de douane (forfait 3€/article — réforme UE)`;
                    }
                    return `+ Droits de douane (${(results.customsRate*100).toFixed(0)} % sur CIF)`;
                  })(), value: `+${formatEur(results.douane)}`, color: "#6D7175" },
                { label: `+ TVA à l'import (${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format((results.vatRate ?? 0.20) * 100)} %)${results.vatRegime !== "franchise" ? " — récupérable" : ""}`, value: `+${formatEur(results.tvaImport)}`, color: results.vatRegime !== "franchise" ? "#008060" : "#6D7175" },
                { label: `+ Frais de port (${form.paysImport})`,  value: `+${formatEur(results.shipping)}`,  color: "#6D7175" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F1F2F3" }}>
                  <span style={{ fontSize: "13px", color }}>{label}</span>
                  <span style={{ fontSize: "13px", fontWeight: "600", color }}>{value}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0 0" }}>
                <span style={{ fontSize: "14px", fontWeight: "700", color: "#202223" }}>= Coût rendu total</span>
                <span style={{ fontSize: "15px", fontWeight: "700", color: "#202223" }}>{formatEur(results.coutRendu)}</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "12px" }}>Déductions sur le prix de vente</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F1F2F3" }}>
                <span style={{ fontSize: "13px", color: "#008060" }}>Prix de vente</span>
                <span style={{ fontSize: "13px", fontWeight: "600", color: "#008060" }}>{formatEur(results.prixVente)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F1F2F3" }}>
                <span style={{ fontSize: "13px", color: "#D72C0D" }}>— Coût rendu</span>
                <span style={{ fontSize: "13px", fontWeight: "600", color: "#D72C0D" }}>-{formatEur(results.coutRendu)}</span>
              </div>
              {[
                { label: `— Frais Shopify (${form.shopifyFee}%)`, value: results.shopifyCost },
                { label: `— ${form.paymentProcessor} (${form.stripeFee}% + ${form.processorFixedFee ?? "0.25"}€)`, value: results.stripeCost },
                { label: `— Provision retours (${form.retours}%)`, value: results.retoursCost },
                { label: `— Budget ads (${form.ads}%)`,           value: results.adsCost },
                ...(results.fraisRetour > 0 ? [{ label: "— Frais de retour", value: results.fraisRetour }] : []),
                ...(results.coutEmballage > 0 ? [{ label: "— Coût d'emballage", value: results.coutEmballage }] : []),
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F1F2F3" }}>
                  <span style={{ fontSize: "13px", color: "#D72C0D" }}>{label}</span>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "#D72C0D" }}>-{formatEur(value)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0 0" }}>
                <span style={{ fontSize: "14px", fontWeight: "700", color: marginColor }}>= Marge nette réelle</span>
                <span style={{ fontSize: "15px", fontWeight: "700", color: marginColor }}>{formatEur(results.margeNette)}</span>
              </div>
            </div>
          </div>

          {/* Feature 5: AI recommendation */}
          <AIRecommendation fetcher={aiFetcher} />

          {/* Expert: Break-Even ROAS */}
          {isExpert ? (
            <BreakEvenROAS results={results} onGoToSimulation={() => setActiveTab("simulate")} />
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

      <s-section slot="aside">
        <button onClick={() => setMethOpen(v => !v)} style={{ width: "100%", background: "none", border: "none", padding: "0 0 4px 0", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "13px", fontWeight: "600", color: "#202223" }}>Méthodologie</span>
          <span style={{ fontSize: "11px", color: "#6D7175", display: "inline-block", transition: "transform 0.3s", transform: methOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
        </button>
        <div style={{ maxHeight: methOpen ? "600px" : "0", overflow: "hidden", transition: "max-height 0.3s ease" }}>
          <s-unordered-list>
            <s-list-item><strong>Prix fournisseur</strong> — Ce que vous payez pour acheter le produit à votre fournisseur.</s-list-item>
            <s-list-item><strong>Droits de douane</strong> — Les taxes que vous devez payer quand vous faites entrer un produit en France depuis l'étranger (Chine, Turquie, etc.).</s-list-item>
            <s-list-item><strong>TVA à l'import</strong> — La TVA payée à l'importation (taux normal 20 %, réduit 5,5 % pour l'alimentation et les livres) — vous pouvez la récupérer si vous êtes assujetti à la TVA.</s-list-item>
            <s-list-item><strong>Frais de port</strong> — Le coût d'expédition depuis le pays de votre fournisseur jusqu'en France.</s-list-item>
            <s-list-item><strong>Commissions plateformes</strong> — Ce que Shopify et Stripe prélèvent sur chaque vente que vous réalisez.</s-list-item>
            <s-list-item><strong>Provision retours</strong> — Une réserve calculée pour couvrir les remboursements et retours clients.</s-list-item>
          </s-unordered-list>
          <s-paragraph>
            <strong>Sources :</strong> Tarif douanier TARIC (CE 2658/87), barèmes Shopify et Stripe publics, estimations sectorielles basées sur les tendances marché actuelles pour les taux de retour.
          </s-paragraph>
        </div>
      </s-section>

      <s-section slot="aside">
        <button onClick={() => setDouaneOpen(v => !v)} style={{ width: "100%", background: "none", border: "none", padding: "0 0 4px 0", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "13px", fontWeight: "600", color: "#202223" }}>Taux de douane</span>
          <span style={{ fontSize: "11px", color: "#6D7175", display: "inline-block", transition: "transform 0.3s", transform: douaneOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
        </button>
        <div style={{ maxHeight: douaneOpen ? "600px" : "0", overflow: "hidden", transition: "max-height 0.3s ease" }}>
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
