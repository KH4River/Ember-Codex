import { NodeSqlitePort } from '@/testing/node-sqlite.port';
import { runMigrations } from '@/db/migrate';
import { MIGRATIONS } from '@/db/migrations.generated';
import { exportPack } from '@/packs/exportPack';
import { FIXTURE_SQL, packFixture } from '@/testing/pack-fixture';

describe('exporting a pack', () => {
  let port: NodeSqlitePort;

  beforeEach(async () => {
    port = new NodeSqlitePort();
    await port.open();
    await runMigrations(port, MIGRATIONS);
    await port.exec(FIXTURE_SQL);
  });

  afterEach(async () => {
    await port.close();
  });

  it('gives back the pack it was pointed at', async () => {
    const exported = JSON.parse(await exportPack(port, 'my-homebrew'));
    expect(exported).toEqual(packFixture);
  });

  it('writes the same bytes every time', async () => {
    expect(await exportPack(port, 'my-homebrew')).toBe(await exportPack(port, 'my-homebrew'));
  });

  it('names the pack it cannot find', async () => {
    await expect(exportPack(port, 'srd-9')).rejects.toThrow('no pack named "srd-9" is installed');
  });
});
