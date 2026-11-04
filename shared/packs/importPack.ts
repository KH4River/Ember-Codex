import type { DatabasePort } from '../db/DatabasePort';
import type {
  PackBackground,
  PackClass,
  PackEffect,
  PackFeat,
  PackFeature,
  PackFile,
  PackItem,
  PackSpell,
  PackSubclass,
  PackWeapon,
} from '../models/ContentPack';
import {
  CLOSED_TABLES,
  KEYED_TABLES,
  resolveReference,
  type ClosedTable,
  type KeyedTable,
} from './references';
import { declaredKeys, validatePack } from './validatePack';

/** Writes a pack inside one transaction, updating matched slugs in place so a
 *  character keeps pointing at the same row. Validation has already run. */

export type ImportMode = 'replace' | 'keep-both';

export interface ImportOptions {
  mode?: ImportMode;
  /** The new slug when keeping both. Required for `keep-both` on an installed pack. */
  newSlug?: string;
}

export interface ImportResult {
  sourceId: number;
  sourceSlug: string;
}

/** Carries every blocker found, so one error can list them all. */
export class PackImportError extends Error {
  constructor(readonly blockers: string[]) {
    super(summariseBlockers(blockers));
    this.name = 'PackImportError';
  }
}

function summariseBlockers(blockers: string[]): string {
  if (blockers.length === 1) return `this pack cannot be imported: ${blockers[0]}`;
  const listed = blockers.map((blocker) => `  - ${blocker}`).join('\n');
  return `this pack cannot be imported, ${blockers.length} blockers:\n${listed}`;
}

function tableNameInProse(table: string): string {
  return table.replace(/_/g, ' ');
}

function bool(value: boolean): number {
  if (value) return 1;
  return 0;
}

interface SourceRow {
  id: number;
  slug: string;
}

async function findSource(port: DatabasePort, slug: string): Promise<SourceRow | undefined> {
  return port.get<SourceRow>('SELECT id, slug FROM source WHERE slug = ?', [slug]);
}

/** Replace keeps the file's key; keep-both needs a different one, chosen by
 *  the user rather than derived, because it appears in shared references. */
async function targetSlugFor(
  port: DatabasePort,
  file: PackFile,
  existing: SourceRow | undefined,
  options: ImportOptions,
): Promise<string> {
  const mode = options.mode ?? 'replace';
  if (mode === 'replace') return file.source.key;
  if (existing === undefined) return file.source.key;

  const newSlug = options.newSlug?.trim();
  if (!newSlug) {
    throw new PackImportError([
      `the pack "${file.source.key}" is already installed; choose a new key to keep both`,
    ]);
  }
  if (newSlug === existing.slug) {
    throw new PackImportError([
      `the new key must differ from "${existing.slug}"; choose replace to update it in place`,
    ]);
  }
  if (await findSource(port, newSlug)) {
    throw new PackImportError([`a pack named "${newSlug}" is already installed`]);
  }
  return newSlug;
}

async function writeSource(
  port: DatabasePort,
  file: PackFile,
  existing: SourceRow | undefined,
  slug: string,
): Promise<number> {
  if (existing && existing.slug === slug) {
    await port.run(
      `UPDATE source
          SET name = ?, version = ?, license = ?, attribution = ?,
              imported_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
              superseded_by = NULL
        WHERE id = ?`,
      [
        file.source.name,
        file.source.version,
        file.source.license,
        file.source.attribution,
        existing.id,
      ],
    );
    return existing.id;
  }

  await port.run(
    'INSERT INTO source (slug, name, version, license, attribution) VALUES (?, ?, ?, ?, ?)',
    [
      slug,
      file.source.name,
      file.source.version,
      file.source.license,
      file.source.attribution,
    ],
  );
  return (await findSource(port, slug))!.id;
}

interface PackIds {
  skills: Map<string, number>;
  tools: Map<string, number>;
  languages: Map<string, number>;
  conditions: Map<string, number>;
  species: Map<string, number>;
  variants: Map<string, number>;
  backgrounds: Map<string, number>;
  classes: Map<string, number>;
  subclasses: Map<string, number>;
  feats: Map<string, number>;
  features: Map<string, number>;
  spells: Map<string, number>;
  effects: Map<string, number>;
  items: Map<string, number>;
}

function newPackIds(): PackIds {
  return {
    skills: new Map(),
    tools: new Map(),
    languages: new Map(),
    conditions: new Map(),
    species: new Map(),
    variants: new Map(),
    backgrounds: new Map(),
    classes: new Map(),
    subclasses: new Map(),
    feats: new Map(),
    features: new Map(),
    spells: new Map(),
    effects: new Map(),
    items: new Map(),
  };
}

async function findId(
  port: DatabasePort,
  table: string,
  sourceId: number,
  slug: string,
): Promise<number | undefined> {
  const row = await port.get<{ id: number }>(
    `SELECT id FROM "${table}" WHERE source_id = ? AND slug = ?`,
    [sourceId, slug],
  );
  return row?.id;
}

