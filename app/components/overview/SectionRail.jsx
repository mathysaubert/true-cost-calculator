// ── Rail des sections (nav cible) : livrées = liens ; « Bientôt » = grisées, non cliquables ────
// s-app-nav (App Bridge) n'offre ni badge ni état désactivé : ce rail app-owned porte la nav
// complète de la maquette ; s-app-nav ne liste que les sections livrées (voir app.jsx).
import { Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { SECTIONS } from "../../lib/sections.js";
import { Icon } from "./Icons.jsx";

export function SectionRail({ current = "overview", sections = SECTIONS }) {
  const { t } = useI18n();
  return (
    <nav className="tcc-rail" aria-label={t("nav.sections")}>
      <ul>
        {sections.map((s) => (
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
    </nav>
  );
}
