import { NodeSqlitePort } from '@/testing/node-sqlite.port';
import { runMigrations } from '@/db/migrate';
import { MIGRATIONS } from '@/db/migrations.generated';
import { PackValidationError, validatePack, validateStructure } from '@/packs/validatePack';
import type {
  PackBackground,
  PackClass,
  PackFile,
  PackSkill,
  PackSpell,
} from '@/models/ContentPack';

/**
 * The messages are the contract: the UI shows them and the user acts on them,
 * so they are pinned here before anything imports them.
 *
 * Each test changes one field of one fixture. The builders below exist so a
 * test reads as "a spell whose damage type is misspelled" rather than as
 * fourteen lines of spell.
 */
describe('pack validation', () => {
  let port: NodeSqlitePort;
  let homebrewPackId: number;
  let srdPackId: number;

  /** The smallest thing that is still a pack file. */
  const aPackFile = (): PackFile => ({
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

  const aClass = (overrides: Partial<PackClass> = {}): PackClass => ({
    key: 'fighter',
    name: 'Fighter',
    hitDie: 10,
    spellcastingAbility: null,
    castingProgression: 'none',
    slotRecovery: null,
    ...overrides,
  });

  const aBackground = (overrides: Partial<PackBackground> = {}): PackBackground => ({
    key: 'wayfarer',
    name: 'Wayfarer',
    abilities: ['DEX'],
    ...overrides,
  });

  const aSkill = (overrides: Partial<PackSkill> = {}): PackSkill => ({
    key: 'skyriding',
    name: 'Skyriding',
    ability: 'DEX',
    ...overrides,
  });

  /** Every problem validatePack found, or [] when it accepted the file. */
  const problemsFoundIn = async (file: unknown): Promise<string[]> => {
    try {
      await validatePack(port, file, homebrewPackId);
      return [];
    } catch (error) {
      expect(error).toBeInstanceOf(PackValidationError);
      return (error as PackValidationError).problems;
    }
  };

  beforeEach(async () => {
    port = new NodeSqlitePort();
    await port.open();
    await runMigrations(port, MIGRATIONS);

    await port.run(`INSERT INTO source (slug, name, version) VALUES ('my-homebrew', 'My Homebrew', '1.0')`);
    await port.run(`INSERT INTO source (slug, name, version) VALUES ('srd-5.2.1', 'SRD', '5.2.1')`);
    homebrewPackId = (await port.get<{ id: number }>(`SELECT id FROM source WHERE slug = 'my-homebrew'`))!.id;
    srdPackId = (await port.get<{ id: number }>(`SELECT id FROM source WHERE slug = 'srd-5.2.1'`))!.id;

    // Two rows the tests reference: one owned by this pack, one by another.
    await port.run(
      `INSERT INTO feat (source_id, slug, name, description, category_id)
       VALUES (?, 'alert', 'Alert', 'x', 2)`,
      [homebrewPackId],
    );
    await port.run(
      `INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration)
       VALUES (?, 'fireball', 'Fireball', 3, 'evocation', '1 action', '150 feet', 'Instant')`,
      [srdPackId],
    );
  });

  afterEach(async () => {
    await port.close();
  });

  describe('phase 1, the shape of the file', () => {
    it('accepts a file that carries nothing but an envelope', () => {
      expect(() => validateStructure(aPackFile())).not.toThrow();
    });

    it('rejects a misspelled collection rather than dropping its contents', () => {
      const file = { ...aPackFile(), spellz: [] };
      expect(() => validateStructure(file)).toThrow(/unknown top-level key "spellz"/);
    });

    it('rejects a collection that is not an array', () => {
      const file = { ...aPackFile(), spells: {} };
      expect(() => validateStructure(file)).toThrow(/"spells" must be an array/);
    });

    it('rejects a format this build does not read', () => {
      const file = { ...aPackFile(), format: 'other.pack' };
      expect(() => validateStructure(file)).toThrow(/"format" must be "ember-codex.pack"/);
    });

    it('rejects a formatVersion this build does not read', () => {
      const file = { ...aPackFile(), formatVersion: 2 };
      expect(() => validateStructure(file)).toThrow(/"formatVersion" must be 1/);
    });

    it('rejects a pack with no key', () => {
      const file = { ...aPackFile(), source: { name: 'Nameless' } };
      expect(() => validateStructure(file)).toThrow(/"source.key" must be a non-empty string/);
    });

    it('rejects null, which is not an object', () => {
      expect(() => validateStructure(null)).toThrow(/must be a JSON object/);
    });

    it('rejects an array, which is not an object either', () => {
      expect(() => validateStructure([])).toThrow(/must be a JSON object/);
    });
  });

  describe('phase 2, references that point nowhere', () => {
    it('accepts a file whose references all resolve', async () => {
      const file = {
        ...aPackFile(),
        backgrounds: [aBackground({ originFeats: ['alert'] })],
        classes: [aClass({ spells: ['srd-5.2.1/fireball'] })],
      };
      expect(await problemsFoundIn(file)).toEqual([]);
    });

    it('names the value, the referrer and the path when a spell names no such damage type', async () => {
      const file = {
        ...aPackFile(),
        spells: [
          aSpell({
            damageTypes: [{ damageType: 'fireblet', selection: 'fixed', delivery: 'cast' }],
          }),
        ],
      };
      expect(await problemsFoundIn(file)).toEqual([
        'fireblet is referenced by spell "searing-smite" at spells[0].damageTypes[0].damageType but is not a known damage type',
      ]);
    });

    it('names the pack when a reference points at one that was never imported', async () => {
      const file = { ...aPackFile(), classes: [aClass({ spells: ['srd-5.1/fireball'] })] };
      expect(await problemsFoundIn(file)).toEqual([
        'class "fighter" references "srd-5.1/fireball" but no pack "srd-5.1" is installed',
      ]);
    });

    it('names the ability when a skill asks for one that does not exist', async () => {
      const file = { ...aPackFile(), skills: [aSkill({ ability: 'GRIT' as never })] };
      expect(await problemsFoundIn(file)).toEqual([
        'GRIT is referenced by skill "skyriding" at skills[0].ability but is not a known ability',
      ]);
    });

    it('reports every dangling reference, not just the first', async () => {
      const file = {
        ...aPackFile(),
        backgrounds: [
          aBackground({ key: 'a', name: 'A', originFeats: ['nope'] }),
          aBackground({ key: 'b', name: 'B', originFeats: ['also-nope'] }),
        ],
      };
      const problems = await problemsFoundIn(file);
      expect(problems).toHaveLength(2);
      expect(problems).toContain('feat "nope" is referenced by background "a" at backgrounds[0].originFeats[0] but is not in this pack');
      expect(problems).toContain('feat "also-nope" is referenced by background "b" at backgrounds[1].originFeats[0] but is not in this pack');
    });

    it('puts every problem under one error rather than one error each', async () => {
      const file = {
        ...aPackFile(),
        backgrounds: [
          aBackground({ key: 'a', name: 'A', abilities: ['GRIT' as never], originFeats: ['nope'] }),
          aBackground({ key: 'b', name: 'B', originFeats: ['also-nope'] }),
        ],
      };
      await expect(validatePack(port, file, homebrewPackId)).rejects.toThrow(/3 problems/);
    });
  });

  describe('a pack may add vocabulary, but not redefine it', () => {
    it('accepts a skill the app has never heard of', async () => {
      const file = { ...aPackFile(), skills: [aSkill()] };
      expect(await problemsFoundIn(file)).toEqual([]);
    });

    it('rejects a condition that already exists as global vocabulary', async () => {
      // `poisoned` is seeded. A pack claiming it as its own is the split-state
      // bug, so the file is refused before anything is written.
      const file = { ...aPackFile(), conditions: [{ key: 'poisoned', name: 'Poisoned' }] };
      expect(await problemsFoundIn(file)).toEqual([
        'condition "poisoned" already exists as global vocabulary — reference it rather than redefining it',
      ]);
    });

    it('rejects a skill that already exists as global vocabulary', async () => {
      await port.run(`INSERT INTO skill (slug, name, ability_id) VALUES ('acrobatics', 'Acrobatics', 2)`);
      const file = { ...aPackFile(), skills: [aSkill({ key: 'acrobatics', name: 'Acrobatics' })] };
      expect(await problemsFoundIn(file)).toEqual([
        'skill "acrobatics" already exists as global vocabulary — reference it rather than redefining it',
      ]);
    });
  });
});