/** The replace loop in one place: a matched slug updates in place, so its id
 *  and every character reference to it survive. */
async function upsert(
  port: DatabasePort,
  table: string,
  sourceId: number,
  slug: string,
  columns: readonly string[],
  values: readonly unknown[],
): Promise<number> {
  const existing = await findId(port, table, sourceId, slug);
  if (existing !== undefined) {
    const assignments = columns.map((column) => `${column} = ?`).join(', ');
    await port.run(`UPDATE "${table}" SET ${assignments} WHERE id = ?`, [...values, existing]);
    return existing;
  }

  const allColumns = ['source_id', 'slug', ...columns];
  const placeholders = allColumns.map(() => '?').join(', ');
  await port.run(
    `INSERT INTO "${table}" (${allColumns.join(', ')}) VALUES (${placeholders})`,
    [sourceId, slug, ...values],
  );
  return (await findId(port, table, sourceId, slug))!;
}

async function requiredCode(
  port: DatabasePort,
  table: ClosedTable,
  value: string | undefined,
): Promise<number> {
  if (value === undefined) {
    throw new PackImportError([`a ${tableNameInProse(table)} value is required`]);
  }
  const column = CLOSED_TABLES[table];
  const row = await port.get<{ id: number }>(
    `SELECT id FROM "${table}" WHERE ${column} = ?`,
    [value],
  );
  if (!row) {
    throw new PackImportError([`"${value}" is not a known ${tableNameInProse(table)}`]);
  }
  return row.id;
}

async function requiredReference(
  port: DatabasePort,
  table: KeyedTable,
  value: string,
  sourceId: number,
): Promise<number> {
  const result = await resolveReference(port, table, value, sourceId);
  if (result.found) return result.id;
  throw new PackImportError([`"${value}" is not a known ${tableNameInProse(table)}`]);
}

type FeatureOwner = 'class_id' | 'subclass_id' | 'species_id' | 'variant_id' | 'background_id';

const FEATURE_OWNERS: readonly FeatureOwner[] = [
  'class_id',
  'subclass_id',
  'species_id',
  'variant_id',
  'background_id',
];

interface FeatureEntry {
  feature: PackFeature;
  owner: FeatureOwner;
  ownerKey: string;
}

function collectFeatures(file: PackFile): FeatureEntry[] {
  const entries: FeatureEntry[] = [];
  const add = (
    features: readonly PackFeature[] | undefined,
    owner: FeatureOwner,
    ownerKey: string,
  ): void => {
    for (const feature of features ?? []) entries.push({ feature, owner, ownerKey });
  };

  for (const species of file.species ?? []) {
    add(species.features, 'species_id', species.key);
    for (const variant of species.variants ?? []) {
      add(variant.features, 'variant_id', variant.key);
    }
  }
  for (const background of file.backgrounds ?? []) {
    add(background.features, 'background_id', background.key);
  }
  for (const classEntry of file.classes ?? []) {
    add(classEntry.features, 'class_id', classEntry.key);
    for (const subclass of classEntry.subclasses ?? []) {
      add(subclass.features, 'subclass_id', subclass.key);
    }
  }
  return entries;
}

function collectEffects(file: PackFile, features: readonly FeatureEntry[]): PackEffect[] {
  const effects: PackEffect[] = [];
  for (const effect of file.effects ?? []) effects.push(effect);
  for (const feat of file.feats ?? []) {
    for (const effect of feat.effects ?? []) effects.push(effect);
  }
  for (const { feature } of features) {
    for (const effect of feature.effects ?? []) effects.push(effect);
  }
  return effects;
}

function ownerIdFor(entry: FeatureEntry, ids: PackIds): number {
  switch (entry.owner) {
    case 'species_id':
      return ids.species.get(entry.ownerKey)!;
    case 'variant_id':
      return ids.variants.get(entry.ownerKey)!;
    case 'background_id':
      return ids.backgrounds.get(entry.ownerKey)!;
    case 'class_id':
      return ids.classes.get(entry.ownerKey)!;
    case 'subclass_id':
      return ids.subclasses.get(entry.ownerKey)!;
  }
}

