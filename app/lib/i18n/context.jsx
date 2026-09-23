// ── Contexte React i18n (F4) ─────────────────────────────────────────────────────────────────
// Le loader de app.jsx résout la locale et charge les catalogues ; ce fournisseur expose `t`,
// `locale`, `dir`, `currency`, `timeZone` aux écrans. Aucune lecture de la locale App Bridge côté client ici :
// le rendu serveur et le rendu client utilisent la MÊME locale (pas de mismatch d'hydratation).
import { createContext, useContext, useMemo } from "react";
import { createTranslator } from "./t.js";
import { localeDir, DEFAULT_LOCALE } from "./resolveLocale.js";
import * as fmt from "./format.js";

const I18nContext = createContext(null);

export function I18nProvider({ locale = DEFAULT_LOCALE, catalogs = {}, currency = null, timeZone = "UTC", children }) {
  const value = useMemo(() => {
    const t = createTranslator({ catalogs, locale, fallback: DEFAULT_LOCALE });
    return {
      t, locale, dir: localeDir(locale), currency, timeZone,
      money: (v, opts) => fmt.formatMoney(v, locale, currency, opts),
      int: (v) => fmt.formatInt(v, locale),
      number: (v, opts) => fmt.formatNumber(v, locale, opts),
      pct: (v, opts) => fmt.formatPct(v, locale, opts),
      ratio: (v, opts) => fmt.formatRatio(v, locale, opts),
      delta: (v, opts) => fmt.formatDelta(v, locale, { pointsLabel: t("common.points"), ...opts }),
      day: (d, opts) => fmt.formatDay(d, locale, { timeZone, ...opts }),
      dateTime: (d) => fmt.formatDateTime(d, locale, { timeZone }),
      relative: (d, now) => fmt.formatRelative(d, locale, now),
      byUnit: (v, unit) => fmt.formatByUnit(v, unit, locale, currency),
    };
  }, [locale, catalogs, currency, timeZone]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n: I18nProvider manquant (app.jsx doit envelopper la route)");
  return ctx;
}
