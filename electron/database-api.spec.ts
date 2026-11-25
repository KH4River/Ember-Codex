import { MainDatabaseApi } from './database-api';

import { openDatabase } from '../shared/db/openDatabase';
import { NodeSqlitePort } from '../shared/testing/node-sqlite.port';

/** The desktop API is the boundary the renderer sees: typed operations over
 *  shared repositories, with refusals mapped to data instead of thrown classes. */
describe('MainDatabaseApi', () => {
  let port: NodeSqlitePort;
  let api: MainDatabaseApi;

  const aPack = JSON.stringify({
    format: 'ember-codex.pack',
    formatVersion: 1,
    source: {
      key: 'my-homebrew',
      name: 'My Homebrew',
      version: '1.0.0',
      license: null,
      attribution: null,
    },
  });

  beforeEach(async () => {
    port = new NodeSqlitePort();
    await openDatabase(port);
    api = new MainDatabaseApi(port);
  });

  afterEach(async () => {
    await port.close();
  });

  it('lists the seeded abilities', async () => {
    expect(await api.listAbilities()).toHaveLength(6);
  });

  it('imports a pack and lets the list read it back', async () => {
    expect((await api.importPack(aPack)).status).toBe('ok');

    expect(await api.listPacks()).toEqual([
      {
        slug: 'my-homebrew',
        name: 'My Homebrew',
        version: '1.0.0',
        importedAt: expect.any(String),
        supersededBy: null,
      },
    ]);
  });

  it('returns validation problems instead of throwing', async () => {
    const result = await api.importPack('{');

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.problems[0]).toContain('valid JSON');
    }
  });

  it('exports the imported pack as text', async () => {
    await api.importPack(aPack);

    expect(await api.exportPack('my-homebrew')).toContain('ember-codex.pack');
  });

  it('removes an unused pack', async () => {
    await api.importPack(aPack);

    expect(await api.removePack('my-homebrew')).toEqual({ removed: true });
  });

  it('reports the engine version', async () => {
    expect(await api.sqliteVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