async function upsertFeature(
  port: DatabasePort,
  sourceId: number,
  feature: PackFeature,
  owner: FeatureOwner,
  ownerId: number,
): Promise<number> {
  const ownerIds: (number | null)[] = [];
  for (const column of FEATURE_OWNERS) {
    if (column === owner) {
      ownerIds.push(ownerId);
    } else {
      ownerIds.push(null);
    }
  }
  const existing = await findId(port, 'feature', sourceId, feature.key);

  if (existing !== undefined) {
    await port.run(
      `UPDATE feature
          SET name = ?, description = ?, level = ?,
              class_id = ?, subclass_id = ?, species_id = ?, variant_id = ?, background_id = ?
        WHERE id = ?`,
      [feature.name, feature.description, feature.level, ...ownerIds, existing],
    );
    return existing;
  }

  await port.run(
    `INSERT INTO feature
       (source_id, slug, name, description, level,
        class_id, subclass_id, species_id, variant_id, background_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [sourceId, feature.key, feature.name, feature.description, feature.level, ...ownerIds],
  );
  return (await findId(port, 'feature', sourceId, feature.key))!;
}

async function writeContent(
  port: DatabasePort,
  file: PackFile,
  sourceId: number,
  features: readonly FeatureEntry[],
  effects: readonly PackEffect[],
): Promise<PackIds> {
  const ids = newPackIds();

  await writeVocabulary(port, file, sourceId, ids);
  await writeOrigins(port, file, sourceId, ids);
  await writeClasses(port, file, sourceId, ids);
  await writeFeats(port, file, sourceId, ids);
  await writeFeatures(port, sourceId, ids, features);
  await writeSpells(port, file, sourceId, ids);
  await writeEffects(port, sourceId, ids, effects);
  await writeItems(port, file, sourceId, ids);

  return ids;
}

async function writeVocabulary(
  port: DatabasePort,
  file: PackFile,
  sourceId: number,
  ids: PackIds,
): Promise<void> {
  for (const skill of file.skills ?? []) {
    const abilityId = await requiredCode(port, 'ability', skill.ability);
    ids.skills.set(
      skill.key,
      await upsert(port, 'skill', sourceId, skill.key, ['name', 'ability_id'], [
        skill.name,
        abilityId,
      ]),
    );
  }

  for (const tool of file.tools ?? []) {
    ids.tools.set(
      tool.key,
      await upsert(port, 'tool', sourceId, tool.key, ['name', 'is_artisan'], [
        tool.name,
        bool(tool.isArtisan),
      ]),
    );
  }

  for (const language of file.languages ?? []) {
    ids.languages.set(
      language.key,
      await upsert(port, 'language', sourceId, language.key, ['name'], [language.name]),
    );
  }

  for (const condition of file.conditions ?? []) {
    ids.conditions.set(
      condition.key,
      await upsert(port, 'condition', sourceId, condition.key, ['name', 'description'], [
        condition.name,
        condition.description ?? null,
      ]),
    );
  }
}

async function writeOrigins(
  port: DatabasePort,
  file: PackFile,
  sourceId: number,
  ids: PackIds,
): Promise<void> {
  for (const species of file.species ?? []) {
    ids.species.set(
      species.key,
      await upsert(port, 'species', sourceId, species.key, ['name', 'size', 'speed'], [
        species.name,
        species.size,
        species.speed,
      ]),
    );
  }

  for (const species of file.species ?? []) {
    const speciesId = ids.species.get(species.key)!;
    for (const variant of species.variants ?? []) {
      ids.variants.set(
        variant.key,
        await upsert(
          port,
          'species_variant',
          sourceId,
          variant.key,
          ['species_id', 'variant_kind', 'name'],
          [speciesId, variant.variantKind, variant.name],
        ),
      );
    }
  }

  for (const background of file.backgrounds ?? []) {
    ids.backgrounds.set(
      background.key,
      await upsert(port, 'background', sourceId, background.key, ['name', 'description'], [
        background.name,
        background.description ?? null,
      ]),
    );
  }
}

async function writeClasses(
  port: DatabasePort,
  file: PackFile,
  sourceId: number,
  ids: PackIds,
): Promise<void> {
  for (const classEntry of file.classes ?? []) {
    let abilityId: number | null = null;
    if (classEntry.spellcastingAbility !== null) {
      abilityId = await requiredCode(port, 'ability', classEntry.spellcastingAbility);
    }
    ids.classes.set(
      classEntry.key,
      await upsert(
        port,
        'class',
        sourceId,
        classEntry.key,
        ['name', 'hit_die', 'spellcasting_ability_id', 'casting_progression'],
        [classEntry.name, classEntry.hitDie, abilityId, classEntry.castingProgression],
      ),
    );
  }

  for (const classEntry of file.classes ?? []) {
    const classId = ids.classes.get(classEntry.key)!;
    for (const subclass of classEntry.subclasses ?? []) {
      ids.subclasses.set(
        subclass.key,
        await upsert(
          port,
          'subclass',
          sourceId,
          subclass.key,
          ['class_id', 'name', 'unlock_level'],
          [classId, subclass.name, subclass.unlockLevel],
        ),
      );
    }
  }
}

async function writeFeats(
  port: DatabasePort,
  file: PackFile,
  sourceId: number,
  ids: PackIds,
): Promise<void> {
  for (const feat of file.feats ?? []) {
    const categoryId = await requiredCode(port, 'feat_category', feat.category);
    ids.feats.set(
      feat.key,
      await upsert(port, 'feat', sourceId, feat.key, ['name', 'description', 'category_id'], [
        feat.name,
        feat.description,
        categoryId,
      ]),
    );
  }
}

async function writeFeatures(
  port: DatabasePort,
  sourceId: number,
  ids: PackIds,
  features: readonly FeatureEntry[],
): Promise<void> {
  for (const entry of features) {
    const ownerId = ownerIdFor(entry, ids);
    ids.features.set(
      entry.feature.key,
      await upsertFeature(port, sourceId, entry.feature, entry.owner, ownerId),
    );
  }
}

async function writeSpells(
  port: DatabasePort,
  file: PackFile,
  sourceId: number,
  ids: PackIds,
): Promise<void> {
  for (const spell of file.spells ?? []) {
    ids.spells.set(
      spell.key,
      await upsert(
        port,
        'spell',
        sourceId,
        spell.key,
        [
          'name',
          'spell_level',
          'school',
          'casting_time',
          'spell_range',
          'duration',
          'concentration',
          'ritual',
          'verbal',
          'somatic',
          'material',
          'material_cost_cp',
          'description',
        ],
        [
          spell.name,
          spell.spellLevel,
          spell.school,
          spell.castingTime,
          spell.spellRange,
          spell.duration,
          bool(spell.concentration),
          bool(spell.ritual),
          bool(spell.verbal),
          bool(spell.somatic),
          bool(spell.material),
          spell.materialCostCp,
          spell.description ?? null,
        ],
      ),
    );
  }
}

async function writeEffects(
  port: DatabasePort,
  sourceId: number,
  ids: PackIds,
  effects: readonly PackEffect[],
): Promise<void> {
  for (const effect of effects) {
    ids.effects.set(
      effect.key,
      await upsert(port, 'effect', sourceId, effect.key, ['name', 'description', 'base_value'], [
        effect.name,
        effect.description ?? null,
        effect.baseValue,
      ]),
    );
  }
}

async function writeItems(
  port: DatabasePort,
  file: PackFile,
  sourceId: number,
  ids: PackIds,
): Promise<void> {
  for (const item of file.items ?? []) {
    ids.items.set(
      item.key,
      await upsert(
        port,
        'item',
        sourceId,
        item.key,
        ['name', 'weight', 'cost_cp', 'description', 'requires_attunement'],
        [
          item.name,
          item.weight,
          item.costCp,
          item.description ?? null,
          bool(item.requiresAttunement),
        ],
      ),
    );
  }
}

interface Usage {
  character: string;
  via: string;
}

async function charactersUsing(
  port: DatabasePort,
  sql: string,
  params: readonly unknown[],
  via: string,
): Promise<Usage[]> {
  const rows = await port.all<{ character: string }>(sql, params);
  return rows.map((row) => ({ character: row.character, via }));
}

async function charactersUsingGrantSlot(
  port: DatabasePort,
  classId: number,
  classLevel: number,
  grantKind: string,
): Promise<Usage[]> {
  return charactersUsing(
    port,
    `SELECT c.name AS character
       FROM character_grant_pick p
       JOIN player_character c ON c.id = p.character_id
      WHERE p.class_id = ? AND p.class_level = ? AND p.grant_kind = ?`,
    [classId, classLevel, grantKind],
    'character_grant_pick',
  );
}

async function writeGrants(
  port: DatabasePort,
  classEntry: PackClass,
  classId: number,
  blockers: string[],
): Promise<void> {
  const grants = classEntry.grants ?? [];
  const fileKeys = new Set(grants.map((grant) => `${grant.level}:${grant.kind}`));
  const existing = await port.all<{ class_level: number; grant_kind: string }>(
    'SELECT class_level, grant_kind FROM class_grant_slot WHERE class_id = ?',
    [classId],
  );

  for (const grant of grants) {
    const slot = await port.get<{ class_id: number }>(
      `SELECT class_id FROM class_grant_slot
        WHERE class_id = ? AND class_level = ? AND grant_kind = ?`,
      [classId, grant.level, grant.kind],
    );
    if (slot) {
      await port.run(
        `UPDATE class_grant_slot SET opens = ?
          WHERE class_id = ? AND class_level = ? AND grant_kind = ?`,
        [grant.opens, classId, grant.level, grant.kind],
      );
    } else {
      await port.run(
        `INSERT INTO class_grant_slot (class_id, class_level, grant_kind, opens)
         VALUES (?, ?, ?, ?)`,
        [classId, grant.level, grant.kind, grant.opens],
      );
    }
  }

  for (const slot of existing) {
    if (fileKeys.has(`${slot.class_level}:${slot.grant_kind}`)) continue;
    const used = await charactersUsingGrantSlot(port, classId, slot.class_level, slot.grant_kind);
    if (used.length === 0) {
      await port.run(
        `DELETE FROM class_grant_slot
          WHERE class_id = ? AND class_level = ? AND grant_kind = ?`,
        [classId, slot.class_level, slot.grant_kind],
      );
      continue;
    }
    for (const usage of used) {
      blockers.push(
        `cannot replace: class "${classEntry.key}" grant "${slot.grant_kind}" at level ${slot.class_level} was removed in this version but is used by character "${usage.character}" (${usage.via})`,
      );
    }
  }
}

async function writeBackgroundSatellites(
  port: DatabasePort,
  background: PackBackground,
  ids: PackIds,
  sourceId: number,
): Promise<void> {
  const backgroundId = ids.backgrounds.get(background.key)!;
  if (background.abilities.length !== 3) {
    throw new PackImportError([
      `background "${background.key}" must list exactly three abilities`,
    ]);
  }

  await port.run('DELETE FROM background_ability WHERE background_id = ?', [backgroundId]);
  for (const ability of background.abilities) {
    const abilityId = await requiredCode(port, 'ability', ability);
    await port.run('INSERT INTO background_ability (background_id, ability_id) VALUES (?, ?)', [
      backgroundId,
      abilityId,
    ]);
  }

  await port.run('DELETE FROM background_origin_feat WHERE background_id = ?', [backgroundId]);
  for (const featRef of background.originFeats ?? []) {
    const featId = await requiredReference(port, 'feat', featRef, sourceId);
    await port.run('INSERT INTO background_origin_feat (background_id, feat_id) VALUES (?, ?)', [
      backgroundId,
      featId,
    ]);
  }
}

async function writeSubclassSatellites(
  port: DatabasePort,
  subclass: PackSubclass,
  ids: PackIds,
  sourceId: number,
): Promise<void> {
  const subclassId = ids.subclasses.get(subclass.key)!;

  await port.run('DELETE FROM subclass_skill WHERE subclass_id = ?', [subclassId]);
  for (const skill of subclass.skills ?? []) {
    const skillId = await requiredReference(port, 'skill', skill.skill, sourceId);
    await port.run('INSERT INTO subclass_skill (subclass_id, skill_id) VALUES (?, ?)', [
      subclassId,
      skillId,
    ]);
  }

  await port.run('DELETE FROM subclass_tool WHERE subclass_id = ?', [subclassId]);
  for (const tool of subclass.tools ?? []) {
    const toolId = await requiredReference(port, 'tool', tool.tool, sourceId);
    await port.run('INSERT INTO subclass_tool (subclass_id, tool_id) VALUES (?, ?)', [
      subclassId,
      toolId,
    ]);
  }

  await port.run('DELETE FROM subclass_armour_type WHERE subclass_id = ?', [subclassId]);
  for (const armourType of subclass.armourTypes ?? []) {
    await port.run(
      'INSERT INTO subclass_armour_type (subclass_id, armour_type) VALUES (?, ?)',
      [subclassId, armourType],
    );
  }
}

async function writeClassSatellites(
  port: DatabasePort,
  classEntry: PackClass,
  ids: PackIds,
  sourceId: number,
  blockers: string[],
): Promise<void> {
  const classId = ids.classes.get(classEntry.key)!;

  await writeGrants(port, classEntry, classId, blockers);
  await writeClassProgress(port, classEntry, classId);
  await writeClassProficiencies(port, classEntry, classId, sourceId);
  await writeClassSpells(port, classEntry, classId, sourceId);

  for (const subclass of classEntry.subclasses ?? []) {
    await writeSubclassSatellites(port, subclass, ids, sourceId);
  }
}

async function writeClassProgress(
  port: DatabasePort,
  classEntry: PackClass,
  classId: number,
): Promise<void> {
  await port.run('DELETE FROM class_cantrip_count WHERE class_id = ?', [classId]);
  for (const count of classEntry.cantripCounts ?? []) {
    await port.run(
      'INSERT INTO class_cantrip_count (class_id, class_level, cantrips) VALUES (?, ?, ?)',
      [classId, count.level, count.cantrips],
    );
  }

  await port.run('DELETE FROM class_prepared_count WHERE class_id = ?', [classId]);
  for (const count of classEntry.preparedCounts ?? []) {
    await port.run(
      `INSERT INTO class_prepared_count
         (class_id, class_level, spell_level, max_prepared)
       VALUES (?, ?, ?, ?)`,
      [classId, count.level, count.spellLevel, count.maxPrepared],
    );
  }

  await port.run('DELETE FROM class_spell_slot WHERE class_id = ?', [classId]);
  for (const slot of classEntry.spellSlots ?? []) {
    await port.run(
      `INSERT INTO class_spell_slot
         (class_id, class_level, slot_level, slot_count)
       VALUES (?, ?, ?, ?)`,
      [classId, slot.level, slot.slotLevel, slot.slotCount],
    );
  }

  await port.run('DELETE FROM class_slot_recovery WHERE class_id = ?', [classId]);
  if (classEntry.slotRecovery !== null) {
    await port.run('INSERT INTO class_slot_recovery (class_id, interval) VALUES (?, ?)', [
      classId,
      classEntry.slotRecovery,
    ]);
  }
}

async function writeClassProficiencies(
  port: DatabasePort,
  classEntry: PackClass,
  classId: number,
  sourceId: number,
): Promise<void> {
  await port.run('DELETE FROM class_saving_throw WHERE class_id = ?', [classId]);
  for (const ability of classEntry.savingThrows ?? []) {
    const abilityId = await requiredCode(port, 'ability', ability);
    await port.run('INSERT INTO class_saving_throw (class_id, ability_id) VALUES (?, ?)', [
      classId,
      abilityId,
    ]);
  }

  await port.run('DELETE FROM class_skill WHERE class_id = ?', [classId]);
  for (const skill of classEntry.skills ?? []) {
    const skillId = await requiredReference(port, 'skill', skill.skill, sourceId);
    await port.run('INSERT INTO class_skill (class_id, skill_id) VALUES (?, ?)', [
      classId,
      skillId,
    ]);
  }

  await port.run('DELETE FROM class_tool WHERE class_id = ?', [classId]);
  for (const tool of classEntry.tools ?? []) {
    const toolId = await requiredReference(port, 'tool', tool.tool, sourceId);
    await port.run('INSERT INTO class_tool (class_id, tool_id) VALUES (?, ?)', [classId, toolId]);
  }

  await port.run('DELETE FROM class_armour_type WHERE class_id = ?', [classId]);
  for (const armourType of classEntry.armourTypes ?? []) {
    await port.run('INSERT INTO class_armour_type (class_id, armour_type) VALUES (?, ?)', [
      classId,
      armourType,
    ]);
  }

  await port.run('DELETE FROM class_weapon_category WHERE class_id = ?', [classId]);
  for (const category of classEntry.weaponCategories ?? []) {
    const categoryId = await requiredCode(port, 'weapon_category', category);
    await port.run(
      'INSERT INTO class_weapon_category (class_id, category_id) VALUES (?, ?)',
      [classId, categoryId],
    );
  }
}

async function writeClassSpells(
  port: DatabasePort,
  classEntry: PackClass,
  classId: number,
  sourceId: number,
): Promise<void> {
  await port.run('DELETE FROM class_spell WHERE class_id = ?', [classId]);
  for (const spellRef of classEntry.spells ?? []) {
    const spellId = await requiredReference(port, 'spell', spellRef, sourceId);
    await port.run('INSERT INTO class_spell (class_id, spell_id) VALUES (?, ?)', [
      classId,
      spellId,
    ]);
  }
}

async function writeFeatSatellites(
  port: DatabasePort,
  feat: PackFeat,
  ids: PackIds,
  sourceId: number,
): Promise<void> {
  const featId = ids.feats.get(feat.key)!;

  await port.run('DELETE FROM feat_ability_prereq WHERE feat_id = ?', [featId]);
  for (const prereq of feat.abilityPrereqs ?? []) {
    const abilityId = await requiredCode(port, 'ability', prereq.ability);
    await port.run(
      'INSERT INTO feat_ability_prereq (feat_id, ability_id, min_score) VALUES (?, ?, ?)',
      [featId, abilityId, prereq.minScore],
    );
  }

  await port.run('DELETE FROM feat_effect WHERE feat_id = ?', [featId]);
  for (const effect of feat.effects ?? []) {
    await port.run('INSERT INTO feat_effect (feat_id, effect_id) VALUES (?, ?)', [
      featId,
      ids.effects.get(effect.key)!,
    ]);
  }
}

async function writeFeatureSatellites(
  port: DatabasePort,
  feature: PackFeature,
  ids: PackIds,
  sourceId: number,
): Promise<void> {
  const featureId = ids.features.get(feature.key)!;

  await port.run('DELETE FROM feature_spell WHERE feature_id = ?', [featureId]);
  for (const spellRef of feature.spells ?? []) {
    const spellId = await requiredReference(port, 'spell', spellRef, sourceId);
    await port.run('INSERT INTO feature_spell (feature_id, spell_id) VALUES (?, ?)', [
      featureId,
      spellId,
    ]);
  }

  await port.run('DELETE FROM granted_spell WHERE feature_id = ?', [featureId]);
  for (const granted of feature.grantedSpells ?? []) {
    const spellId = await requiredReference(port, 'spell', granted.spell, sourceId);
    await port.run(
      'INSERT INTO granted_spell (feature_id, spell_id, grant_level, replaceable) VALUES (?, ?, ?, ?)',
      [featureId, spellId, granted.grantLevel, bool(granted.replaceable)],
    );
  }

  await port.run('DELETE FROM feature_effect WHERE feature_id = ?', [featureId]);
  for (const effect of feature.effects ?? []) {
    await port.run('INSERT INTO feature_effect (feature_id, effect_id) VALUES (?, ?)', [
      featureId,
      ids.effects.get(effect.key)!,
    ]);
  }
}

async function writeSpellSatellites(
  port: DatabasePort,
  spell: PackSpell,
  ids: PackIds,
): Promise<void> {
  const spellId = ids.spells.get(spell.key)!;

  await port.run('DELETE FROM spell_damage_type WHERE spell_id = ?', [spellId]);
  for (const damage of spell.damageTypes ?? []) {
    const damageTypeId = await requiredCode(port, 'damage_type', damage.damageType);
    await port.run(
      'INSERT INTO spell_damage_type (spell_id, damage_type_id, selection, delivery) VALUES (?, ?, ?, ?)',
      [spellId, damageTypeId, damage.selection, damage.delivery],
    );
  }
}

async function writeEffectSatellites(
  port: DatabasePort,
  effect: PackEffect,
  ids: PackIds,
): Promise<void> {
  const effectId = ids.effects.get(effect.key)!;

  await writeRollModifiers(port, effect, effectId);
  await writeRecharge(port, effect, effectId);
  await writeAbilityModifiers(port, effect, effectId);
}

async function writeRollModifiers(
  port: DatabasePort,
  effect: PackEffect,
  effectId: number,
): Promise<void> {
  await port.run('DELETE FROM effect_roll_modifier WHERE effect_id = ?', [effectId]);
  for (const modifier of effect.rollModifiers ?? []) {
    const scopeId = await requiredCode(port, 'roll_scope', modifier.scope);
    let damageTypeId: number | null = null;
    if (modifier.damageType !== undefined) {
      damageTypeId = await requiredCode(port, 'damage_type', modifier.damageType);
    }
    await port.run(
      `INSERT INTO effect_roll_modifier
         (effect_id, scope_id, kind, amount, dice, damage_type_id, trigger_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        effectId,
        scopeId,
        modifier.kind,
        modifier.amount,
        modifier.dice ?? null,
        damageTypeId,
        modifier.triggerText ?? null,
      ],
    );
  }
}

