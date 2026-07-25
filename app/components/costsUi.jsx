// ── Suivi des coûts — composants UI (extraits pour être RENDABLES/testables, cf. CLAUDE.md, ère XV) ──
// Rendu réel exigé avant commit (scripts/render_check.mjs). Aucun import shopify.server → rendables seuls.
// TOUT l'état d'édition est piloté par le parent (CostTracker) : composants CONTRÔLÉS, aucun fetcher ici.
import { formatPct } from "../lib/engine.js";
import { formatMoney } from "../lib/orderHistory.js";
import { PAYS_KEYS, CATEGORIE_KEYS, VAT_REGIMES, SHIPPING_MODELS } from "../lib/variantCosts.js";

// Libellés bijection (mêmes termes que le calculateur / l'audit).
const VAT_LABEL  = { assujetti: "Assujetti à la TVA", franchise: "Franchise de TVA" };
const SHIP_LABEL = { dropshipping: "Dropshipping", stock: "Import en stock" };
const STATUS_TONE = {
  complete: { color: "#008060", bg: "#F1F8F5" },
  partial:  { color: "#B98900", bg: "#FFF9EC" },
  todo:     { color: "#6D7175", bg: "#F1F2F4" },
};

// ── Résumé réel COMPACT, toujours visible en tête ([1]) ──────────────────────────────────────
// Bandeau non repliable (le MarginMonitor accordéon reste, replié, plus bas). Totaux DÉJÀ calculés
// par aggregateOrderMargins (agg.totals / unprofitableCount / validCount / multiCurrency) : aucun
// recalcul. Sans commande analysée → invite à synchroniser ; multi-devises → renvoi au détail.
export function CostSummaryBanner({ totals, unprofitableCount = 0, validCount = 0, multiCurrency = false, feesCurrency }) {
  const neutral = { padding: "14px 18px", borderRadius: "10px", background: "#F9FAFB", border: "1px solid #E4E5E7", color: "#6D7175", fontSize: "13px", marginBottom: "16px", lineHeight: "1.6" };
  if (!validCount) {
    return <div style={neutral}>Pas encore de commandes analysées : synchronisez vos commandes des 30 derniers jours pour voir vos marges réelles.</div>;
  }
  if (multiCurrency) {
    return <div style={neutral}>Vos commandes analysées sont en plusieurs devises : voyez le détail par produit ci-dessous.</div>;
  }
  const rev = totals?.net_revenue ?? 0, marg = totals?.net_margin ?? 0, orders = totals?.orders ?? 0;
  const pct = rev > 0 ? (marg / rev) * 100 : null;
  const item = (label, value, color) => (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: "2px" }}>
      <span style={{ fontSize: "10px", fontWeight: 700, color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</span>
      <span style={{ fontSize: "16px", fontWeight: 700, color: color ?? "#202223" }}>{value}</span>
    </span>
  );
  return (
    <div style={{ padding: "14px 18px", borderRadius: "10px", background: "#F1F8F5", border: "1px solid #00806033", marginBottom: "16px", display: "flex", alignItems: "center", gap: "24px", flexWrap: "wrap" }}>
      {item("CA net (30 j)", formatMoney(rev, feesCurrency))}
      {item("Marge nette (30 j)", `${formatMoney(marg, feesCurrency)}${pct == null ? "" : ` · ${formatPct(pct)} %`}`, marg < 0 ? "#D72C0D" : "#008060")}
      {item("Commandes", String(orders))}
      {unprofitableCount > 0 && (
        <span style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: "10px", background: "#FFF4F4", color: "#D72C0D", fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap" }}>
          {unprofitableCount} {unprofitableCount > 1 ? "produits à perte" : "produit à perte"}
        </span>
      )}
    </div>
  );
}

