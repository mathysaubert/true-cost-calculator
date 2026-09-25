// ── Champs de formulaire Réglages (S3a) : Polaris WC NON contrôlés dans un formulaire natif ───
// value = valeur enregistrée (attribut initial, jamais re-rendu sans rechargement) ; placeholder =
// valeur courante non confirmée (S6 : jamais enregistrée à la place du marchand). Repli (S3b) :
// champs HTML natifs, décidé au premier rendu réel si les FormData n'arrivent pas.
// D0 (React 19) : sur un web component, React 19 pose `value` en PROPRIÉTÉ au rendu client, alors que
// Polaris lit la valeur de départ UNIQUEMENT dans l'ATTRIBUT `value`, celle que remet « Annuler »
// (form.reset → formResetCallback : value = defaultValue || "", défaut lu dans l'attribut). Or Polaris
// surcharge setAttribute sur ses éléments et IGNORE l'écriture d'un attribut dont le nom figure dans les
// props React de l'élément (`value` y est) : ni la propriété `defaultValue` ni el.setAttribute ne créent
// l'attribut (mesuré dans un vrai navigateur, vrai polaris.js : scripts/browser_reset_check.mjs). Seul
// le HTML analysé (rendu serveur) le crée. useStartValue écrit donc l'attribut par la méthode DOM
// native (Element.prototype.setAttribute), côté client seulement, à la même valeur que le rendu serveur.
import { useLayoutEffect, useRef } from "react";
import { useI18n } from "../../lib/i18n/context.jsx";

const fmt = (v) => (v == null || v === "" ? "" : String(v));

// Valeur de départ (celle que remet « Annuler »), remise à jour à chaque valeur enregistrée :
// • champ texte : attribut `value` de l'élément ;
// • liste s-select : sa réinitialisation reprend l'option portant l'attribut `selected` (sinon la
//   première) ; on le pose sur l'option enregistrée et on le retire des autres.
const setAttr = (el, name, v) => Element.prototype.setAttribute.call(el, name, v);
const dropAttr = (el, name) => Element.prototype.removeAttribute.call(el, name);
const startOnText = (el, start) => { if (el.getAttribute("value") !== start) setAttr(el, "value", start); };
const startOnSelect = (el, start) => {
  for (const o of el.querySelectorAll("s-option")) {
    const v = o.value ?? o.getAttribute("value");
    if (String(v) === start) { if (!o.hasAttribute("selected")) setAttr(o, "selected", ""); }
    else if (o.hasAttribute("selected")) dropAttr(o, "selected");
  }
};
function useStartValue(start, apply = startOnText) {
  const ref = useRef(null);
  useLayoutEffect(() => { if (ref.current) apply(ref.current, start); }, [start, apply]);
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
  const start = useStartValue(value == null ? "" : String(value), startOnSelect);
  return (
    <s-select ref={start} name={name} label={label} value={value ?? ""} details={help ?? undefined} error={error ? t(`settings.error.${error}`) : undefined}>
      {options.map((o) => <s-option key={String(o.value)} value={String(o.value)} selected={String(o.value) === String(value ?? "") ? true : undefined}>{o.label}</s-option>)}
    </s-select>
  );
}
