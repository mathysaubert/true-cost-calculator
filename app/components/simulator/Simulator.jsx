// ── Simulateur boutique (S1, T3) : leviers sur champs HTML natifs tenus par React, calcul client ──
// avec econ/simulate.js (pur), résultat avant / après / écart, fourchette T5, hypothèses, « Retenir
// ce scénario » (Form POST, l'action recalcule côté serveur). Aucun champ Polaris contrôlé (C1a).
import { useState } from "react";
import { Form, Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { LEVERS, leverAvailable, runScenario, scenarioSearch, HORIZONS } from "../../lib/simulator/index.js";
import { ConfidenceBadge } from "../overview/Analysis.jsx";
import { Icon } from "../overview/Icons.jsx";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

export function Simulator({ leaves = {}, periodDays = 30, days = 30, initial = {}, rule = null, horizon: initialHorizon = "period", memory = [] }) {
  const { t, byUnit, money, ratio, pct } = useI18n();
  const [values, setValues] = useState(initial);
  const [horizon, setHorizon] = useState(initialHorizon);
  const run = runScenario({ leaves, values, periodDays, horizon });
  const set = (id, raw) => setValues((v) => { const n = num(String(raw).replace(",", ".")); const next = { ...v }; if (n == null) delete next[id]; else next[id] = n; return next; });
  const fmt = (n, v) => (v == null ? t("common.na") : n.unit === "money" ? money(v) : ratio(v));
  const sign = (v) => (v == null ? "" : v > 0 ? "is-up" : v < 0 ? "is-down" : "");
  return (
    <div className="tcc-sim">
      {rule && <p className="tcc-muted tcc-sim__from"><Icon id="spark" />{t("sim.from_rule", { name: t(`insight.${rule}.name`) })}</p>}
      <div className="tcc-sim__grid">
        <section className="tcc-block tcc-sim__levers" aria-labelledby="tcc-sim-levers">
          <div className="tcc-block__head"><h3 id="tcc-sim-levers">{t("sim.levers.title")}</h3><button type="button" className="tcc-cta tcc-cta--ghost" onClick={() => setValues({})}>{t("sim.reset")}</button></div>
          {LEVERS.map((l) => {
            const ok = leverAvailable(l, leaves);
            const v = values[l.id] ?? (l.kind === "pct" ? 0 : "");
            return (
              <div key={l.id} className={`tcc-lever${ok ? "" : " is-off"}`} data-lever={l.id}>
                <label htmlFor={`lever-${l.id}`}><strong>{t(`sim.lever.${l.id}.label`)}</strong><small className="tcc-muted">{t(`sim.lever.${l.id}.help`)}</small></label>
                <div className="tcc-lever__controls">
                  <input type="range" id={`lever-${l.id}`} min={l.min} max={l.max} step={l.step} value={v === "" ? l.min : v} disabled={!ok} onChange={(e) => set(l.id, e.target.value)} />
                  <input type="number" inputMode="decimal" aria-labelledby={`lever-${l.id}`} min={l.min} max={l.max} step={l.step} value={v} disabled={!ok} onChange={(e) => set(l.id, e.target.value)} />
                  <span className="tcc-lever__unit">{l.kind === "pct" ? "%" : byUnit(0, "money").normalize("NFKC").replace(/[\d\s.,]/g, "")}</span>
                </div>
                {!ok && <small className="tcc-muted">{t("sim.lever.unavailable")}</small>}
              </div>
            );
          })}
        </section>
        <section className="tcc-block tcc-sim__results" aria-labelledby="tcc-sim-results">
          <div className="tcc-block__head">
            <h3 id="tcc-sim-results">{t("sim.results.title")}</h3>
            <ConfidenceBadge confidence={{ key: "simulation", label: t("confidence.simulation.label"), help: t("confidence.simulation.help") }} />
          </div>
          <div className="tcc-seg" role="group" aria-label={t("sim.horizon.label")}>
            {HORIZONS.map((h) => <button key={h} type="button" className="tcc-seg__btn" aria-pressed={horizon === h} onClick={() => setHorizon(h)}>{h === "month" ? t("sim.horizon.month") : t("sim.horizon.period", { count: days })}</button>)}
          </div>
          <p className="tcc-muted">{run.empty ? t("sim.results.empty") : t("sim.results.formula")}</p>
          <div className="tcc-simtable" role="table">
            <div className="tcc-simtable__row is-head" role="row"><span role="columnheader" /><span role="columnheader">{t("sim.col.before")}</span><span role="columnheader">{t("sim.col.after")}</span><span role="columnheader">{t("sim.col.delta")}</span><span role="columnheader">{t("sim.col.range")}</span></div>
            {run.nodes.map((n) => (
              <div key={n.id} className="tcc-simtable__row" role="row" data-node={n.id}>
                <span role="rowheader">{t.has(`overview.calc.input.${n.id}`) ? t(`overview.calc.input.${n.id}`) : t(`sim.node.${n.id}`)}</span>
                <span role="cell">{fmt(n, n.before)}</span>
                <span role="cell"><strong>{fmt(n, n.after)}</strong></span>
                <span role="cell" className={`tcc-simtable__delta ${sign(n.delta)}`}>{n.delta == null ? t("common.na") : `${n.delta > 0 ? "+" : ""}${fmt(n, n.delta)}`}</span>
                <span role="cell" className="tcc-muted">{n.low == null ? t("common.na") : `${fmt(n, n.low)} – ${fmt(n, n.high)}`}</span>
              </div>
            ))}
          </div>
          <details className="tcc-fold">
            <summary>{t("sim.assumptions.title")}<Icon id="soon" /></summary>
            <div className="tcc-fold__body">
              <ul className="tcc-partials">
                {run.assumptions.map((a) => <li key={a.key}><Icon id="check" /><span>{t(`assumption.${a.key}`)}{a.factor != null ? ` (× ${a.factor.toFixed(2)})` : ""}</span></li>)}
                <li><Icon id="check" /><span>{t("sim.assumptions.range", { low: pct(-10, { digits: 0 }), high: pct(10, { digits: 0 }) })}</span></li>
                <li><Icon id="check" /><span>{horizon === "month" ? t("sim.assumptions.month") : t("sim.assumptions.period", { count: days })}</span></li>
                <li><Icon id="check" /><span>{t("sim.note")}</span></li>
              </ul>
            </div>
          </details>
          <Form method="post" className="tcc-decision">
            <input type="hidden" name="intent" value="keep" />
            <input type="hidden" name="days" value={days} />
            <input type="hidden" name="h" value={horizon} />
            {rule && <input type="hidden" name="rule" value={rule} />}
            {LEVERS.map((l) => (values[l.id] != null ? <input key={l.id} type="hidden" name={l.id} value={values[l.id]} /> : null))}
            <s-button type="submit" variant="secondary" disabled={run.empty ? true : undefined}>{t("decision.keep_scenario")}</s-button>
            <span className="tcc-muted">{t("sim.keep_help")}</span>
          </Form>
        </section>
      </div>
      <section className="tcc-block" aria-labelledby="tcc-sim-memory">
        <div className="tcc-block__head"><h3 id="tcc-sim-memory">{t("sim.memory.title")}</h3></div>
        {!memory.length ? <p className="tcc-muted">{t("sim.memory.none")}</p> : (
          <ul className="tcc-partials tcc-sim__memory">
            {memory.map((m) => (
              <li key={m.id} data-decision={m.id}>
                <Icon id="chart" />
                <span>
                  {m.rule_id ? t(`insight.${m.rule_id}.name`) : t("sim.memory.manual")}{" · "}{m.decided_at}
                  {m.expected_low != null ? ` · ${money(m.expected_low)} – ${money(m.expected_high)}` : ""}
                  {" · "}<Link to={`/app/simulator${scenarioSearch({ values: m.values, rule: m.rule_id, days: m.days, horizon: m.horizon })}`}>{t("sim.memory.replay")}</Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
