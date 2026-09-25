// ── D1c — Section Produits : synthèse, filtres par statut de coût, tri, liste par produit ──
import { Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { PRODUCT_COST_STATUSES, PRODUCT_SORTS } from "../../lib/products.js";

const STATUS_TONE = { set: "tcc-badge--good", to_confirm: "tcc-badge--warn", partial: "tcc-badge--warn", missing: "tcc-badge--bad" };
const search = ({ days, status, sort }) => {
  const p = new URLSearchParams({ days: String(days) });
  if (status && status !== "all") p.set("status", status);
  if (sort && sort !== "ca_ht") p.set("sort", sort);
  return `?${p.toString()}`;
};

export function ProductSummary({ summary, capped = false, total = 0 }) {
  const { t, pct } = useI18n();
  if (!summary?.total) return null;
  return (
    <div className="tcc-card tcc-stack" data-products-summary="">
      <p>{t("products.summary.count", { count: capped ? total : summary.total })}</p>
      {summary.unknown_share > 0 && <p className="tcc-muted">{t("products.summary.unknown", { pct: pct(summary.unknown_share) })}</p>}
      {capped && <p className="tcc-muted">{t("products.summary.capped", { count: summary.total })}</p>}
    </div>
  );
}

export function ProductList({ products = [], summary = null, days = 30, status = "all", sort = "ca_ht" }) {
  const { t, money, pct, int } = useI18n();
  const counts = summary?.counts ?? {};
  return (
    <section className="tcc-block tcc-table-host" aria-labelledby="tcc-products-list">
      <div className="tcc-block__head"><h3 id="tcc-products-list">{t("products.list.title")}</h3><Link to="/app/settings/products">{t("products.list.costs_link")}</Link></div>
      <nav className="tcc-subnav" aria-label={t("products.filter.label")}>
        {["all", ...PRODUCT_COST_STATUSES].map((s) => (
          <Link key={s} to={search({ days, status: s, sort })} className="tcc-subnav__item" aria-current={status === s ? "page" : undefined} data-status-filter={s}>
            {t(`products.status.${s}`)}{s !== "all" && ` · ${int(counts[s] ?? 0)}`}
          </Link>
        ))}
      </nav>
      <p className="tcc-muted">{t("products.list.help")}</p>
      {!products.length ? <div className="tcc-card tcc-empty"><p>{t("products.list.none")}</p></div> : (
        <div className="tcc-prodtable" role="table">
          <div className="tcc-prodtable__row is-head" role="row">
            <span role="columnheader">{t("products.col.product")}</span>
            {PRODUCT_SORTS.map((k) => (
              <span key={k} role="columnheader"><Link to={search({ days, status, sort: k })} aria-current={sort === k ? "true" : undefined} data-sort={k}>{t(`products.col.${k}`)}</Link></span>
            ))}
            <span role="columnheader">{t("products.col.status")}</span>
          </div>
          {products.map((p) => (
            <div key={p.id} className="tcc-prodtable__row" role="row" data-product={p.id} data-cost-status={p.status}>
              <span role="cell" className="tcc-prodtable__title"><strong>{p.title}</strong><small className="tcc-muted">{t("products.orders", { count: p.orders })}</small></span>
              <span role="cell" className="tcc-table__amount" data-col="ca_ht">{money(p.ca_ht)}</span>
              <span role="cell" className={`tcc-table__amount${p.cm2 != null && p.cm2 < 0 ? " is-bad" : ""}`} data-col="cm2">{p.cm2 == null ? t("common.na") : money(p.cm2)}</span>
              <span role="cell" className="tcc-table__amount" data-col="cm2_pct">{p.cm2_pct == null ? t("common.na") : pct(p.cm2_pct)}</span>
              <span role="cell" className="tcc-table__amount" data-col="units">{int(p.units)}</span>
              <span role="cell"><span className={`tcc-badge ${STATUS_TONE[p.status]}`}>{t(`products.status.${p.status}`)}</span></span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
