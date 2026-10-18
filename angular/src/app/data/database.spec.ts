import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { DatabasePort } from '@/db/DatabasePort';
import { runMigrations } from '@/db/migrate';
import { MIGRATIONS } from '@/db/migrations.generated';
import { listAbilities } from '@/db/repositories/abilities';

import { NodeSqlitePort } from '@/testing/node-sqlite.port';

describe('database bridge', () => {
  let port: NodeSqlitePort;

  beforeEach(async () => {
    port = new NodeSqlitePort();
    await port.open();
    await runMigrations(port, MIGRATIONS);
  });

  afterEach(async () => {
    await port.close();
  });

  it('enables foreign keys: SQLite ignores every FK without the pragma', async () => {
    const row = await port.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(row?.foreign_keys).toBe(1);
  });

  it('records the applied schema version in user_version', async () => {
    const row = await port.get<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(1);
  });

  it('is idempotent: a second migration run changes nothing', async () => {
    await runMigrations(port, MIGRATIONS);
    const row = await port.get<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(1);
    expect(await listAbilities(port)).toHaveLength(6);
  });

  it('reads the six seeded abilities through the port', async () => {
    const abilities = await listAbilities(port);
    expect(abilities.map((a) => a.code)).toEqual(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
    expect(abilities[0].name).toBe('Strength');
  });

  it('enforces foreign keys at DML time (dangling species rejected)', async () => {
    const uuid = 'a'.repeat(8) + '-1111-1111-1111-' + 'a'.repeat(12);
    await expect(
      port.run(
        `INSERT INTO player_character (uuid, name, species_id, background_id, hp_max, hp_current)
         VALUES (?, 'Orphan', 999, 999, 1, 1)`,
        [uuid],
      ),
    ).rejects.toThrow();
  });
});

/**
 * How @capacitor-community/sqlite turns a migration into statements on Android.
 * The real code is UtilsSQLite.getStatementsArray, and the four steps below are
 * all of it that this schema can trip over. Modelling it here means a migration
 * that would break the plugin breaks `npm test` instead of the app on a device.
 */
function capacitorStatements(sql: string): string[] {
  const chunks = sql.split(';\n').map((chunk) => chunk.trim());
  // A chunk that is exactly END is the tail of a trigger body, and belongs to
  // the statement before it. Both triggers in 001 need this.
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i] === 'END') {
      chunks[i - 1] = `${chunks[i - 1]}; END`;
      chunks.splice(i, 1);
    }
  }
  return chunks
    .map((chunk) =>
      chunk
        .split('\n')
        .map((line) => line.replace(/--.*$/, '').trim())
        .filter(Boolean)
        .join(' '),
    )
    .map((statement) => (statement.endsWith(';') ? statement : `${statement};`));
}

class CapacitorSplitPort implements DatabasePort {
  private readonly db = new DatabaseSync(':memory:');

  async open(): Promise<void> {
    this.db.exec('PRAGMA foreign_keys = ON');
  }
  async exec(sql: string): Promise<void> {
    for (const statement of capacitorStatements(sql)) {
      this.db.exec(statement);
    }
  }
  async run(sql: string, params: readonly unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as unknown as SQLInputValue[]));
  }
  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as unknown as SQLInputValue[])) as T[];
  }
  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...(params as unknown as SQLInputValue[])) as T | undefined;
  }
  async close(): Promise<void> {
    this.db.close();
  }
}

describe('Capacitor statement split', () => {
  it('never yields an empty statement, which the plugin cannot execute', () => {
    // A comment line ending in ";" splits the file inside a comment block; the
    // comment-only chunk strips down to nothing, and execSQL(";") prepares no
    // statement at all -- SQLITE_MISUSE, "not an error (code 0)".
    for (const migration of MIGRATIONS) {
      for (const statement of capacitorStatements(migration)) {
        expect(statement.replace(/;\s*$/, '').trim()).not.toBe('');
      }
    }
  });

  it('applies the schema through the split and seeds the abilities', async () => {
    const port = new CapacitorSplitPort();
    await port.open();
    await runMigrations(port, MIGRATIONS);

    const row = await port.get<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(1);
    expect(await listAbilities(port)).toHaveLength(6);
    await port.close();
  });

  it('keeps each trigger in one piece', () => {
    const statements = capacitorStatements(MIGRATIONS[0]);
    const triggers = statements.filter((s) => s.startsWith('CREATE TRIGGER'));
    expect(triggers).toHaveLength(2);
    for (const trigger of triggers) {
      expect(trigger).toContain(' BEGIN ');
      expect(trigger.endsWith('END;')).toBe(true);
    }
  });
});
