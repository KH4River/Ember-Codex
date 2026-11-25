import { beforeEach, describe, expect, it, vi } from 'vitest';

const connection = vi.hoisted(() => ({
  open: vi.fn(),
  execute: vi.fn(),
  run: vi.fn(),
  query: vi.fn(),
  beginTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class {
    async checkConnectionsConsistency() {
      return { result: true };
    }
    async isConnection() {
      return { result: true };
    }
    async retrieveConnection() {
      return connection;
    }
    async closeConnection() {
      return;
    }
  },
}));

import { CapacitorSqliteDriver } from './capacitor-sqlite.driver';

/**
 * The plugin wraps each statement in its own transaction and Android refuses
 * to nest one inside an explicit BEGIN, so the driver must turn that wrapping
 * off for the statement inside a port transaction.
 */
describe('CapacitorSqliteDriver transactions', () => {
  let driver: CapacitorSqliteDriver;

  beforeEach(async () => {
    vi.clearAllMocks();
    driver = new CapacitorSqliteDriver();
    await driver.open();
  });

  it('routes BEGIN and COMMIT to the plugin, and does not nest the statement', async () => {
    await driver.exec('BEGIN');
    await driver.run('INSERT INTO t VALUES (?)', [1]);
    await driver.exec('COMMIT');

    expect(connection.beginTransaction).toHaveBeenCalled();
    expect(connection.run).toHaveBeenCalledWith('INSERT INTO t VALUES (?)', [1], false);
    expect(connection.commitTransaction).toHaveBeenCalled();
  });

  it('routes ROLLBACK to the plugin', async () => {
    await driver.exec('BEGIN');
    await driver.exec('ROLLBACK');

    expect(connection.rollbackTransaction).toHaveBeenCalled();
  });

  it('leaves a statement outside a transaction to the plugin', async () => {
    await driver.run('DELETE FROM t');

    expect(connection.run).toHaveBeenCalledWith('DELETE FROM t', [], true);
  });
});
