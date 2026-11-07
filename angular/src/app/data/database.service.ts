import { Injectable } from '@angular/core';

import type { DatabasePort } from '@/db/DatabasePort';
import { runMigrations } from '@/db/migrate';
import { MIGRATIONS } from '@/db/migrations.generated';
import { listAbilities, type Ability } from '@/db/repositories/abilities';

import { ElectronIpcDriver } from './electron-ipc.driver';

/**
 * The renderer's entry point to the database: pick a DatabasePort, migrate once,
 * and expose typed reads. SQL lives in shared/db/repositories; this class writes
 * none. initialize() is idempotent, so the app initializer and components can
 * both call it.
 */
@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private port?: DatabasePort;
  private ready?: Promise<void>;

  initialize(): Promise<void> {
    this.ready ??= this.open();
    return this.ready;
  }

  async abilities(): Promise<Ability[]> {
    const port = await this.connectedPort();
    return listAbilities(port);
  }

  async sqliteVersion(): Promise<string> {
    const port = await this.connectedPort();
    const row = await port.get<{ version: string }>('SELECT sqlite_version() AS version');
    return row?.version ?? 'unknown';
  }

  private async connectedPort(): Promise<DatabasePort> {
    await this.initialize();
    return this.port!;
  }

  private async open(): Promise<void> {
    const port = await DatabaseService.createPort();
    await port.open();
    await runMigrations(port, MIGRATIONS);
    this.port = port;
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
