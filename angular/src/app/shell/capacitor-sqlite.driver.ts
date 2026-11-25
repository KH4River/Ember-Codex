import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';

import type { DatabasePort } from '@/db/DatabasePort';

const DATABASE = 'dnd';
const READ_ONLY = false;

/**
 * Mobile adapter: the Capacitor SQLite plugin over native SQLite. The browser is
 * not a target, so open() refuses there rather than failing obscurely. open() is
 * idempotent, and the service imports this module lazily to keep the plugin out
 * of the initial bundle.
 */
export class CapacitorSqliteDriver implements DatabasePort {
  private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
  private connection?: SQLiteDBConnection;
  private inTransaction = false;

  async open(): Promise<void> {
    if (this.connection) {
      return;
    }

    if (!Capacitor.isNativePlatform()) {
      throw new Error(
        'The database needs a native shell. Run the app through Electron or on a device; the browser is not a target.',
      );
    }

    const consistent = (await this.sqlite.checkConnectionsConsistency()).result ?? false;
    const exists = (await this.sqlite.isConnection(DATABASE, READ_ONLY)).result ?? false;
    this.connection =
      consistent && exists
        ? await this.sqlite.retrieveConnection(DATABASE, READ_ONLY)
        : await this.sqlite.createConnection(DATABASE, false, 'no-encryption', 1, READ_ONLY);

    await this.connection.open();
    // Per connection. SQLite ignores every FOREIGN KEY without it. Pass
    // transaction=false because the plugin wraps execute() in its own
    // transaction by default, and the pragma is a NO-OP inside one.
    await this.connection.execute('PRAGMA foreign_keys = ON', false);
  }

  async exec(sql: string): Promise<void> {
    if (await this.transaction(sql)) {
      return;
    }
    // transaction=false: the migration runner and importer issue their own
    // BEGIN/COMMIT, and the plugin's implicit transaction would collide.
    await this.requireConnection().execute(sql, false);
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<void> {
    // The plugin wraps every statement in its own transaction by default, and
    // Android refuses to nest one inside an explicit BEGIN.
    await this.requireConnection().run(sql, [...params], !this.inTransaction);
  }

  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.requireConnection().query(sql, [...params]);
    return (result.values ?? []) as T[];
  }

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
    const rows = await this.all<T>(sql, params);
    return rows[0];
  }

  async close(): Promise<void> {
    if (!this.connection) {
      return;
    }
    await this.sqlite.closeConnection(DATABASE, READ_ONLY);
    this.connection = undefined;
    this.inTransaction = false;
  }

  /** The plugin exposes transaction control as calls, not SQL, and Android
   *  tracks a raw BEGIN either way. Route the three statements through them. */
  private async transaction(sql: string): Promise<boolean> {
    const command = sql.trim().toUpperCase();
    if (command === 'BEGIN') {
      await this.requireConnection().beginTransaction();
      this.inTransaction = true;
      return true;
    }
    if (command === 'COMMIT') {
      await this.requireConnection().commitTransaction();
      this.inTransaction = false;
      return true;
    }
    if (command === 'ROLLBACK') {
      await this.requireConnection().rollbackTransaction();
      this.inTransaction = false;
      return true;
    }
    return false;
  }

  private requireConnection(): SQLiteDBConnection {
    if (!this.connection) {
      throw new Error('database not open; call open() first');
    }
    return this.connection;
  }
}
