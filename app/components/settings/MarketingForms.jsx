// ── Réglages > Marketing (R2, décision H) : partenaires, règles de codes promo, commissions
// manuelles. Saisie ici, lecture dans Marketing plus tard. Formulaires POST natifs par action.
import { Form } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { COMMISSION_BASES, PARTNER_MODES } from "../../lib/settings.js";
import { NumberField, TextField, SelectField, DateField } from "./Fields.jsx";
import { Icon } from "../overview/Icons.jsx";

const err = (result, intent, key) => (result?.intent === intent ? result.errors?.[key] ?? null : null);

export function Partners({ partners = [], result = null }) {
  const { t } = useI18n();
  return (
    <section className="tcc-block" aria-labelledby="tcc-partners-title">
      <div className="tcc-block__head"><h3 id="tcc-partners-title">{t("settings.partners.title")}</h3></div>
      <p className="tcc-muted">{t("settings.partners.help")}</p>
      {!partners.length ? <div className="tcc-card tcc-empty"><p>{t("settings.partners.none")}</p></div> : (
        <div className="tcc-table" role="table">
          {partners.map((p) => (
            <div key={p.id} className="tcc-table__row" role="row" data-partner={p.id}>
              <span role="cell"><strong>{p.name}</strong></span>
              <span role="cell"><span className="tcc-badge">{t(`settings.partner_mode.${p.mode}`)}</span></span>
              <span role="cell" className="tcc-table__actions">
                <Form method="post"><input type="hidden" name="intent" value="delete_partner" /><input type="hidden" name="id" value={p.id} /><s-button type="submit" variant="tertiary" tone="critical">{t("settings.fixed.delete")}</s-button></Form>
              </span>
            </div>
          ))}
        </div>
      )}
      <Form method="post" className="tcc-card tcc-form">
        <input type="hidden" name="intent" value="add_partner" />
        <h4 className="tcc-eyebrow"><Icon id="check" />{t("settings.partners.add")}</h4>
        <div className="tcc-form__grid">
          <TextField name="name" label={t("settings.field.partner_name.label")} maxLength={80} error={err(result, "add_partner", "name")} />
          <SelectField name="mode" label={t("settings.field.partner_mode.label")} help={t("settings.field.partner_mode.help")} value="codes" options={PARTNER_MODES.map((m) => ({ value: m, label: t(`settings.partner_mode.${m}`) }))} error={err(result, "add_partner", "mode")} />
        </div>
        <div className="tcc-form__actions"><s-button type="submit" variant="secondary">{t("settings.partners.add")}</s-button></div>
      </Form>
    </section>
  );
}

// Règles de codes promo : une par code (clé shop + code), commission % sur base HT après ou avant remise.
export function PromoRules({ rules = [], partners = [], codes = [], result = null }) {
  const { t, pct, day } = useI18n();
  const partnerName = (id) => partners.find((p) => p.id === id)?.name ?? null;
  const known = new Set(rules.map((r) => r.code));
  const unseen = codes.filter((c) => !known.has(c.code));
  const partnerOptions = [{ value: "", label: t("settings.promo.no_partner") }, ...partners.map((p) => ({ value: p.id, label: p.name }))];
  return (
    <section className="tcc-block" aria-labelledby="tcc-promo-title">
      <div className="tcc-block__head"><h3 id="tcc-promo-title">{t("settings.promo.title")}</h3></div>
      <p className="tcc-muted">{t("settings.promo.help")}</p>
      {unseen.length > 0 && <p className="tcc-muted" data-unseen-codes={unseen.length}>{t("settings.promo.seen", { list: unseen.map((c) => `${c.code} (${t("settings.gateways.orders", { count: c.orders })})`).join(", ") })}</p>}
      {!rules.length ? <div className="tcc-card tcc-empty"><p>{t("settings.promo.none")}</p></div> : (
        <div className="tcc-table" role="table">
          {rules.map((r) => (
            <div key={r.code} className="tcc-table__row" role="row" data-code={r.code}>
              <span role="cell"><strong>{r.code}</strong><br /><small className="tcc-muted">{partnerName(r.partner_id) ?? t("settings.promo.no_partner")}{r.active_from || r.active_to ? ` · ${r.active_from ? day(r.active_from) : "—"} → ${r.active_to ? day(r.active_to) : "—"}` : ""}</small></span>
              <span role="cell" className="tcc-table__amount">{pct(r.commission_pct, { digits: 1 })}</span>
              <span role="cell"><span className="tcc-badge">{t(`settings.commission_base.${r.commission_base}`)}</span></span>
              <span role="cell" className="tcc-table__actions">
                <Form method="post"><input type="hidden" name="intent" value="delete_promo_rule" /><input type="hidden" name="code" value={r.code} /><s-button type="submit" variant="tertiary" tone="critical">{t("settings.fixed.delete")}</s-button></Form>
              </span>
            </div>
          ))}
        </div>
      )}
      <Form method="post" className="tcc-card tcc-form">
        <input type="hidden" name="intent" value="save_promo_rule" />
        <h4 className="tcc-eyebrow"><Icon id="check" />{t("settings.promo.add")}</h4>
        <div className="tcc-form__grid">
          <TextField name="code" label={t("settings.field.promo_code.label")} help={t("settings.field.promo_code.help")} maxLength={60} error={err(result, "save_promo_rule", "code")} />
          <SelectField name="partner_id" label={t("settings.field.promo_partner.label")} value="" options={partnerOptions} error={err(result, "save_promo_rule", "partner_id")} />
          <NumberField name="commission_pct" label={t("settings.field.commission_pct.label")} help={t("settings.field.commission_pct.help")} suffix="%" error={err(result, "save_promo_rule", "commission_pct")} />
          <SelectField name="commission_base" label={t("settings.field.commission_base.label")} value="ht_after_discount" options={COMMISSION_BASES.map((b) => ({ value: b, label: t(`settings.commission_base.${b}`) }))} error={err(result, "save_promo_rule", "commission_base")} />
          <DateField name="active_from" label={t("settings.field.active_from.label")} error={err(result, "save_promo_rule", "active_from")} />
          <DateField name="active_to" label={t("settings.field.active_to.label")} error={err(result, "save_promo_rule", "active_to")} />
        </div>
        <div className="tcc-form__actions"><s-button type="submit" variant="secondary">{t("settings.promo.add")}</s-button></div>
      </Form>
    </section>
  );
}

