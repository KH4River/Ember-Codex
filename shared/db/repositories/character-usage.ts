import { KEYED_TABLES, type KeyedTable } from '../../packs/references';
import type { DatabasePort } from '../DatabasePort';

export interface Usage {
  character: string;
  via: string;
}

interface UsageQuery {
  sql: string;
  via: string;
}

/** Every character table that can point at a keyed row. A missing entry would
 *  let a removal discard player state without a blocker. */
const USAGE_QUERIES: Record<KeyedTable, readonly UsageQuery[]> = {
  species: [
    {
      sql: 'SELECT name AS character FROM player_character WHERE species_id = ?',
      via: 'player_character',
    },
    {
      sql: `SELECT c.name AS character
              FROM character_damage_modifier dm
              JOIN player_character c ON c.id = dm.character_id
             WHERE dm.species_id = ?`,
      via: 'character_damage_modifier',
    },
  ],
  species_variant: [
    {
      sql: 'SELECT name AS character FROM player_character WHERE variant_id = ?',
      via: 'player_character',
    },
    {
      sql: `SELECT c.name AS character
              FROM character_damage_modifier dm
              JOIN player_character c ON c.id = dm.character_id
             WHERE dm.variant_id = ?`,
      via: 'character_damage_modifier',
    },
  ],
  background: [
    {
      sql: 'SELECT name AS character FROM player_character WHERE background_id = ?',
      via: 'player_character',
    },
  ],
  class: [
    {
      sql: `SELECT c.name AS character
              FROM character_class cc
              JOIN player_character c ON c.id = cc.character_id
             WHERE cc.class_id = ?`,
      via: 'character_class',
    },
    {
      sql: `SELECT c.name AS character
              FROM character_spell s
              JOIN player_character c ON c.id = s.character_id
             WHERE s.class_id = ?`,
      via: 'character_spell',
    },
    {
      sql: `SELECT c.name AS character
              FROM character_cantrip s
              JOIN player_character c ON c.id = s.character_id
             WHERE s.class_id = ?`,
      via: 'character_cantrip',
    },
    {
      sql: `SELECT c.name AS character
              FROM character_grant_pick p
              JOIN player_character c ON c.id = p.character_id
             WHERE p.class_id = ?`,
      via: 'character_grant_pick',
    },
  ],
  subclass: [
    {
      sql: `SELECT c.name AS character
              FROM character_class cc
              JOIN player_character c ON c.id = cc.character_id
             WHERE cc.subclass_id = ?`,
      via: 'character_class',
    },
  ],
  feat: [
    {
      sql: `SELECT c.name AS character
              FROM character_grant_pick p
              JOIN player_character c ON c.id = p.character_id
             WHERE p.feat_id = ?`,
      via: 'character_grant_pick',
    },
    {
      sql: `SELECT c.name AS character
              FROM character_origin_feat f
              JOIN player_character c ON c.id = f.character_id
             WHERE f.feat_id = ?`,
      via: 'character_origin_feat',
    },
    {
      sql: `SELECT c.name AS character
              FROM character_epic_boon e
              JOIN player_character c ON c.id = e.character_id
             WHERE e.feat_id = ?`,
      via: 'character_epic_boon',
    },
  ],
  feature: [
    {
      sql: `SELECT c.name AS character
              FROM character_damage_modifier dm
              JOIN player_character c ON c.id = dm.character_id
             WHERE dm.feature_id = ?`,
      via: 'character_damage_modifier',
    },
    {
      sql: `SELECT c.name AS character
              FROM character_granted_spell g
              JOIN player_character c ON c.id = g.character_id
             WHERE g.feature_id = ?`,
      via: 'character_granted_spell',
    },
  ],
  spell: [
    {
      sql: `SELECT c.name AS character
              FROM character_spell s
              JOIN player_character c ON c.id = s.character_id
             WHERE s.spell_id = ?`,
      via: 'character_spell',
    },
    {
      sql: `SELECT c.name AS character
              FROM character_cantrip s
              JOIN player_character c ON c.id = s.character_id
             WHERE s.spell_id = ?`,
      via: 'character_cantrip',
    },
    {
      sql: `SELECT c.name AS character
              FROM character_granted_spell g
              JOIN player_character c ON c.id = g.character_id
             WHERE g.spell_id = ?`,
      via: 'character_granted_spell',
    },
  ],
  effect: [
    {
      sql: `SELECT c.name AS character
              FROM character_effect_uses e
              JOIN player_character c ON c.id = e.character_id
             WHERE e.effect_id = ?`,
      via: 'character_effect_uses',
    },
  ],
  item: [
    {
      sql: `SELECT c.name AS character
              FROM character_item i
              JOIN player_character c ON c.id = i.character_id
             WHERE i.item_id = ?`,
      via: 'character_item',
    },
    {
      sql: `SELECT c.name AS character
              FROM character_grant_pick p
              JOIN player_character c ON c.id = p.character_id
             WHERE p.item_id = ?`,
      via: 'character_grant_pick',
    },
    {
      sql: `SELECT c.name AS character
              FROM character_damage_modifier dm
              JOIN player_character c ON c.id = dm.character_id
             WHERE dm.item_id = ?`,
      via: 'character_damage_modifier',
    },
  ],
  skill: [
    {
      sql: `SELECT c.name AS character
              FROM character_skill s
              JOIN player_character c ON c.id = s.character_id
             WHERE s.skill_id = ?`,
      via: 'character_skill',
    },
  ],
  tool: [
    {
      sql: `SELECT c.name AS character
              FROM character_tool t
              JOIN player_character c ON c.id = t.character_id
             WHERE t.tool_id = ?`,
      via: 'character_tool',
    },
  ],
  condition: [
    {
      sql: `SELECT c.name AS character
              FROM character_condition x
              JOIN player_character c ON c.id = x.character_id
             WHERE x.condition_id = ?`,
      via: 'character_condition',
    },
  ],
  language: [],
};

export async function charactersUsing(
  port: DatabasePort,
  sql: string,
  params: readonly unknown[],
  via: string,
): Promise<Usage[]> {
  const rows = await port.all<{ character: string }>(sql, params);
  return rows.map((row) => ({ character: row.character, via }));
}

async function characterUsages(
  port: DatabasePort,
  table: KeyedTable,
  id: number,
): Promise<Usage[]> {
  const usages: Usage[] = [];
  for (const query of USAGE_QUERIES[table]) {
    const found = await charactersUsing(port, query.sql, [id], query.via);
    usages.push(...found);
  }
  return usages;
}

export interface RemovedRowUsage {
  table: KeyedTable;
  slug: string;
  usage: Usage;
}

/** Every character use of this pack's rows that `keep` does not name. The
 *  importer calls it before deleting removed content; removePack before
 *  deleting the pack. */
export async function usagesOfRemovedRows(
  port: DatabasePort,
  sourceId: number,
  keep: ReadonlyMap<KeyedTable, ReadonlySet<string>>,
): Promise<RemovedRowUsage[]> {
  const removed: RemovedRowUsage[] = [];

  for (const table of KEYED_TABLES) {
    const rows = await port.all<{ id: number; slug: string }>(
      `SELECT id, slug FROM "${table}" WHERE source_id = ?`,
      [sourceId],
    );
    const kept = keep.get(table);
    for (const row of rows) {
      if (kept?.has(row.slug)) continue;
      for (const usage of await characterUsages(port, table, row.id)) {
        removed.push({ table, slug: row.slug, usage });
      }
    }
  }

  return removed;
}
