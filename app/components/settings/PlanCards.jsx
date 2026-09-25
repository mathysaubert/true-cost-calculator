// ── Réglages > Offre (F4-D1b) : offre courante et abonnements, même facturation que l'écran classique ──
import { Form } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { PLAN_CURRENCY } from "../../lib/plans.js";
import { Icon } from "../overview/Icons.jsx";

// view : sortie de planView ; isDevShop : boutique de développement (abonnement de test) ; welcome : retour d'abonnement.
export function PlanCards({ view, isDevShop = false, welcome = false }) {
  const { t, locale } = useI18n();
  if (!view) return null;
  const price = (p) => new Intl.NumberFormat(locale, { style: "currency", currency: PLAN_CURRENCY, maximumFractionDigits: 0 }).format(p);
  return (
    <div className="tcc-stack">
      {welcome && <s-banner tone="success">{t("plan.welcome")}</s-banner>}
      {view.indeterminate && <s-banner tone="warning">{t("plan.indeterminate")}</s-banner>}
      {isDevShop && <s-banner tone="info">{t("plan.dev_store")}</s-banner>}
      {!view.indeterminate && (
        <p className="tcc-muted" data-current-plan={view.current}>
          {t("plan.current", { plan: t(`plan.name.${view.current}`) })}{view.source === "cache" ? ` ${t("plan.cached")}` : ""}
        </p>
      )}
      <div className="tcc-plans-host"><div className="tcc-plans">
        {view.offers.map((o) => (
          <section key={o.id} className={`tcc-plan${o.current ? " is-current" : ""}`} data-plan={o.id} aria-labelledby={`tcc-plan-${o.id}`}>
            <header className="tcc-plan__head">
              <h3 id={`tcc-plan-${o.id}`}>{t(`plan.name.${o.id}`)}</h3>
              {o.current && <span className="tcc-badge tcc-badge--good">{t("plan.badge.current")}</span>}
              {!o.current && o.badge && <span className="tcc-badge">{t(`plan.badge.${o.badge}`)}</span>}
            </header>
            <p className="tcc-plan__price">{t("plan.per_month", { price: price(o.price) })}</p>
            {o.trialDays > 0 && !o.current && <p className="tcc-muted">{t("plan.trial", { count: o.trialDays })}</p>}
            <ul className="tcc-partials">
              {Array.from({ length: o.features }, (_, i) => <li key={i}><Icon id="check" /><span>{t(`plan.feature.${o.id}.${i + 1}`)}</span></li>)}
            </ul>
            {o.canSubscribe && (
              <Form method="post" className="tcc-plan__action">
                <input type="hidden" name="intent" value={`subscribe_${o.id}`} />
                <s-button type="submit" variant="secondary">{t("plan.choose", { plan: t(`plan.name.${o.id}`) })}</s-button>
              </Form>
            )}
          </section>
        ))}
      </div></div>
      <p className="tcc-muted">{view.top ? t("plan.top") : t("plan.fair_use")}</p>
    </div>
  );
}
