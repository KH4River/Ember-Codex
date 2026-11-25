import type { DatabaseApi, PackImportResult } from '../shared/api/DatabaseApi';
import { createDatabaseApi } from '../shared/api/createDatabaseApi';
import type { DatabasePort } from '../shared/db/DatabasePort';
import type { Ability } from '../shared/models/Ability';
import type { PackSummary } from '../shared/models/PackSummary';
import type { ImportTextOptions } from '../shared/packs/importPackText';
import type { PackRemoval } from '../shared/packs/removePack';

/** The desktop implementation of the renderer contract. It runs in main, so
 *  no SQL, port or migration ever crosses into the webview. */
export class MainDatabaseApi implements DatabaseApi {
  private readonly api: DatabaseApi;

  constructor(port: DatabasePort) {
    this.api = createDatabaseApi(async () => port);
  }

  listAbilities(): Promise<Ability[]> {
    return this.api.listAbilities();
  }

  listPacks(): Promise<PackSummary[]> {
    return this.api.listPacks();
  }

  importPack(contents: string, options?: ImportTextOptions): Promise<PackImportResult> {
    return this.api.importPack(contents, options);
  }

  exportPack(slug: string): Promise<string> {
    return this.api.exportPack(slug);
  }

  removePack(slug: string): Promise<PackRemoval> {
    return this.api.removePack(slug);
  }

  sqliteVersion(): Promise<string> {
    return this.api.sqliteVersion();
  }
}
