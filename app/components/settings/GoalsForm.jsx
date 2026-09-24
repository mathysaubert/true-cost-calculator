// ── Réglages > Objectifs (S7) : CM2 cible (bande 40-60 en rappel), marge après pub, prix principal ──
import { Form } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { FIELDS, CM2_TARGET_BAND } from "../../lib/settings.js";
import { NumberField } from "./Fields.jsx";

export function GoalsForm({ settings = {}, result = null, alertThreshold = null }) {
  const { t, pct } = useI18n();
  const bad = result?.intent === "save_goals" ? result.errors ?? {} : {};
  return (
    <section className="tcc-block" aria-labelledby="tcc-goals-title">
      <div className="tcc-block__head"><h3 id="tcc-goals-title">{t("settings.goals.title")}</h3></div>
      <p className="tcc-muted">{t("settings.goals.band", { low: pct(CM2_TARGET_BAND.low, { digits: 0 }), high: pct(CM2_TARGET_BAND.high, { digits: 0 }) })}</p>
      <Form method="post" className="tcc-form">
        <input type="hidden" name="intent" value="save_goals" />
        <div className="tcc-form__grid">
          {FIELDS.goals.map((f) => (
            <NumberField key={f.key} name={f.key} label={t(`settings.field.${f.key}.label`)} help={t(`settings.field.${f.key}.help`)} value={f.key === "profitability_threshold_pct" && Number(settings[f.key]) === 0 ? null : settings[f.key]} error={bad[f.key] ?? null} suffix={f.kind === "pct" ? "%" : null} />
          ))}
        </div>
        <div className="tcc-form__actions"><s-button type="submit" variant="secondary">{t("settings.save")}</s-button></div>
      </Form>
      {alertThreshold != null && <p className="tcc-muted">{t("settings.goals.alert_threshold", { pct: pct(alertThreshold, { digits: 0 }) })}</p>}
    </section>
  );
}
