// ── Reprise des opérations bulk de sync — décision PURE (aucun I/O, aucun React) ─────────────
// Fix du P0 d'audit « op COMPLETED jamais téléchargée » : syncShopOrders lit l'opération bulk
// courante à l'ENTRÉE et passe par cette décision AVANT toute création. Une op terminée de notre
// requête est reprise (téléchargée puis ingérée par le chemin existant) au lieu d'être écrasée
// par une nouvelle création. Testé lot22 ; couvre les trois déclencheurs (bouton, cron, recalc)
// puisqu'ils convergent tous vers syncShopOrders.

// Marqueurs de NOTRE requête bulk de sync (orderSync.server.js, bulkQuery). currentBulkOperation
// est déjà scopée à l'app sur ce shop : les marqueurs n'excluent qu'une future AUTRE requête bulk
// de l'app. Ils doivent tous apparaître — lot22 vérifie qu'ils matchent le bulkQuery réel du
// source (toute dérive de la requête qui casserait la reconnaissance fait rougir le test).
export const SYNC_QUERY_MARKERS = [
  'orders(query: "created_at:>=',
  "discountedUnitPriceAfterAllDiscountsSet",
];

export function isOurSyncQuery(query) {
  const q = String(query ?? "");
  return SYNC_QUERY_MARKERS.every((m) => q.includes(m));
}

// Décision de reprise — table validée en Phase 0 (P0.6/P0.7) :
//   op    : currentBulkOperation { id, status, url, query } ou null.
//   state : ligne order_sync_state { bulk_operation_id, status } ou null (lue par l'appelant
//           quand op est COMPLETED ; « déjà ingérée » ⟺ même id ET status 'completed', le couple
//           écrit par syncShopOrders APRÈS ingestion réussie — aucun état persisté nouveau).
// Retours :
//   'create' : aucune op à reprendre → lancer une op fraîche (chemin actuel).
//   'poll'   : notre op tourne → ne RIEN créer, entrer dans le poll existant.
//   'busy'   : une op qu'on ne doit pas toucher occupe le slot → message « déjà en cours »
//              existant. DÉFAUT SÛR : tout statut inconnu (CANCELING, statuts futurs) et toute
//              op sans statut lisible tombent ici — l'inaction, jamais une création par-dessus.
//   'ingest' : notre op est COMPLETED et non ingérée → télécharger son url et ingérer par le
//              chemin existant (url null → branche « aucune commande » existante).
export function decideBulkResume({ op, state } = {}) {
  if (!op) return "create";
  const ours = isOurSyncQuery(op.query);
  if (op.status === "RUNNING" || op.status === "CREATED") return ours ? "poll" : "busy";
  if (op.status === "COMPLETED") {
    if (!ours) return "create"; // jamais consommer les résultats d'une autre requête
    const ingested = state?.bulk_operation_id === op.id && state?.status === "completed";
    return ingested ? "create" : "ingest";
  }
  if (op.status === "FAILED" || op.status === "CANCELED" || op.status === "EXPIRED") return "create";
  return "busy";
}
