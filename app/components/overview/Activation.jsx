// ── Liste de contrôle d'activation (R3) : 3 jalons du PDF, chacun relié à la page qui le débloque ──
import { Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { Icon } from "./Icons.jsx";

// checklist : sortie de activationChecklist()
export function ActivationChecklist({ checklist }) {
  const { t, int, pct } = useI18n();
  if (!checklist) return null;
  return (
    <section className="tcc-block" aria-labelledby="tcc-activation-title" data-activation={checklist.complete ? "complete" : "pending"}>
      <div className="tcc-block__head">
        <h3 id="tcc-activation-title">{t("activation.title")}</h3>
        <span className={`tcc-badge ${checklist.complete ? "tcc-badge--good" : "tcc-badge--warn"}`}>{t("activation.progress", { done: int(checklist.done), total: int(checklist.total) })}</span>
      </div>
      <ul className="tcc-status">
        {checklist.items.map((i) => (
          <li key={i.id} data-step={i.id} data-state={i.done ? "done" : "todo"}>
            <Icon id={i.done ? "check" : "soon"} />
            <span>
              <strong>{t(`activation.item.${i.id}`)}</strong>
              <br />
              <small className="tcc-muted">{t(`activation.help.${i.id}`)}{i.detail != null ? ` ${t("activation.costs_share", { pct: pct(i.detail, { digits: 0 }) })}` : ""}</small>
            </span>
            {i.done ? <span className="tcc-badge tcc-badge--good">{t("activation.done")}</span> : <Link className="tcc-cta tcc-cta--ghost" to={i.path}>{t("activation.go")}</Link>}
          </li>
        ))}
      </ul>
      {checklist.complete && <p className="tcc-muted">{t("activation.complete")}</p>}
    </section>
  );
}
