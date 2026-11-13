import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { DatabasePort } from '../db/DatabasePort';

/**
 * A DatabasePort backed by an in-memory node:sqlite database. Test-only, and
 * outside angular/src because the app build compiles every .ts under src with
 * "types": [], so a file importing node:sqlite cannot sit there. Specs get the
 * same DatabasePort the app runs, with a different engine underneath.
 */
export class NodeSqlitePort implements DatabasePort {
  private readonly db = new DatabaseSync(':memory:');
  private readonly bind = (params: readonly unknown[]) => params as unknown as SQLInputValue[];

  async open(): Promise<void> {
    // Per connection. The runner repeats it before the first transaction,
    // which is the point where SQLite will still honour it.
    this.db.exec('PRAGMA foreign_keys = ON');
  }
  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }
  async run(sql: string, params: readonly unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...this.bind(params));
  }
  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...this.bind(params)) as T[];
  }
  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...this.bind(params)) as T | undefined;
  }
  async close(): Promise<void> {
    this.db.close();
  }
}