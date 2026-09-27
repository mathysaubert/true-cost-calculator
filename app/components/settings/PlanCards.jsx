// ── Réglages > Offre (F4-D1b ; D2-1 W4 a, W7) : offre reconnue, contenu de chaque offre, changement ──
// App Pricing allumée (view.changeUrl) : un seul bouton « Changer d'offre » vers la page d'offres de
// Shopify, ouverte dans la fenêtre de l'admin (target _top, l'app tourne dans un iframe). Éteinte :
// boutons de montée par l'API de facturation, comme avant.
import { Form } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { PLAN_CURRENCY } from "../../lib/plans.js";
import { Icon } from "../overview/Icons.jsx";
import { PlanOverageBanner } from "../overview/Banners.jsx";

// view : sortie de planView ; isDevShop : boutique de développement (abonnement de test) ; welcome : retour d'abonnement.
// usage : volume du mois écoulé (bandeau Z3) ; customHref : demande d'offre sur mesure (mailto).
export function PlanCards({ view, isDevShop = false, welcome = false, usage = null, customHref = null }) {
  const { t, locale } = useI18n();
  if (!view) return null;
  const price = (p) => new Intl.NumberFormat(locale, { style: "currency", currency: PLAN_CURRENCY, maximumFractionDigits: 0 }).format(p);
  const count = (n) => new Intl.NumberFormat(locale).format(n);
  return (
    <div className="tcc-stack">
      {welcome && <s-banner tone="success">{t("plan.welcome")}</s-banner>}
      {view.indeterminate && <s-banner tone="warning">{t("plan.indeterminate")}</s-banner>}
      {isDevShop && <s-banner tone="info">{t("plan.dev_store")}</s-banner>}
      <PlanOverageBanner usage={usage} customHref={customHref} showLink={false} />
      {!view.indeterminate && (
        <p className="tcc-muted" data-current-plan={view.current}>
          {t("plan.current", { plan: t(`plan.name.${view.current}`) })}{view.source === "cache" ? ` ${t("plan.cached")}` : ""}
        </p>
      )}
      {view.changeUrl && (
        <div className="tcc-plan-change" data-plan-change="">
          <s-button variant="primary" href={view.changeUrl} target="_top">{t("plan.change")}</s-button>
          <span className="tcc-muted">{t("plan.change_help")}</span>
        </div>
      )}
      <div className="tcc-plans-host"><div className="tcc-plans">
        {view.offers.map((o) => (
          <section key={o.id} className={`tcc-plan${o.current ? " is-current" : ""}${o.suggested ? " is-suggested" : ""}`} data-plan={o.id} aria-labelledby={`tcc-plan-${o.id}`}>
            <header className="tcc-plan__head">
              <h3 id={`tcc-plan-${o.id}`}>{t(`plan.name.${o.id}`)}</h3>
              {o.current && <span className="tcc-badge tcc-badge--good">{t("plan.badge.current")}</span>}
              {o.suggested && <span className="tcc-badge tcc-badge--warn">{t("plan.badge.suggested")}</span>}
              {!o.current && !o.suggested && o.badge && <span className="tcc-badge">{t(`plan.badge.${o.badge}`)}</span>}
            </header>
            <p className="tcc-plan__price">{t("plan.per_month", { price: price(o.price) })}</p>
            {o.trialDays > 0 && !o.current && <p className="tcc-muted">{t("plan.trial", { count: o.trialDays })}</p>}
            <p className="tcc-muted tcc-plan__volume" data-plan-volume={o.orders}><strong>{t("plan.volume", { count: count(o.orders) })}</strong></p>
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
      <p className="tcc-muted">{t("plan.custom")}{customHref && <> <a href={customHref} target="_blank" rel="noreferrer">{t("overage.custom_cta")}</a></>}</p>
    </div>
  );
}
