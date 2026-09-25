// ── Arbre de la page de preuve navigateur (partagé : rendu serveur en Node, rendu client en page) ──
import { NumberField, SelectField } from "../../app/components/settings/Fields.jsx";
import { I18nProvider } from "../../app/lib/i18n/context.jsx";
import { CATALOGS } from "../../app/locales/index.js";

export const SAVED = { threshold: 45, shipping: 4.9, vat: "franchise" };

function Page({ view, saved }) {
  if (view === "home") return <p id="home">Aujourd&apos;hui</p>;
  return (
    <form method="post" data-save-bar="" id="goals">
      <NumberField name="profitability_threshold_pct" label="Objectif" value={saved.threshold} suffix="%" />
      <NumberField name="shipping_default" label="Port par défaut" value={saved.shipping} />
      <SelectField name="vat_regime" label="TVA" value={saved.vat} options={[{ value: "assujetti", label: "Assujetti" }, { value: "franchise", label: "Franchise" }]} />
    </form>
  );
}

export const tree = (view, saved = SAVED) => <I18nProvider locale="fr" catalogs={{ en: CATALOGS.en, fr: CATALOGS.fr }} currency="EUR" timeZone="UTC"><Page view={view} saved={saved} /></I18nProvider>;
