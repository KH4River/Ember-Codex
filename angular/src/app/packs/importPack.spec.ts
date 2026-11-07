import { NodeSqlitePort } from '@/testing/node-sqlite.port';
import { runMigrations } from '@/db/migrate';
import { MIGRATIONS } from '@/db/migrations.generated';
import { exportPack } from '@/packs/exportPack';
import { importPack, PackImportError } from '@/packs/importPack';
import { PackValidationError } from '@/packs/validatePack';
import { SRD_SQL, packFixture } from '@/testing/pack-fixture';
import type { PackFeat, PackFile, PackSpell } from '@/models/ContentPack';

/** The pack format is the round trip: import a file, export it, get the same
 *  file back. The other tests pin the cases the round trip cannot show. */
describe('importing a pack', () => {
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

  const aSpell = (overrides: Partial<PackSpell> = {}): PackSpell => ({
    key: 'searing-smite',
    name: 'Searing Smite',
    spellLevel: 1,
    school: 'evocation',
    castingTime: '1 action',
    spellRange: 'Self',
    duration: '1 round',
    concentration: false,
    ritual: false,
    verbal: true,
    somatic: false,
    material: false,
    materialCostCp: 0,
    ...overrides,
  });

  const speciesAndBackground = (speed: number): PackFile => ({
    ...anEnvelope(),
    species: [{ key: 'elf', name: 'Elf', size: 'medium', speed }],
    backgrounds: [{ key: 'wayfarer', name: 'Wayfarer', abilities: ['CON', 'DEX', 'WIS'] }],
  });

  const alertFeat: PackFeat = {
    key: 'alert',
    name: 'Alert',
    description: 'x',
    category: 'general',
  };

  const featPack = (version: string, withFeat: boolean): PackFile => ({
    ...speciesAndBackground(30),
    source: { ...anEnvelope().source, version },
    feats: withFeat ? [alertFeat] : [],
    backgrounds: [
      {
        key: 'wayfarer',
        name: 'Wayfarer',
        abilities: ['CON', 'DEX', 'WIS'],
        originFeats: withFeat ? ['alert'] : [],
      },
    ],
  });

  const rowCount = async (table: string): Promise<number> =>
    (await port.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}"`))!.n;

  /** The minimum a character needs, so a test can then point one table at the
   *  content it is about to remove. */
  const addCharacter = async (name = 'Thia'): Promise<number> => {
    const species = await port.get<{ id: number }>('SELECT id FROM species WHERE slug = ?', ['elf']);
    const background = await port.get<{ id: number }>(
      'SELECT id FROM background WHERE slug = ?',
      ['wayfarer'],
    );
    await port.run(
      `INSERT INTO player_character (uuid, name, species_id, background_id, hp_max, hp_current)
       VALUES (?, ?, ?, ?, 10, 10)`,
      ['00000000-0000-0000-0000-000000000001', name, species!.id, background!.id],
    );
    return (await port.get<{ id: number }>('SELECT id FROM player_character WHERE name = ?', [name]))!
      .id;
  };

  const giveOriginFeat = async (characterId: number, slug: string): Promise<void> => {
    const feat = await port.get<{ id: number }>('SELECT id FROM feat WHERE slug = ?', [slug]);
    await port.run(
      `INSERT INTO character_origin_feat (character_id, feat_id, origin)
       VALUES (?, ?, 'background')`,
      [characterId, feat!.id],
    );
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

  it('gives back the file it imported', async () => {
    await importPack(port, packFixture);

    const exported = JSON.parse(await exportPack(port, 'my-homebrew'));
    expect(exported).toEqual(packFixture);
  });

  it('imports the same file twice without duplicating a row', async () => {
    await importPack(port, packFixture);
    await importPack(port, packFixture);

    expect(await rowCount('skill')).toBe(1);
    expect(await rowCount('species_variant')).toBe(1);
    expect(await rowCount('feature')).toBe(6);
    expect(await rowCount('effect')).toBe(6);
    expect(await rowCount('damage_modifier')).toBe(1);
  });

  describe('replace in place', () => {
    it('keeps a matched row id, so the character pointing at it needs no remapping', async () => {
      await importPack(port, speciesAndBackground(30));
      const characterId = await addCharacter();
      const before = await port.get<{ species_id: number }>(
        'SELECT species_id FROM player_character WHERE id = ?',
        [characterId],
      );
      const speciesId = before!.species_id;

      await importPack(port, speciesAndBackground(35));

      const after = await port.get<{ species_id: number; speed: number }>(
        `SELECT pc.species_id, s.speed
           FROM player_character pc JOIN species s ON s.id = pc.species_id
          WHERE pc.id = ?`,
        [characterId],
      );
      expect(after).toEqual({ species_id: speciesId, speed: 35 });
    });

    it('updates a pack-owned skill in place', async () => {
      const skillPack = (name: string): PackFile => ({
        ...anEnvelope(),
        skills: [{ key: 'skyriding', name, ability: 'DEX' }],
      });

      await importPack(port, skillPack('Skyriding'));
      const first = await port.get<{ id: number }>('SELECT id FROM skill WHERE slug = ?', [
        'skyriding',
      ]);

      await importPack(port, skillPack('Skyriding (revised)'));

      const second = await port.get<{ id: number; name: string }>(
        'SELECT id, name FROM skill WHERE slug = ?',
        ['skyriding'],
      );
      expect(second).toEqual({ id: first!.id, name: 'Skyriding (revised)' });
    });

    it('refuses to redefine a global vocabulary slug before writing anything', async () => {
      await expect(
        importPack(port, {
          ...anEnvelope(),
          conditions: [{ key: 'poisoned', name: 'Poisoned' }],
        }),
      ).rejects.toBeInstanceOf(PackValidationError);

      expect(await rowCount('source')).toBe(1); // only srd-lite
    });

    it('gives another pack its own row for the same slug', async () => {
      await importPack(port, {
        ...anEnvelope('my-homebrew'),
        skills: [{ key: 'skyriding', name: 'Mine', ability: 'DEX' }],
      });
      await importPack(port, {
        ...anEnvelope('other-pack'),
        skills: [{ key: 'skyriding', name: 'Theirs', ability: 'DEX' }],
      });

      const rows = await port.all<{ name: string }>(
        `SELECT name FROM skill WHERE slug = 'skyriding' ORDER BY name`,
      );
      expect(rows.map((row) => row.name)).toEqual(['Mine', 'Theirs']);
    });
  });

  describe('removed content', () => {
    it('refuses to remove a feat a character uses, and names both', async () => {
      await importPack(port, featPack('1.0.0', true));
      const characterId = await addCharacter();
      await giveOriginFeat(characterId, 'alert');

      await expect(importPack(port, featPack('2.0.0', false))).rejects.toThrow(
        /cannot replace: feat "alert".*character "Thia" \(character_origin_feat\)/,
      );
      expect(await rowCount('feat')).toBe(1);
    });

    it('rolls the whole replace back when a removal is blocked', async () => {
      await importPack(port, featPack('1.0.0', true));
      const characterId = await addCharacter();
      await giveOriginFeat(characterId, 'alert');

      await expect(importPack(port, featPack('2.0.0', false))).rejects.toBeInstanceOf(
        PackImportError,
      );
      const source = await port.get<{ version: string }>(
        'SELECT version FROM source WHERE slug = ?',
        ['my-homebrew'],
      );
      expect(source!.version).toBe('1.0.0');
    });

    it('refuses to remove a pack-owned condition a character has', async () => {
      const conditionPack = (withCondition: boolean): PackFile => ({
        ...speciesAndBackground(30),
        conditions: withCondition ? [{ key: 'marked', name: 'Marked' }] : [],
      });

      await importPack(port, conditionPack(true));
      const characterId = await addCharacter();
      const conditionId = (await port.get<{ id: number }>(
        'SELECT id FROM condition WHERE slug = ?',
        ['marked'],
      ))!.id;
      await port.run(
        'INSERT INTO character_condition (character_id, condition_id) VALUES (?, ?)',
        [characterId, conditionId],
      );

      await expect(importPack(port, conditionPack(false))).rejects.toThrow(
        /condition "marked".*character "Thia" \(character_condition\)/,
      );
      expect(await rowCount('condition')).toBeGreaterThan(0);
      expect(
        await port.get<{ id: number }>('SELECT id FROM condition WHERE slug = ?', ['marked']),
      ).toBeDefined();
    });
  });

  describe('keep both', () => {
    it('installs the new version under a new key and marks the old one superseded', async () => {
      await importPack(port, speciesAndBackground(30));
      const characterId = await addCharacter();
      const oldSpecies = (await port.get<{ species_id: number }>(
        'SELECT species_id FROM player_character WHERE id = ?',
        [characterId],
      ))!.species_id;

      await importPack(port, speciesAndBackground(35), {
        mode: 'keep-both',
        newSlug: 'my-homebrew-2',
      });

      const oldSource = await port.get<{ id: number; superseded_by: number | null }>(
        'SELECT id, superseded_by FROM source WHERE slug = ?',
        ['my-homebrew'],
      );
      const newSource = await port.get<{ id: number }>('SELECT id FROM source WHERE slug = ?', [
        'my-homebrew-2',
      ]);
      expect(oldSource!.superseded_by).toBe(newSource!.id);

      const character = await port.get<{ species_id: number }>(
        'SELECT species_id FROM player_character WHERE id = ?',
        [characterId],
      );
      expect(character!.species_id).toBe(oldSpecies);
      expect(
        await port.get<{ speed: number }>('SELECT speed FROM species WHERE id = ?', [oldSpecies]),
      ).toEqual({ speed: 30 });
      expect(
        await port.get<{ speed: number }>(
          `SELECT s.speed FROM species s
             JOIN source o ON o.id = s.source_id
            WHERE o.slug = 'my-homebrew-2'`,
        ),
      ).toEqual({ speed: 35 });
    });

    it('requires a new key rather than deriving one', async () => {
      await importPack(port, speciesAndBackground(30));
      await expect(
        importPack(port, speciesAndBackground(35), { mode: 'keep-both' }),
      ).rejects.toThrow(/choose a new key to keep both/);
    });
  });

  it('rolls back a pack whose last row breaks a CHECK', async () => {
    const bad: PackFile = {
      ...anEnvelope(),
      species: [{ key: 'elf', name: 'Elf', size: 'medium', speed: 30 }],
      spells: [aSpell({ school: 'not-a-school' as never })],
    };

    await expect(importPack(port, bad)).rejects.toBeInstanceOf(Error);

    expect(await port.get<{ n: number }>(`SELECT COUNT(*) AS n FROM source WHERE slug = 'my-homebrew'`)).toEqual({ n: 0 });
    expect(await rowCount('species')).toBe(0);
    const version = await port.get<{ user_version: number }>('PRAGMA user_version');
    expect(version!.user_version).toBe(1);
  });

  it('looks a damage modifier up instead of inserting a duplicate on re-import', async () => {
    const itemPack: PackFile = {
      ...anEnvelope(),
      items: [
        {
          key: 'ember-dagger',
          name: 'Ember Dagger',
          weight: 1,
          costCp: 500,
          requiresAttunement: false,
          damageModifiers: [{ damageType: 'fire', relation: 'resistant' }],
        },
      ],
    };

    await importPack(port, itemPack);
    await importPack(port, itemPack);

    expect(await rowCount('damage_modifier')).toBe(1);
  });

  it('links a weapon to ammunition that appears later in the file', async () => {
    const pack: PackFile = {
      ...anEnvelope(),
      items: [
        {
          key: 'shortbow',
          name: 'Shortbow',
          weight: 2,
          costCp: 25,
          requiresAttunement: false,
          weapon: {
            category: 'simple_ranged',
            damageDice: '1d6',
            damageType: 'piercing',
            masteryProperty: 'vex',
            ammunition: 'arrow',
          },
        },
        { key: 'arrow', name: 'Arrow', weight: 0.05, costCp: 1, requiresAttunement: false, ammunition: true },
      ],
    };

    await importPack(port, pack);

    const row = await port.get<{ ammunition_id: number | null }>(
      `SELECT w.ammunition_id
         FROM weapon w JOIN item i ON i.id = w.item_id
        WHERE i.slug = 'shortbow'`,
    );
    expect(row!.ammunition_id).not.toBeNull();
  });

  it('refuses a weapon that references an item which is not ammunition', async () => {
    const pack: PackFile = {
      ...anEnvelope(),
      items: [
        { key: 'rope', name: 'Rope', weight: 5, costCp: 1, requiresAttunement: false },
        {
          key: 'shortbow',
          name: 'Shortbow',
          weight: 2,
          costCp: 25,
          requiresAttunement: false,
          weapon: {
            category: 'simple_ranged',
            damageDice: '1d6',
            damageType: 'piercing',
            masteryProperty: 'vex',
            ammunition: 'rope',
          },
        },
      ],
    };

    await expect(importPack(port, pack)).rejects.toThrow(
      /weapon "shortbow" references "rope" but that item is not ammunition/,
    );
    expect(await rowCount('item')).toBe(0);
  });

  it('stores a weapon with no mastery property as NULL', async () => {
    const pack: PackFile = {
      ...anEnvelope(),
      items: [
        {
          key: 'plain-blade',
          name: 'Plain Blade',
          weight: 1,
          costCp: 100,
          requiresAttunement: false,
          weapon: {
            category: 'simple_melee',
            damageDice: '1d6',
            damageType: 'slashing',
          },
        },
      ],
    };

    await importPack(port, pack);

    const row = await port.get<{ mastery_property_id: number | null }>(
      `SELECT w.mastery_property_id
         FROM weapon w
         JOIN item i ON i.id = w.item_id
        WHERE i.slug = 'plain-blade'`,
    );
    expect(row).toEqual({ mastery_property_id: null });

    const exported = JSON.parse(await exportPack(port, 'my-homebrew'));
    expect(exported.items[0].weapon).not.toHaveProperty('masteryProperty');
  });

  it('round-trips the delivery and recharge values the schema allows', async () => {
    const pack: PackFile = {
      ...anEnvelope(),
      spells: [
        aSpell({
          key: 'beacon',
          name: 'Beacon',
          damageTypes: [{ damageType: 'radiant', selection: 'fixed', delivery: 'beam' }],
        }),
      ],
      effects: [
        {
          key: 'beacon-glow',
          name: 'Beacon Glow',
          baseValue: 0,
          recharge: { interval: 'permanent', usesMax: 1 },
        },
      ],
    };

    await importPack(port, pack);

    const exported = JSON.parse(await exportPack(port, 'my-homebrew'));
    expect(exported.spells[0].damageTypes[0].delivery).toBe('beam');
    expect(exported.effects[0].recharge.interval).toBe('permanent');
  });

  it('resolves a reference to another installed pack by its slug', async () => {
    const pack: PackFile = {
      ...anEnvelope(),
      spells: [aSpell({ key: 'borrowed', name: 'Borrowed' })],
      classes: [
        {
          key: 'borrower',
          name: 'Borrower',
          hitDie: 8,
          spellcastingAbility: null,
          castingProgression: 'none',
          slotRecovery: null,
          spells: ['srd-lite/fireball', 'borrowed'],
        },
      ],
    };

    await importPack(port, pack);
    const rows = await port.all<{ slug: string }>(
      `SELECT s.slug
         FROM class_spell cs
         JOIN spell s ON s.id = cs.spell_id
        WHERE cs.class_id = (SELECT id FROM class WHERE slug = 'borrower')
        ORDER BY s.slug`,
    );
    expect(rows.map((row) => row.slug)).toEqual(['borrowed', 'fireball']);
  });

  it('names the pack a qualified reference points at when it is not installed', async () => {
    const pack: PackFile = {
      ...anEnvelope(),
      classes: [
        {
          key: 'borrower',
          name: 'Borrower',
          hitDie: 8,
          spellcastingAbility: null,
          castingProgression: 'none',
          slotRecovery: null,
          spells: ['srd-9/fireball'],
        },
      ],
    };

    await expect(importPack(port, pack)).rejects.toThrow(/no pack "srd-9" is installed/);
  });
});
