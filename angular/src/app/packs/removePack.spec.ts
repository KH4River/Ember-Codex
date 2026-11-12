import { NodeSqlitePort } from '@/testing/node-sqlite.port';
import { runMigrations } from '@/db/migrate';
import { MIGRATIONS } from '@/db/migrations.generated';
import type { PackFile } from '@/models/ContentPack';
import { importPack } from '@/packs/importPack';
import { removePack } from '@/packs/removePack';
import { SRD_SQL, packFixture } from '@/testing/pack-fixture';

/** Removing a pack is a cascade, but only once the character tables have been
 *  asked: RESTRICT alone names no character, so the blockers come from the
 *  usage table and the delete is the second line of defence. */
describe('removing a pack', () => {
  let port: NodeSqlitePort;

  const anEnvelope = (key = 'my-homebrew'): PackFile => ({
    format: 'ember-codex.pack',
    formatVersion: 1,
    source: {
      key,
      name: 'My Homebrew',
      version: '1.0.0',
      license: null,
      attribution: null,
    },
  });

  const itemPack = (): PackFile => ({
    ...anEnvelope(),
    species: [{ key: 'elf', name: 'Elf', size: 'medium', speed: 30 }],
    backgrounds: [{ key: 'wayfarer', name: 'Wayfarer', abilities: ['CON', 'DEX', 'WIS'] }],
    items: [
      {
        key: 'ember-dagger',
        name: 'Ember Dagger',
        weight: 1,
        costCp: 500,
        requiresAttunement: false,
      },
    ],
  });

  const rowCount = async (table: string): Promise<number> =>
    (await port.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}"`))!.n;

  /** The minimum a character needs, so a test can point one table at the
   *  content that is about to go. */
  const addCharacter = async (): Promise<number> => {
    const species = await port.get<{ id: number }>('SELECT id FROM species WHERE slug = ?', [
      'elf',
    ]);
    const background = await port.get<{ id: number }>('SELECT id FROM background WHERE slug = ?', [
      'wayfarer',
    ]);
    await port.run(
      `INSERT INTO player_character (uuid, name, species_id, background_id, hp_max, hp_current)
       VALUES (?, ?, ?, ?, 10, 10)`,
      ['00000000-0000-0000-0000-000000000001', 'Thia', species!.id, background!.id],
    );
    return (await port.get<{ id: number }>('SELECT id FROM player_character WHERE name = ?', [
      'Thia',
    ]))!.id;
  };

  beforeEach(async () => {
    port = new NodeSqlitePort();
    await port.open();
    await runMigrations(port, MIGRATIONS);
    await port.exec(SRD_SQL);
  });

  afterEach(async () => {
    await port.close();
  });

  it('deletes an unused pack and cascades its content', async () => {
    await importPack(port, packFixture);

    expect(await removePack(port, 'my-homebrew')).toEqual({ removed: true });
    expect(await rowCount('source')).toBe(1);
    expect(await rowCount('species')).toBe(0);
    expect(await rowCount('class')).toBe(0);
  });

  it('refuses a pack a character is using and names the character', async () => {
    await importPack(port, itemPack());
    const characterId = await addCharacter();
    const item = await port.get<{ id: number }>('SELECT id FROM item WHERE slug = ?', [
      'ember-dagger',
    ]);
    await port.run('INSERT INTO character_item (character_id, item_id) VALUES (?, ?)', [
      characterId,
      item!.id,
    ]);

    expect(await removePack(port, 'my-homebrew')).toEqual({
      removed: false,
      blockers: [
        'cannot remove pack "my-homebrew": species "elf" is used by character "Thia" (player_character)',
        'cannot remove pack "my-homebrew": background "wayfarer" is used by character "Thia" (player_character)',
        'cannot remove pack "my-homebrew": item "ember-dagger" is used by character "Thia" (character_item)',
      ],
    });
    expect(await rowCount('source')).toBe(2);
    expect(await rowCount('item')).toBe(1);
  });

  it('throws for a slug that is not installed', async () => {
    await expect(removePack(port, 'nope')).rejects.toThrow(
      'no pack named "nope" is installed',
    );
  });

  it('clears the predecessor pointer when the successor is removed', async () => {
    await importPack(port, packFixture);
    await importPack(port, packFixture, { mode: 'keep-both', newSlug: 'my-homebrew-2' });

    expect(await removePack(port, 'my-homebrew-2')).toEqual({ removed: true });
    expect(
      await port.get<{ superseded_by: number | null }>(
        'SELECT superseded_by FROM source WHERE slug = ?',
        ['my-homebrew'],
      ),
    ).toEqual({ superseded_by: null });
  });
});
