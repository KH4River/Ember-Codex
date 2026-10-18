import { NodeSqlitePort } from '@/testing/node-sqlite.port';
import { runMigrations } from '@/db/migrate';
import { MIGRATIONS } from '@/db/migrations.generated';
import { columnFor, columnsFor, isDropped, jsonNameFor, jsonNamesFor } from '@/packs/mapping';

/**
 * The mapping is the most bug-prone part of the format: a missing entry drops
 * a column silently, and a wrong one writes the right value under the wrong
 * key. Both are checked here against the real schema, so neither can reach a
 * round trip.
 */
describe('the camelCase mapping', () => {
  let port: NodeSqlitePort;
  let tableNames: string[];

  const columnsOf = async (table: string): Promise<string[]> => {
    const rows = await port.all<{ name: string }>(`PRAGMA table_info('${table}')`);
    return rows.map((row) => row.name);
  };

  beforeEach(async () => {
    port = new NodeSqlitePort();
    await port.open();
    await runMigrations(port, MIGRATIONS);
    const tables = await port.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    tableNames = tables.map((row) => row.name);
  });

  afterEach(async () => {
    await port.close();
  });

  describe('names that are not the mechanical transform', () => {
    it('renames a slug to key, because KEY is a keyword', () => {
      expect(jsonNameFor('slug')).toBe('key');
      expect(columnFor('key')).toBe('slug');
    });

    it('renames a spellcasting ability column and drops the id suffix', () => {
      expect(jsonNameFor('spellcasting_ability_id')).toBe('spellcastingAbility');
      expect(columnFor('spellcastingAbility')).toBe('spellcasting_ability_id');
    });

    it('drops the three columns that must never cross the file', () => {
      expect(isDropped('id')).toBe(true);
      expect(isDropped('source_id')).toBe(true);
      expect(isDropped('imported_at')).toBe(true);
      expect(jsonNameFor('id')).toBeUndefined();
      expect(columnFor('id')).toBeUndefined();
    });
  });

  describe('names that are the mechanical transform', () => {
    it.each([
      ['spell_level', 'spellLevel'],
      ['spell_range', 'spellRange'],
      ['casting_time', 'castingTime'],
      ['material_cost_cp', 'materialCostCp'],
      ['variant_kind', 'variantKind'],
      ['base_value', 'baseValue'],
      ['unlock_level', 'unlockLevel'],
      ['hit_die', 'hitDie'],
      ['casting_progression', 'castingProgression'],
      ['requires_attunement', 'requiresAttunement'],
      ['cost_cp', 'costCp'],
      ['is_artisan', 'isArtisan'],
      ['hp_max', 'hpMax'],
    ])('%s is %s', (column, expected) => {
      expect(jsonNameFor(column)).toBe(expected);
      expect(columnFor(expected)).toBe(column);
    });
  });

  describe('every column of every table', () => {
    it('maps to a JSON name and back to itself', async () => {
      const broken: string[] = [];
      for (const table of tableNames) {
        for (const column of await columnsOf(table)) {
          const jsonName = jsonNameFor(column);
          if (jsonName === undefined) continue;
          const backAgain = columnFor(jsonName);
          if (backAgain !== column) broken.push(`${table}.${column} -> ${jsonName} -> ${backAgain}`);
        }
      }
      expect(broken).toEqual([]);
    });

    it('never gives two columns of one table the same JSON name', async () => {
      const collisions: string[] = [];
      for (const table of tableNames) {
        const seen = new Map<string, string>();
        for (const column of await columnsOf(table)) {
          const jsonName = jsonNameFor(column);
          if (jsonName === undefined) continue;
          const previous = seen.get(jsonName);
          if (previous !== undefined) collisions.push(`${table}: ${previous} and ${column} are both ${jsonName}`);
          seen.set(jsonName, column);
        }
      }
      expect(collisions).toEqual([]);
    });

    it('exports the spell columns §4.5 names, and none it does not', async () => {
      const exported = jsonNamesFor(await columnsOf('spell'));
      for (const expected of [
        'key',
        'name',
        'spellLevel',
        'school',
        'castingTime',
        'spellRange',
        'duration',
        'concentration',
        'ritual',
        'verbal',
        'somatic',
        'material',
        'materialCostCp',
        'description',
      ]) {
        expect(exported).toContain(expected);
      }
      expect(exported).not.toContain('id');
      expect(exported).not.toContain('source_id');
    });

    it('exports a class with its spellcasting ability resolved by name', async () => {
      expect(jsonNamesFor(await columnsOf('class'))).toEqual([
        'key',
        'name',
        'hitDie',
        'spellcastingAbility',
        'castingProgression',
      ]);
    });
  });

  describe('turning a JSON object back into columns', () => {
    it('reads the columns out in the order the object lists them', () => {
      const spell = { key: 'fireball', spellLevel: 3, materialCostCp: 50 };
      const spellColumns = ['slug', 'spell_level', 'material_cost_cp'];
      expect(columnsFor(spell, spellColumns)).toEqual(spellColumns);
    });

    it('ignores a key the table does not have, so a typo cannot reach an INSERT', () => {
      const spell = { key: 'fireball', spellLevle: 3 };
      expect(columnsFor(spell, ['slug', 'spell_level'])).toEqual(['slug']);
    });

    it('refuses to read back a dropped column', () => {
      expect(columnsFor({ key: 'fireball', id: 99, sourceId: 1 }, ['slug', 'id', 'source_id'])).toEqual(['slug']);
    });
  });
});