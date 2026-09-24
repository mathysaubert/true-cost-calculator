// ── Blocs du briefing (I0-B) : 3 résultats, situation, priorités, opportunité, cascade, replié ──
// Tous purs et rendables seuls. Aucune couleur ni chaîne en dur.
import { Link, Form } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { renderSituation } from "../../lib/insights/render.js";
import { Analysis, ConfidenceBadge } from "./Analysis.jsx";
import { CalcBlock } from "./KpiTile.jsx";
import { Icon } from "./Icons.jsx";
import { simulatorHref } from "../../lib/simulator/index.js";

const RESULT_TO_KPI = { ca_ht: "ca_ht", cm2: "cm2_pct", net_result: "net_result" };

// results : buildResults ; kpis : buildKpis (pour « Voir le calcul »).
export function Results({ results, kpis = [] }) {
  const { t, money, pct } = useI18n();
  if (!results) return null;
  return (
    <div className="tcc-results-wrap"><div className="tcc-results">
      {["ca_ht", "cm2", "net_result"].map((id) => {
        const r = results[id];
        const kpi = kpis.find((k) => k.id === RESULT_TO_KPI[id]);
        const modalId = `calc-result-${id}`;
        return (
          <div key={id} className={`tcc-result tcc-result--${id}`} data-result={id} data-status={r?.status}>
            <span className="tcc-result__label">{t(`results.${id}.label`)}</span>
            {r?.status === "ok" ? (
              <>
                <span className="tcc-result__value">{money(r.value)}</span>
                {id === "cm2" && r.pct != null && <span className="tcc-result__sub">{t("results.cm2_pct", { pct: pct(r.pct) })}{r.known_share != null && r.known_share < 99.5 ? ` · ${t("results.known_share", { pct: pct(r.known_share, { digits: 0 }) })}` : ""}</span>}
                {id === "ca_ht" && r.refunds && <span className="tcc-result__sub">{t("overview.tile.refunds", { refunded: money(r.refunds.refunded), gross: money(r.refunds.gross) })}</span>}
                {id === "net_result" && r.estimated && <span className="tcc-result__status">{t("results.estimated")}{r.gap ? ` · ${t(`results.gap.${r.gap}`)}` : ""}</span>}
              </>
            ) : r?.status === "insufficient" ? (
              <span className="tcc-result__status">{t("overview.status.insufficient", { needs: Object.entries(r.missing ?? {}).map(([k, n]) => t(`overview.missing.${k}`, { count: n })).join(", ") })}</span>
            ) : (
              <span className="tcc-result__status">{t("results.unknown", { gap: r?.gap ? t(`results.gap.${r.gap}`) : t("common.na") })}</span>
            )}
            {kpi && (
              <>
                <s-button variant="tertiary" commandFor={modalId} command="--show">{t("overview.calc.open")}</s-button>
                <s-modal id={modalId} heading={t("overview.calc.title", { label: t(`results.${id}.label`) })}>
                  <CalcBlock kpi={kpi} label={t(`results.${id}.label`)} />
                  <s-button slot="secondary-actions" commandFor={modalId} command="--hide">{t("overview.calc.close")}</s-button>
                </s-modal>
              </>
            )}
          </div>
        );
      })}
    </div></div>
  );
}

export function Situation({ slots = [], titles = {} }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!slots.length) return null;
  const sentences = renderSituation(slots, i18n, { titles });
  return (
    <section className="tcc-situation" aria-labelledby="tcc-situation-title">
      <h3 id="tcc-situation-title">{t("overview.block.situation")}</h3>
      <p>{sentences.map((s) => s.text).join(" ")}</p>
    </section>
  );
}

// priorities : buildBriefing.priorities ; partials : insights « partial » (ce qui attend des données).
export function Priorities({ priorities = [], partials = [], titles = {}, days = null }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <section className="tcc-block" aria-labelledby="tcc-priorities-title">
      <div className="tcc-block__head"><h3 id="tcc-priorities-title">{t("overview.block.priorities")}</h3></div>
      {priorities.length ? (
        <div className="tcc-priorities">{priorities.map((p) => <Analysis key={p.fingerprint ?? p.id} insight={p} rank={p.rank} titles={titles} days={days} />)}</div>
      ) : (
        <div className="tcc-card tcc-empty">
          <h3>{t("overview.priorities.empty_title")}</h3>
          <p>{t("overview.priorities.empty_body")}</p>
        </div>
      )}
      {partials.length > 0 && <PartialConclusions partials={partials} titles={titles} />}
    </section>
  );
}

