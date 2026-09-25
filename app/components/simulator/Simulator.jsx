// ── Simulateur boutique (S1, T3 ; S2a objectif, S2b comparaison, S2c observé) : leviers sur champs
// HTML natifs tenus par React, calcul client avec econ/simulate.js (pur), résultat avant / après /
// écart, fourchette T5, hypothèses, « Retenir ce scénario » (Form POST recalculé côté serveur).
// Aucun champ Polaris contrôlé (C1a). ───────────────────────────────────────────────────────────
import { useState } from "react";
import { Form, Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { LEVERS, leverAvailable, runScenario, scenarioSearch, HORIZONS, deltaTone } from "../../lib/simulator/index.js";
import { solveObjective, OBJECTIVE_NODES } from "../../lib/simulator/objective.js";
import { compareScenarios } from "../../lib/simulator/compare.js";
import { observedStatus } from "../../lib/simulator/observed.js";
import { ConfidenceBadge } from "../overview/Analysis.jsx";
import { Icon } from "../overview/Icons.jsx";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

export function Simulator({ leaves = {}, periodDays = 30, days = 30, initial = {}, rule = null, horizon: initialHorizon = "period", memory = [], compare = [], now = null }) {
  const { t, byUnit, money, ratio, pct, day } = useI18n();
  const [values, setValues] = useState(initial);
  const [horizon, setHorizon] = useState(initialHorizon);
  const [obj, setObj] = useState({ node: "cm2_pct", target: "", lever: "price", result: null });
  const run = runScenario({ leaves, values, periodDays, horizon });
  const set = (id, raw) => setValues((v) => { const n = num(String(raw).replace(",", ".")); const next = { ...v }; if (n == null) delete next[id]; else next[id] = n; return next; });
  const fmtNode = (id, unit, v) => (v == null ? t("common.na") : unit === "money" ? money(v) : unit === "pct" ? pct(v) : ratio(v));
  const fmt = (n, v) => fmtNode(n.id, n.unit, v);
  const tone = (n) => { const k = deltaTone(n, n.delta); return k ? ` is-${k}` : ""; };
  const nodeLabel = (id) => (t.has(`overview.calc.input.${id}`) ? t(`overview.calc.input.${id}`) : t(`sim.node.${id}`));
  const leverValueText = (leverId, v) => { const l = LEVERS.find((x) => x.id === leverId); return l?.kind === "money" ? money(v) : `${v > 0 ? "+" : ""}${pct(v, { digits: 1 })}`; };
  const objUnit = obj.node === "cm2_pct" ? "pct" : obj.node === "be_roas" ? "ratio" : "money";
  const solve = () => setObj((o) => ({ ...o, result: solveObjective({ leaves, periodDays, horizon, node: o.node, target: num(String(o.target).replace(",", ".")), lever: o.lever, base: values }) }));
  const applyObjective = () => { if (obj.result?.reached) setValues((v) => ({ ...v, [obj.lever]: obj.result.value })); };
  const cmp = compare.length ? compareScenarios({ leaves, periodDays, horizon, scenarios: [{ id: "current", label: t("sim.compare.current"), values }, ...compare] }) : null;
  const currentSearch = (extra = {}) => scenarioSearch({ values, rule, days, horizon, ...extra });
  const when = now ? new Date(now) : new Date();
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
          <div className="tcc-objective" data-objective={obj.result ? (obj.result.reached ? "reached" : obj.result.reason) : "idle"}>
            <h4 className="tcc-eyebrow">{t("sim.objective.title")}</h4>
            <p className="tcc-muted">{t("sim.objective.help")}</p>
            <div className="tcc-objective__row">
              <label>{t("sim.objective.node")}<select value={obj.node} onChange={(e) => setObj((o) => ({ ...o, node: e.target.value, result: null }))}>{OBJECTIVE_NODES.map((id) => <option key={id} value={id}>{nodeLabel(id)}</option>)}</select></label>
              <label>{t("sim.objective.target")}<input type="number" inputMode="decimal" value={obj.target} onChange={(e) => setObj((o) => ({ ...o, target: e.target.value, result: null }))} /></label>
              <label>{t("sim.objective.lever")}<select value={obj.lever} onChange={(e) => setObj((o) => ({ ...o, lever: e.target.value, result: null }))}>{LEVERS.map((l) => <option key={l.id} value={l.id} disabled={!leverAvailable(l, leaves)}>{t(`sim.lever.${l.id}.label`)}</option>)}</select></label>
              <button type="button" className="tcc-cta" onClick={solve}>{t("sim.objective.solve")}</button>
            </div>
            {obj.result?.reached && (
              <p className="tcc-objective__result" role="status">
                {t("sim.objective.reached", { lever: t(`sim.lever.${obj.lever}.label`), value: leverValueText(obj.lever, obj.result.value), node: nodeLabel(obj.node), after: fmtNode(obj.node, objUnit, obj.result.after) })}
                {" "}<button type="button" className="tcc-cta tcc-cta--ghost" onClick={applyObjective}>{t("sim.objective.apply")}</button>
              </p>
            )}
            {obj.result && !obj.result.reached && obj.result.reason === "out_of_range" && <p className="tcc-objective__result" role="status">{t("sim.objective.out_of_range", { node: nodeLabel(obj.node), lever: t(`sim.lever.${obj.lever}.label`), min: leverValueText(obj.lever, obj.result.min), max: leverValueText(obj.lever, obj.result.max), best: fmtNode(obj.node, objUnit, obj.result.best?.after) })}</p>}
            {obj.result && !obj.result.reached && obj.result.reason !== "out_of_range" && <p className="tcc-objective__result" role="status">{t("sim.objective.unavailable")}</p>}
          </div>
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
                <span role="rowheader">{nodeLabel(n.id)}</span>
                <span role="cell">{fmt(n, n.before)}</span>
                <span role="cell"><strong>{fmt(n, n.after)}</strong></span>
                <span role="cell" className={`tcc-simtable__delta${tone(n)}`} data-tone={deltaTone(n, n.delta) ?? undefined}>{n.delta == null ? t("common.na") : `${n.delta > 0 ? "+" : ""}${fmt(n, n.delta)}`}</span>
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
      {cmp && (
        <section className="tcc-block" aria-labelledby="tcc-sim-compare" data-compare={cmp.scenarios.length}>
          <div className="tcc-block__head"><h3 id="tcc-sim-compare">{t("sim.compare.title")}</h3><Link className="tcc-cta tcc-cta--ghost" to={`/app/simulator${currentSearch()}`}>{t("sim.compare.close")}</Link></div>
          <p className="tcc-muted">{t("sim.compare.note")}</p>
          <div className="tcc-simtable" role="table">
            <div className="tcc-simtable__row is-head" role="row"><span role="columnheader" />{cmp.scenarios.map((s) => <span key={s.id} role="columnheader">{s.id === "current" ? t("sim.compare.current") : s.rule_id ? t(`insight.${s.rule_id}.name`) : t("sim.memory.manual")}</span>)}</div>
            {cmp.nodes.map((n) => (
              <div key={n.id} className="tcc-simtable__row" role="row" data-node={n.id}>
                <span role="rowheader">{nodeLabel(n.id)}</span>
                {n.cells.map((c) => <span key={c.id} role="cell" className={`tcc-simtable__delta${deltaTone(n, c.delta) ? ` is-${deltaTone(n, c.delta)}` : ""}`}><strong>{fmt(n, c.after)}</strong><br /><small>{c.delta == null ? t("common.na") : `${c.delta > 0 ? "+" : ""}${fmt(n, c.delta)}`}</small></span>)}
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="tcc-block" aria-labelledby="tcc-sim-memory">
        <div className="tcc-block__head"><h3 id="tcc-sim-memory">{t("sim.memory.title")}</h3></div>
        {!memory.length ? <p className="tcc-muted">{t("sim.memory.none")}</p> : (
          <ul className="tcc-partials tcc-sim__memory">
            {memory.map((m) => {
              const st = observedStatus(m, when);
              const inCompare = compare.some((c) => c.id === m.id);
              const nextCompare = inCompare ? compare.filter((c) => c.id !== m.id).map((c) => c.id) : [...compare.map((c) => c.id), m.id].slice(-2);
              return (
                <li key={m.id} data-decision={m.id} data-observed={st}>
                  <Icon id="chart" />
                  <span>
                    {m.rule_id ? t(`insight.${m.rule_id}.name`) : t("sim.memory.manual")}{" · "}{m.decided_at}
                    {m.expected_low != null ? ` · ${t("sim.memory.expected", { low: money(m.expected_low), high: money(m.expected_high) })}` : ""}
                    {st === "observed" ? ` · ${t("sim.memory.observed", { value: `${m.observed_impact > 0 ? "+" : ""}${money(m.observed_impact)}` })}` : ""}
                    {st === "unobservable" ? ` · ${t("sim.memory.unobservable")}` : ""}
                    {st === "pending" ? ` · ${t("sim.memory.pending", { date: day(String(m.review_at).slice(0, 10)) })}` : ""}
                    {st === "due" ? ` · ${t("sim.memory.due")}` : ""}
                    {" · "}<Link to={`/app/simulator${scenarioSearch({ values: m.values, rule: m.rule_id, days: m.days, horizon: m.horizon })}`}>{t("sim.memory.replay")}</Link>
                    {" · "}<Link to={`/app/simulator${currentSearch()}${currentSearch() ? "&" : "?"}compare=${nextCompare.join(",")}`} data-compare-toggle={inCompare ? "remove" : "add"}>{inCompare ? t("sim.compare.remove") : t("sim.compare.add")}</Link>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
