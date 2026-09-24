// ── Réglages > Connexions (R2) : état des connexions, sans connecteur (les boutons viendront avec
// les intégrations pub et Search Console). Shopify = la synchronisation elle-même.
import { useI18n } from "../../lib/i18n/context.jsx";
import { Icon } from "../overview/Icons.jsx";

const TONE = { connected: "tcc-badge--good", error: "tcc-badge--bad", revoked: "tcc-badge--warn", none: "", stale: "tcc-badge--warn" };

// items : sortie de connectionsStatus ({ id, status, account, last_sync_at, last_error })
export function ConnectionsList({ items = [] }) {
  const { t, relative } = useI18n();
  return (
    <section className="tcc-block" aria-labelledby="tcc-connections-title">
      <div className="tcc-block__head"><h3 id="tcc-connections-title">{t("settings.connections.title")}</h3></div>
      <p className="tcc-muted">{t("settings.connections.help")}</p>
      <ul className="tcc-status">
        {items.map((c) => (
          <li key={c.id} data-provider={c.id} data-status={c.status}>
            <Icon id={c.status === "connected" ? "check" : c.id === "shopify" ? "brand" : "marketing"} />
            <span>
              <strong>{t(`settings.provider.${c.id}`)}</strong>
              <br />
              <small className="tcc-muted">
                {c.account ? `${c.account} · ` : ""}
                {c.last_sync_at ? t("settings.connections.last_sync", { when: relative(c.last_sync_at) }) : t("settings.connections.never")}
                {c.last_error ? ` · ${t("settings.connections.error", { message: c.last_error })}` : ""}
                {c.status === "none" && c.id !== "shopify" ? ` · ${t("settings.connections.soon")}` : ""}
              </small>
            </span>
            <span className={`tcc-badge ${TONE[c.status] ?? ""}`}>{t(`settings.conn_status.${c.status}`)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
