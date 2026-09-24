// ── Fiabilité des données (I0-B) : score, manques et déblocages ; bloc compact ou page ─────────
import { Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { settingsPathForRule } from "../../lib/activation.js";

const R = 40, C = 2 * Math.PI * R;

export function HealthRing({ score = 0, level = "low" }) {
  const { int } = useI18n();
  const s = Math.max(0, Math.min(100, score));
  return (
    <div className={`tcc-ring is-${level}`} role="img" aria-label={`${int(s)} / 100`}>
      <svg viewBox="0 0 92 92" aria-hidden="true">
        <circle className="tcc-ring__track" cx="46" cy="46" r={R} />
        <circle className="tcc-ring__fill" cx="46" cy="46" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - s / 100)} />
      </svg>
      <span className="tcc-ring__value">{int(s)}</span>
    </div>
  );
}

function unlockLabels(rule, t) {
  return (rule.unlocks ?? []).map((u) => (t.has(`overview.kpi.${u}.label`) ? t(`overview.kpi.${u}.label`) : t.has(`insight.${u}.name`) ? t(`insight.${u}.name`) : t(`health.unlock.${u}`))).join(", ");
}

// confidence : sortie de dataConfidence ; compact : bloc de la Vue d'ensemble (3 manques) ; sinon page.
export function DataHealth({ confidence, compact = true }) {
  const { t, int } = useI18n();
  if (!confidence) return null;
  const gaps = compact ? (confidence.gaps ?? []).slice(0, 3) : (confidence.gaps ?? []);
  return (
    <div className="tcc-health-wrap"><section className="tcc-health" aria-labelledby="tcc-health-title" data-level={confidence.level}>
      <HealthRing score={confidence.score} level={confidence.level} />
      <div className="tcc-health__body">
        <h3 id="tcc-health-title">{t("health.title")} · {t(`health.level.${confidence.level}`)}</h3>
        {gaps.length ? (
          <div className="tcc-health__gaps">
            {gaps.map((g) => (
              <div key={g.id} className="tcc-health__gap">
                <span><strong>{t(`health.rule.${g.id}`)}</strong><small>{t("health.gap.unlocks", { list: unlockLabels(g, t) })}</small></span>
                <span className="tcc-health__points">{t("health.gap.points", { points: int(Math.round(g.points_if_fixed)) })}</span>
                <Link className="tcc-cta tcc-cta--ghost tcc-health__fix" to={settingsPathForRule(g.id).path} data-fix={g.id}>{t("health.gap.fix")}</Link>
              </div>
            ))}
          </div>
        ) : <p className="tcc-muted">{t("health.all_good")}</p>}
        {compact ? <Link className="tcc-cta" to="/app/data-health">{t("health.open")}</Link> : null}
      </div>
    </section></div>
  );
}

export function HealthRules({ confidence }) {
  const { t, int } = useI18n();
  if (!confidence) return null;
  return (
    <div className="tcc-health-rules">
      {confidence.rules.map((r) => (
        <div key={r.id} className={`tcc-health-rule${r.applicable ? "" : " is-na"}`} data-rule={r.id}>
          <span><strong>{t(`health.rule.${r.id}`)}</strong><br /><small className="tcc-muted">{t(`health.rule.${r.id}.help`)}</small></span>
          <span className="tcc-health__points">{r.applicable ? `${int(Math.round(r.points))} / ${int(r.max)}` : t("health.na")}</span>
          {r.applicable && <svg className="tcc-health-rule__meter" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="0" height="6" width={Math.round(r.measure * 100)} /></svg>}
          {r.applicable && r.points_if_fixed > 0.5 && <small className="tcc-muted">{t("health.gap.unlocks", { list: unlockLabels(r, t) })} · {t("health.if_fixed", { score: int(confidence.if_fixed?.[r.id] ?? confidence.score) })}</small>}
          {r.applicable && r.points_if_fixed > 0.5 && <Link className="tcc-cta tcc-cta--ghost" to={settingsPathForRule(r.id).path} data-fix={r.id}>{t("health.gap.fix")}</Link>}
        </div>
      ))}
    </div>
  );
}