// ── Compteur de fiabilité des marges réelles (point 4, option A) ─────────────────────────────
// reliability = sortie de computeCostReliability. titleFor(id) → titre produit ; onSelectProduct(id) →
// ouvre l'édition. Pas de ventes → null (l'invite « synchronisez » vit dans le parent). Libellés IMPOSÉS.
export function ReliabilityCounter({ reliability, titleFor, onSelectProduct }) {
  if (!reliability || !reliability.hasSales) return null;
  const { reliabilityPct, missingProducts, missingCount, topIncomplete } = reliability;
  const title = (id) => (titleFor ? titleFor(id) : null) || "(produit supprimé de la boutique)";
  const link = (id, label, k) => (
    <button key={k} onClick={() => onSelectProduct?.(id)} disabled={!id}
      style={{ background: "none", border: "none", padding: 0, color: id ? "#008060" : "#6D7175", cursor: id ? "pointer" : "default", fontFamily: "inherit", fontSize: "inherit", fontWeight: 600, textDecoration: id ? "underline" : "none" }}>{label}</button>
  );
  return (
    <div style={{ padding: "14px 18px", borderRadius: "10px", background: "#FBFBFC", border: "1px solid #E4E5E7", marginBottom: "16px" }}>
      {/* Priorité (toujours en tête si > 0) : produits vendus sans coût renseigné. */}
      {missingCount > 0 && (
        <div style={{ fontSize: "13px", color: "#B98900", marginBottom: "10px", lineHeight: "1.6" }}>
          <strong>{missingCount}</strong> {missingCount > 1 ? "produits vendus" : "produit vendu"} sans coût renseigné (30 j) : marge inconnue.{" "}
          {missingProducts.slice(0, 6).map((p, i) => (
            <span key={p.product_id ?? i}>{i > 0 ? " · " : ""}{link(p.product_id, title(p.product_id), p.product_id ?? i)}</span>
          ))}
          {missingCount > 6 ? ` +${missingCount - 6} autres` : ""}
        </div>
      )}
      {reliabilityPct == null ? (
        <div style={{ fontSize: "13px", color: "#202223", lineHeight: "1.6" }}>
          Renseignez vos coûts pour mesurer la fiabilité de vos marges.
        </div>
      ) : (
        <div style={{ fontSize: "13px", color: "#202223", lineHeight: "1.6" }}>
          Vos marges réelles reposent sur des coûts confirmés ou importés pour <strong>{formatPct(reliabilityPct)} %</strong> de vos ventes analysées (30 j).
        </div>
      )}
      {topIncomplete.length > 0 && (
        <div style={{ fontSize: "12px", color: "#6D7175", marginTop: "10px", lineHeight: "1.7" }}>
          Complétez vos plus gros vendeurs :{" "}
          {topIncomplete.map((p, i) => (
            <span key={p.product_id ?? i}>{i > 0 ? " · " : ""}{link(p.product_id, title(p.product_id) + (p.status === "missing" ? " (marge inconnue)" : ""), p.product_id ?? i)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Liste des produits (remplace la grille par variantes) ────────────────────────────────────
// products = [{ product_id, title, status:{key,label}, marginPct:number|null, variantRows }]. Clic sur une
// ligne → onToggle(product_id) ; ligne dépliée → renderPanel(product) rendu dessous (panneau d'édition).
export function ProductCostList({ products = [], expandedId, onToggle, renderPanel }) {
  if (products.length === 0) {
    return <div style={{ padding: "32px", textAlign: "center", color: "#6D7175", fontSize: "13px", border: "1px solid #E4E5E7", borderRadius: "10px" }}>Aucun produit actif dans la boutique.</div>;
  }
  const th = { padding: "8px 16px", fontSize: "10px", fontWeight: 700, color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.4px" };
  return (
    <div style={{ border: "1px solid #E4E5E7", borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "#F9FAFB", borderBottom: "1px solid #E4E5E7" }}>
        <span style={{ ...th, flex: "1 1 200px" }}>Produit</span>
        <span style={{ ...th, whiteSpace: "nowrap" }}>Statut des coûts</span>
        <span style={{ ...th, width: "90px", textAlign: "right" }}>Marge réelle 30 j</span>
        <span style={{ width: "14px" }} />
      </div>
      {products.map((p, i) => {
        const tone = STATUS_TONE[p.status.key] ?? STATUS_TONE.todo;
        const open = expandedId === p.product_id;
        return (
          <div key={p.product_id ?? i} style={{ borderTop: i > 0 ? "1px solid #F1F2F4" : "none" }}>
            <button onClick={() => onToggle?.(p.product_id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", background: open ? "#F9FAFB" : "#fff", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
              <span style={{ flex: "1 1 200px", fontSize: "13px", fontWeight: 600, color: "#202223", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
              <span style={{ padding: "2px 10px", borderRadius: "10px", fontSize: "11px", fontWeight: 700, color: tone.color, background: tone.bg, whiteSpace: "nowrap" }}>
                {p.status.key === "complete" ? `${p.status.label} ✓` : p.status.label}
              </span>
              <span style={{ width: "90px", textAlign: "right", fontSize: "13px", fontWeight: 700, color: p.marginPct == null ? "#8C9196" : p.marginPct < 0 ? "#D72C0D" : "#008060" }}>
                {p.marginPct == null ? "—" : `${formatPct(p.marginPct)} %`}
              </span>
              <span style={{ width: "14px", color: "#8C9196", fontSize: "12px" }}>{open ? "▾" : "▸"}</span>
            </button>
            {open && renderPanel && <div style={{ padding: "0 16px 16px" }}>{renderPanel(p)}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Panneau d'édition d'UN produit (remplace la grille — champs vides + placeholders) ─────────
// Intégrité (Amendements C/D) : les suggestions estimées s'affichent en PLACEHOLDER (champ vide), jamais
// comme une donnée saisie. draft[variant_id][field] = valeur tapée. onEdit(vid, field, val). onSave().
// Le parent ne soumet que les variantes réellement éditées (dirty), en repliant les champs vides sur la
// suggestion au moment d'enregistrer (validateCostRow reçoit alors un jeu complet).
export function ProductCostPanel({ product, draft = {}, onEdit, onSave, saving, saved, errors = [], feesCurrency, nextIncomplete = null, hasAnalyzedOrders = false, onContinue }) {
  const rows = product?.variantRows ?? [];
  const single = rows.length === 1; // produit mono-variante : pas de colonne « Variante » (bijection Shopify conservée ailleurs)
  const inp = { width: "100%", padding: "5px 7px", border: "1px solid #C9CCCF", borderRadius: "5px", fontSize: "12px", fontFamily: "inherit", boxSizing: "border-box" };
  const merchant = (r) => r.source === "confirmed" || r.source === "imported";
  const numVal = (r, f) => { const d = draft[r.variant_id]; if (d && f in d) return d[f]; return merchant(r) ? (r[f] ?? "") : ""; };
  const selVal = (r, f) => { const d = draft[r.variant_id]; if (d && f in d) return d[f]; return r[f] ?? ""; };
  const ph = (r, f) => (r[f] != null && String(r[f]) !== "" ? `ex : ${r[f]}` : "");
  const numInput = (r, f) => <input type="text" inputMode="decimal" value={numVal(r, f)} placeholder={ph(r, f)} onChange={(e) => onEdit?.(r.variant_id, f, e.target.value)} style={inp} />;
  const selInput = (r, f, opts, labels) => <select value={selVal(r, f)} onChange={(e) => onEdit?.(r.variant_id, f, e.target.value)} style={inp}>{opts.map((o) => <option key={o} value={o}>{labels ? labels[o] : o}</option>)}</select>;
  const th = { padding: "6px 8px", fontSize: "10px", fontWeight: 700, color: "#6D7175", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.4px", whiteSpace: "nowrap" };
  return (
    <div style={{ border: "1px solid #E4E5E7", borderRadius: "8px", background: "#FBFBFC", padding: "12px" }}>
      <div style={{ fontSize: "11px", color: "#6D7175", marginBottom: "10px", lineHeight: "1.5" }}>
        Renseignez les coûts que Shopify ne connaît pas. Les valeurs grisées sont des suggestions : tapez pour les remplacer. Rien n'est enregistré tant que vous ne cliquez pas sur « Enregistrer ce produit ».
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "820px" }}>
          <thead>
            <tr style={{ background: "#F9FAFB" }}>
              {[...(single ? [] : ["Variante"]), `Prix d'achat (${feesCurrency})`, `Port du lot (${feesCurrency})`, "Qté/lot", `Emballage (${feesCurrency})`, "Régime TVA", "Comment vous expédiez", "Pays d'import", "Catégorie"].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.variant_id} style={{ borderTop: "1px solid #F1F2F4" }}>
                {!single && (
                  <td style={{ padding: "6px 8px", fontSize: "12px", color: "#202223", whiteSpace: "nowrap" }}>
                    {r.variant_title && r.variant_title !== "Default Title" ? r.variant_title : "Variante"}
                    {merchant(r) && <span title="Coût renseigné" style={{ marginLeft: 6, fontSize: "9px", color: "#008060", fontWeight: 700 }}>✓</span>}
                  </td>
                )}
                <td style={{ padding: "4px 6px" }}>{numInput(r, "prix_achat")}</td>
                <td style={{ padding: "4px 6px" }}>{numInput(r, "port_entrant")}</td>
                <td style={{ padding: "4px 6px", width: 70 }}>{numInput(r, "qty_par_lot")}</td>
                <td style={{ padding: "4px 6px" }}>{numInput(r, "cout_emballage")}</td>
                <td style={{ padding: "4px 6px" }}>{selInput(r, "vat_regime", VAT_REGIMES, VAT_LABEL)}</td>
                <td style={{ padding: "4px 6px" }}>{selInput(r, "shipping_model", SHIPPING_MODELS, SHIP_LABEL)}</td>
                <td style={{ padding: "4px 6px" }}>{selInput(r, "pays_import", PAYS_KEYS, null)}</td>
                <td style={{ padding: "4px 6px" }}>{selInput(r, "categorie", CATEGORIE_KEYS, null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "10px", flexWrap: "wrap" }}>
        <button onClick={onSave} disabled={saving} style={{ padding: "7px 14px", background: saving ? "#E4E5E7" : "#008060", color: saving ? "#6D7175" : "#fff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
          {saving ? "Enregistrement…" : "Enregistrer ce produit"}
        </button>
        {saved && <span style={{ fontSize: "12px", color: "#008060" }}>✓ Coûts enregistrés.</span>}
        {errors.length > 0 && <span style={{ fontSize: "12px", color: "#D72C0D" }}>{errors.length} ligne(s) non enregistrée(s) : {errors.slice(0, 3).map((e) => e.messages?.join(" · ")).join(" ; ")}</span>}
      </div>
      {/* Boucle post-enregistrement (point 9) : guide vers le prochain produit incomplet, ou clôture. */}
      {saved && (
        <div style={{ fontSize: "12px", color: "#202223", marginTop: "6px", lineHeight: "1.5" }}>
          {nextIncomplete ? (
            <>Continuez : <button onClick={() => onContinue?.(nextIncomplete.product_id)} style={{ background: "none", border: "none", padding: 0, color: "#008060", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 600, textDecoration: "underline" }}>{nextIncomplete.title}</button></>
          ) : !hasAnalyzedOrders ? (
            "Tous vos produits sont renseignés. Synchronisez vos commandes pour voir vos marges réelles."
          ) : (
            "Tous vos produits sont renseignés."
          )}
        </div>
      )}
      <div style={{ fontSize: "11px", color: "#6D7175", marginTop: "6px" }}>Les champs laissés vides utiliseront la valeur suggérée affichée en exemple.</div>
    </div>
  );
}
