// ── Sync v2 (F2) — requêtes Admin GraphQL (validées contre le schéma 2026-01 le 2026-09-22) ───
// Aucun champ nominatif : customer { id }, shippingAddress { countryCodeV2 } seulement (niveau 1).
// Bulk : connexions SANS first (le bulk pagine) ; jamais une connexion sous une liste (refunds).

// Marqueurs de reconnaissance de NOTRE requête bulk (bulkResume.js) : les deux doivent y figurer.
export const ORDER_NODE_FIELDS = `
  __typename id name createdAt processedAt cancelledAt test sourceName paymentGatewayNames currencyCode taxesIncluded tags
  subtotalPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } } totalPriceSet { shopMoney { amount } }
  discountCodes
  customer { id }
  shippingAddress { countryCodeV2 }
  purchasingEntity { __typename }
  customerJourneySummary { ready customerOrderIndex lastVisit { source sourceType landingPage utmParameters { source medium campaign content term } } }
  refunds { id createdAt totalRefundedSet { shopMoney { amount } } }
  fulfillments { id createdAt status displayStatus deliveredAt estimatedDeliveryAt inTransitAt trackingInfo { company number } }
  lineItems { edges { node {
    __typename id quantity isGiftCard product { id } variant { id }
    originalUnitPriceSet { shopMoney { amount } } discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
    taxLines { title rate priceSet { shopMoney { amount } } }
  } } }
  shippingLines { edges { node {
    __typename id originalPriceSet { shopMoney { amount } } discountedPriceSet { shopMoney { amount } }
    taxLines { title rate priceSet { shopMoney { amount } } }
  } } }`;

// Filtre de fenêtre [start, end) sur created_at (backfill) ou updated_at (réconciliation).
export function windowFilter({ start, end, by = "created_at" }) {
  const field = by === "updated_at" ? "updated_at" : "created_at";
  return `${field}:>='${start}' AND ${field}:<'${end}'`;
}

export function ordersBulkQuery({ start, end, by = "created_at" }) {
  const sortKey = by === "updated_at" ? "UPDATED_AT" : "CREATED_AT";
  return `{ orders(query: "${windowFilter({ start, end, by })}", sortKey: ${sortKey}) { edges { node { ${ORDER_NODE_FIELDS} } } } }`;
}

export const refundsFilter = (w) => `${windowFilter(w)} AND (financial_status:refunded OR financial_status:partially_refunded)`;
export const returnsFilter = (w) => `${windowFilter(w)} AND (return_status:return_requested OR return_status:in_progress OR return_status:inspection_complete OR return_status:returned OR return_status:return_failed)`;

export const REFUNDS_QUERY = `query Refunds($q: String!, $cursor: String) {
  orders(first: 50, query: $q, after: $cursor, sortKey: CREATED_AT) {
    edges { node { id refunds {
      id createdAt totalRefundedSet { shopMoney { amount } }
      refundShippingLines(first: 10) { edges { node { subtotalAmountSet { shopMoney { amount } } } } }
      refundLineItems(first: 100) { edges { node { quantity restockType subtotalSet { shopMoney { amount } } lineItem { id } } } }
      transactions(first: 50) { edges { node { kind status amountSet { shopMoney { amount } } } } }
    } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const RETURNS_QUERY = `query Returns($q: String!, $cursor: String) {
  orders(first: 50, query: $q, after: $cursor, sortKey: CREATED_AT) {
    edges { node { id returns(first: 10) { edges { node {
      id status name createdAt closedAt
      returnLineItems(first: 50) { edges { node { ... on ReturnLineItem { quantity returnReason returnReasonNote fulfillmentLineItem { lineItem { id } } } } } }
    } } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const JOURNEY_QUERY = `query Journey($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Order { id customerJourneySummary { ready customerOrderIndex lastVisit { source sourceType landingPage utmParameters { source medium campaign content term } } } } }
}`;

export const FEES_QUERY = `query Fees($cursor: String, $q: String) {
  shopifyPaymentsAccount { balanceTransactions(first: 100, after: $cursor, query: $q, hideTransfers: true) {
    edges { node { id type test transactionDate amount { amount currencyCode } fee { amount } net { amount } associatedOrder { id } sourceOrderTransactionId sourceType } }
    pageInfo { hasNextPage endCursor }
  } }
}`;

export const SHOP_QUERY = `{ shop { ianaTimezone currencyCode taxesIncluded shopAddress { countryCodeV2 } } }`;

export const VARIANTS_QUERY = `query Variants($cursor: String) {
  productVariants(first: 250, after: $cursor) {
    edges { node { id product { id } inventoryQuantity inventoryItem { tracked unitCost { amount } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const BULK_OP_QUERY = `query Op($id: ID!) { bulkOperation(id: $id) { id status errorCode url partialDataUrl objectCount query completedAt } }`;
export const ACTIVE_BULK_OPS_QUERY = `{ bulkOperations(first: 5, query: "status:running OR status:created", sortKey: CREATED_AT, reverse: true) { edges { node { id status query url errorCode } } } }`;
export const BULK_RUN_MUTATION = `mutation Run($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id status } userErrors { field message } } }`;
export const ORDER_BY_ID_QUERY = `query O($id: ID!) { order(id: $id) { id createdAt } }`;
