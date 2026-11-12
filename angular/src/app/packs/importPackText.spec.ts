import { NodeSqlitePort } from '@/testing/node-sqlite.port';
import { runMigrations } from '@/db/migrate';
import { MIGRATIONS } from '@/db/migrations.generated';
import type { PackFile } from '@/models/ContentPack';
import { importPackText } from '@/packs/importPackText';
import { PackValidationError } from '@/packs/validatePack';

/** Text in, one of two outcomes out. The installed-key case is the reason this
 *  layer exists: the caller must not have to parse the file to find out. */
describe('importing pack text', () => {
  let port: NodeSqlitePort;

  const aPack = (version: string, name: string): PackFile => ({
    format: 'ember-codex.pack',
    formatVersion: 1,
    source: {
      key: 'my-homebrew',
      name,
      version,
      license: null,
      attribution: null,
    },
    skills: [{ key: 'skyriding', name: 'Skyriding', ability: 'DEX' }],
  });

  const sourceCount = async (): Promise<number> =>
    (await port.get<{ n: number }>('SELECT COUNT(*) AS n FROM source'))!.n;

  beforeEach(async () => {
    port = new NodeSqlitePort();
    await port.open();
    await runMigrations(port, MIGRATIONS);
  });

  afterEach(async () => {
    await port.close();
  });

  it('imports text for a key that is not installed', async () => {
    const outcome = await importPackText(port, JSON.stringify(aPack('1.0.0', 'My Homebrew')));

    if (outcome.status !== 'imported') {
      throw new Error(`expected an import, got ${outcome.status}`);
    }
    expect(outcome.file.source.key).toBe('my-homebrew');
    expect(outcome.result.sourceSlug).toBe('my-homebrew');
    expect(await sourceCount()).toBe(1);
  });

  it('reports an installed key as needs-mode and writes nothing', async () => {
    await importPackText(port, JSON.stringify(aPack('1.0.0', 'My Homebrew')));

    const outcome = await importPackText(
      port,
      JSON.stringify(aPack('2.0.0', 'My Homebrew Revised')),
    );

    if (outcome.status !== 'needs-mode') {
      throw new Error(`expected a mode question, got ${outcome.status}`);
    }
    expect(outcome.installed).toMatchObject({
      slug: 'my-homebrew',
      name: 'My Homebrew',
      version: '1.0.0',
    });
    expect(outcome.contents).toContain('My Homebrew Revised');
    expect(
      await port.get<{ name: string; version: string }>(
        'SELECT name, version FROM source WHERE slug = ?',
        ['my-homebrew'],
      ),
    ).toEqual({ name: 'My Homebrew', version: '1.0.0' });
  });

  it('rejects malformed text as a validation problem and touches nothing', async () => {
    let thrown: unknown;
    try {
      await importPackText(port, '{"format":');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PackValidationError);
    expect((thrown as PackValidationError).problems[0]).toContain('valid JSON');
    expect(await sourceCount()).toBe(0);
  });
});
