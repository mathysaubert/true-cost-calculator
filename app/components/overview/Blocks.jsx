// ── État vide, emplacements réservés, bandeau du moteur — app-owned, PUR ─────────────────────
import { useI18n } from "../../lib/i18n/context.jsx";
import { OVERVIEW_RESERVED } from "../../lib/sections.js";
import { Icon } from "./Icons.jsx";

// excluded = compteurs par raison sur la période courante (legacy compris) : le POURQUOI est visible.
export function OverviewEmptyState({ excluded = {} }) {
  const { t, int } = useI18n();
  const entries = Object.entries(excluded).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const reasons = entries.map(([r, n]) => `${int(n)} ${t(`overview.excluded.${r}`)}`).join(", ");
  return (
    <div className="tcc-card tcc-empty">
      <h3>{t("overview.empty.title")}</h3>
      <p>{t("overview.empty.body")}</p>
      {total > 0 && <p className="tcc-empty__reasons">{t("overview.empty.body_excluded", { count: total, reasons })}</p>}
      <a className="tcc-cta tcc-cta--ghost" href="/app">{t("overview.empty.cta_legacy")}</a>
    </div>
  );
}

// Emplacement réservé : jamais un chiffre, une carte discrète « Disponible avec {section} ».
export function ReservedSlot({ slot }) {
  const { t } = useI18n();
  const sectionLabel = t(`nav.${slot.section}`);
  return (
    <div className={`tcc-slot tcc-slot--${slot.size}`} data-slot={slot.id} aria-label={t(`overview.reserved.${slot.id}`)}>
      <span className="tcc-slot__icon"><Icon id={slot.id} /></span>
      <p><strong>{t(`overview.reserved.${slot.id}`)}</strong></p>
      <p>{slot.section === "overview" ? t("overview.reserved.next_release") : t("overview.reserved.with", { section: sectionLabel })}</p>
      <span className="tcc-badge"><Icon id="soon" />{t("nav.soon")}</span>
    </div>
  );
}

export function ReservedSlots({ slots = OVERVIEW_RESERVED }) {
  const main = slots.filter((s) => s.size === "wide" || s.size === "narrow");
  const aside = slots.filter((s) => s.size === "aside");
  const quarters = slots.filter((s) => s.size === "quarter");
  return (
    <div className="tcc-slots-wrap">
      <div className="tcc-slots tcc-slots--main">
        {main.map((s) => <ReservedSlot key={s.id} slot={s} />)}
        {aside.map((s) => <ReservedSlot key={s.id} slot={s} />)}
      </div>
      <div className="tcc-slots tcc-slots--quarters">
        {quarters.map((s) => <ReservedSlot key={s.id} slot={s} />)}
      </div>
    </div>
  );
}

// Bandeau « Le moteur économique derrière toutes les sections » : statique, traduit.
const STEPS = ["data", "engine", "intelligence", "simulator", "results"];
export function EngineBanner() {
  const { t } = useI18n();
  return (
    <section className="tcc-engine" aria-labelledby="tcc-engine-title">
      <div className="tcc-engine__head">
        <span className="tcc-brand__mark"><Icon id="spark" /></span>
        <div>
          <h3 id="tcc-engine-title">{t("overview.engine.title")}</h3>
          <p>{t("overview.engine.subtitle")}</p>
        </div>
      </div>
      <ol className="tcc-engine__steps">
        {STEPS.map((s, i) => (
          <li key={s} className="tcc-engine__step">
            <h4><span className="tcc-engine__num" aria-hidden="true">{i + 1}</span>{t(`overview.engine.${s}.title`)}</h4>
            <ul>
              {[1, 2, 3].map((n) => <li key={n}>{t(`overview.engine.${s}.b${n}`)}</li>)}
            </ul>
          </li>
        ))}
      </ol>
      <p className="tcc-engine__foot"><Icon id="check" />{t("overview.engine.footer")}</p>
    </section>
  );
}
