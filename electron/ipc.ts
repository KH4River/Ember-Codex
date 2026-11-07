import { ipcMain } from 'electron';
import type { SQLInputValue } from 'node:sqlite';

import type { GameDatabase } from './database';

function assertSql(sql: unknown): asserts sql is string {
  if (typeof sql !== 'string') {
    throw new TypeError('db: sql must be a string');
  }
}

function assertParams(params: unknown): asserts params is SQLInputValue[] {
  if (!Array.isArray(params)) {
    throw new TypeError('db: params must be an array');
  }
}

/**
 * Exposes the database to the renderer as SQL primitives. Raw SQL over IPC is
 * safe only because statements originate in shared/db/repositories and the
 * renderer runs with contextIsolation on; payloads are still validated.
 */
export function registerDatabaseIpc(db: GameDatabase): void {
  ipcMain.handle('db:version', () => db.sqliteVersion());
  ipcMain.handle('db:exec', (_event, sql: unknown) => {
    assertSql(sql);
    db.exec(sql);
  });
  ipcMain.handle('db:run', (_event, sql: unknown, params: unknown = []) => {
    assertSql(sql);
    assertParams(params);
    db.run(sql, params);
  });
  ipcMain.handle('db:all', (_event, sql: unknown, params: unknown = []) => {
    assertSql(sql);
    assertParams(params);
    return db.all(sql, params);
  });
  ipcMain.handle('db:get', (_event, sql: unknown, params: unknown = []) => {
    assertSql(sql);
    assertParams(params);
    return db.get(sql, params);
  });
}
