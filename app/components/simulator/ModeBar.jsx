// ── S3 — Simulateur : choix du mode (boutique, produit existant, nouveau produit) et du produit ──
import { Form, Link } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";

export const SIM_MODES = ["shop", "product", "new"];

// products : [{ id, title, ca_ht, orders }] ; product : id sélectionné ; days : période.
export function ModeBar({ mode = "shop", products = [], product = null, days = 30 }) {
  const { t, money } = useI18n();
  return (
    <div className="tcc-stack">
      <nav className="tcc-subnav" aria-label={t("sim.mode.label")}>
        {SIM_MODES.map((m) => <Link key={m} to={`?days=${days}${m === "shop" ? "" : `&mode=${m}`}`} className="tcc-subnav__item" aria-current={mode === m ? "page" : undefined}>{t(`sim.mode.${m}`)}</Link>)}
      </nav>
      {mode === "product" && (
        !products.length ? <div className="tcc-card tcc-empty"><p>{t("sim.product.none")}</p></div> : (
          <Form method="get" className="tcc-form tcc-objective__row" data-product-picker="">
            <input type="hidden" name="mode" value="product" />
            <input type="hidden" name="days" value={days} />
            <label>{t("sim.product.pick")}<select name="product" defaultValue={product ?? products[0].id}>{products.map((p) => <option key={p.id} value={p.id}>{`${p.title} · ${money(p.ca_ht)} · ${t("sim.product.orders", { count: p.orders })}`}</option>)}</select></label>
            <button type="submit" className="tcc-cta">{t("sim.product.load")}</button>
            {product && <span className="tcc-muted">{t("sim.product.count", { count: products.length })}</span>}
          </Form>
        )
      )}
    </div>
  );
}
