// ── Grille des 12 KPI par section — grille CSS app-owned (retour 2), 4 / 2 / 1 colonnes ───────
// C10a : sur conteneur étroit, les 4 KPI secondaires sont masqués derrière « Afficher N
// indicateurs de plus » (bouton natif, aucun champ contrôlé) ; sur conteneur large tout est
// visible sans état. Aucune dépendance à la syntaxe @container de s-grid.
import { useState } from "react";
import { useI18n } from "../../lib/i18n/context.jsx";
import { KPI_GROUPS } from "../../lib/overview.js";
import { KpiTile } from "./KpiTile.jsx";

export function KpiGrid({ kpis = [] }) {
  const { t } = useI18n();
  const [more, setMore] = useState(false);
  const secondaryCount = kpis.filter((k) => !k.primary).length;
  let index = 0;
  return (
    <div className={`tcc-groups${more ? " tcc-groups--more" : ""}`}>
      {KPI_GROUPS.map((group) => {
        const items = kpis.filter((k) => k.group === group);
        if (!items.length) return null;
        return (
          <section key={group} className={`tcc-group tcc-group--${group}`} aria-labelledby={`tcc-group-${group}`}>
            <header className="tcc-group__head">
              <span className="tcc-group__dot" aria-hidden="true" />
              <h3 id={`tcc-group-${group}`}>{t(`overview.section.${group}`)}</h3>
            </header>
            <div className="tcc-grid">
              {items.map((k) => <KpiTile key={k.id} kpi={k} index={index++} />)}
            </div>
          </section>
        );
      })}
      {secondaryCount > 0 && (
        <button type="button" className="tcc-more" onClick={() => setMore(true)}>{t("overview.more.show", { count: secondaryCount })}</button>
      )}
    </div>
  );
}