// États vides actionnables : ce qui peut déjà être conclu + ce que l'action débloque.
export function PartialConclusions({ partials = [], titles = {}, title = null }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!partials.length) return null;
  return (
    <div className="tcc-card">
      <h4 className="tcc-eyebrow">{title ?? t("overview.priorities.partials")}</h4>
      <ul className="tcc-partials">
        {partials.map((p) => {
          const missing = Object.entries(p.missing ?? {}).map(([k, n]) => t(`overview.missing.${k}`, { count: n })).join(", ");
          const vars = Object.fromEntries(Object.entries(p.vars ?? {}).map(([k, v]) => [k, v == null ? t("common.na") : typeof v === "number" ? i18n.int(Math.round(v)) : titles[v] ?? String(v)]));
          return (
            <li key={p.fingerprint ?? p.id}>
              <Icon id="soon" />
              <span><strong>{t(`insight.${p.id}.name`)}</strong>{" — "}{t(`insight.${p.id}.partial`, { ...vars, missing })}{p.unlocks?.length ? ` ${t("overview.empty.unlock", { list: p.unlocks.map((u) => (t.has(`overview.kpi.${u}.label`) ? t(`overview.kpi.${u}.label`) : t(`insight.${u}.name`))).join(", ") })}` : ""}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// fingerprint + days : quand ils sont fournis, un formulaire POST « Retenir ce scénario » enregistre
// la décision (decision_log kind simulated, I0-C) ; l'action recalcule l'opportunité côté serveur.
export function Opportunity({ opportunity, titles = {}, fingerprint = null, days = null }) {
  const i18n = useI18n();
  const { t, money, byUnit } = i18n;
  if (!opportunity) return null;
  const insight = { ...opportunity, kind: "opportunity", status: "simulation", impact: { range: opportunity.impact, point: opportunity.impact?.point, formula: null } };
  return (
    <section className="tcc-block" aria-labelledby="tcc-opportunity-title">
      <div className="tcc-block__head"><h3 id="tcc-opportunity-title">{t("overview.block.opportunity")}</h3><ConfidenceBadge confidence={{ key: "simulation", label: t("confidence.simulation.label"), help: t("confidence.simulation.help") }} /></div>
      <Analysis insight={insight} titles={titles} days={days} />
      <p className="tcc-muted">
        {t("overview.opportunity.before_after", { node: t.has(`overview.calc.input.${opportunity.node}`) ? t(`overview.calc.input.${opportunity.node}`) : opportunity.node, before: byUnit(opportunity.before, "money"), after: byUnit(opportunity.after, "money") })}
        {" · "}{t("overview.opportunity.assumptions")}{": "}{(opportunity.assumptions ?? []).map((a) => t(`assumption.${a.key}`)).join(", ") || t("common.na")}
        {opportunity.impact ? ` · ${money(opportunity.impact.low)} – ${money(opportunity.impact.high)} ${t("impact.per_month")}` : ""}
      </p>
      {fingerprint && (
        <Form method="post" className="tcc-decision">
          <input type="hidden" name="intent" value="simulate" />
          <input type="hidden" name="fingerprint" value={fingerprint} />
          <input type="hidden" name="days" value={days ?? ""} />
          <s-button type="submit" variant="secondary">{t("decision.keep_scenario")}</s-button>
          <Link className="tcc-cta tcc-cta--ghost" to={simulatorHref(opportunity, { days })}>{t("decision.open_simulator")}</Link>
          <span className="tcc-muted">{t("decision.keep_scenario_help")}</span>
        </Form>
      )}
    </section>
  );
}

// Retour d'une action de décision : succès (kind) ou scénario périmé. Rien si pas d'action.
export function DecisionBanner({ result }) {
  const { t } = useI18n();
  if (!result || !("ok" in result) || !result.intent) return null;
  if (result.ok) return <s-banner tone="success">{t(`decision.recorded.${result.kind ?? "simulated"}`)}</s-banner>;
  return <s-banner tone="warning">{result.error === "stale" ? t("decision.stale") : t("decision.failed")}</s-banner>;
}

// Cascade « Où est passé votre argent ? » en tableau (rendu graphique en F4-B).
const WATERFALL_ROWS = [["", "ca_ht"], ["−", "cogs"], ["−", "shipping_cost"], ["−", "packaging_cost"], ["−", "payment_fees"], ["−", "returns_cost"], ["=", "cm2"], ["−", "ad_spend"], ["−", "commissions"], ["=", "cm3"], ["−", "fixed_costs"], ["=", "net_result"]];
export function WaterfallTable({ leaves = {}, nodes = {} }) {
  const { t, money } = useI18n();
  const value = (id) => (id in nodes ? nodes[id] : leaves[id]);
  return (
    <section className="tcc-block" aria-labelledby="tcc-waterfall-title">
      <div className="tcc-block__head"><h3 id="tcc-waterfall-title">{t("overview.block.waterfall")}</h3></div>
      <div className="tcc-waterfall">
        {WATERFALL_ROWS.map(([op, id]) => (
          <div key={id} className={`tcc-waterfall__row${op === "=" ? " is-total" : ""}`}>
            <span className="tcc-waterfall__op" aria-hidden="true">{op}</span>
            <span>{t(`overview.calc.input.${id}`)}</span>
            <span className="tcc-waterfall__amount">{value(id) == null ? t("common.na") : money(value(id))}</span>
          </div>
        ))}
      </div>
      <p className="tcc-muted">{t("overview.waterfall.note")}</p>
    </section>
  );
}

// Bloc 9 : « Tous les indicateurs » replié, 3 mini-lignes, lien vers Indicateurs.
export function AllIndicators({ kpis = [] }) {
  const { t, byUnit } = useI18n();
  const mini = ["ca_ht", "orders", "cm2_pct"].map((id) => kpis.find((k) => k.id === id)).filter(Boolean);
  return (
    <details className="tcc-fold">
      <summary>{t("overview.block.all")}<Icon id="soon" /></summary>
      <div className="tcc-fold__body">
        {mini.map((k) => (
          <div key={k.id} className="tcc-fold__row"><span>{t(`overview.kpi.${k.id}.label`)}</span><span>{k.status === "ok" ? byUnit(k.value, k.unit) : t(`confidence.to_verify.label`)}</span></div>
        ))}
        <Link className="tcc-cta" to="/app/metrics">{t("overview.all.more")}</Link>
      </div>
    </details>
  );
}
