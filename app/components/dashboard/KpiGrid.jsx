// ── Grille des 12 KPI par section (F4-A) — PUR ───────────────────────────────────────────────
// C10a : sur conteneur étroit (≤ 480 px), les 4 KPI secondaires (primary=false) sont masqués
// derrière « Afficher N indicateurs de plus » ; sur conteneur large, tout est visible sans état.
// Le masquage est un container query CSS sur un wrapper APP-OWNED (autorisé : hors shadow DOM).
import { useState } from "react";
import { useI18n } from "../../lib/i18n/context.jsx";
import { KPI_GROUPS } from "../../lib/dashboard.js";
import { KpiTile } from "./KpiTile.jsx";

const GRID_COLUMNS = "@container (inline-size <= 480px) 1fr, @container (inline-size <= 900px) 1fr 1fr, 1fr 1fr 1fr 1fr";

export function KpiGrid({ kpis = [] }) {
  const { t } = useI18n();
  const [more, setMore] = useState(false);
  const secondaryCount = kpis.filter((k) => !k.primary).length;
  return (
    <div className={`tcc-dash${more ? " tcc-dash--more" : ""}`}>
      <style>{`
        .tcc-dash { container-type: inline-size; container-name: tcc-dash; }
        .tcc-dash .tcc-secondary { display: contents; }
        .tcc-dash .tcc-more { display: none; }
        @container tcc-dash (max-width: 480px) {
          .tcc-dash:not(.tcc-dash--more) .tcc-secondary { display: none; }
          .tcc-dash:not(.tcc-dash--more) .tcc-more { display: block; }
        }
      `}</style>
      {KPI_GROUPS.map((group) => {
        const items = kpis.filter((k) => k.group === group);
        if (!items.length) return null;
        return (
          <s-section key={group} heading={t(`dashboard.section.${group}`)}>
            <s-grid gridTemplateColumns={GRID_COLUMNS} gap="base">
              {items.map((k) => k.primary
                ? <KpiTile key={k.id} kpi={k} />
                : <div key={k.id} className="tcc-secondary"><KpiTile kpi={k} /></div>)}
            </s-grid>
          </s-section>
        );
      })}
      {secondaryCount > 0 && (
        <div className="tcc-more">
          <s-button variant="secondary" onClick={() => setMore(true)}>{t("dashboard.more.show", { count: secondaryCount })}</s-button>
        </div>
      )}
    </div>
  );
}
