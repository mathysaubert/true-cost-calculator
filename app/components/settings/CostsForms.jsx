// ── Réglages > Coûts (R1) : coûts de commande, port par pays, frais par passerelle, coûts fixes ──
// Chaque bloc = un formulaire POST natif avec son intent ; aucun champ contrôlé.
import { Form } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { FIELDS, SHIPPING_ROWS, presetFor, ruleFor, isActiveFixedCost, shippingState } from "../../lib/settings.js";
import { NumberField, TextField, DateField } from "./Fields.jsx";
import { Icon } from "../overview/Icons.jsx";

const err = (result, intent, key) => (result?.intent === intent ? result.errors?.[key] ?? null : null);

export function OrderCostsForm({ settings = {}, result = null }) {
  const { t } = useI18n();
  return (
    <section className="tcc-block" aria-labelledby="tcc-order-costs-title">
      <div className="tcc-block__head"><h3 id="tcc-order-costs-title">{t("settings.costs.order.title")}</h3></div>
      <p className="tcc-muted">{t("settings.costs.order.help")}</p>
      <Form method="post" data-save-bar="" className="tcc-form">
        <input type="hidden" name="intent" value="save_order_costs" />
        <div className="tcc-form__grid">
          {FIELDS.order_costs.map((f) => (
            <NumberField key={f.key} name={f.key} label={t(`settings.field.${f.key}.label`)} help={t(`settings.field.${f.key}.help`)} value={settings[f.key]} error={err(result, "save_order_costs", f.key)} suffix={f.kind === "int" ? t("settings.unit.days") : null} />
          ))}
        </div>
        <div className="tcc-form__actions"><s-button type="submit" variant="secondary">{t("settings.save")}</s-button></div>
      </Form>
    </section>
  );
}

const SHIPPING_TONE = { set: "tcc-badge--good", unconfirmed: "tcc-badge--warn", unset: "tcc-badge--bad" };

export function ShippingForm({ settings = {}, result = null }) {
  const { t } = useI18n();
  const rules = settings.shipping_cost_rules ?? {};
  const rows = Object.entries(rules.byCountry ?? {});
  const shipState = shippingState(rules);
  return (
    <section className="tcc-block" aria-labelledby="tcc-shipping-title">
      <div className="tcc-block__head">
        <h3 id="tcc-shipping-title">{t("settings.shipping.title")}</h3>
        <span className={`tcc-badge ${SHIPPING_TONE[shipState]}`} data-shipping-state={shipState}>{t(`settings.status.${shipState}`)}</span>
      </div>
      <p className="tcc-muted">{t("settings.shipping.help")}</p>
      <Form method="post" data-save-bar="" className="tcc-form">
        <input type="hidden" name="intent" value="save_shipping" />
        <div className="tcc-form__grid">
          <NumberField name="shipping_default" label={t("settings.field.shipping_default.label")} help={t("settings.field.shipping_default.help")} value={rules.confirmed ? rules.default : null} error={err(result, "save_shipping", "shipping_default")} />
        </div>
        <div className="tcc-form__rows">
          {Array.from({ length: SHIPPING_ROWS }, (_, i) => {
            const [c, a] = rows[i] ?? [null, null];
            return (
              <div key={i} className="tcc-form__row">
                <TextField name={`shipping_country_${i + 1}`} label={t("settings.field.shipping_country.label", { n: i + 1 })} value={c} placeholder={t("settings.placeholder.country")} maxLength={2} error={err(result, "save_shipping", `shipping_country_${i + 1}`)} />
                <NumberField name={`shipping_amount_${i + 1}`} label={t("settings.field.shipping_amount.label")} value={a} error={err(result, "save_shipping", `shipping_amount_${i + 1}`)} />
              </div>
            );
          })}
        </div>
        <div className="tcc-form__actions"><s-button type="submit" variant="secondary">{t("settings.confirm")}</s-button></div>
      </Form>
    </section>
  );
}

