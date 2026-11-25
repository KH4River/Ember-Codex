import type { SQLInputValue } from 'node:sqlite';

import type { DatabasePort } from '../shared/db/DatabasePort';
import type { GameDatabase } from './database';

/** node:sqlite is synchronous; the shared data layer is async because Capacitor
 *  is. This adapter is the only place main casts between the two. */
export class ElectronDatabasePort implements DatabasePort {
  constructor(private readonly db: GameDatabase) {}

  async open(): Promise<void> {
    // GameDatabase opens in its constructor.
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<void> {
    this.db.run(sql, params as SQLInputValue[]);
  }

  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.db.all(sql, params as SQLInputValue[]) as T[];
  }

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
    return this.db.get(sql, params as SQLInputValue[]) as T | undefined;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
