// ── Réglages > Coûts produits (F4-D1a) : liste par produit, panneau par variante, douane, CSV ──
// Formulaires POST natifs, champs Polaris non contrôlés (S3 prouvé), barre de sauvegarde App Bridge.
// Les suggestions sont des exemples (placeholders), jamais des valeurs pré-remplies (S6).
import { useState } from "react";
import { Form, Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { NUMBER_FIELDS, ENUM_FIELDS, STATUS_FILTERS, isMerchant } from "../../lib/productCosts.js";
import { CATEGORIE_KEYS } from "../../lib/variantCosts.js";
import { NumberField, SelectField } from "./Fields.jsx";
import { Icon } from "../overview/Icons.jsx";

const TONE = { complete: "tcc-badge--good", partial: "tcc-badge--warn", todo: "tcc-badge--bad" };
const enumLabel = (t, f, v) => (f === "pays_import" ? t(`productcosts.country.${v}`) : f === "categorie" ? t(`productcosts.category.${v}`) : f === "vat_regime" ? t(`settings.vat.${v}`) : t(`productcosts.shipping_model.${v}`));

export function ProductCostSummary({ counts, filter = "all" }) {
  const { t, int } = useI18n();
  return (
    <nav className="tcc-subnav" aria-label={t("productcosts.filter")}>
      {STATUS_FILTERS.map((s) => (
        <Link key={s} to={s === "all" ? "?" : `?status=${s}`} className="tcc-subnav__item" aria-current={filter === s ? "page" : undefined}>{t(`productcosts.status.${s}`)} ({int(counts?.[s] ?? 0)})</Link>
      ))}
    </nav>
  );
}

export function ProductCostList({ products = [], openId = null, filter = "all", currency = null, result = null }) {
  const { t, int } = useI18n();
  if (!products.length) return <div className="tcc-card tcc-empty"><p>{t("productcosts.none")}</p></div>;
  return (
    <div className="tcc-stack">
      {products.map((p) => {
        const open = p.product_id === openId;
        return (
          <section key={p.product_id} className={`tcc-card tcc-pc${open ? " is-open" : ""}`} data-product={p.product_id} data-status={p.status.key}>
            <div className="tcc-block__head">
              <h4>{p.title}</h4>
              <span className={`tcc-badge ${TONE[p.status.key] ?? ""}`}>{p.status.key === "partial" ? t("productcosts.partial", { done: int(p.status.done), total: int(p.status.total) }) : t(`productcosts.status.${p.status.key}`)}</span>
              {p.customs?.estimated && <span className="tcc-badge tcc-badge--warn">{t("productcosts.customs.to_confirm")}</span>}
              <Link className="tcc-cta tcc-cta--ghost" to={open ? `?status=${filter}` : `?status=${filter}&product=${encodeURIComponent(p.product_id)}`}>{open ? t("productcosts.close") : t("productcosts.edit")}</Link>
            </div>
            {open && <ProductCostPanel product={p} currency={currency} result={result?.product_id === p.product_id ? result : null} />}
          </section>
        );
      })}
    </div>
  );
}

export function ProductCostPanel({ product, currency = null, result = null }) {
  const { t, number } = useI18n();
  const rows = product?.variantRows ?? [];
  const single = rows.length === 1;
  const bad = new Map((result?.errors ?? []).map((e) => [e.variant_id, new Set(e.fields)]));
  const missing = new Map((result?.skipped ?? []).map((e) => [e.variant_id, new Set(e.empty)]));
  const ph = (r, f) => (r[f] != null && String(r[f]) !== "" && !isMerchant(r) ? t("productcosts.example", { value: typeof r[f] === "number" ? number(r[f], { digits: 2 }) : r[f] }) : null);
  const val = (r, f) => (isMerchant(r) ? r[f] ?? null : null);
  return (
    <Form method="post" data-save-bar="" className="tcc-form tcc-pc__panel">
      <input type="hidden" name="intent" value="save_product" />
      <input type="hidden" name="product_id" value={product.product_id} />
      <p className="tcc-muted">{t("productcosts.panel_help")}</p>
      {rows.map((r, i) => (
        <fieldset key={r.variant_id} className="tcc-pc__variant" data-variant={r.variant_id}>
          <input type="hidden" name={`vid_${i}`} value={r.variant_id} />
          {!single && <legend>{r.variant_title && r.variant_title !== "Default Title" ? r.variant_title : t("productcosts.variant")}{isMerchant(r) ? ` · ${t("productcosts.entered")}` : ""}</legend>}
          <div className="tcc-form__grid">
            {NUMBER_FIELDS.map((f) => (
              <NumberField key={f} name={`${f}_${i}`} label={t(`productcosts.field.${f}`, { currency: currency ?? "" })} value={val(r, f)} placeholder={ph(r, f)} error={bad.get(r.variant_id)?.has(f) ? "invalid" : missing.get(r.variant_id)?.has(f) ? "required" : null} />
            ))}
            {Object.entries(ENUM_FIELDS).map(([f, opts]) => (
              <SelectField key={f} name={`${f}_${i}`} label={t(`productcosts.field.${f}`)} value={r[f] ?? opts[0]} options={opts.map((o) => ({ value: o, label: enumLabel(t, f, o) }))} error={bad.get(r.variant_id)?.has(f) ? "invalid" : null} />
            ))}
          </div>
        </fieldset>
      ))}
      <div className="tcc-form__actions"><s-button type="submit" variant="secondary">{t("productcosts.save")}</s-button><span className="tcc-muted">{t("productcosts.empty_rule")}</span></div>
    </Form>
  );
}

// Classification douanière : produits dont au moins une variante stockée n'est pas confirmée.
export function CustomsPanel({ products = [], result = null }) {
  const { t } = useI18n();
  const list = products.filter((p) => p.customs?.estimated);
  if (!list.length) return null;
  return (
    <section className="tcc-block" aria-labelledby="tcc-customs-title">
      <div className="tcc-block__head"><h3 id="tcc-customs-title">{t("productcosts.customs.title", { count: list.length })}</h3></div>
      <p className="tcc-muted">{t("productcosts.customs.help")}</p>
      {result?.intent === "confirm_customs" && result.ok && <s-banner tone="success">{result.rateChanged ? t("productcosts.customs.rate_changed") : t("productcosts.customs.confirmed")}</s-banner>}
      <div className="tcc-stack">
        {list.map((p) => (
          <Form key={p.product_id} method="post" className="tcc-card tcc-form tcc-pc__customs" data-customs={p.product_id}>
            <input type="hidden" name="intent" value="confirm_customs" />
            <input type="hidden" name="product_id" value={p.product_id} />
            <div className="tcc-form__row">
              <SelectField name="categorie" label={p.customs.divergent ? `${p.title} · ${t("productcosts.customs.divergent")}` : p.title} value={p.customs.category ?? ""} options={[...(p.customs.divergent ? [{ value: "", label: t("productcosts.customs.choose") }] : []), ...CATEGORIE_KEYS.map((c) => ({ value: c, label: t(`productcosts.category.${c}`) }))]} />
              <div className="tcc-form__actions"><s-button type="submit" variant="secondary">{t("settings.confirm")}</s-button></div>
            </div>
          </Form>
        ))}
      </div>
    </section>
  );
}

// Import / export CSV : export = modèle pré-rempli (lien de téléchargement), import = fichier natif.
// Un rejet dit pourquoi : champ, valeur reçue, raison, valeurs acceptées.
function csvIssue(t, x) {
  const field = t(`productcosts.error.${x.field}`);
  const reason = t(`productcosts.csv.reason.${x.reason}`, { value: x.value, max: x.max ?? "", expected: (x.expected ?? []).join(", ") });
  return x.value ? `${field} « ${x.value} » : ${reason}` : `${field} : ${reason}`;
}

// Téléchargement du modèle par la route authentifiée : fetch (App Bridge y ajoute le jeton de session),
// puis fichier enregistré depuis la page (lien d'objet). Un lien simple n'aurait pas de jeton.
export const EXPORT_PATH = "/app/settings/products/export";
const EXPORT_NAMES = { xlsx: "true-cost-calculator-costs.xlsx", csv: "true-cost-calculator-costs.csv" };
function useExport() {
  const [state, setState] = useState({ busy: null, error: false });
  const download = async (format) => {
    setState({ busy: format, error: false });
    try {
      const res = await fetch(`${EXPORT_PATH}?format=${format}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = EXPORT_NAMES[format];
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setState({ busy: null, error: false });
    } catch (e) {
      console.error("[ProductCosts] export :", e?.message);
      setState({ busy: null, error: true });
    }
  };
  return [state, download];
}

export function CostsCsv({ result = null }) {
  const { t, int } = useI18n();
  const imported = result?.intent === "import_csv" ? result : null;
  const [exp, download] = useExport();
  return (
    <section className="tcc-block" aria-labelledby="tcc-csv-title">
      <div className="tcc-block__head"><h3 id="tcc-csv-title">{t("productcosts.csv.title")}</h3></div>
      <p className="tcc-muted">{t("productcosts.csv.help")}</p>
      <div className="tcc-form__actions">
        <s-button variant="primary" data-export="xlsx" loading={exp.busy === "xlsx" ? "true" : undefined} disabled={exp.busy ? "true" : undefined} onClick={() => download("xlsx")}>{t("productcosts.csv.export")}</s-button>
        <s-button variant="tertiary" data-export="csv" loading={exp.busy === "csv" ? "true" : undefined} disabled={exp.busy ? "true" : undefined} onClick={() => download("csv")}>{t("productcosts.csv.export_csv")}</s-button>
      </div>
      {exp.error && <s-banner tone="critical" data-export-error="">{t("productcosts.csv.download_error")}</s-banner>}
      <Form method="post" encType="multipart/form-data" className="tcc-card tcc-form">
        <input type="hidden" name="intent" value="import_csv" />
        <label className="tcc-pc__file">{t("productcosts.csv.file")}<input type="file" name="csv" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></label>
        <div className="tcc-form__actions"><s-button type="submit" variant="secondary">{t("productcosts.csv.import")}</s-button></div>
      </Form>
      {imported?.header && <s-banner tone="critical" data-csv-header={imported.header.reason}>{imported.header.reason === "missing_columns" ? t("productcosts.csv.missing_columns", { columns: imported.header.columns.join(", ") }) : t(`productcosts.csv.${imported.header.reason}`)}</s-banner>}
      {imported && !imported.header && !imported.ok && <s-banner tone="critical">{t("settings.error.failed")}</s-banner>}
      {imported?.ok && <s-banner tone={imported.errorCount ? "warning" : "success"}>{t("productcosts.csv.done", { count: imported.saved ?? 0 })}{imported.errorCount ? ` ${t("productcosts.csv.line_errors", { count: imported.errorCount })}` : ""}</s-banner>}
      {imported?.incomplete > 0 && <s-banner tone="info" data-csv-incomplete={imported.incomplete}>{t("productcosts.csv.incomplete", { count: imported.incomplete })}</s-banner>}
      {imported?.csvErrors?.length > 0 && (
        <ul className="tcc-partials" data-csv-errors={imported.errorCount}>
          {imported.csvErrors.slice(0, 10).map((e) => (
            <li key={e.line}><Icon id="soon" /><span>{t("productcosts.csv.line", { line: int(e.line) })}{" "}{e.issues.map((x) => csvIssue(t, x)).join(" ; ")}</span></li>
          ))}
        </ul>
      )}
    </section>
  );
}
