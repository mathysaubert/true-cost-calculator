// ── D2-4 : comparaison de deux empreintes (scripts/d2_4_snapshot.mjs) — preuve du retour arrière ──
// Usage : node scripts/d2_4_compare.mjs <avant.json> <après.json>
// Compare la structure (colonnes, contraintes, index, politiques, RLS, déclencheurs, fonctions, droits)
// et les données (lignes et empreintes). Signale à part un écart limité à l'ORDRE des colonnes (colonnes
// réajoutées en fin de table par ALTER TABLE ADD COLUMN), sans effet sur l'app ni sur les données.
import fs from "node:fs";
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const s = (x) => JSON.stringify(x);
const norm = (cols) => cols.map(({ ordinal_position, ...c }) => c).sort((x, y) => (x.table_name + x.column_name).localeCompare(y.table_name + y.column_name));
const parts = ["constraints", "indexes", "policies", "rls", "triggers", "functions", "grants"];
const diffs = [];
if (s(norm(a.columns)) !== s(norm(b.columns))) {
  const key = (c) => `${c.table_name}.${c.column_name}`;
  const A = new Map(norm(a.columns).map((c) => [key(c), s(c)])), B = new Map(norm(b.columns).map((c) => [key(c), s(c)]));
  for (const k of new Set([...A.keys(), ...B.keys()])) if (A.get(k) !== B.get(k)) diffs.push(`colonne ${k} : ${A.has(k) ? (B.has(k) ? "définition différente" : "absente après") : "en trop après"}`);
}
for (const p of parts) if (s(a[p]) !== s(b[p])) {
  const A = new Set(a[p].map(s)), B = new Set(b[p].map(s));
  const lost = [...A].filter((x) => !B.has(x)).length, extra = [...B].filter((x) => !A.has(x)).length;
  diffs.push(`${p} : ${lost} élément(s) perdu(s), ${extra} en trop`);
}
const orderOnly = s(a.columns) !== s(b.columns) && s(norm(a.columns)) === s(norm(b.columns));
const moved = orderOnly ? [...new Set(a.columns.filter((c) => { const o = b.columns.find((x) => x.table_name === c.table_name && x.column_name === c.column_name); return o && o.ordinal_position !== c.ordinal_position; }).map((c) => c.table_name))] : [];
const dataDiffs = [];
for (const k of new Set([...Object.keys(a.data), ...Object.keys(b.data)])) if (s(a.data[k]) !== s(b.data[k])) dataDiffs.push(`${k} : avant ${s(a.data[k])} · après ${s(b.data[k])}`);
console.log(`Comparaison « ${a.label} » → « ${b.label} »`);
console.log(`  structure : ${diffs.length === 0 ? "IDENTIQUE" : "DIFFÉRENTE"}${orderOnly ? ` (seul écart : ordre des colonnes de ${moved.join(", ")})` : ""}`);
for (const d of diffs) console.log(`    - ${d}`);
console.log(`  données : ${dataDiffs.length === 0 ? "IDENTIQUES" : "DIFFÉRENTES"}`);
for (const d of dataDiffs) console.log(`    - ${d}`);
process.exit(diffs.length === 0 && dataDiffs.length === 0 ? 0 : 1);