// Une règle par passerelle vue dans les commandes (S4) ; enregistrer = confirmer.
export function GatewayRules({ settings = {}, gateways = [], result = null }) {
  const { t, number, pct } = useI18n();
  const rules = settings.gateway_fee_rules ?? [];
  const known = gateways.map((g) => g.gateway);
  const extra = (Array.isArray(rules) ? rules : []).filter((r) => r?.gateway && !known.includes(r.gateway)).map((r) => ({ gateway: r.gateway, orders: 0 }));
  const list = [...gateways, ...extra];
  return (
    <section className="tcc-block" aria-labelledby="tcc-gateways-title">
      <div className="tcc-block__head"><h3 id="tcc-gateways-title">{t("settings.gateways.title")}</h3></div>
      <p className="tcc-muted">{t("settings.gateways.help")}</p>
      {!list.length ? <div className="tcc-card tcc-empty"><p>{t("settings.gateways.none")}</p></div> : (
        <div className="tcc-stack">
          {list.map((g) => {
            const rule = ruleFor(rules, g.gateway);
            const preset = presetFor(g.gateway);
            const bad = result?.intent === "save_gateway" && result.gateway === g.gateway ? result.errors ?? {} : {};
            return (
              <Form key={g.gateway} method="post" data-save-bar="" className="tcc-card tcc-form tcc-gateway" data-gateway={g.gateway}>
                <input type="hidden" name="intent" value="save_gateway" />
                <input type="hidden" name="gateway" value={g.gateway} />
                <div className="tcc-block__head">
                  <h4>{g.gateway} <small className="tcc-muted">{t("settings.gateways.orders", { count: g.orders })}</small></h4>
                  <span className={`tcc-badge ${rule?.confirmed ? "tcc-badge--good" : "tcc-badge--warn"}`}>{rule?.confirmed ? t("settings.gateways.confirmed") : t("settings.gateways.unconfirmed")}</span>
                </div>
                <div className="tcc-form__row">
                  <NumberField name="pct" label={t("settings.field.gateway_pct.label")} value={rule?.pct} placeholder={preset.pct} error={bad.pct ?? null} suffix="%" />
                  <NumberField name="fixed" label={t("settings.field.gateway_fixed.label")} value={rule?.fixed} placeholder={preset.fixed} error={bad.fixed ?? null} />
                </div>
                {!rule?.confirmed && <p className="tcc-muted">{t("settings.gateways.preset", { pct: pct(preset.pct), fixed: number(preset.fixed, { digits: 2 }) })}</p>}
                <div className="tcc-form__actions"><s-button type="submit" variant="secondary">{t("settings.confirm")}</s-button></div>
              </Form>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Coûts fixes (S5) : lignes, ajout, fin (date du jour), suppression.
export function FixedCosts({ rows = [], today = null, result = null }) {
  const { t, money, day } = useI18n();
  const active = rows.filter((r) => !today || isActiveFixedCost(r, today));
  const total = active.reduce((s, r) => s + Number(r.amount_monthly ?? 0), 0);
  return (
    <section className="tcc-block" aria-labelledby="tcc-fixed-title">
      <div className="tcc-block__head"><h3 id="tcc-fixed-title">{t("settings.fixed.title")}</h3>{active.length > 0 && <span className="tcc-badge tcc-badge--good">{t("settings.fixed.total", { amount: money(total) })}</span>}</div>
      <p className="tcc-muted">{t("settings.fixed.help")}</p>
      {!rows.length ? <div className="tcc-card tcc-empty"><p>{t("settings.fixed.none")}</p></div> : (
        <div className="tcc-table" role="table">
          {rows.map((r) => {
            const on = !today || isActiveFixedCost(r, today);
            return (
              <div key={r.id} className={`tcc-table__row${on ? "" : " is-off"}`} role="row" data-fixed-cost={r.id}>
                <span role="cell"><strong>{r.label}</strong><br /><small className="tcc-muted">{r.active_from ? day(r.active_from) : "—"}{" → "}{r.active_to ? day(r.active_to) : "—"}</small></span>
                <span role="cell" className="tcc-table__amount">{money(r.amount_monthly)}</span>
                <span role="cell"><span className={`tcc-badge ${on ? "tcc-badge--good" : ""}`}>{on ? t("settings.fixed.active") : t("settings.fixed.ended")}</span></span>
                <span role="cell" className="tcc-table__actions">
                  {on && <Form method="post"><input type="hidden" name="intent" value="end_fixed_cost" /><input type="hidden" name="id" value={r.id} /><s-button type="submit" variant="tertiary">{t("settings.fixed.end")}</s-button></Form>}
                  <Form method="post"><input type="hidden" name="intent" value="delete_fixed_cost" /><input type="hidden" name="id" value={r.id} /><s-button type="submit" variant="tertiary" tone="critical">{t("settings.fixed.delete")}</s-button></Form>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <Form method="post" data-save-bar="" className="tcc-card tcc-form">
        <input type="hidden" name="intent" value="add_fixed_cost" />
        <h4 className="tcc-eyebrow"><Icon id="check" />{t("settings.fixed.add")}</h4>
        <div className="tcc-form__grid">
          <TextField name="label" label={t("settings.field.label.label")} maxLength={120} error={err(result, "add_fixed_cost", "label")} />
          <NumberField name="amount_monthly" label={t("settings.field.amount_monthly.label")} error={err(result, "add_fixed_cost", "amount_monthly")} />
          <DateField name="active_from" label={t("settings.field.active_from.label")} help={t("settings.field.active_from.help")} error={err(result, "add_fixed_cost", "active_from")} />
          <DateField name="active_to" label={t("settings.field.active_to.label")} help={t("settings.field.active_to.help")} error={err(result, "add_fixed_cost", "active_to")} />
        </div>
        <div className="tcc-form__actions"><s-button type="submit" variant="secondary">{t("settings.fixed.add")}</s-button></div>
      </Form>
    </section>
  );
}
