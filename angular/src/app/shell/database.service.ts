import { Injectable } from '@angular/core';

import type { DatabaseApi, PackImportResult } from '@/api/DatabaseApi';
import type { Ability } from '@/models/Ability';
import type { PackSummary } from '@/models/PackSummary';
import type { ImportTextOptions } from '@/packs/importPackText';
import type { PackRemoval } from '@/packs/removePack';

/**
 * The renderer's typed database client. Desktop answers through the preload;
 * mobile answers through a worker that owns shared/db, so the UI thread never
 * loads the data layer.
 */
@Injectable({ providedIn: 'root' })
export class DatabaseService implements DatabaseApi {
  private api?: Promise<DatabaseApi>;

  listAbilities(): Promise<Ability[]> {
    return this.call((api) => api.listAbilities());
  }

  listPacks(): Promise<PackSummary[]> {
    return this.call((api) => api.listPacks());
  }

  importPack(contents: string, options?: ImportTextOptions): Promise<PackImportResult> {
    return this.call((api) => api.importPack(contents, options));
  }

  exportPack(slug: string): Promise<string> {
    return this.call((api) => api.exportPack(slug));
  }

  removePack(slug: string): Promise<PackRemoval> {
    return this.call((api) => api.removePack(slug));
  }

  sqliteVersion(): Promise<string> {
    return this.call((api) => api.sqliteVersion());
  }

  private async call<T>(work: (api: DatabaseApi) => Promise<T>): Promise<T> {
    return work(await this.client());
  }

  private client(): Promise<DatabaseApi> {
    this.api ??= this.createClient();
    return this.api;
  }

  private async createClient(): Promise<DatabaseApi> {
    const desktop = window.electronAPI?.database;
    if (desktop !== undefined) {
      return desktop;
    }
    const { WorkerDatabaseClient } = await import('./database.worker.client');
    return WorkerDatabaseClient.create();
  }
}
