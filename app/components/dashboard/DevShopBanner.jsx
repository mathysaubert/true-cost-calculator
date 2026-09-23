// ── Bandeau boutique de développement (C6a) — PUR ────────────────────────────────────────────
// Rendu SEULEMENT si isDevShop === true. La bascule est un formulaire natif (aucun champ contrôlé :
// React 18, C1a) soumis en POST par React Router ; l'action vérifie encore is_dev_shop côté serveur.
import { Form } from "react-router";
import { useI18n } from "../../lib/i18n/context.jsx";

export function DevShopBanner({ isDevShop, includeTestOrders }) {
  const { t } = useI18n();
  if (isDevShop !== true) return null;
  const next = includeTestOrders ? "0" : "1";
  return (
    <s-banner tone="info" heading={t("dashboard.dev.title")}>
      <s-stack gap="base" alignItems="start">
        <s-paragraph>{includeTestOrders ? t("dashboard.dev.body_on") : t("dashboard.dev.body_off")}</s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="toggle_test_orders" />
          <input type="hidden" name="value" value={next} />
          <s-button type="submit" variant="secondary">{includeTestOrders ? t("dashboard.dev.toggle_off") : t("dashboard.dev.toggle_on")}</s-button>
        </Form>
      </s-stack>
    </s-banner>
  );
}
