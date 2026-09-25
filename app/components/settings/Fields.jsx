// ── Champs de formulaire Réglages (S3a) : Polaris WC NON contrôlés dans un formulaire natif ───
// value = valeur enregistrée (attribut initial, jamais re-rendu sans rechargement) ; placeholder =
// valeur courante non confirmée (S6 : jamais enregistrée à la place du marchand). Repli (S3b) :
// champs HTML natifs, décidé au premier rendu réel si les FormData n'arrivent pas.
// D0 (React 19) : sur un web component, React 19 pose `value` en PROPRIÉTÉ au rendu client, alors que
// Polaris lit la valeur de départ dans l'ATTRIBUT `value` (= propriété `defaultValue`), celle que
// remet « Annuler » (form.reset → formResetCallback : value = defaultValue || ""). On passe donc la
// même valeur à la propriété `defaultValue`, CÔTÉ CLIENT seulement (useStartValue) : le rendu serveur
// garde l'attribut value seul (pas d'écart d'hydratation), le rendu client pose defaultValue, que
// Polaris reflète dans l'attribut. Même valeur de départ dans les deux chemins. Preuve : tests/lot35.
import { useLayoutEffect, useRef } from "react";
import { useI18n } from "../../lib/i18n/context.jsx";

const fmt = (v) => (v == null || v === "" ? "" : String(v));

// Valeur de départ (celle que remet « Annuler ») posée sur l'élément Polaris à chaque valeur enregistrée.
function useStartValue(start) {
  const ref = useRef(null);
  useLayoutEffect(() => { if (ref.current) ref.current.defaultValue = start; }, [start]);
  return ref;
}

export function NumberField({ name, label, value = null, placeholder = null, help = null, error = null, suffix = null }) {
  const { t } = useI18n();
  const start = useStartValue(fmt(value));
  return (
    <s-text-field
      name={name}
      label={label}
      ref={start}
      value={fmt(value)}
      placeholder={placeholder == null ? undefined : String(placeholder)}
      details={help ?? undefined}
      error={error ? t(`settings.error.${error}`) : undefined}
      inputMode="decimal"
      suffix={suffix ?? undefined}
    />
  );
}

export function TextField({ name, label, value = null, placeholder = null, help = null, error = null, maxLength = null }) {
  const { t } = useI18n();
  const start = useStartValue(fmt(value));
  return (
    <s-text-field
      name={name}
      label={label}
      ref={start}
      value={fmt(value)}
      placeholder={placeholder == null ? undefined : String(placeholder)}
      details={help ?? undefined}
      error={error ? t(`settings.error.${error}`) : undefined}
      maxLength={maxLength ?? undefined}
    />
  );
}

export function DateField({ name, label, value = null, help = null, error = null }) {
  const { t } = useI18n();
  const start = useStartValue(fmt(value));
  return <s-text-field ref={start} name={name} label={label} value={fmt(value)} placeholder={t("settings.placeholder.date")} details={help ?? undefined} error={error ? t(`settings.error.${error}`) : undefined} />;
}

// Retour d'une action : succès (intent) ou échec serveur ; les erreurs de champ vivent sur les champs.
export function SettingsBanner({ result, intent = null }) {
  const { t } = useI18n();
  if (!result || !result.intent || (intent && result.intent !== intent)) return null;
  if (result.ok) return <s-banner tone="success">{t("settings.saved")}</s-banner>;
  if (result.errors && Object.keys(result.errors).length) return <s-banner tone="warning">{t("settings.error.fields")}</s-banner>;
  return <s-banner tone="critical">{t("settings.error.failed")}</s-banner>;
}

// Liste déroulante Polaris non contrôlée : `value` initial, options { value, label } déjà traduites.
export function SelectField({ name, label, value = "", options = [], help = null, error = null }) {
  const { t } = useI18n();
  const start = useStartValue(value ?? "");
  return (
    <s-select ref={start} name={name} label={label} value={value ?? ""} details={help ?? undefined} error={error ? t(`settings.error.${error}`) : undefined}>
      {options.map((o) => <s-option key={String(o.value)} value={String(o.value)}>{o.label}</s-option>)}
    </s-select>
  );
}
