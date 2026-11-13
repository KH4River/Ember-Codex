import { Injectable } from '@angular/core';

import type { DatabasePort } from '@/db/DatabasePort';
import { runMigrations } from '@/db/migrate';
import { MIGRATIONS } from '@/db/migrations.generated';
import { listAbilities, type Ability } from '@/db/repositories/abilities';

import { ElectronIpcDriver } from './electron-ipc.driver';

/**
 * The renderer's entry point to the database: pick a DatabasePort, open it once
 * and run the migrations. Business SQL lives in shared/db/repositories, so a
 * feature service takes port() and calls them; sqliteVersion() is the one
 * diagnostic that issues its own. initialize() is idempotent, so the app
 * initializer and components can both call it.
 */
@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private connection?: DatabasePort;
  private ready?: Promise<void>;

  initialize(): Promise<void> {
    this.ready ??= this.open();
    return this.ready;
  }

  /** The open connection, for anything that composes repositories. */
  async port(): Promise<DatabasePort> {
    await this.initialize();
    return this.connection!;
  }

  async abilities(): Promise<Ability[]> {
    return listAbilities(await this.port());
  }

  async sqliteVersion(): Promise<string> {
    const port = await this.port();
    const row = await port.get<{ version: string }>('SELECT sqlite_version() AS version');
    return row?.version ?? 'unknown';
  }

  private async open(): Promise<void> {
    const port = await DatabaseService.createPort();
    await port.open();
    await runMigrations(port, MIGRATIONS);
    this.connection = port;
  }

  private static async createPort(): Promise<DatabasePort> {
    // Desktop: Electron's preload exposes the main-process database.
    const electronDb = window.electronAPI?.db;
    if (electronDb) {
      return new ElectronIpcDriver(electronDb);
    }
    // Mobile and web: Capacitor, imported lazily so the plugin and its web
    // dependency stay out of the initial bundle.
    const { CapacitorSqliteDriver } = await import('./capacitor-sqlite.driver');
    return new CapacitorSqliteDriver();
  }
}
