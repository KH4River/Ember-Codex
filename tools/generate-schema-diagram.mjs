// Generates docs/schema/schema.dbml from shared/db/migrations/*.sql.
//
// Reads the built schema through pragmas: the engine knows nullability, key
// order and delete actions, and CHECK bodies come from sqlite_master.sql.
// Ref operators encode key/nullability for dbdiagram: '-' unique, '>'
// non-unique, '?' nullable. https://dbdiagram.io/docs/relationships
//
// Run: node tools/generate-schema-diagram.mjs
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readMigrationSources, sourceDigest } from './lib/migration-source.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(repoRoot, 'docs', 'schema', 'schema.dbml');

const sources = readMigrationSources();
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
for (const { sql } of sources) db.exec(sql);

// Table names reach SQL as string literals, so only bare identifiers are safe
// to interpolate.
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const q = (name) => {
  if (!IDENT.test(name)) throw new Error(`not a bare identifier: ${name}`);
  return `'${name}'`;
};

const tables = db
  .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all();
const ddl = new Map(tables.map((t) => [t.name, t.sql]));

const columnsOf = (t) => db.prepare(`PRAGMA table_info(${q(t)})`).all();

/**
 * foreign_key_list emits one row per column. `id` groups the columns of one
 * constraint; `seq` orders them.
 */
function foreignKeysOf(table) {
  const groups = new Map();
  for (const fk of db.prepare(`PRAGMA foreign_key_list(${q(table)})`).all()) {
    groups.set(fk.id, [...(groups.get(fk.id) ?? []), fk]);
  }
  return [...groups.values()].map((rows) => rows.sort((a, b) => a.seq - b.seq));
}

/**
 * The keys on a table, split into what DBML can carry: a composite key becomes
 * an `indexes` entry, a single-column key a column setting.
 */
function keysOf(table) {
  const compositePk = columnsOf(table).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
  const single = new Set();
  const compositeUnique = [];
  for (const idx of db.prepare(`PRAGMA index_list(${q(table)})`).all()) {
    if (!idx.unique) continue;
    const cols = db
      .prepare(`PRAGMA index_info(${q(idx.name)})`).all()
      .sort((a, b) => a.seqno - b.seqno)
      .map((c) => c.name);
    // A partial index keeps its predicate only in the DDL. DBML has no partial
    // index, so record the predicate as a note.
    const predicate = /where\s+([\s\S]+)$/i.exec(
      db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name=${q(idx.name)}`).get()?.sql ?? ''
    );
    const entry = { cols, name: idx.origin === 'c' ? idx.name : null, predicate: predicate?.[1].trim() ?? null };
    // A composite PK is also a unique index, and [pk] already says unique.
    const isThePk = compositePk.length > 1 && cols.join() === compositePk.map((c) => c.name).join();
    if (isThePk) continue;
    if (cols.length === 1 && entry.name === null) single.add(cols[0]);
    else compositeUnique.push(entry);
  }
  return { pk: compositePk, single, compositeUnique };
}

/**
 * table_info reports a single-column INTEGER PRIMARY KEY as nullable; it is the
 * rowid alias and cannot be null. Shared by the column emitter and ref operator.
 */
const isNotNull = (c, keys) => c.notnull || (c.pk > 0 && keys.pk.length === 1);

/**
 * True when this column set is a unique key: a single-column primary key or
 * unique constraint, the full composite primary key, or a non-partial composite
 * unique index. A partial index only constrains matching rows, so it cannot make
 * an FK one-to-one.
 */
function isUniqueKey(keys, cols) {
  const names = cols.join();
  if (keys.pk.length === 1 && keys.pk[0].name === cols[0] && cols.length === 1) return true;
  if (keys.single.has(cols[0]) && cols.length === 1) return true;
  if (keys.pk.length > 1 && keys.pk.map((c) => c.name).join() === names) return true;
  return keys.compositeUnique.some((u) => !u.predicate && u.cols.join() === names);
}

/**
 * CHECK bodies from the stored DDL. The scan balances parentheses because a
 * body can nest, and skips quoted literals so a paren inside a string does not
 * end it early.
 */
function checksOf(table) {
  const sql = ddl.get(table);
  const found = [];
  for (const m of sql.matchAll(/check\s*\(/gi)) {
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < sql.length; j++) {
      const c = sql[j];
      if (c === "'") {
        while (++j < sql.length && sql[j] !== "'") if (sql[j] === "'" && sql[j + 1] === "'") j++;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) break;
    }
    found.push(oneLine(sql.slice(m.index + m[0].length, j)));
  }
  return found;
}

/** Some CHECK bodies span lines; DBML wants one line per expression. */
function oneLine(expr) {
  let out = '';
  let literal = false;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'") literal = !literal;
    if (!literal && /\s/.test(c)) {
      out += ' ';
      while (/\s/.test(expr[i + 1] ?? '')) i++;
      continue;
    }
    out += c;
  }
  return out.trim();
}

function tableBlock(name) {
  const keys = keysOf(name);
  const { pk, single, compositeUnique } = keys;
  const compositePk = pk.length > 1;
  const lines = columnsOf(name).map((c) => {
    const settings = [];
    if (c.pk > 0 && !compositePk) settings.push('pk');
    if (isNotNull(c, keys)) settings.push('not null');
    if (single.has(c.name)) settings.push('unique');
    // SQLite hands back the literal as written; only a call needs backticks.
    const d = c.dflt_value?.trim();
    if (d) settings.push(/^[A-Za-z_][\w]*\s*\(/.test(d) ? `default: \`${d}\`` : `default: ${d}`);
    return `  ${c.name} ${c.type.toLowerCase()}${settings.length ? ` [${settings.join(', ')}]` : ''}`;
  });

  const indexes = [];
  if (compositePk) indexes.push(`    (${pk.map((c) => c.name).join(', ')}) [pk]`);
  for (const u of compositeUnique) {
    const parts = ['unique'];
    if (u.name) parts.push(`name: '${u.name}'`);
    if (u.predicate) parts.push(`note: 'partial index: WHERE ${u.predicate}'`);
    indexes.push(`    (${u.cols.join(', ')}) [${parts.join(', ')}]`);
  }
  if (indexes.length) lines.push('  indexes {', ...indexes, '  }');

  const checks = checksOf(name);
  if (checks.length) lines.push('  checks {', ...checks.map((c) => `    \`${c}\``), '  }');

  return [`Table ${name} {`, ...lines, '}'];
}

