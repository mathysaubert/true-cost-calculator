// ── Rail des sections : nav hybride en trois groupes (Piloter / Explorer / Système) ───────────
// Livrées = liens ; « Bientôt » = grisées, non cliquables. s-app-nav (App Bridge) n'offre ni
// entête ni état désactivé : ce rail app-owned porte la nav complète ; s-app-nav ne liste que les
// sections livrées (app.jsx).
import { Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { NAV_GROUPS } from "../../lib/sections.js";
import { Icon } from "./Icons.jsx";

export function SectionRail({ current = "overview", groups = NAV_GROUPS }) {
  const { t } = useI18n();
  return (
    <nav className="tcc-rail" aria-label={t("nav.sections")}>
      <div className="tcc-rail__groups">
        {groups.map((g) => (
          <div key={g.id} className="tcc-rail__group">
            <h4>{t(`nav.group.${g.id}`)}</h4>
            <ul>
              {g.sections.map((s) => (
                <li key={s.id}>
                  {s.status === "live" && s.path ? (
                    <Link to={s.path} className="tcc-rail__item" aria-current={s.id === current ? "page" : undefined}>{t(`nav.${s.id}`)}</Link>
                  ) : (
                    <span className="tcc-rail__item is-soon" aria-disabled="true">
                      {t(`nav.${s.id}`)}
                      <span className="tcc-badge"><Icon id="soon" />{t("nav.soon")}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
