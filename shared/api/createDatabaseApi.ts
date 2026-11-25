import type { DatabasePort } from '../db/DatabasePort';
import { listAbilities } from '../db/repositories/abilities';
import { listPacks } from '../db/repositories/sources';
import { sqliteVersion } from '../db/sqliteVersion';
import { exportPack } from '../packs/exportPack';
import { importPackResult } from '../packs/importPackResult';
import { removePack } from '../packs/removePack';

import type { DatabaseApi } from './DatabaseApi';

/** The one implementation of the renderer contract. Electron main and the
 *  mobile worker both call it with their own DatabasePort, so the behaviour is
 *  the same on both shells. */
export function createDatabaseApi(port: () => Promise<DatabasePort>): DatabaseApi {
  return {
    async listAbilities() {
      return listAbilities(await port());
    },

    async listPacks() {
      return listPacks(await port());
    },

    async importPack(contents, options) {
      return importPackResult(await port(), contents, options);
    },

    async exportPack(slug) {
      return exportPack(await port(), slug);
    },

    async removePack(slug) {
      return removePack(await port(), slug);
    },

    async sqliteVersion() {
      return sqliteVersion(await port());
    },
  };
}
