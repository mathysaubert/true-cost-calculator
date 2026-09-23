// ── En-tête de la Vue d'ensemble : marque, salutation, état de synchronisation, période ────────
// Sélecteur de période = contrôle segmenté app-owned (liens ?days=, aria-current="page"), sans
// champ contrôlé (React 18, C1a). La journée en cours est incluse et dite partielle (retour 4).
import { Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { PERIOD_OPTIONS } from "../../lib/overview.js";
import { Icon } from "./Icons.jsx";

export function PeriodSelector({ days, options = PERIOD_OPTIONS }) {
  const { t } = useI18n();
  return (
    <nav className="tcc-seg" aria-label={t("overview.period.label")}>
      {options.map((n) => (
        <Link key={n} to={`?days=${n}`} aria-current={n === days ? "page" : undefined}>
          {t("overview.period.days", { count: n })}
        </Link>
      ))}
    </nav>
  );
}

export function OverviewHeader({ firstName, shopName, lastSync, now, days, windows }) {
  const { t, relative, day } = useI18n();
  const who = firstName || shopName || null;
  const range = windows?.current
    ? (windows.current.partial ? t("overview.period.range_partial", { start: day(windows.current.start) }) : t("overview.period.range", { start: day(windows.current.start), end: day(windows.current.end) }))
    : null;
  const compare = windows?.previous ? t("overview.period.compare", { count: days, start: day(windows.previous.start), end: day(windows.previous.end) }) : null;
  return (
    <header className="tcc-hero">
      <div className="tcc-brand">
        <span className="tcc-brand__mark"><Icon id="brand" /></span>
        <div>
          <h1>{t("app.name")}</h1>
          <p>{t("app.tagline")}</p>
        </div>
      </div>
      <div className="tcc-hero__row">
        <div className="tcc-hero__greet">
          <h2>{who ? t("overview.greeting.named", { name: who }) : t("overview.greeting.anonymous")}</h2>
          <p>{t("overview.greeting.sub")}</p>
        </div>
        <div className="tcc-hero__side">
          <div className="tcc-sync">
            {lastSync ? (
              <>
                <span className="tcc-sync__state"><span className="tcc-sync__dot" aria-hidden="true" />{t("overview.sync.ok")}</span>
                <small>{t("overview.sync.last", { ago: relative(lastSync, now ? new Date(now) : undefined) })}</small>
              </>
            ) : (
              <span className="tcc-sync__state is-idle"><span className="tcc-sync__dot" aria-hidden="true" />{t("overview.sync.never")}</span>
            )}
          </div>
          <PeriodSelector days={days} />
          {range && <p className="tcc-period">{range}{compare ? `, ${compare}` : ""}</p>}
        </div>
      </div>
    </header>
  );
}
