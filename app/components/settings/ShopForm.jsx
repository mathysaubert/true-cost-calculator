// ── Réglages > Boutique (R2, S8) : pays, devise (lue depuis Shopify), TVA, B2B, historique, langues,
// pays de vente / d'expédition, sources d'approvisionnement. Un formulaire POST natif, intent save_shop.
import { Form } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";
import { SHOP_FIELDS, COUNTRY_LIST_FIELDS, LOCALE_CHOICES } from "../../lib/settings.js";
import { VAT_REGIMES } from "../../lib/variantCosts.js";
import { NumberField, TextField, SelectField } from "./Fields.jsx";

const err = (result, key) => (result?.intent === "save_shop" ? result.errors?.[key] ?? null : null);
const joinCountries = (v) => (Array.isArray(v) ? v.join(", ") : "");

export function ShopForm({ settings = {}, result = null }) {
  const { t, locale } = useI18n();
  const nameOf = (l) => { try { return new Intl.DisplayNames([locale], { type: "language" }).of(l) ?? l; } catch { return l; } };
  const localeOptions = [{ value: "", label: t("settings.locale.auto") }, ...LOCALE_CHOICES.map((l) => ({ value: l, label: `${nameOf(l)} (${l})` }))];
  return (
    <section className="tcc-block" aria-labelledby="tcc-shop-title">
      <div className="tcc-block__head"><h3 id="tcc-shop-title">{t("settings.shop.title")}</h3></div>
      <p className="tcc-muted">{t("settings.shop.help")}</p>
      <Form method="post" className="tcc-form">
        <input type="hidden" name="intent" value="save_shop" />
        <div className="tcc-form__grid">
          <TextField name="shop_country_code" label={t("settings.field.shop_country_code.label")} help={t("settings.field.shop_country_code.help")} value={settings.shop_country_code} placeholder={t("settings.placeholder.country")} maxLength={2} error={err(result, "shop_country_code")} />
          <div className="tcc-lever" data-readonly="shop_currency">
            <label><strong>{t("settings.field.shop_currency.label")}</strong><small className="tcc-muted">{t("settings.field.shop_currency.help")}</small></label>
            <span className="tcc-badge">{settings.shop_currency ?? t("common.na")}</span>
          </div>
          <SelectField name="vat_regime" label={t("settings.field.vat_regime.label")} help={t("settings.field.vat_regime.help")} value={settings.vat_regime ?? "assujetti"} options={VAT_REGIMES.map((v) => ({ value: v, label: t(`settings.vat.${v}`) }))} error={err(result, "vat_regime")} />
          <TextField name="b2b_tag" label={t("settings.field.b2b_tag.label")} help={t("settings.field.b2b_tag.help")} value={settings.b2b_tag} maxLength={60} error={err(result, "b2b_tag")} />
          <NumberField name="history_months" label={t("settings.field.history_months.label")} help={t("settings.field.history_months.help")} value={settings.history_months} placeholder={SHOP_FIELDS.find((f) => f.key === "history_months")?.placeholder ?? null} suffix={t("settings.unit.months")} error={err(result, "history_months")} />
          <SelectField name="locale_override" label={t("settings.field.locale_override.label")} help={t("settings.field.locale_override.help")} value={settings.locale_override ?? ""} options={localeOptions} error={err(result, "locale_override")} />
          <SelectField name="report_locale" label={t("settings.field.report_locale.label")} help={t("settings.field.report_locale.help")} value={settings.report_locale ?? ""} options={localeOptions} error={err(result, "report_locale")} />
        </div>
        <div className="tcc-form__grid">
          {COUNTRY_LIST_FIELDS.map((k) => (
            <TextField key={k} name={k} label={t(`settings.field.${k}.label`)} help={t(`settings.field.${k}.help`)} value={joinCountries(settings[k])} placeholder={t("settings.placeholder.countries")} error={err(result, k)} />
          ))}
        </div>
        <div className="tcc-form__actions"><s-button type="submit" variant="secondary">{t("settings.save")}</s-button></div>
      </Form>
    </section>
  );
}
