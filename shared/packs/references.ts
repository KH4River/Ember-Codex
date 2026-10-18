import type { DatabasePort } from '../db/DatabasePort';

/**
 * How a pack file names another row, and how that name becomes an id.
 *
 *   "skyriding"              this pack's own row, else a global one
 *   "srd-5.2.1/fireball"     that named pack's row
 *
 * The validator, the importer and the exporter all resolve through here, so
 * the rule is written once rather than three times.
 */

/** Tables a pack file may name by `key`. The name is interpolated into SQL, so
 *  this is an allowlist rather than an open union. */
export const KEYED_TABLES = [
  'species',
  'species_variant',
  'background',
  'class',
  'subclass',
  'feat',
  'feature',
  'spell',
  'effect',
  'item',
  'skill',
  'tool',
  'language',
  'condition',
] as const;

export type KeyedTable = (typeof KEYED_TABLES)[number];

/** Closed vocabulary, named by `code` or `slug` and never pack-owned, so it
 *  resolves against the global row only. */
export const CLOSED_TABLES = {
  ability: 'code',
  feat_category: 'code',
  roll_scope: 'code',
  class_grant_kind: 'code',
  weapon_category: 'code',
  weapon_property: 'code',
  mastery_property: 'code',
  damage_type: 'slug',
} as const;

export type ClosedTable = keyof typeof CLOSED_TABLES;

export interface ParsedReference {
  /** The named pack's slug, or null for a bare key. */
  source: string | null;
  key: string;
}

/**
 * Why a reference did not resolve. The two are kept apart because the user
 * needs different messages: a misspelled key in this pack is one problem, and
 * a pack that was never imported is another.
 */
export type UnresolvedReason = 'no-such-key' | 'no-such-pack';

export type Resolution =
  | { found: true; id: number }
  | { found: false; reason: UnresolvedReason; source: string | null; key: string };

/** Guards the union above: KEYED_TABLES is a runtime array, and any other
 *  string would reach the SQL. */
export function isKeyedTable(table: string): table is KeyedTable {
  return (KEYED_TABLES as readonly string[]).includes(table);
}

/** Splits a reference into its two halves. A pack slug may contain dots and
 *  hyphens, so the separator is the first `/` and only one is allowed. */
export function parseReference(ref: unknown): ParsedReference {
  if (typeof ref !== 'string') {
    throw new TypeError(`a pack reference must be a string, got ${typeof ref}`);
  }
  const slash = ref.indexOf('/');
  if (slash === -1) {
    if (ref.trim() === '') throw new SyntaxError('a pack reference cannot be empty');
    return { source: null, key: ref };
  }
  if (ref.indexOf('/', slash + 1) !== -1) {
    throw new SyntaxError(`"${ref}" has more than one "/"; a reference is key or source/key`);
  }
  const source = ref.slice(0, slash);
  const key = ref.slice(slash + 1);
  if (source.trim() === '' || key.trim() === '') {
    throw new SyntaxError(`"${ref}" is not a usable reference`);
  }
  return { source, key };
}

/** How many rows a vocabulary table has, to tell "not seeded" apart from
 *  "not a value this build knows". */
export async function vocabularySize(port: DatabasePort, table: ClosedTable): Promise<number> {
  const row = await port.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}"`);
  return row?.n ?? 0;
}

/** Resolves one closed-vocabulary value. No pack scoping and no fallback: these
 *  tables are seeded, so there is one row or none. */
export async function resolveCode(
  port: DatabasePort,
  table: ClosedTable,
  value: unknown,
): Promise<Resolution> {
  if (typeof value !== 'string') {
    throw new TypeError(`a ${table} value must be a string, got ${typeof value}`);
  }
  const column = CLOSED_TABLES[table];
  const row = await port.get<{ id: number }>(
    `SELECT id FROM "${table}" WHERE ${column} = ?`,
    [value],
  );
  if (row) return { found: true, id: row.id };
  return { found: false, reason: 'no-such-key', source: null, key: value };
}

/** Resolves one reference to a row id. A bare key looks in the importing pack
 *  first, then at global vocabulary. A qualified key looks only in the pack it
 *  names, so a typo cannot quietly resolve to a row the author did not mean. */
export async function resolveReference(
  port: DatabasePort,
  table: KeyedTable,
  ref: unknown,
  ownSourceId: number,
): Promise<Resolution> {
  if (!isKeyedTable(table)) {
    throw new TypeError(`"${table}" is not a table a pack may reference`);
  }
  const { source, key } = parseReference(ref);

  if (source !== null) {
    const pack = await port.get<{ id: number }>('SELECT id FROM source WHERE slug = ?', [source]);
    if (!pack) {
      return { found: false, reason: 'no-such-pack', source, key };
    }
    const row = await port.get<{ id: number }>(
      `SELECT id FROM "${table}" WHERE source_id = ? AND slug = ?`,
      [pack.id, key],
    );
    if (row) return { found: true, id: row.id };
    return { found: false, reason: 'no-such-key', source, key };
  }

  const own = await port.get<{ id: number }>(
    `SELECT id FROM "${table}" WHERE source_id = ? AND slug = ?`,
    [ownSourceId, key],
  );
  if (own) return { found: true, id: own.id };

  const global = await port.get<{ id: number }>(
    `SELECT id FROM "${table}" WHERE source_id IS NULL AND slug = ?`,
    [key],
  );
  if (global) return { found: true, id: global.id };
  return { found: false, reason: 'no-such-key', source: null, key };
}