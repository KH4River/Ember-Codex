import { app, dialog, ipcMain } from 'electron';
import { basename, join } from 'node:path';
import type { SQLInputValue } from 'node:sqlite';

import type { GameDatabase } from './database';
import { readPackFile, writePackFile } from './files';

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

function assertPackText(contents: unknown): asserts contents is string {
  if (typeof contents !== 'string') {
    throw new TypeError('pack: contents must be a string');
  }
}

/** The renderer derives the name from the slug, so a path separator must not
 *  reach the save dialog. */
function assertPackName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+\.json$/.test(name)) {
    throw new TypeError('pack: the file name must be <key>.json');
  }
}

const PACK_FILTERS = [{ name: 'Pack files', extensions: ['json'] }];

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

/** Pack files are read and written here, so the renderer never sees a path. */
export function registerPackIpc(): void {
  ipcMain.handle('pack:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: PACK_FILTERS,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const path = result.filePaths[0];
    return { name: basename(path), contents: readPackFile(path) };
  });

  ipcMain.handle('pack:save', async (_event, contents: unknown, suggestedName: unknown) => {
    assertPackText(contents);
    assertPackName(suggestedName);
    const result = await dialog.showSaveDialog({
      defaultPath: join(app.getPath('documents'), suggestedName),
      filters: PACK_FILTERS,
    });
    if (result.canceled || !result.filePath) {
      return false;
    }
    writePackFile(result.filePath, contents);
    return true;
  });
}
