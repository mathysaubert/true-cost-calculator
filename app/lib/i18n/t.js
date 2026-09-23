// ── Traduction — PUR (aucune I/O, aucun React) ────────────────────────────────────────────────
// Module maison à API compatible i18next (arbitrage C4c) : `t(key, vars)`, interpolation `{{name}}`,
// pluriels par suffixe `_zero|_one|_two|_few|_many|_other` choisis par Intl.PluralRules sur
// `vars.count`. Catalogue = objet PLAT { "dashboard.title": "…" }. Clé absente → catalogue de repli
// (en) → la clé elle-même (jamais une chaîne vide, jamais `undefined`), et `onMissing` est notifié.

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];
const rulesCache = new Map();
function pluralCategory(locale, count) {
  let pr = rulesCache.get(locale);
  if (!pr) {
    try { pr = new Intl.PluralRules(locale); } catch { pr = new Intl.PluralRules("en"); }
    rulesCache.set(locale, pr);
  }
  return pr.select(count);
}

export function interpolate(template, vars = {}) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, name) => {
    const v = vars[name];
    return v === undefined || v === null ? "" : String(v);
  });
}

// Cherche la clé (avec variante plurielle si `count` est un nombre) dans UN catalogue.
function lookup(catalog, locale, key, vars) {
  if (!catalog) return undefined;
  if (typeof vars?.count === "number" && Number.isFinite(vars.count)) {
    const cat = pluralCategory(locale, vars.count);
    if (vars.count === 0 && catalog[`${key}_zero`] !== undefined) return catalog[`${key}_zero`];
    if (catalog[`${key}_${cat}`] !== undefined) return catalog[`${key}_${cat}`];
    if (catalog[`${key}_other`] !== undefined) return catalog[`${key}_other`];
  }
  return catalog[key];
}

// catalogs : { en: {...}, fr: {...} } ; locale servie ; fallback (défaut "en").
export function createTranslator({ catalogs = {}, locale = "en", fallback = "en", onMissing = null } = {}) {
  const primary = catalogs[locale];
  const secondary = locale === fallback ? null : catalogs[fallback];
  const t = (key, vars = {}) => {
    let raw = lookup(primary, locale, key, vars);
    if (raw === undefined && secondary) {
      raw = lookup(secondary, fallback, key, vars);
      if (raw !== undefined && typeof onMissing === "function") onMissing(key, locale, "fallback");
    }
    if (raw === undefined) {
      if (typeof onMissing === "function") onMissing(key, locale, "missing");
      return key;
    }
    return interpolate(raw, vars);
  };
  t.locale = locale;
  t.has = (key) => lookup(primary, locale, key, {}) !== undefined || (secondary ? lookup(secondary, fallback, key, {}) !== undefined : false);
  return t;
}

// Clés « de base » d'un catalogue : les variantes plurielles sont ramenées à leur clé racine.
export function baseKeys(catalog = {}) {
  const out = new Set();
  for (const k of Object.keys(catalog)) {
    const m = k.match(/^(.*)_(zero|one|two|few|many|other)$/);
    out.add(m && PLURAL_SUFFIXES.includes(m[2]) ? m[1] : k);
  }
  return out;
}
