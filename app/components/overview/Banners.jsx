// ── Bandeaux (Polaris s-banner) : trous de données, notes, boutique de développement ──────────
import { Form } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";

export function gapText(gap, t, int) {
  switch (gap.id) {
    case "capped": return t("overview.gaps.capped", { cap: int(gap.cap) });
    case "no_packaging_cost": return t("overview.gaps.no_packaging_cost");
    case "excluded": {
      const reasons = (gap.reasons ?? []).map((r) => `${int(r.count)} ${t(`overview.excluded.${r.reason}`)}`).join(", ");
      return t("overview.gaps.excluded", { count: gap.count, reasons });
    }
    default: return t(`overview.gaps.${gap.id}`, { count: gap.count });
  }
}

export function DataGapsBanner({ gaps = [] }) {
  const { t, int } = useI18n();
  if (!gaps.length) return null;
  return (
    <s-banner tone="warning" heading={t("overview.gaps.title")}>
      <s-unordered-list>
        {gaps.map((g) => <s-list-item key={g.id}>{gapText(g, t, int)}</s-list-item>)}
      </s-unordered-list>
    </s-banner>
  );
}

export function OverviewNotes({ notes = [] }) {
  const { t, pct } = useI18n();
  if (!notes.length) return null;
  return (
    <ul className="tcc-notes">
      {notes.map((n) => <li key={n.id}>{n.pct != null ? t(`overview.note.${n.id}`, { pct: pct(n.pct, { digits: 0 }) }) : t(`overview.note.${n.id}`)}</li>)}
    </ul>
  );
}

// Rendu SEULEMENT si isDevShop === true ; formulaire natif POST (aucun champ contrôlé).
export function DevShopBanner({ isDevShop, includeTestOrders }) {
  const { t } = useI18n();
  if (isDevShop !== true) return null;
  const next = includeTestOrders ? "0" : "1";
  return (
    <s-banner tone="info" heading={t("overview.dev.title")}>
      <s-stack gap="base" alignItems="start">
        <s-paragraph>{includeTestOrders ? t("overview.dev.body_on") : t("overview.dev.body_off")}</s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="toggle_test_orders" />
          <input type="hidden" name="value" value={next} />
          <s-button type="submit" variant="secondary">{includeTestOrders ? t("overview.dev.toggle_off") : t("overview.dev.toggle_on")}</s-button>
        </Form>
      </s-stack>
    </s-banner>
  );
}
