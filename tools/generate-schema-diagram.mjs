// Generates docs/schema/schema.dbml from shared/db/migrations/*.sql.
//
// Why introspect the built schema instead of parsing the .sql text: the engine
// already answers "which columns are NOT NULL", "in what order is the composite
// primary key" and "what does this foreign key do on delete" through pragmas,
// and tools/verify-migration.mjs already opens the migrations this way. A regex
// would re-derive all three, and it would disagree with table_info about rowid
// aliases -- SQLite reports an INTEGER PRIMARY KEY as nullable however it is
// declared, so a parser reading the declaration would call it NOT NULL.
//
// CHECK bodies are the one thing no pragma exposes, so they come out of the DDL
// SQLite itself stored in sqlite_master.sql. That is still the engine's copy of
// the text rather than a second parse of the file, and it means a CHECK the
// engine rejected at CREATE time cannot appear here.
//
// Why DBML rather than Mermaid: this schema has 51 composite primary keys, 63
// composite unique indexes and 106 CHECK constraints. Mermaid's erDiagram has
// no syntax for any of the three -- composite keys flatten into a PK per
// column, composite uniques are dropped, and CHECK is not expressible -- so a
// Mermaid diagram of this schema misstates most of what the schema constrains.
// DBML carries all of them, plus [delete: ...] for the two-tier delete policy
// that .opencode/rules-reference.md is about.
//
// The Ref operator carries the two facts the column settings carry, because
// dbdiagram warns on any operator the columns contradict: a unique child key
// is one-to-one ('-' rather than '>') and a nullable child FK is optional
// ('?' appended) -- https://dbdiagram.io/docs/relationships.
//
// What DBML still cannot carry, so the .sql keeps doing it: partial indexes are
// noted rather than expressed, CHECK constraints are unnamed because SQLite
// does not name them, and column comments stay in the migration.
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
 * foreign_key_list emits one row per column: `id` groups the columns belonging
 * to one constraint and `seq` is their order. Grouping by id is what keeps
 * `player_character.(variant_id, species_id)` one relationship rather than two
 * unrelated ones.
 */
function foreignKeysOf(table) {
  const groups = new Map();
  for (const fk of db.prepare(`PRAGMA foreign_key_list(${q(table)})`).all()) {
    groups.set(fk.id, [...(groups.get(fk.id) ?? []), fk]);
  }
  return [...groups.values()].map((rows) => rows.sort((a, b) => a.seq - b.seq));
}

/**
 * Every key on a table, split by what DBML can actually say. A composite key is
 * an `indexes` entry; a single-column key is a column setting. Both spellings
 * exist so nothing has to be flattened to fit.
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
    // A named index may be partial, which SQLite keeps only in its DDL. DBML has
    // no partial index, so the predicate is recorded as a note rather than
    // dropped -- these four are what hold a NULL source_id to one global row.
    const predicate = /where\s+([\s\S]+)$/i.exec(
      db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name=${q(idx.name)}`).get()?.sql ?? ''
    );
    const entry = { cols, name: idx.origin === 'c' ? idx.name : null, predicate: predicate?.[1].trim() ?? null };
    // A composite primary key is itself a unique index, and DBML's [pk] already
    // says unique. Emitting both would print every key twice.
    const isThePk = compositePk.length > 1 && cols.join() === compositePk.map((c) => c.name).join();
    if (isThePk) continue;
    if (cols.length === 1 && entry.name === null) single.add(cols[0]);
    else compositeUnique.push(entry);
  }
  return { pk: compositePk, single, compositeUnique };
}

/**
 * A single-column key is not nullable even where table_info says it is: it is
 * the rowid alias, and SQLite reports INTEGER PRIMARY KEY as notnull 0
 * whatever the declaration says. Shared by the column emitter and the ref
 * operator so the two cannot disagree about the same column.
 */
const isNotNull = (c, keys) => c.notnull || (c.pk > 0 && keys.pk.length === 1);

/**
 * True when this column set is a unique key of the table: the single-column
 * primary key (which has no autoindex to find), a single-column unique
 * constraint, the full composite primary key, or a composite unique index.
 * A partial unique index does not count — it constrains only the rows matching
 * its predicate, so it cannot make an FK set one-to-one.
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
 * body can nest -- `length(attribution) > 0` -- and steps over quoted literals
 * so a paren or the word inside a string cannot end the scan early.
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
    // DBML takes a bare number, a 'quoted string' or a `expression`. SQLite
    // hands back the literal as written, so only a call needs the backticks.
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

// keysOf and table_info cost a pragma round trip each, so they are computed
// once per child table rather than once per foreign key.
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