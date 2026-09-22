// ── TVA — PUR. Taux de TVA à l'import selon le pays du MARCHAND (décision A8) ─────────────────
// engine.js embarque des taux français ; computeLandedCost prend `vatRate` en paramètre, donc le
// moteur lui passe le bon taux sans le modifier (0 diff, R2). Hors UE → null (pas de TVA d'import
// dans le modèle V1, décision A9 : le marchand l'inclut dans duty_rate_pct s'il ne la récupère pas).
import { EU_VAT_STANDARD, FR_REDUCED_VAT_BY_CATEGORY } from "./config.js";

const norm = (cc) => String(cc ?? "").trim().toUpperCase();

export function isEuCountry(countryCode) {
  return Object.prototype.hasOwnProperty.call(EU_VAT_STANDARD, norm(countryCode));
}

export function vatRateFor({ countryCode, categorie } = {}) {
  const cc = norm(countryCode);
  if (cc === "FR" && FR_REDUCED_VAT_BY_CATEGORY[categorie] != null) return FR_REDUCED_VAT_BY_CATEGORY[categorie];
  return EU_VAT_STANDARD[cc] ?? null;
}
