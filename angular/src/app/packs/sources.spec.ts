import { NodeSqlitePort } from '@/testing/node-sqlite.port';
import { runMigrations } from '@/db/migrate';
import { MIGRATIONS } from '@/db/migrations.generated';
import { getPack, listPacks } from '@/db/repositories/sources';
import { importPack } from '@/packs/importPack';
import { SRD_SQL, packFixture } from '@/testing/pack-fixture';

/** The list is the pack table as a user sees it: the successor pointer is the
 *  only thing the source table holds that a row has to explain. */
describe('pack sources', () => {
  let port: NodeSqlitePort;

  beforeEach(async () => {
    port = new NodeSqlitePort();
    await port.open();
    await runMigrations(port, MIGRATIONS);
    await port.exec(SRD_SQL);
  });

  afterEach(async () => {
    await port.close();
  });

  it('lists every installed pack ordered by slug', async () => {
    await importPack(port, packFixture);

    expect(await listPacks(port)).toEqual([
      {
        slug: 'my-homebrew',
        name: 'My Homebrew',
        version: '1.0.0',
        importedAt: expect.any(String),
        supersededBy: null,
      },
      {
        slug: 'srd-lite',
        name: 'SRD Lite',
        version: '1.0',
        importedAt: expect.any(String),
        supersededBy: null,
      },
    ]);
  });

  it('reports the successor slug after keeping both versions', async () => {
    await importPack(port, packFixture);
    await importPack(port, packFixture, { mode: 'keep-both', newSlug: 'my-homebrew-2' });

    const packs = await listPacks(port);
    expect(packs.map((pack) => [pack.slug, pack.supersededBy])).toEqual([
      ['my-homebrew', 'my-homebrew-2'],
      ['my-homebrew-2', null],
      ['srd-lite', null],
    ]);
    expect(await getPack(port, 'my-homebrew-2')).toMatchObject({
      name: 'My Homebrew',
      supersededBy: null,
    });
  });
});
