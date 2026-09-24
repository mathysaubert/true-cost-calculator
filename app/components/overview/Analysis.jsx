// ── Composant « Analyse » (I0-B, D10) — PUR, trois niveaux de lecture ────────────────────────
// 5 s   : nom, observation, impact en fourchette, niveau de confiance, une seule action.
// 30 s  : dépliage natif <details> (aucun état contrôlé) : Question / Impact / Action, contexte,
//         cause avec barres de contribution (le mouvement explique l'argent), recommandation.
// Complet : s-modal Polaris « Pourquoi cette conclusion ? » : formule, preuves du moteur, part
//         expliquée, trous, simulation, suivi. Jamais de couleur seule : badge de confiance texte.
import { Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { renderInsight } from "../../lib/insights/render.js";
import { Icon } from "./Icons.jsx";

const SECTION_OF_TARGET = { costs: "settings", fees: "settings", ads: "settings", profit: "profit", products: "products", marketing: "marketing", inventory: "inventory" };

function Cta({ cta, insightId }) {
  if (!cta) return null;
  const target = SECTION_OF_TARGET[cta.target] ?? cta.target;
  const modalId = `why-${insightId}`;
  if (cta.kind === "fix_data" || cta.kind === "connect") return <Link className="tcc-cta" to="/app/data-health">{cta.label}</Link>;
  if (cta.kind === "open_section" && target === "overview") return <Link className="tcc-cta" to="/app/overview">{cta.label}</Link>;
  // Sections « Bientôt » et simulation : le CTA ouvre la modale complète (hypothèses, preuves).
  return <s-button variant="secondary" commandFor={modalId} command="--show">{cta.label}</s-button>;
}

export function ConfidenceBadge({ confidence }) {
  if (!confidence) return null;
  return <span className={`tcc-confidence tcc-confidence--${confidence.key}`} title={confidence.help}>{confidence.label}</span>;
}

export function Analysis({ insight, rank = null, titles = {} }) {
  const i18n = useI18n();
  const { t, money, pct } = i18n;
  if (!insight) return null;
  const r = renderInsight(insight, i18n, { titles });
  const modalId = `why-${insight.id}`;
  const range = insight.impact?.range ?? null;
  const contributions = insight.cause?.contributions ?? [];
  const maxShare = Math.max(0.0001, ...contributions.map((c) => Math.abs(c.share ?? 0)));
  return (
    <article className={`tcc-analysis is-${insight.kind}`} data-insight={insight.id} data-status={insight.status}>
      <header className="tcc-analysis__head">
        {rank != null && <span className="tcc-analysis__rank" aria-hidden="true">{rank}</span>}
        <h3 className="tcc-analysis__name">{r.name}</h3>
        <ConfidenceBadge confidence={r.confidence} />
      </header>
      <p className="tcc-analysis__obs">{r.observation}</p>
      {range && (
        <p className="tcc-analysis__impact">
          {t("impact.everything_equal", { low: money(range.low), high: money(range.high) })} <small>{r.horizon}</small>
        </p>
      )}
      <div className="tcc-analysis__actions">
        <Cta cta={r.cta} insightId={insight.id} />
        <s-button variant="tertiary" commandFor={modalId} command="--show">{t("analysis.why")}</s-button>
      </div>
      {(r.context || r.cause || r.recommendation) && (
        <details>
          <summary><Icon id="soon" className="tcc-analysis__chev" />{t("analysis.more")}</summary>
          <div className="tcc-qia-host"><div className="tcc-qia">
            <div className="tcc-qia__block"><h4>{t("analysis.question")}</h4><p>{r.context ?? r.observation}</p></div>
            <div className="tcc-qia__block"><h4>{t("analysis.impact")}</h4><p>{r.impact ?? t("analysis.no_impact")}</p></div>
            <div className="tcc-qia__block"><h4>{t("analysis.action")}</h4><p>{r.recommendation ?? t("common.na")}</p></div>
          </div></div>
          {contributions.length > 0 && (
            <div className="tcc-cause">
              <p>{r.cause}{r.offset ? ` ${r.offset}` : ""}</p>
              {contributions.map((c) => (
                <div key={c.factor} className="tcc-cause__row">
                  <span>{t.has(`factor.${c.factor}`) ? t(`factor.${c.factor}`) : t.has(`reason.${c.factor}`) ? t(`reason.${c.factor}`) : c.factor}</span>
                  <span>{c.amount != null ? money(c.amount) : pct((c.share ?? 0) * 100, { digits: 0 })}</span>
                  <svg className="tcc-cause__bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect className="tcc-cause__fill" x="0" y="0" height="6" width={Math.round(Math.min(1, Math.abs(c.share ?? 0) / maxShare) * 100)} /></svg>
                </div>
              ))}
            </div>
          )}
          {!contributions.length && insight.status !== "partial" && <p className="tcc-muted">{t("analysis.no_cause")}</p>}
        </details>
      )}
      <s-modal id={modalId} heading={t("analysis.why_title", { name: r.name })}>
        <div className="tcc tcc-calc">
          <p className="tcc-calc__formula">{r.observation}</p>
          <div className="tcc-qia-host"><div className="tcc-qia">
            <div className="tcc-qia__block"><h4>{t("analysis.context")}</h4><p>{r.context ?? t("common.na")}</p></div>
            <div className="tcc-qia__block"><h4>{t("analysis.cause")}</h4><p>{r.cause ? `${r.cause}${r.offset ? ` ${r.offset}` : ""}` : t("analysis.no_cause")}</p></div>
            <div className="tcc-qia__block"><h4>{t("analysis.impact")}</h4><p>{r.impact ?? t("analysis.no_impact")}</p></div>
          </div></div>
          {insight.impact?.formula && <p className="tcc-calc__note"><strong>{t("analysis.formula")}</strong>{": "}{insight.impact.formula}</p>}
          <h4 className="tcc-eyebrow">{t("analysis.evidence")}</h4>
          <div className="tcc-evidence">
            {r.evidence.map((e, i) => (
              <div key={`${e.node}-${i}`} className="tcc-evidence__row"><span>{e.label}</span><span>{e.text}</span></div>
            ))}
          </div>
          {insight.explained != null && <p className="tcc-calc__note">{t("analysis.explained", { pct: pct(insight.explained * 100, { digits: 0 }) })}</p>}
          {insight.gaps_share > 0 && <p className="tcc-calc__note">{t("analysis.gaps_share", { pct: pct(insight.gaps_share, { digits: 0 }) })}</p>}
          {r.simulation && <p className="tcc-calc__note"><strong>{t("analysis.simulation")}</strong>{": "}{r.simulation}</p>}
          {r.followup && <p className="tcc-calc__note"><strong>{t("analysis.followup")}</strong>{": "}{r.followup}</p>}
          <p className="tcc-calc__note"><ConfidenceBadge confidence={r.confidence} /> {r.confidence.help}</p>
        </div>
        <s-button slot="secondary-actions" commandFor={modalId} command="--hide">{t("analysis.close")}</s-button>
      </s-modal>
    </article>
  );
}
