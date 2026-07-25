// ── Fiabilité douane — composants UI (extraits pour être RENDABLES/testables en isolation) ─────
// Rendu réel exigé avant tout commit UI (cf. CLAUDE.md) : ces composants sont importés par la route
// ET par le harness de rendu scripts/render_check.mjs. Aucun import de shopify.server (rendable seul).
import { useState, useMemo, useEffect } from "react";
import { useFetcher } from "react-router";
import { CUSTOMS_RATES, formatPct } from "../lib/engine.js";
import { customsIndicator } from "../lib/customsClassification.js";

// Indicateur discret « taux estimé — à confirmer ». estimated=false ⇒ null (classification confirmée :
// AUCUN changement d'affichage). Ambre sobre, adossé à la nomenclature TARIC (jamais de chapitre inventé).
export function CustomsEstimatedTag({ estimated }) {
  if (!estimated) return null;
  const ind = customsIndicator("estimated");
  return (
    <span title="Le taux de douane dépend de la catégorie, encore estimée. Confirmez-la dans « Suivi des coûts » pour un taux fiable (selon la nomenclature TARIC)."
      style={{ fontSize: "10px", fontWeight: "600", color: "#B98900", background: "#FFF9EC", border: "1px solid #B9890033", borderRadius: "8px", padding: "1px 6px", whiteSpace: "nowrap", marginLeft: "6px" }}>
      {ind.label}
    </span>
  );
}

// Bandeau de feedback PERSISTANT de la confirmation douane (hissé dans CostTracker : survit à la
// disparition du panneau). Extrait pour être rendable/testable (render_check). feedback = { success,
// rateChanged, error }. Rendu réel exigé pour les textes règle d'or (ère XV, commit 6). null → rien.
export function CustomsFeedbackBanner({ feedback, onClose }) {
  if (!feedback) return null;
  const ok = feedback.success;
  const bg = ok ? (feedback.rateChanged ? "#FFF9EC" : "#F1F8F5") : "#FFF4F4";
  const bd = ok ? (feedback.rateChanged ? "#B9890033" : "#00806033") : "#D72C0D33";
  return (
    <div style={{ padding: "10px 14px", borderRadius: "8px", marginBottom: "12px", display: "flex", alignItems: "flex-start", gap: "10px", background: bg, border: `1px solid ${bd}` }}>
      <div style={{ flex: 1, fontSize: "12px", color: "#202223", lineHeight: "1.5" }}>
        {ok ? (
          feedback.rateChanged
            ? <>✓ Catégorie confirmée. Le taux de douane a changé : vos prochains calculs utiliseront ce taux. Les marges déjà calculées avec vos vrais coûts ne bougent pas ; celles calculées sans coût saisi peuvent être mises à jour avec « Corriger les marges calculées sans coût » ci-dessus.</>
            : <>✓ Catégorie confirmée. Vos prochains calculs utiliseront ce taux.</>
        ) : <span style={{ color: "#D72C0D" }}>{feedback.error}</span>}
      </div>
      <button onClick={onClose} title="Fermer" style={{ background: "none", border: "none", color: "#6D7175", cursor: "pointer", fontSize: "16px", lineHeight: 1, fontFamily: "inherit", flexShrink: 0 }}>×</button>
    </div>
  );
}

// Confirmation de la classification PAR PRODUIT (configuration actuelle). Ne liste que les produits à
// classification ESTIMÉE (pire cas : ≥1 variante non confirmée). Divergence ⇒ aucune présélection, choix
// explicite + mention du conflit. Sur rateChanged, dit explicitement que les marges à coûts confirmés
// gardent l'ancien taux. Feedback (succès OU erreur) remonté AU PARENT (bandeau persistant).
export function CustomsClassificationPanel({ rows, onConfirmed }) {
  const confirmFetcher = useFetcher();
  useEffect(() => { if (confirmFetcher.data) onConfirmed?.(confirmFetcher.data); }, [confirmFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [choice, setChoice] = useState({});
  const [expanded, setExpanded] = useState(false);
  const products = useMemo(() => {
    const m = new Map();
    // rows === null au 1er rendu (CostTracker : useState(null) « pas encore chargé ») → garde OBLIGATOIRE :
    // `for (const r of null)` jette « rows is not iterable » (« i » minifié) et crashe l'onglet entier.
    for (const r of (rows ?? [])) {
      if (!r.product_id) continue;
      let g = m.get(r.product_id);
      if (!g) { g = { product_id: r.product_id, title: r.product_title, cats: new Set(), estimated: false }; m.set(r.product_id, g); }
      g.cats.add(r.categorie);
      if (r.customs_confirmed !== true) g.estimated = true;
    }
    return [...m.values()].filter((g) => g.estimated);
  }, [rows]);
  if (products.length === 0) return null;
  // Blocage UX : au-delà de 3 produits, replié par défaut (ligne résumé) → ne pas enterrer le tableau.
  const collapsed = products.length > 3 && !expanded;
  const submit = (pid, cat) => confirmFetcher.submit({ _action: "confirm_customs_category", product_id: pid, categorie: cat }, { method: "POST", encType: "application/json" });
  return (
    <div style={{ padding: "12px 14px", borderRadius: "8px", background: "#FBFBFC", border: "1px solid #E4E5E7", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", fontWeight: "600", color: "#202223" }}>Classification douanière : {products.length} produit(s) à confirmer</span>
        {products.length > 3 && (
          <button onClick={() => setExpanded((e) => !e)} style={{ padding: "3px 10px", background: "#fff", color: "#6D7175", border: "1px solid #C9CCCF", borderRadius: "6px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>{collapsed ? "Déplier" : "Replier"}</button>
        )}
      </div>
      <div style={{ fontSize: "11px", color: "#6D7175", marginTop: "4px", lineHeight: "1.5" }}>
        Le taux de douane appliqué à un produit dépend de sa <strong>catégorie</strong>. Vérifiez-la une fois pour chaque produit : vos marges utiliseront le bon taux. Les marges déjà calculées avec vos coûts confirmés ne changeront pas.
      </div>
      {!collapsed && (
        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {products.map((g) => {
            const divergent = g.cats.size > 1;
            const chosen = choice[g.product_id] ?? (divergent ? "" : [...g.cats][0]);
            return (
              <div key={g.product_id} style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "12px", color: "#202223", fontWeight: "600", flex: "1 1 160px" }}>{g.title}</span>
                {divergent && <span style={{ fontSize: "10px", fontWeight: "600", color: "#B98900" }}>⚠ catégories divergentes</span>}
                <select value={chosen} onChange={(e) => setChoice({ ...choice, [g.product_id]: e.target.value })}
                  style={{ fontSize: "12px", padding: "5px 8px", borderRadius: "6px", border: "1px solid #C9CCCF", fontFamily: "inherit" }}>
                  {divergent && <option value="">Choisir une catégorie</option>}
                  {Object.entries(CUSTOMS_RATES).map(([cat, rate]) => <option key={cat} value={cat}>{cat} · douane {formatPct(rate * 100)} %</option>)}
                </select>
                <button onClick={() => submit(g.product_id, chosen)} disabled={!chosen || confirmFetcher.state !== "idle"}
                  style={{ padding: "5px 12px", background: chosen ? "#008060" : "#E4E5E7", color: chosen ? "#fff" : "#6D7175", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: chosen ? "pointer" : "default", fontFamily: "inherit" }}>Confirmer</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
