import { NodeSqlitePort } from '@/testing/node-sqlite.port';
import { runMigrations } from '@/db/migrate';
import { MIGRATIONS } from '@/db/migrations.generated';
import { parseReference, resolveReference, type Resolution } from '@/packs/references';

/**
 * The reference rule, against a real schema.
 *
 * Bare key: the importing pack own row, else a global one.
 * Qualified `source/key`: that named pack, and only that pack.
 *
 * The fallback cannot tie only because the importer refuses a pack that
 * defines a slug which already exists globally, so these cases are exhaustive.
 */
describe('pack references', () => {
  let port: NodeSqlitePort;
  let homebrew: number;
  let srd: number;
  let dex: number;

  // DatabasePort.run returns void, so there is no lastInsertRowid to read.
  // Every insert is followed by the same lookup the importer makes: resolve by
  // the row own stable identifier.
  const addSource = async (slug: string) => {
    await port.run(`INSERT INTO source (slug, name, version) VALUES (?, ?, '1.0')`, [slug, slug]);
    return (await port.get<{ id: number }>('SELECT id FROM source WHERE slug = ?', [slug]))!.id;
  };

  const addSkill = async (sourceId: number | null, slug: string) => {
    await port.run(
      `INSERT INTO skill (source_id, slug, name, ability_id) VALUES (?, ?, ?, ?)`,
      [sourceId, slug, slug, dex],
    );
    // IS rather than =, so the global (NULL owner) case reads the same way.
    return (
      await port.get<{ id: number }>('SELECT id FROM skill WHERE source_id IS ? AND slug = ?', [
        sourceId,
        slug,
      ])
    )!.id;
  };

  const resolve = (table: 'skill' | 'spell', ref: string, own = homebrew) =>
    resolveReference(port, table, ref, own);

  beforeEach(async () => {
    port = new NodeSqlitePort();
    await port.open();
    await runMigrations(port, MIGRATIONS);
    dex = (await port.get<{ id: number }>(`SELECT id FROM ability WHERE code = 'DEX'`))!.id;
    homebrew = await addSource('my-homebrew');
    srd = await addSource('srd-5.2.1');
  });

  afterEach(async () => {
    await port.close();
  });

  describe('parseReference', () => {
    it('reads a bare key as its own pack', () => {
      expect(parseReference('skyriding')).toEqual({ source: null, key: 'skyriding' });
    });

    it('reads a qualified key, splitting on the FIRST slash so a dotted pack slug survives', () => {
      expect(parseReference('srd-5.2.1/fireball')).toEqual({
        source: 'srd-5.2.1',
        key: 'fireball',
      });
    });

    it('rejects what it cannot split unambiguously', () => {
      expect(() => parseReference('')).toThrow(SyntaxError);
      expect(() => parseReference('a/b/c')).toThrow(SyntaxError);
      expect(() => parseReference('/fireball')).toThrow(SyntaxError);
      expect(() => parseReference('srd/')).toThrow(SyntaxError);
      expect(() => parseReference(42)).toThrow(TypeError);
    });
  });

  describe('resolveReference', () => {
    it('finds the importing pack own row for a bare key', async () => {
      const own = await addSkill(homebrew, 'skyriding');
      expect(await resolve('skill', 'skyriding')).toEqual({ found: true, id: own });
    });

    it('falls back to global vocabulary when the pack does not define the key', async () => {
      const global = await addSkill(null, 'acrobatics');
      await addSkill(homebrew, 'something-else');
      expect(await resolve('skill', 'acrobatics')).toEqual({ found: true, id: global });
    });

    it('prefers the pack own row over a global one, so the fallback cannot tie', async () => {
      const global = await addSkill(null, 'acrobatics');
      const own = await addSkill(homebrew, 'acrobatics');
      expect(await resolve('skill', 'acrobatics')).toEqual({ found: true, id: own });
      expect(own).not.toBe(global);
    });

    it('reads another pack by its slug', async () => {
      const theirs = await addSkill(srd, 'acrobatics');
      expect(await resolve('skill', 'srd-5.2.1/acrobatics')).toEqual({ found: true, id: theirs });
    });

    it('does not read another pack by a BARE key, even when that pack owns it', async () => {
      await addSkill(srd, 'acrobatics');
      const result = (await resolve('skill', 'acrobatics')) as Extract<Resolution, { found: false }>;
      expect(result.found).toBe(false);
      expect(result.reason).toBe('no-such-key');
    });

    it('reports an uninstalled pack differently from a missing key', async () => {
      await addSkill(srd, 'acrobatics');
      const missingPack = (await resolve('skill', 'never-imported/acrobatics')) as Extract<
        Resolution,
        { found: false }
      >;
      expect(missingPack).toEqual({
        found: false,
        reason: 'no-such-pack',
        source: 'never-imported',
        key: 'acrobatics',
      });

      const missingKey = (await resolve('skill', 'srd-5.2.1/nope')) as Extract<
        Resolution,
        { found: false }
      >;
      expect(missingKey.reason).toBe('no-such-key');
    });

    it('refuses a table a pack may not reference', async () => {
      await expect(
        resolveReference(port, 'player_character' as never, 'anything', homebrew),
      ).rejects.toThrow(TypeError);
    });
  });
});