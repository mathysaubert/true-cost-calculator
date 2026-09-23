// ── Résolution de la locale — PUR (aucune I/O, aucun React) ──────────────────────────────────
// Chaîne de décision C3 (Phase 0 F4) : surcharge marchand (shop_settings.locale_override) >
// paramètre `locale` de la requête (posé par l'admin au chargement initial) > cookie `tcc_locale`
// (posé par nous pour les navigations suivantes) > Accept-Language > "en".
// Les codes suivent ceux de l'admin Shopify (décision 13) : 36 codes ci-dessous ; les 3 RTL
// (ar, he, ur) sont déclarés pour que `dir` suive dès qu'un catalogue existera.

export const SUPPORTED_LOCALES = [
  "en", "fr", "de", "es", "it", "nl", "pt-BR", "pt-PT", "da", "sv", "nb", "fi", "pl", "cs", "sk", "sl",
  "hr", "hu", "ro", "bg", "lt", "el", "ru", "tr", "ja", "ko", "zh-CN", "zh-TW", "th", "vi", "id", "ms",
  "hi", "ar", "he", "ur",
];
export const RTL_LOCALES = ["ar", "he", "ur"];
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "tcc_locale";

// Alias de langues sans région vers la variante régionale servie (choix documentés Phase 0 §4.1).
const BASE_ALIASES = { pt: "pt-BR", zh: "zh-CN", no: "nb", nn: "nb", in: "id", iw: "he" };
const REGION_ALIASES = { "zh-hans": "zh-CN", "zh-hant": "zh-TW", "zh-hk": "zh-TW", "zh-sg": "zh-CN", "zh-mo": "zh-TW" };

const supportedLower = new Map(SUPPORTED_LOCALES.map((l) => [l.toLowerCase(), l]));

// "fr-CA" → "fr" ; "pt-BR" → "pt-BR" ; "pt" → "pt-BR" ; "zh-Hant-TW" → "zh-TW" ; inconnu → null.
export function normalizeLocale(raw, supported = SUPPORTED_LOCALES) {
  if (typeof raw !== "string") return null;
  const tag = raw.trim().replace(/_/g, "-").toLowerCase();
  if (!tag || !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(tag)) return null;
  const table = supported === SUPPORTED_LOCALES ? supportedLower : new Map(supported.map((l) => [l.toLowerCase(), l]));
  if (table.has(tag)) return table.get(tag);
  const parts = tag.split("-");
  const base = parts[0];
  // zh-Hant / zh-Hans / zh-HK…
  for (let i = parts.length; i >= 2; i--) {
    const sub = parts.slice(0, i).join("-");
    if (REGION_ALIASES[sub] && table.has(REGION_ALIASES[sub].toLowerCase())) return table.get(REGION_ALIASES[sub].toLowerCase());
  }
  if (parts.length >= 2) {
    const region = `${base}-${parts[parts.length - 1]}`;
    if (table.has(region)) return table.get(region);
  }
  if (table.has(base)) return table.get(base);
  const alias = BASE_ALIASES[base];
  if (alias && table.has(alias.toLowerCase())) return table.get(alias.toLowerCase());
  // Base sans variante exacte : première variante régionale supportée (ex. "pt-AO" → pt-BR via alias, sinon 1re "pt-*").
  for (const [low, canon] of table) if (low.startsWith(base + "-")) return canon;
  return null;
}

// Accept-Language: "fr-CA,fr;q=0.9,en;q=0.8" → ["fr-CA", "fr", "en"] (ordre de préférence).
export function parseAcceptLanguage(header) {
  if (typeof header !== "string" || !header.trim()) return [];
  return header.split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? parseFloat(q.slice(2)) : 1;
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((x) => x.tag && x.tag !== "*" && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
    .map((x) => x.tag);
}

// Lecture d'un cookie dans l'en-tête Cookie (aucune dépendance).
export function readCookie(cookieHeader, name) {
  if (typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try { return decodeURIComponent(part.slice(idx + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

// Entrée : { override, param, cookie, acceptLanguage } (chaînes brutes ou null). Sortie :
// { locale, source } avec source ∈ override | param | cookie | accept_language | default.
export function resolveLocale({ override = null, param = null, cookie = null, acceptLanguage = null } = {}, supported = SUPPORTED_LOCALES) {
  const o = normalizeLocale(override, supported); if (o) return { locale: o, source: "override" };
  const p = normalizeLocale(param, supported);    if (p) return { locale: p, source: "param" };
  const c = normalizeLocale(cookie, supported);   if (c) return { locale: c, source: "cookie" };
  for (const tag of parseAcceptLanguage(acceptLanguage)) {
    const a = normalizeLocale(tag, supported);
    if (a) return { locale: a, source: "accept_language" };
  }
  return { locale: DEFAULT_LOCALE, source: "default" };
}

export const localeDir = (locale) => (RTL_LOCALES.includes(locale) ? "rtl" : "ltr");

// Valeur d'en-tête Set-Cookie pour mémoriser la locale (iframe admin → SameSite=None; Secure).
export function localeCookieHeader(locale, { maxAgeDays = 365 } = {}) {
  return `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=${maxAgeDays * 86400}; SameSite=None; Secure; HttpOnly`;
}
