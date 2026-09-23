// ── État vide (composition « Empty state ») — PUR ────────────────────────────────────────────
// excluded = compteurs par raison sur la période courante : le marchand voit POURQUOI c'est vide.
import { useI18n } from "../../lib/i18n/context.jsx";

export function DashboardEmptyState({ excluded = {} }) {
  const { t, int } = useI18n();
  const entries = Object.entries(excluded).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const reasons = entries.map(([r, n]) => `${int(n)} ${t(`dashboard.excluded.${r}`)}`).join(", ");
  return (
    <s-section>
      <s-stack gap="base" alignItems="start">
        <s-heading>{t("dashboard.empty.title")}</s-heading>
        <s-paragraph>{t("dashboard.empty.body")}</s-paragraph>
        {total > 0 && <s-paragraph>{t("dashboard.empty.body_excluded", { count: total, reasons })}</s-paragraph>}
        <s-button href="/app" variant="secondary">{t("dashboard.empty.cta_legacy")}</s-button>
      </s-stack>
    </s-section>
  );
}
