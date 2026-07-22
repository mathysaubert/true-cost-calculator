// Helper DEV — construit un client Admin GraphQL depuis le token OFFLINE stocké (prisma Session),
// SANS importer app/shopify.server (qui importe ./db.server sans extension → KO en node ESM brut).
// ⚠ Le token offline EXPIRE (~quotidien : expiringOfflineAccessTokens). S'il est invalide, ouvre
// l'app dans le dev store pour le rafraîchir, puis relance. probeToken() valide AVANT toute écriture.
import prisma from "../app/db.server.js";

const API_VERSION = "2025-10"; // = ApiVersion.October25 (app/shopify.server.js)

// Retourne { admin, expires } — admin.graphql(query, { variables }) mime le client Shopify (Response.json()).
export async function offlineAdmin(shop) {
  const s = await prisma.session.findFirst({
    where: { shop, isOnline: false }, select: { accessToken: true, expires: true },
  });
  if (!s?.accessToken) throw new Error(`Aucune session offline pour ${shop}`);
  const admin = {
    graphql: (query, options = {}) => fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": s.accessToken },
      body: JSON.stringify({ query, variables: options.variables ?? {} }),
    }),
  };
  return { admin, expires: s.expires };
}

// Vérifie que le token répond (≠ 401). Retourne { ok, status, message? }.
export async function probeToken(admin) {
  try {
    const r = await admin.graphql("{ shop { myshopifyDomain } }");
    if (r.status === 200) {
      const j = await r.json();
      if (j?.data?.shop) return { ok: true, status: 200 };
    }
    return { ok: false, status: r.status, message: `HTTP ${r.status}` };
  } catch (e) { return { ok: false, status: 0, message: e?.message }; }
}