// Commissions manuelles (partenaire sans code) : une par partenaire et par mois.
export function ManualCommissions({ commissions = [], partners = [], result = null }) {
  const { t, money } = useI18n();
  const manualPartners = partners.filter((p) => p.mode === "manual");
  const partnerName = (id) => partners.find((p) => p.id === id)?.name ?? t("common.na");
  return (
    <section className="tcc-block" aria-labelledby="tcc-manual-title">
      <div className="tcc-block__head"><h3 id="tcc-manual-title">{t("settings.manual.title")}</h3></div>
      <p className="tcc-muted">{t("settings.manual.help")}</p>
      {!commissions.length ? <div className="tcc-card tcc-empty"><p>{t("settings.manual.none")}</p></div> : (
        <div className="tcc-table" role="table">
          {commissions.map((c) => (
            <div key={c.id} className="tcc-table__row" role="row" data-commission={c.id}>
              <span role="cell"><strong>{partnerName(c.partner_id)}</strong><br /><small className="tcc-muted">{c.period_month}{c.note ? ` · ${c.note}` : ""}</small></span>
              <span role="cell" className="tcc-table__amount">{money(c.amount)}</span>
              <span role="cell" className="tcc-table__actions">
                <Form method="post"><input type="hidden" name="intent" value="delete_manual_commission" /><input type="hidden" name="id" value={c.id} /><s-button type="submit" variant="tertiary" tone="critical">{t("settings.fixed.delete")}</s-button></Form>
              </span>
            </div>
          ))}
        </div>
      )}
      {!manualPartners.length ? <p className="tcc-muted">{t("settings.manual.need_partner")}</p> : (
        <Form method="post" className="tcc-card tcc-form">
          <input type="hidden" name="intent" value="add_manual_commission" />
          <h4 className="tcc-eyebrow"><Icon id="check" />{t("settings.manual.add")}</h4>
          <div className="tcc-form__grid">
            <SelectField name="partner_id" label={t("settings.field.promo_partner.label")} value={manualPartners[0].id} options={manualPartners.map((p) => ({ value: p.id, label: p.name }))} error={err(result, "add_manual_commission", "partner_id")} />
            <TextField name="period_month" label={t("settings.field.period_month.label")} help={t("settings.field.period_month.help")} placeholder={t("settings.placeholder.month")} maxLength={7} error={err(result, "add_manual_commission", "period_month")} />
            <NumberField name="amount" label={t("settings.field.amount.label")} error={err(result, "add_manual_commission", "amount")} />
            <TextField name="note" label={t("settings.field.note.label")} maxLength={200} error={err(result, "add_manual_commission", "note")} />
          </div>
          <div className="tcc-form__actions"><s-button type="submit" variant="secondary">{t("settings.manual.add")}</s-button></div>
        </Form>
      )}
    </section>
  );
}
