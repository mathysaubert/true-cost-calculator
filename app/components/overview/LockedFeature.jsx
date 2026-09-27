// ── D2-2 (Z4 a) : fonction non incluse dans l'offre — carte explicative ───────────────────────────
// Ce que fait la fonction, l'offre qui l'inclut, et le passage vers l'écran Offre. Offre indéterminée
// (Shopify injoignable) : message de rechargement, jamais de verrou affirmé sur un doute.
import { Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";

// feature : clé de catalogue (locked.<feature>.*) ; plan : 'pro' | 'expert' ; indeterminate : offre non lue.
export function LockedFeature({ feature, plan = "pro", indeterminate = false }) {
  const { t } = useI18n();
  return (
    <section className="tcc-block" aria-labelledby={`tcc-locked-${feature}`} data-locked={feature}>
      <div className="tcc-block__head">
        <h3 id={`tcc-locked-${feature}`}>{t(`locked.${feature}.title`)}</h3>
        <span className="tcc-badge tcc-badge--accent">{t(`plan.name.${plan}`)}</span>
      </div>
      {indeterminate ? (
        <p className="tcc-muted">{t("locked.indeterminate")}</p>
      ) : (
        <>
          <p>{t(`locked.${feature}.body`)}</p>
          <p className="tcc-muted">{t("locked.included", { plan: t(`plan.name.${plan}`) })}</p>
          <Link to="/app/settings/plan">{t("locked.cta")}</Link>
        </>
      )}
    </section>
  );
}
