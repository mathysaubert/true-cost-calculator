// ── Sélecteur de période (7 / 30 / 90 jours) — PUR, sans état contrôlé (liens ?days=) ─────────
import { useI18n } from "../../lib/i18n/context.jsx";
import { PERIOD_OPTIONS } from "../../lib/dashboard.js";

export function PeriodSelector({ days, windows, options = PERIOD_OPTIONS }) {
  const { t, day } = useI18n();
  return (
    <s-stack gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-text color="subdued">{t("dashboard.period.label")}</s-text>
        <s-button-group>
          {options.map((n) => (
            <s-button key={n} href={`?days=${n}`} variant={n === days ? "primary" : "secondary"} disabled={n === days ? true : undefined}>
              {t("dashboard.period.days", { count: n })}
            </s-button>
          ))}
        </s-button-group>
      </s-stack>
      {windows && (
        <s-text color="subdued">
          {t("dashboard.period.range", { start: day(windows.current.start), end: day(windows.current.end) })}
          {", "}
          {t("dashboard.period.compare", { count: days, start: day(windows.previous.start), end: day(windows.previous.end) })}
        </s-text>
      )}
    </s-stack>
  );
}
