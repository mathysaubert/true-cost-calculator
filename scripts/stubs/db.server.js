// ── Stub Prisma du rendu des routes : toute méthode de tout modèle répond vide, sans connexion ──
const model = new Proxy({}, { get: (_t, m) => async () => (/^find(Many)?$|^findMany$/.test(String(m)) ? [] : m === "count" ? 0 : null) });
const prisma = new Proxy({}, { get: (_t, k) => (k === "$connect" || k === "$disconnect" ? async () => {} : model) });
export default prisma;
