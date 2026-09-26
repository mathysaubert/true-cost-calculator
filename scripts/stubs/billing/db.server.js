/* global globalThis */
// ── Stub Prisma pour scripts/billing_redirect_check.mjs : une session hors ligne en mémoire ──────
// Aucune base réelle : la table Session répond avec la session fournie par le harnais
// (globalThis.__BILLING_SESSION) ; toute écriture réussit sans effet.
const session = () => globalThis.__BILLING_SESSION ?? null;
const sessionModel = {
  count: async () => 1,
  findUnique: async ({ where }) => (session()?.id === where?.id ? session() : null),
  findFirst: async () => session(),
  findMany: async () => (session() ? [session()] : []),
  upsert: async ({ create }) => create,
  create: async ({ data }) => data,
  update: async ({ data }) => data,
  delete: async () => ({}),
  deleteMany: async () => ({ count: 0 }),
};
const prisma = new Proxy({}, { get: (_t, k) => (k === "session" ? sessionModel : k === "$connect" || k === "$disconnect" ? async () => {} : new Proxy({}, { get: () => async () => null })) });
export default prisma;
