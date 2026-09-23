// ── Catalogues chargés (C5 : en + fr en F4-A ; les 33 autres arrivent en F4-D, repli en) ────────
// Le loader ne transmet au client que le catalogue de la locale servie + le repli.
import en from "./en.js";
import fr from "./fr.js";

export const CATALOGS = { en, fr };
export const AVAILABLE_LOCALES = Object.keys(CATALOGS);

export function catalogsFor(locale, fallback = "en") {
  const out = { [fallback]: CATALOGS[fallback] };
  if (CATALOGS[locale]) out[locale] = CATALOGS[locale];
  return out;
}
