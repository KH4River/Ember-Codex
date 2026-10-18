import type { DatabasePort } from '../db/DatabasePort';

/**
 * How a pack file names another row, and how that name becomes an id.
 *
 * A reference is either a bare `key` or a qualified `source/key`:
 *
 *   "skyriding"              this pack's own row, else a global one
 *   "srd-5.2.1/fireball"     that named pack's row
 *
 * The fallback order is a decision, not a constraint, and it cannot tie: the
 * importer refuses a pack that defines a slug which already exists as global
 * vocabulary, so "own pack first, else global" always has one answer.
 *
 * THREE call sites depend on this file agreeing with itself -- the validator,
 * the importer and the exporter. That is why the rule lives here once instead
 * of being written out three times.
 */

/** Tables a pack file may name by `key`. The table name is interpolated into
 *  SQL, so this is an allowlist rather than an open union. */
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

/** Guards the type assertion above, because `KEYED_TABLES` is a runtime
 *  array and a caller passing any other string would reach the SQL. */
export function isKeyedTable(table: string): table is KeyedTable {
  return (KEYED_TABLES as readonly string[]).includes(table);
}

/**
 * Splits a reference into its two halves.
 *
 * A pack slug may contain dots and hyphens (`srd-5.2.1`), so the separator is
 * the first `/` and only one is allowed -- a key with a slash in it cannot be
 * expressed, and that is better caught here than silently mis-split.
 */
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

/**
 * Resolves one reference to a row id.
 *
 * A bare key looks in the importing pack first and then at global vocabulary,
 * because that is the order the format promises. A qualified key looks only
 * in the pack it names -- it is an explicit statement about where the row
 * lives, and quietly falling back would make a typo resolve to something the
 * author did not write.
 */
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
    return row ? { found: true, id: row.id } : { found: false, reason: 'no-such-key', source, key };
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
  return global ? { found: true, id: global.id } : { found: false, reason: 'no-such-key', source: null, key };
}