async function writeRecharge(
  port: DatabasePort,
  effect: PackEffect,
  effectId: number,
): Promise<void> {
  await port.run('DELETE FROM effect_recharge WHERE effect_id = ?', [effectId]);
  await port.run('DELETE FROM effect_recharge_level_bonus WHERE effect_id = ?', [effectId]);
  if (effect.recharge === undefined) return;

  await port.run(
    `INSERT INTO effect_recharge
       (effect_id, interval, uses_max, short_rest_returns)
     VALUES (?, ?, ?, ?)`,
    [
      effectId,
      effect.recharge.interval,
      effect.recharge.usesMax,
      effect.recharge.shortRestReturns ?? null,
    ],
  );
  for (const bonus of effect.recharge.levelBonuses ?? []) {
    await port.run(
      `INSERT INTO effect_recharge_level_bonus
         (effect_id, class_level, uses_bonus)
       VALUES (?, ?, ?)`,
      [effectId, bonus.classLevel, bonus.usesBonus],
    );
  }
}

async function writeAbilityModifiers(
  port: DatabasePort,
  effect: PackEffect,
  effectId: number,
): Promise<void> {
  await port.run('DELETE FROM effect_modifier WHERE effect_id = ?', [effectId]);
  for (const modifier of effect.modifiers ?? []) {
    const abilityId = await requiredCode(port, 'ability', modifier.ability);
    await port.run(
      `INSERT INTO effect_modifier
         (effect_id, ability_id, amount, max_score, max_delta, sets_to_personal_max)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        effectId,
        abilityId,
        modifier.amount,
        modifier.maxScore ?? 20,
        modifier.maxDelta ?? null,
        bool(modifier.setsToPersonalMax ?? false),
      ],
    );
  }
}

async function findOrCreateDamageModifier(
  port: DatabasePort,
  damageTypeId: number,
  relation: string,
): Promise<number> {
  const existing = await port.get<{ id: number }>(
    'SELECT id FROM damage_modifier WHERE damage_type_id = ? AND relation = ?',
    [damageTypeId, relation],
  );
  if (existing) return existing.id;

  await port.run('INSERT INTO damage_modifier (damage_type_id, relation) VALUES (?, ?)', [
    damageTypeId,
    relation,
  ]);
  return (
    await port.get<{ id: number }>(
      'SELECT id FROM damage_modifier WHERE damage_type_id = ? AND relation = ?',
      [damageTypeId, relation],
    )
  )!.id;
}

async function writeWeapon(
  port: DatabasePort,
  itemKey: string,
  weapon: PackWeapon,
  itemId: number,
): Promise<void> {
  if (weapon.damageType === undefined) {
    throw new PackImportError([`weapon "${itemKey}" has no damage type`]);
  }
  if (weapon.masteryProperty === undefined) {
    throw new PackImportError([`weapon "${itemKey}" has no mastery property`]);
  }

  const categoryId = await requiredCode(port, 'weapon_category', weapon.category);
  const damageTypeId = await requiredCode(port, 'damage_type', weapon.damageType);
  const masteryId = await requiredCode(port, 'mastery_property', weapon.masteryProperty);

  const existing = await port.get<{ item_id: number }>(
    'SELECT item_id FROM weapon WHERE item_id = ?',
    [itemId],
  );
  if (existing) {
    await port.run(
      `UPDATE weapon
          SET category_id = ?, damage_dice = ?, damage_type_id = ?, mastery_property_id = ?
        WHERE item_id = ?`,
      [categoryId, weapon.damageDice, damageTypeId, masteryId, itemId],
    );
    return;
  }

  await port.run(
    `INSERT INTO weapon (item_id, category_id, damage_dice, damage_type_id, mastery_property_id)
     VALUES (?, ?, ?, ?, ?)`,
    [itemId, categoryId, weapon.damageDice, damageTypeId, masteryId],
  );
}

async function writeItemSatellites(
  port: DatabasePort,
  item: PackItem,
  ids: PackIds,
): Promise<void> {
  const itemId = ids.items.get(item.key)!;

  if (item.weapon) {
    await writeWeapon(port, item.key, item.weapon, itemId);
  } else {
    await port.run('DELETE FROM weapon WHERE item_id = ?', [itemId]);
  }

  await port.run('DELETE FROM weapon_property_map WHERE item_id = ?', [itemId]);
  for (const property of item.weapon?.properties ?? []) {
    const propertyId = await requiredCode(port, 'weapon_property', property);
    await port.run('INSERT INTO weapon_property_map (item_id, property_id) VALUES (?, ?)', [
      itemId,
      propertyId,
    ]);
  }

  await port.run('DELETE FROM item_damage_modifier WHERE item_id = ?', [itemId]);
  for (const modifier of item.damageModifiers ?? []) {
    const damageTypeId = await requiredCode(port, 'damage_type', modifier.damageType);
    const damageModifierId = await findOrCreateDamageModifier(
      port,
      damageTypeId,
      modifier.relation,
    );
    await port.run(
      'INSERT INTO item_damage_modifier (item_id, damage_modifier_id, conditions_note) VALUES (?, ?, ?)',
      [itemId, damageModifierId, modifier.conditionsNote ?? null],
    );
  }
}

async function writeSatellites(
  port: DatabasePort,
  file: PackFile,
  sourceId: number,
  ids: PackIds,
  features: readonly FeatureEntry[],
  effects: readonly PackEffect[],
  blockers: string[],
): Promise<void> {
  for (const background of file.backgrounds ?? []) {
    await writeBackgroundSatellites(port, background, ids, sourceId);
  }
  for (const classEntry of file.classes ?? []) {
    await writeClassSatellites(port, classEntry, ids, sourceId, blockers);
  }
  for (const feat of file.feats ?? []) {
    await writeFeatSatellites(port, feat, ids, sourceId);
  }
  for (const entry of features) {
    await writeFeatureSatellites(port, entry.feature, ids, sourceId);
  }
  for (const spell of file.spells ?? []) {
    await writeSpellSatellites(port, spell, ids);
  }
  for (const effect of effects) {
    await writeEffectSatellites(port, effect, ids);
  }
  for (const item of file.items ?? []) {
    await writeItemSatellites(port, item, ids);
  }
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

async function findRemovalBlockers(
  port: DatabasePort,
  sourceId: number,
  file: PackFile,
): Promise<string[]> {
  const declared = declaredKeys(file);
  const blockers: string[] = [];

  for (const table of KEYED_TABLES) {
    const rows = await port.all<{ id: number; slug: string }>(
      `SELECT id, slug FROM "${table}" WHERE source_id = ?`,
      [sourceId],
    );
    const keep = declared.get(table);
    for (const row of rows) {
      if (keep?.has(row.slug)) continue;
      for (const usage of await characterUsages(port, table, row.id)) {
        blockers.push(
          `cannot replace: ${tableNameInProse(table)} "${row.slug}" was removed in this version but is used by character "${usage.character}" (${usage.via})`,
        );
      }
    }
  }

  return blockers;
}

async function deleteRemoved(
  port: DatabasePort,
  sourceId: number,
  file: PackFile,
): Promise<void> {
  const declared = declaredKeys(file);

  for (const table of KEYED_TABLES) {
    const rows = await port.all<{ id: number; slug: string }>(
      `SELECT id, slug FROM "${table}" WHERE source_id = ?`,
      [sourceId],
    );
    const keep = declared.get(table);
    for (const row of rows) {
      if (keep?.has(row.slug)) continue;
      try {
        await port.run(`DELETE FROM "${table}" WHERE id = ?`, [row.id]);
      } catch {
        throw new PackImportError([
          `cannot remove ${tableNameInProse(table)} "${row.slug}"; it is still referenced`,
        ]);
      }
    }
  }
}

export async function importPack(
  port: DatabasePort,
  input: unknown,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const file = await validatePack(port, input);
  const existing = await findSource(port, file.source.key);
  const slug = await targetSlugFor(port, file, existing, options);

  await port.exec('BEGIN');
  try {
    const sourceId = await writeSource(port, file, existing, slug);
    if (options.mode === 'keep-both' && existing) {
      await port.run('UPDATE source SET superseded_by = ? WHERE id = ?', [sourceId, existing.id]);
    }

    const features = collectFeatures(file);
    const effects = collectEffects(file, features);
    const ids = await writeContent(port, file, sourceId, features, effects);

    const blockers: string[] = [];
    await writeSatellites(port, file, sourceId, ids, features, effects, blockers);
    blockers.push(...(await findRemovalBlockers(port, sourceId, file)));
    if (blockers.length > 0) throw new PackImportError(blockers);

    await deleteRemoved(port, sourceId, file);
    await port.exec('COMMIT');
    return { sourceId, sourceSlug: slug };
  } catch (error) {
    await port.exec('ROLLBACK');
    throw error;
  }
}
