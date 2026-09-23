// ── Bandeau des trous de données (principe 5) — PUR ──────────────────────────────────────────
// gaps = buildGaps() ; rien à signaler → null. Les commandes exclues sont listées avec leur raison.
import { useI18n } from "../../lib/i18n/context.jsx";

export function gapText(gap, t, int) {
  switch (gap.id) {
    case "capped": return t("dashboard.gaps.capped", { cap: int(gap.cap) });
    case "no_packaging_cost": return t("dashboard.gaps.no_packaging_cost");
    case "excluded": {
      const reasons = (gap.reasons ?? []).map((r) => `${int(r.count)} ${t(`dashboard.excluded.${r.reason}`)}`).join(", ");
      return t("dashboard.gaps.excluded", { count: gap.count, reasons });
    }
    default: return t(`dashboard.gaps.${gap.id}`, { count: gap.count });
  }
}

export function DataGapsBanner({ gaps = [] }) {
  const { t, int } = useI18n();
  if (!gaps.length) return null;
  return (
    <s-banner tone="warning" heading={t("dashboard.gaps.title")}>
      <s-unordered-list>
        {gaps.map((g) => <s-list-item key={g.id}>{gapText(g, t, int)}</s-list-item>)}
      </s-unordered-list>
    </s-banner>
  );
}

// Notes de contexte (buildNotes) : jamais bloquantes, texte discret.
export function DashboardNotes({ notes = [] }) {
  const { t, pct } = useI18n();
  if (!notes.length) return null;
  return (
    <s-stack gap="small-200">
      {notes.map((n) => (
        <s-paragraph key={n.id} color="subdued">
          {n.pct != null ? t(`dashboard.note.${n.id}`, { pct: pct(n.pct, { digits: 0 }) }) : t(`dashboard.note.${n.id}`)}
        </s-paragraph>
      ))}
    </s-stack>
  );
}
