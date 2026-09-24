// ── Réglages : accueil = état de chaque réglage (renseigné / à confirmer / manquant) + fiabilité ──
import { Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { SETTINGS_NAV } from "../../lib/settings.js";
import { Icon } from "../overview/Icons.jsx";

const TONE = { set: "tcc-badge--good", unconfirmed: "tcc-badge--warn", unset: "tcc-badge--bad" };

export function SettingsIndex({ items = [] }) {
  const { t } = useI18n();
  const pages = [...new Set(items.map((i) => i.page))];
  return (
    <div className="tcc-stack">
      {pages.map((p) => {
        const nav = SETTINGS_NAV.find((n) => n.id === p);
        return (
          <section key={p} className="tcc-block" aria-labelledby={`tcc-settings-${p}`}>
            <div className="tcc-block__head"><h3 id={`tcc-settings-${p}`}>{t(`settings.nav.${p}`)}</h3>{nav?.path && <Link className="tcc-cta tcc-cta--ghost" to={nav.path}>{t("settings.open_page")}</Link>}</div>
            <ul className="tcc-status">
              {items.filter((i) => i.page === p).map((i) => (
                <li key={i.id} data-setting={i.id} data-state={i.state}>
                  <Icon id={i.state === "set" ? "check" : "soon"} />
                  <span>{t(`settings.item.${i.id}`)}</span>
                  <span className={`tcc-badge ${TONE[i.state] ?? ""}`}>{t(`settings.status.${i.state}`)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
