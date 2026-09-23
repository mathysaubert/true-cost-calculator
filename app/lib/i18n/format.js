// ── Formatage par locale et devise — PUR (Intl seulement) ────────────────────────────────────
// Remplace, pour les écrans F4, formatMoney/formatPct/formatNum codés en fr-FR. La locale est celle
// RENDUE par le loader (jamais celle du navigateur : pas de mismatch d'hydratation) ; la devise est
// celle de la boutique (shop_settings.shop_currency). "MIXED" ou devise invalide → nombre neutre
// suivi du code, jamais un mauvais symbole (invariant lot 7).

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const safeLocale = (locale) => { try { new Intl.NumberFormat(locale); return locale; } catch { return "en"; } };

export function formatMoney(value, locale = "en", currency = null, { digits = 2 } = {}) {
  const v = num(value);
  if (v === null) return null;
  const loc = safeLocale(locale);
  if (typeof currency === "string" && /^[A-Z]{3}$/.test(currency)) {
    for (const opts of [{ currencyDisplay: "narrowSymbol" }, {}]) {
      try {
        return new Intl.NumberFormat(loc, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits, ...opts }).format(v);
      } catch { /* devise ou option non supportée → essai suivant */ }
    }
  }
  const plain = new Intl.NumberFormat(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  return currency && currency !== "MIXED" ? `${plain} ${currency}` : plain;
}

export function formatInt(value, locale = "en") {
  const v = num(value);
  return v === null ? null : new Intl.NumberFormat(safeLocale(locale), { maximumFractionDigits: 0 }).format(v);
}

export function formatNumber(value, locale = "en", { digits = 2 } = {}) {
  const v = num(value);
  return v === null ? null : new Intl.NumberFormat(safeLocale(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

// Pourcentage : la valeur est déjà en points (64.7 → « 64,7 % »).
export function formatPct(value, locale = "en", { digits = 1 } = {}) {
  const v = num(value);
  return v === null ? null : new Intl.NumberFormat(safeLocale(locale), { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v / 100);
}

// Ratio (ROAS, MER, LTV/CAC) : « 3,57× » — le suffixe × est universel (pas de traduction).
export function formatRatio(value, locale = "en", { digits = 2 } = {}) {
  const v = num(value);
  return v === null ? null : `${new Intl.NumberFormat(safeLocale(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)}×`;
}

// Écart signé : pct → « +12,3 % » ; points → « +2,1 pt » (unité passée par l'appelant, traduite).
export function formatDelta(value, locale = "en", { kind = "pct", digits = 1, pointsLabel = "pt" } = {}) {
  const v = num(value);
  if (v === null) return null;
  const loc = safeLocale(locale);
  if (kind === "pct") return new Intl.NumberFormat(loc, { style: "percent", signDisplay: "exceptZero", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v / 100);
  return `${new Intl.NumberFormat(loc, { signDisplay: "exceptZero", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)} ${pointsLabel}`;
}

// Date calendaire (YYYY-MM-DD, jour boutique) ou ISO → date courte de la locale. Le jour local est
// formaté SANS fuseau (c'est déjà un jour boutique) ; un ISO complet l'est dans le fuseau donné.
export function formatDay(day, locale = "en", { timeZone = "UTC", style = "medium" } = {}) {
  if (!day) return null;
  const loc = safeLocale(locale);
  const isDayOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(day));
  const d = isDayOnly ? new Date(`${day}T12:00:00Z`) : new Date(day);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(loc, { dateStyle: style, timeZone: isDayOnly ? "UTC" : timeZone }).format(d);
  } catch { return new Intl.DateTimeFormat(loc, { dateStyle: style }).format(d); }
}

export function formatDateTime(iso, locale = "en", { timeZone = "UTC" } = {}) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try { return new Intl.DateTimeFormat(safeLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone }).format(d); }
  catch { return new Intl.DateTimeFormat(safeLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(d); }
}

// Formate une valeur de nœud selon son unité (nodes.js : money | pct | ratio | count).
export function formatByUnit(value, unit, locale, currency) {
  switch (unit) {
    case "money": return formatMoney(value, locale, currency);
    case "pct":   return formatPct(value, locale);
    case "ratio": return formatRatio(value, locale);
    case "count": return formatInt(value, locale);
    default:      return formatNumber(value, locale);
  }
}
