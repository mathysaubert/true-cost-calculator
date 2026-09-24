// ── Champs de formulaire Réglages (S3a) : Polaris WC NON contrôlés dans un formulaire natif ───
// value = valeur enregistrée (attribut initial, jamais re-rendu sans rechargement) ; placeholder =
// valeur courante non confirmée (S6 : jamais enregistrée à la place du marchand). Repli (S3b) :
// champs HTML natifs, décidé au premier rendu réel si les FormData n'arrivent pas.
import { useI18n } from "../../lib/i18n/context.jsx";

const fmt = (v) => (v == null || v === "" ? "" : String(v));

export function NumberField({ name, label, value = null, placeholder = null, help = null, error = null, suffix = null }) {
  const { t } = useI18n();
  return (
    <s-text-field
      name={name}
      label={label}
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
  return (
    <s-text-field
      name={name}
      label={label}
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
  return <s-text-field name={name} label={label} value={fmt(value)} placeholder={t("settings.placeholder.date")} details={help ?? undefined} error={error ? t(`settings.error.${error}`) : undefined} />;
}

// Retour d'une action : succès (intent) ou échec serveur ; les erreurs de champ vivent sur les champs.
export function SettingsBanner({ result, intent = null }) {
  const { t } = useI18n();
  if (!result || !result.intent || (intent && result.intent !== intent)) return null;
  if (result.ok) return <s-banner tone="success">{t("settings.saved")}</s-banner>;
  if (result.errors && Object.keys(result.errors).length) return <s-banner tone="warning">{t("settings.error.fields")}</s-banner>;
  return <s-banner tone="critical">{t("settings.error.failed")}</s-banner>;
}
