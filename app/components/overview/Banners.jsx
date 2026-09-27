// ── Bandeaux (Polaris s-banner) : trous de données, notes, boutique de développement ──────────
import { useFetcher, Link } from "react-router";
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
export const DEV_TOGGLE_ACTION = "/app/overview";

export function DevShopBanner({ isDevShop, includeTestOrders }) {
  const { t } = useI18n();
  const fetcher = useFetcher();
  if (isDevShop !== true) return null;
  const next = includeTestOrders ? "0" : "1";
  // Action d'Aujourd'hui (seule route qui la traite), appelée par un fetcher : la page courante reste
  // affichée et ses données sont rechargées. Avant : envoyé à l'action de la page courante → « Cette
  // action n'est pas disponible » ailleurs qu'Aujourd'hui.
  const busy = fetcher.state !== "idle";
  const failed = fetcher.state === "idle" && fetcher.data?.intent === "toggle_test_orders" && fetcher.data?.ok === false;
  return (
    <s-banner tone="info" heading={t("overview.dev.title")}>
      <s-stack gap="base" alignItems="start">
        <s-paragraph>{includeTestOrders ? t("overview.dev.body_on") : t("overview.dev.body_off")}</s-paragraph>
        <fetcher.Form method="post" action={DEV_TOGGLE_ACTION} data-dev-toggle="">
          <input type="hidden" name="intent" value="toggle_test_orders" />
          <input type="hidden" name="value" value={next} />
          <s-button type="submit" variant="secondary" loading={busy ? "true" : undefined}>{includeTestOrders ? t("overview.dev.toggle_off") : t("overview.dev.toggle_on")}</s-button>
        </fetcher.Form>
        {failed && <s-paragraph>{t("settings.error.failed")}</s-paragraph>}
      </s-stack>
    </s-banner>
  );
}

// ── D2-2 (Z3) : dépassement du volume au mois écoulé — constat, jamais de blocage ─────────────────
// usage : sortie de loadPlanUsage (null → rien). Lien vers l'écran Offre ; au-delà de 3 000 : demande
// d'offre sur mesure (customHref, mailto du contact public de l'app).
export function PlanOverageBanner({ usage, customHref = null, showLink = true }) {
  const { t, int, month: monthLabel } = useI18n();
  if (!usage?.over) return null;
  const month = monthLabel(usage.prevMonth);
  const n = int;
  const custom = usage.suggest === "custom";
  return (
    <s-banner tone="warning" heading={t("overage.title", { month })} data-overage={usage.suggest}>
      <s-stack gap="base" alignItems="start">
        <s-paragraph>{t("overage.body", { count: n(usage.count), cap: n(usage.cap), plan: t(`plan.name.${usage.plan}`) })}</s-paragraph>
        <s-paragraph>{custom ? t("overage.custom") : t("overage.suggest", { plan: t(`plan.name.${usage.suggest}`) })}</s-paragraph>
        {custom && customHref && <s-button variant="secondary" href={customHref} target="_blank">{t("overage.custom_cta")}</s-button>}
        {!custom && showLink && <Link to="/app/settings/plan">{t("overage.cta")}</Link>}
      </s-stack>
    </s-banner>
  );
}
