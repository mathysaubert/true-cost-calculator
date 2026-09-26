// ── D1c — Audit catalogue (Expert) : marge unitaire au prix catalogue, classée par le seuil ──
import { Form, Link, useNavigation } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { AUDIT_GROUPS, classifyAuditRows } from "../../lib/products.js";

const GROUP_TONE = { loser: "tcc-badge--bad", risky: "tcc-badge--warn", winner: "tcc-badge--good" };

export function CatalogAudit({ isExpert = false, indeterminate = false, returnRatePct = null, returnRateMissing = null, returnRateNoOrders = false, thresholdPct = null, result = null }) {
  const { t, money, pct } = useI18n();
  const nav = useNavigation();
  const running = nav.state === "submitting" && nav.formData?.get("intent") === "run_audit";
  if (!isExpert) {
    return (
      <section className="tcc-block" aria-labelledby="tcc-audit" data-audit="locked">
        <div className="tcc-block__head"><h3 id="tcc-audit">{t("products.audit.title")}</h3><span className="tcc-badge tcc-badge--accent">{t("products.audit.expert")}</span></div>
        <p className="tcc-muted">{indeterminate ? t("products.audit.indeterminate") : t("products.audit.locked")}</p>
        {!indeterminate && <Link to="/app/settings/plan">{t("products.audit.upgrade")}</Link>}
      </section>
    );
  }
  // D2-4 : objectif non renseigné (null) = classement à 0 (perte stricte), libellé dédié.
  const t0 = result?.ok ? result.thresholdPct : thresholdPct;
  const groups = result?.ok ? classifyAuditRows(result.rows, t0 ?? 0) : null;
  return (
    <section className="tcc-block tcc-table-host" aria-labelledby="tcc-audit" data-audit={result?.ok ? "done" : running ? "running" : "idle"}>
      <div className="tcc-block__head"><h3 id="tcc-audit">{t("products.audit.title")}</h3><span className="tcc-badge tcc-badge--accent">{t("products.audit.expert")}</span></div>
      <p className="tcc-muted">{t("products.audit.help")}</p>
      <Form method="post" className="tcc-form tcc-objective__row">
        <input type="hidden" name="intent" value="run_audit" />
        <label className="tcc-newp__field">{t("products.audit.return_rate")}<input type="number" name="return_rate_pct" inputMode="decimal" min="0" max="100" step="0.1" defaultValue={returnRatePct ?? ""} /></label>
        <s-button type="submit" variant="primary" disabled={running ? "true" : undefined}>{running ? t("products.audit.running") : t("products.audit.run")}</s-button>
      </Form>
      {returnRatePct == null && <p className="tcc-muted" data-return-rate="unmeasured">{returnRateNoOrders ? t("products.audit.return_rate_no_orders") : returnRateMissing != null ? t("products.audit.return_rate_missing", { count: returnRateMissing }) : t("products.audit.return_rate_none")}</p>}
      {result && !result.ok && <s-banner tone="critical">{t(`products.audit.error.${result.error}`)}</s-banner>}
      {groups && (
        <div className="tcc-stack">
          <p>{t("products.audit.scanned", { count: result.scanned })}{result.noCost > 0 && ` ${t("products.audit.no_cost", { count: result.noCost })}`}</p>
          {result.incomplete && <s-banner tone="warning">{t("products.audit.incomplete")}</s-banner>}
          {result.missingSettings?.length > 0 && <p className="tcc-muted" data-audit-missing="">{t("products.audit.missing_settings", { fields: result.missingSettings.map((k) => t(`sim.new.field.${k}`)).join(", ") })} <Link to="/app/settings/costs">{t("products.audit.settings_link")}</Link></p>}
          {!result.taxesIncluded && <p className="tcc-muted">{t("products.audit.prices_excl_tax")}</p>}
          {AUDIT_GROUPS.map((g) => (
            <div key={g} className="tcc-stack" data-audit-group={g}>
              <h4 className="tcc-eyebrow"><span className={`tcc-badge ${GROUP_TONE[g]}`}>{t(`products.audit.group.${g}`, { count: groups[g].length })}</span>{" "}{g === "risky" && t0 == null ? t("products.audit.band.risky_unset") : g === "risky" && t0 <= 0 ? t("products.audit.band.risky_off") : t(`products.audit.band.${g}`, { pct: pct(t0 ?? 0, { digits: Number.isInteger(t0 ?? 0) ? 0 : 1 }) })}</h4>
              {groups[g].length > 0 && (
                <div className="tcc-prodtable tcc-prodtable--audit" role="table">
                  {groups[g].map((r) => (
                    <div key={r.id} className="tcc-prodtable__row" role="row" data-audit-row={r.id}>
                      <span role="cell" className="tcc-prodtable__title"><strong>{r.title}</strong><small className="tcc-muted">{r.category}{r.customs_estimated ? ` · ${t("products.audit.customs_estimated")}` : ""}</small></span>
                      <span role="cell" className="tcc-table__amount">{money(r.price_ttc)}</span>
                      <span role="cell" className="tcc-table__amount">{t("products.audit.cost", { amount: money(r.cost) })}{r.cost_source === "shopify" && <> <span className="tcc-badge tcc-badge--warn">{t("products.audit.cost_shopify")}</span></>}</span>
                      <span role="cell" className={`tcc-table__amount${r.cm2 < 0 ? " is-bad" : ""}`}>{money(r.cm2)}</span>
                      <span role="cell" className="tcc-table__amount">{pct(r.cm2_pct)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <p className="tcc-muted">{t("products.audit.assumptions")}</p>
        </div>
      )}
    </section>
  );
}
