import { app, dialog, ipcMain } from 'electron';
import { basename, join } from 'node:path';

import type { DatabaseApi } from '../shared/api/DatabaseApi';
import type { ImportTextOptions } from '../shared/packs/importPackText';

import { readPackFile, writePackFile } from './files';

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

function assertSlug(slug: unknown): asserts slug is string {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new TypeError('database: the pack slug must be a non-empty string');
  }
}

function assertImportOptions(options: unknown): asserts options is ImportTextOptions | undefined {
  if (options === undefined) {
    return;
  }
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('database: import options must be an object');
  }
  const mode = (options as { mode?: unknown }).mode;
  if (mode !== undefined && mode !== 'replace' && mode !== 'keep-both') {
    throw new TypeError('database: import mode must be replace or keep-both');
  }
  const newSlug = (options as { newSlug?: unknown }).newSlug;
  if (newSlug !== undefined && typeof newSlug !== 'string') {
    throw new TypeError('database: newSlug must be a string');
  }
}

const PACK_FILTERS = [{ name: 'Pack files', extensions: ['json'] }];

/**
 * The renderer sees these operations only. The SQL and the schema stay in this
 * process; no raw statement crosses the bridge, and the payloads are still
 * validated because a renderer can call the preload API directly.
 */
export function registerDatabaseIpc(api: DatabaseApi): void {
  ipcMain.handle('database:list-abilities', () => api.listAbilities());
  ipcMain.handle('database:list-packs', () => api.listPacks());
  ipcMain.handle('database:import-pack', (_event, contents: unknown, options: unknown) => {
    assertPackText(contents);
    assertImportOptions(options);
    return api.importPack(contents, options);
  });
  ipcMain.handle('database:export-pack', (_event, slug: unknown) => {
    assertSlug(slug);
    return api.exportPack(slug);
  });
  ipcMain.handle('database:remove-pack', (_event, slug: unknown) => {
    assertSlug(slug);
    return api.removePack(slug);
  });
  ipcMain.handle('database:sqlite-version', () => api.sqliteVersion());
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