// DBML spells the referential actions in lower case; SQLite reports them shouted.
const ACTION = (a) => a.toLowerCase();

function refLine(child, group, keys, columnInfo) {
  const cols = (names) => (names.length === 1 ? names[0] : `(${names.join(', ')})`);
  const from = group.map((f) => f.from);
  const to = cols(group.map((f) => f.to));
  const notNull = from.every((name) => isNotNull(columnInfo.get(name), keys));
  const key = isUniqueKey(keys, from);
  const op = key ? (notNull ? '-' : '-?') : (notNull ? '>' : '>?');
  return `Ref: ${child}.${cols(from)} ${op} ${group[0].table}.${to} [delete: ${ACTION(group[0].on_delete)}, update: ${ACTION(group[0].on_update)}]`;
}

// keysOf and table_info each cost a pragma round trip, so compute them once
// per child table.
const refs = tables
  .flatMap((t) => {
    const keys = keysOf(t.name);
    const columnInfo = new Map(columnsOf(t.name).map((c) => [c.name, c]));
    return foreignKeysOf(t.name).map((g) => refLine(t.name, g, keys, columnInfo));
  })
  .sort();
const checkCount = tables.reduce((n, t) => n + checksOf(t.name).length, 0);
const contents = [
  '// AUTO-GENERATED by tools/generate-schema-diagram.mjs. Do not edit by hand.',
  '// Regenerate with: node tools/generate-schema-diagram.mjs',
  `// source-hash: ${sourceDigest(sources)}`,
  `// ${tables.length} tables · ${refs.length} foreign keys · ${checkCount} checks`,
  ...tables.flatMap((t) => ['', ...tableBlock(t.name)]),
  '',
  ...refs,
  '',
].join('\n');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, contents, 'utf8');
console.log(`wrote ${outFile} (${tables.length} tables, ${refs.length} foreign keys, ${checkCount} checks)`);