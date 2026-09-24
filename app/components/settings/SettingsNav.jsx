// ── Sous-navigation Réglages (S2 : une route par sujet) — livrées = liens, « Bientôt » = grisées ──
import { Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { SETTINGS_NAV } from "../../lib/settings.js";
import { Icon } from "../overview/Icons.jsx";

export function SettingsNav({ current = "index", items = SETTINGS_NAV }) {
  const { t } = useI18n();
  return (
    <nav className="tcc-subnav" aria-label={t("settings.title")}>
      {items.map((s) => s.status === "live" && s.path ? (
        <Link key={s.id} to={s.path} className="tcc-subnav__item" aria-current={s.id === current ? "page" : undefined}>{t(`settings.nav.${s.id}`)}</Link>
      ) : (
        <span key={s.id} className="tcc-subnav__item is-soon" aria-disabled="true">{t(`settings.nav.${s.id}`)}<span className="tcc-badge"><Icon id="soon" />{t("nav.soon")}</span></span>
      ))}
    </nav>
  );
}
