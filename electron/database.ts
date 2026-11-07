import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/**
 * The desktop database, owned by the Electron main process. It knows nothing
 * about the schema: the renderer owns migrations and repositories and drives them
 * through these primitives over IPC. Only our own SQL crosses the boundary, and
 * this module runs under plain Node for direct unit tests.
 */
export class GameDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    // Every connection must issue this. SQLite ignores every FOREIGN KEY
    // without it, and the pragma is a no-op inside a transaction, so it cannot
    // live in the migration file.
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  sqliteVersion(): string {
    return (this.db.prepare('SELECT sqlite_version() AS version').get() as { version: string }).version;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: SQLInputValue[] = []): void {
    this.db.prepare(sql).run(...params);
  }

  all(sql: string, params: SQLInputValue[] = []): unknown[] {
    return this.db.prepare(sql).all(...params);
  }

  get(sql: string, params: SQLInputValue[] = []): unknown {
    return this.db.prepare(sql).get(...params);
  }

  close(): void {
    this.db.close();
  }
}
