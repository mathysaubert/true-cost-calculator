// ── S3 — Simulateur, mode « Nouveau produit » : calcul unitaire sur champs natifs, calcul client,
// prix minimum pour une CM2 % cible, « Retenir ce scénario » (recalculé côté serveur). ────────────
import { useState } from "react";
import { Form } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { NEW_PRODUCT_FIELDS, unitEconomics, minPriceFor } from "../../lib/simulator/newProduct.js";
import { VAT_REGIMES, SHIPPING_MODELS, CATEGORIE_KEYS } from "../../lib/variantCosts.js";
import { ConfidenceBadge } from "../overview/Analysis.jsx";

const ENUM_OPTIONS = { vat_regime: VAT_REGIMES, shipping_model: SHIPPING_MODELS, categorie: CATEGORIE_KEYS };

// initial : valeurs de départ (réglages du marchand) ; shopCountryCode : pays du marchand ; days : période courante.
export function NewProduct({ initial = {}, shopCountryCode = null, days = 30 }) {
  const { t, money, pct } = useI18n();
  const [inputs, setInputs] = useState({ vat_regime: "assujetti", shipping_model: "dropshipping", categorie: "Autre", ...initial });
  const [target, setTarget] = useState("");
  const [min, setMin] = useState(null);
  const r = unitEconomics({ inputs, shopCountryCode });
  const set = (id, v) => { setInputs((x) => ({ ...x, [id]: v })); setMin(null); };
  const enumLabel = (f, o) => (f === "categorie" ? t(`productcosts.category.${o}`) : f === "vat_regime" ? t(`settings.vat.${o}`) : t(`productcosts.shipping_model.${o}`));
  const line = (id, value, strong = false, negative = false) => (
    <div key={id} className={`tcc-waterfall__row${strong ? " is-total" : ""}`} data-line={id}>
      <span className="tcc-waterfall__op" aria-hidden="true">{strong ? "=" : negative ? "−" : ""}</span>
      <span>{t(`sim.new.line.${id}`)}</span>
      <span className="tcc-waterfall__amount">{value == null ? t("common.na") : money(value)}</span>
    </div>
  );
  return (
    <div className="tcc-sim-host"><div className="tcc-sim__grid" data-mode="new">
      <section className="tcc-block" aria-labelledby="tcc-new-inputs">
        <div className="tcc-block__head"><h3 id="tcc-new-inputs">{t("sim.new.inputs")}</h3></div>
        <p className="tcc-muted">{t("sim.new.help")}</p>
        <div className="tcc-form__grid">
          {NEW_PRODUCT_FIELDS.map((f) => (
            <label key={f.id} className="tcc-newp__field">{t(`sim.new.field.${f.id}`)}{f.required ? " *" : ""}
              <input type="number" inputMode="decimal" min="0" step={f.kind === "int" ? 1 : 0.01} value={inputs[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} data-field={f.id} />
            </label>
          ))}
          {Object.entries(ENUM_OPTIONS).map(([f, opts]) => (
            <label key={f} className="tcc-newp__field">{t(`productcosts.field.${f}`)}
              <select value={inputs[f] ?? opts[0]} onChange={(e) => set(f, e.target.value)} data-field={f}>{opts.map((o) => <option key={o} value={o}>{enumLabel(f, o)}</option>)}</select>
            </label>
          ))}
        </div>
      </section>
      <section className="tcc-block" aria-labelledby="tcc-new-result">
        <div className="tcc-block__head"><h3 id="tcc-new-result">{t("sim.new.result")}</h3><ConfidenceBadge confidence={{ key: "simulation", label: t("confidence.simulation.label"), help: t("confidence.simulation.help") }} /></div>
        {!r.ok ? <p className="tcc-muted" data-new-state="missing">{t("sim.new.missing", { fields: r.missing.map((m) => t(`sim.new.field.${m}`)).join(", ") })}</p> : (
          <>
            <div className="tcc-waterfall" data-new-state="ok">
              {line("price_ht", r.price_ht)}
              {line("landed", r.landed == null ? null : -r.landed, false, true)}
              {line("cm1", r.cm1, true)}
              {line("packaging", -r.packaging, false, true)}
              {line("shipping", -r.shipping, false, true)}
              {line("payment_fees", -r.payment_fees, false, true)}
              {line("returns", -r.returns, false, true)}
              {line("cm2", r.cm2, true)}
            </div>
            <p className={`tcc-newp__pct${r.cm2 < 0 ? " is-bad" : ""}`} data-cm2-pct={r.cm2_pct?.toFixed(1)}>{t("sim.new.cm2_pct", { pct: pct(r.cm2_pct), ttc: money(r.price_ttc), vat: pct(r.sale_vat_rate * 100, { digits: 1 }) })}</p>
            <p className="tcc-muted">{t(`sim.new.method.${r.method}`)}</p>
          </>
        )}
        <div className="tcc-objective" data-objective={min ? (min.reached ? "reached" : min.reason) : "idle"}>
          <h4 className="tcc-eyebrow">{t("sim.new.min_price")}</h4>
          <div className="tcc-objective__row">
            <label>{t("sim.new.target_pct")}<input type="number" inputMode="decimal" value={target} onChange={(e) => { setTarget(e.target.value); setMin(null); }} /></label>
            <button type="button" className="tcc-cta" onClick={() => setMin(minPriceFor({ inputs, shopCountryCode, targetPct: target }))}>{t("sim.objective.solve")}</button>
          </div>
          {min?.reached && <p className="tcc-objective__result" role="status">{t("sim.new.min_reached", { price: money(min.price), pct: pct(min.result.cm2_pct) })} <button type="button" className="tcc-cta tcc-cta--ghost" onClick={() => set("price_ttc", String(min.price))}>{t("sim.objective.apply")}</button></p>}
          {min && !min.reached && <p className="tcc-objective__result" role="status">{t(`sim.new.min_${min.reason}`)}</p>}
        </div>
        <p className="tcc-muted">{t("sim.new.assumptions")}</p>
        <Form method="post" className="tcc-decision">
          <input type="hidden" name="intent" value="keep_new" />
          <input type="hidden" name="mode" value="new" />
          <input type="hidden" name="days" value={days} />
          {Object.entries(inputs).map(([k, v]) => (v == null || v === "" ? null : <input key={k} type="hidden" name={`np_${k}`} value={v} />))}
          <s-button type="submit" variant="secondary" disabled={r.ok ? undefined : true}>{t("decision.keep_scenario")}</s-button>
          <span className="tcc-muted">{t("sim.new.keep_help")}</span>
        </Form>
      </section>
    </div></div>
  );
}
