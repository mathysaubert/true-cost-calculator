/* global globalThis */
// ── Stub Supabase du rendu des routes (scripts/render_routes.mjs) — en mémoire, aucune écriture ──
// Lit globalThis.__RR_DB[table] ; les écritures (insert/upsert/update/delete) réussissent sans effet.
const rowsOf = (t) => globalThis.__RR_DB?.[t] ?? [];

class Query {
  constructor(table) { this.table = table; this.filters = []; this.mode = "many"; this.write = false; this.lim = null; this.sort = []; this.head = false; }
  select(_cols, opts = {}) { if (opts.head) this.head = true; return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
  gt(c, v) { this.filters.push((r) => r[c] != null && r[c] > v); return this; }
  gte(c, v) { this.filters.push((r) => r[c] != null && r[c] >= v); return this; }
  lt(c, v) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
  lte(c, v) { this.filters.push((r) => r[c] != null && r[c] <= v); return this; }
  in(c, vs) { const s = new Set(vs); this.filters.push((r) => s.has(r[c])); return this; }
  is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  not(c, op, v) { if (op === "is") this.filters.push((r) => (r[c] ?? null) !== v); return this; }
  match(obj) { for (const [c, v] of Object.entries(obj)) this.eq(c, v); return this; }
  or() { return this; } ilike() { return this; } like() { return this; } contains() { return this; } filter() { return this; } overlaps() { return this; }
  order(c, { ascending = true } = {}) { this.sort.push([c, ascending]); return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "one"; return this; }
  insert() { this.write = true; return this; } upsert() { this.write = true; return this; }
  update() { this.write = true; return this; } delete() { this.write = true; return this; }
  exec() {
    if (this.write) return { data: this.mode === "many" ? [] : null, error: null };
    let rows = rowsOf(this.table).filter((r) => this.filters.every((f) => f(r)));
    for (const [c, asc] of [...this.sort].reverse()) rows = [...rows].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    if (this.head) return { data: null, count: rows.length, error: null };
    if (this.mode !== "many") return { data: rows[0] ?? null, error: null };
    return { data: rows, count: rows.length, error: null };
  }
  then(resolve, reject) { return Promise.resolve(this.exec()).then(resolve, reject); }
}

export const supabase = {
  from: (t) => new Query(t),
  rpc: async () => ({ data: null, error: null }),
};
export default supabase;
