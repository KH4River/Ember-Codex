import type { DatabasePort } from '../db/DatabasePort';
import type {
  AbilityCode,
  ArmourType,
  DamageRelation,
  FeatCategory,
  MasteryProperty,
  PackAbilityModifier,
  PackAbilityPrereq,
  PackArmour,
  PackBackground,
  PackClass,
  PackCondition,
  PackConditionModifier,
  PackDamageModifierRef,
  PackEffect,
  PackEffectCrit,
  PackEffectDarkvision,
  PackEffectSpeed,
  PackFeat,
  PackFeature,
  PackFile,
  PackGrantedSpell,
  PackItem,
  PackLanguage,
  PackRecharge,
  PackRollModifier,
  PackSkill,
  PackSpecies,
  PackSpeciesVariant,
  PackSpell,
  PackSpellDamageType,
  PackSubclass,
  PackTool,
  PackWeapon,
  SpeciesSize,
  VariantKind,
  WeaponCategory,
  WeaponProperty,
} from '../models/ContentPack';

/** Reads one pack's rows back out as the file that would write them. Every
 *  list is sorted so the same database exports to the same bytes twice. */

/** What every helper reads through: the connection, and whose pack this is. */
interface Pack {
  port: DatabasePort;
  sourceId: number;
  sourceSlug: string;
}

/** The junction that reaches an effect through the content carrying it. The
 *  format nests an effect under its parent: a feat, a feature, a spell or an
 *  item. */
const EFFECT_JUNCTIONS = {
  feat_effect: 'feat_id',
  feature_effect: 'feature_id',
  spell_effect: 'spell_id',
  item_effect: 'item_id',
} as const;

type EffectJunction = keyof typeof EFFECT_JUNCTIONS;

/** The junction that reaches a damage modifier through the content carrying
 *  it. The modifier itself is a `(damage type, relation)` pair. */
const DAMAGE_MODIFIER_JUNCTIONS = {
  feature_damage_modifier: 'feature_id',
  item_damage_modifier: 'item_id',
  spell_damage_modifier: 'spell_id',
} as const;

type DamageModifierJunction = keyof typeof DAMAGE_MODIFIER_JUNCTIONS;

/** Which of the five owner columns a feature hangs off. */
type FeatureOwner = 'class_id' | 'subclass_id' | 'species_id' | 'variant_id' | 'background_id';

export async function exportPack(port: DatabasePort, sourceSlug: string): Promise<string> {
  const source = await port.get<{
    id: number;
    slug: string;
    name: string;
    version: string;
    license: string | null;
    attribution: string | null;
  }>('SELECT id, slug, name, version, license, attribution FROM source WHERE slug = ?', [sourceSlug]);

  if (source === undefined) throw new Error(`no pack named "${sourceSlug}" is installed`);

  const pack: Pack = { port, sourceId: source.id, sourceSlug: source.slug };

  const file: PackFile = {
    format: 'ember-codex.pack',
    formatVersion: 1,
    source: {
      key: source.slug,
      name: source.name,
      version: source.version,
      license: source.license,
      attribution: source.attribution,
    },
    skills: orAbsent(await skills(pack)),
    tools: orAbsent(await tools(pack)),
    languages: orAbsent(await languages(pack)),
    conditions: orAbsent(await conditions(pack)),
    species: orAbsent(await species(pack)),
    backgrounds: orAbsent(await backgrounds(pack)),
    classes: orAbsent(await classes(pack)),
    feats: orAbsent(await feats(pack)),
    spells: orAbsent(await spells(pack)),
    effects: orAbsent(await unlinkedEffects(pack)),
    items: orAbsent(await items(pack)),
  };

  return JSON.stringify(file, null, 2);
}

/** A pack with no rows for a collection does not name it at all: absent
 *  means "this pack adds none". */
function orAbsent<T>(rows: T[]): T[] | undefined {
  if (rows.length === 0) return undefined;
  return rows;
}

/** A nullable column crosses the file only when it holds a value. */
function orUndefined<T>(value: T | null): T | undefined {
  if (value === null) return undefined;
  return value;
}

/** A column whose default is zero crosses the file only when it is not zero. */
function orUndefinedWhenZero(value: number): number | undefined {
  if (value === 0) return undefined;
  return value;
}

/** Writes a reference: the target's own key when this pack or no pack owns
 *  it, `source/key` when another pack does. */
function reference(pack: Pack, row: { slug: string; owner: string | null }): string {
  if (row.owner === null || row.owner === pack.sourceSlug) return row.slug;
  return `${row.owner}/${row.slug}`;
}

// ---- Pack-extensible vocabulary ----

async function skills(pack: Pack): Promise<PackSkill[]> {
  const rows = await pack.port.all<{ slug: string; name: string; ability: AbilityCode }>(
    `SELECT s.slug, s.name, a.code AS ability
       FROM skill s JOIN ability a ON a.id = s.ability_id
      WHERE s.source_id = ?
      ORDER BY s.slug`,
    [pack.sourceId],
  );
  return rows.map((row) => ({ key: row.slug, name: row.name, ability: row.ability }));
}

async function tools(pack: Pack): Promise<PackTool[]> {
  const rows = await pack.port.all<{ slug: string; name: string; is_artisan: number }>(
    'SELECT slug, name, is_artisan FROM tool WHERE source_id = ? ORDER BY slug',
    [pack.sourceId],
  );
  return rows.map((row) => ({
    key: row.slug,
    name: row.name,
    isArtisan: row.is_artisan === 1,
  }));
}

async function languages(pack: Pack): Promise<PackLanguage[]> {
  const rows = await pack.port.all<{ slug: string; name: string }>(
    'SELECT slug, name FROM language WHERE source_id = ? ORDER BY slug',
    [pack.sourceId],
  );
  return rows.map((row) => ({ key: row.slug, name: row.name }));
}

async function conditions(pack: Pack): Promise<PackCondition[]> {
  const rows = await pack.port.all<{ slug: string; name: string; description: string | null }>(
    'SELECT slug, name, description FROM condition WHERE source_id = ? ORDER BY slug',
    [pack.sourceId],
  );
  return rows.map((row) => ({
    key: row.slug,
    name: row.name,
    description: orUndefined(row.description),
  }));
}

// ---- Species and features ----

async function species(pack: Pack): Promise<PackSpecies[]> {
  const rows = await pack.port.all<{
    id: number;
    slug: string;
    name: string;
    size: SpeciesSize;
    speed: number;
  }>('SELECT id, slug, name, size, speed FROM species WHERE source_id = ? ORDER BY slug', [
    pack.sourceId,
  ]);

  const result: PackSpecies[] = [];
  for (const row of rows) {
    const variants = await speciesVariants(pack, row.id);
    const features = await ownerFeatures(pack, 'species_id', row.id);
    result.push({
      key: row.slug,
      name: row.name,
      size: row.size,
      speed: row.speed,
      variants: orAbsent(variants),
      features: orAbsent(features),
    });
  }
  return result;
}

async function speciesVariants(pack: Pack, speciesId: number): Promise<PackSpeciesVariant[]> {
  const rows = await pack.port.all<{
    id: number;
    slug: string;
    name: string;
    variant_kind: VariantKind;
  }>(
    `SELECT id, slug, name, variant_kind
       FROM species_variant
      WHERE source_id = ? AND species_id = ?
      ORDER BY slug`,
    [pack.sourceId, speciesId],
  );

  const variants: PackSpeciesVariant[] = [];
  for (const row of rows) {
    const features = await ownerFeatures(pack, 'variant_id', row.id);
    variants.push({
      key: row.slug,
      name: row.name,
      variantKind: row.variant_kind,
      features: orAbsent(features),
    });
  }
  return variants;
}

async function ownerFeatures(
  pack: Pack,
  owner: FeatureOwner,
  ownerId: number,
): Promise<PackFeature[]> {
  const rows = await pack.port.all<{
    id: number;
    slug: string;
    name: string;
    description: string;
    level: number | null;
  }>(
    `SELECT id, slug, name, description, level
       FROM feature
      WHERE source_id = ? AND ${owner} = ?
      ORDER BY slug`,
    [pack.sourceId, ownerId],
  );

  const features: PackFeature[] = [];
  for (const row of rows) {
    features.push({
      key: row.slug,
      name: row.name,
      description: row.description,
      level: row.level,
      spells: orAbsent(await featureSpells(pack, row.id)),
      grantedSpells: orAbsent(await grantedSpells(pack, row.id)),
      effects: orAbsent(await junctionEffects(pack, 'feature_effect', row.id)),
      damageModifiers: orAbsent(await damageModifiers(pack, 'feature_damage_modifier', row.id)),
    });
  }
  return features;
}

async function featureSpells(pack: Pack, featureId: number): Promise<string[]> {
  const rows = await pack.port.all<{ slug: string; owner: string | null }>(
    `SELECT sp.slug, o.slug AS owner
       FROM feature_spell fs
       JOIN spell sp ON sp.id = fs.spell_id
       LEFT JOIN source o ON o.id = sp.source_id
      WHERE fs.feature_id = ?
      ORDER BY sp.slug`,
    [featureId],
  );
  return rows.map((row) => reference(pack, row));
}

async function grantedSpells(pack: Pack, featureId: number): Promise<PackGrantedSpell[]> {
  const rows = await pack.port.all<{
    slug: string;
    owner: string | null;
    grant_level: number | null;
    replaceable: number;
  }>(
    `SELECT sp.slug, o.slug AS owner, gs.grant_level, gs.replaceable
       FROM granted_spell gs
       JOIN spell sp ON sp.id = gs.spell_id
       LEFT JOIN source o ON o.id = sp.source_id
      WHERE gs.feature_id = ?
      ORDER BY sp.slug`,
    [featureId],
  );
  return rows.map((row) => ({
    spell: reference(pack, row),
    grantLevel: row.grant_level,
    replaceable: row.replaceable === 1,
  }));
}

// ---- Backgrounds ----

async function backgrounds(pack: Pack): Promise<PackBackground[]> {
  const rows = await pack.port.all<{
    id: number;
    slug: string;
    name: string;
    description: string | null;
  }>(
    'SELECT id, slug, name, description FROM background WHERE source_id = ? ORDER BY slug',
    [pack.sourceId],
  );

  const result: PackBackground[] = [];
  for (const row of rows) {
    result.push({
      key: row.slug,
      name: row.name,
      description: orUndefined(row.description),
      abilities: await backgroundAbilities(pack, row.id),
      originFeats: orAbsent(await backgroundOriginFeats(pack, row.id)),
      features: orAbsent(await ownerFeatures(pack, 'background_id', row.id)),
    });
  }
  return result;
}

async function backgroundAbilities(pack: Pack, backgroundId: number): Promise<AbilityCode[]> {
  const rows = await pack.port.all<{ code: AbilityCode }>(
    `SELECT a.code
       FROM background_ability ba JOIN ability a ON a.id = ba.ability_id
      WHERE ba.background_id = ?
      ORDER BY a.code`,
    [backgroundId],
  );
  return rows.map((row) => row.code);
}

async function backgroundOriginFeats(pack: Pack, backgroundId: number): Promise<string[]> {
  const rows = await pack.port.all<{ slug: string; owner: string | null }>(
    `SELECT f.slug, o.slug AS owner
       FROM background_origin_feat bof
       JOIN feat f ON f.id = bof.feat_id
       LEFT JOIN source o ON o.id = f.source_id
      WHERE bof.background_id = ?
      ORDER BY f.slug`,
    [backgroundId],
  );
  return rows.map((row) => reference(pack, row));
}

// ---- Classes and subclasses ----

async function classes(pack: Pack): Promise<PackClass[]> {
  const rows = await pack.port.all<{
    id: number;
    slug: string;
    name: string;
    hit_die: PackClass['hitDie'];
    casting_progression: PackClass['castingProgression'];
    spellcasting_ability: AbilityCode | null;
  }>(
    `SELECT c.id, c.slug, c.name, c.hit_die, c.casting_progression, a.code AS spellcasting_ability
       FROM class c LEFT JOIN ability a ON a.id = c.spellcasting_ability_id
      WHERE c.source_id = ?
      ORDER BY c.slug`,
    [pack.sourceId],
  );

  const result: PackClass[] = [];
  for (const row of rows) {
    result.push({
      key: row.slug,
      name: row.name,
      hitDie: row.hit_die,
      spellcastingAbility: row.spellcasting_ability,
      castingProgression: row.casting_progression,
      grants: orAbsent(await grants(pack, row.id)),
      cantripCounts: orAbsent(await cantripCounts(pack, row.id)),
      preparedCounts: orAbsent(await preparedCounts(pack, row.id)),
      spellSlots: orAbsent(await spellSlots(pack, row.id)),
      slotRecovery: await slotRecovery(pack, row.id),
      savingThrows: orAbsent(await classSavingThrows(pack, row.id)),
      skills: orAbsent(await classSkills(pack, row.id)),
      tools: orAbsent(await classTools(pack, row.id)),
      armourTypes: orAbsent(await classArmourTypes(pack, row.id)),
      weaponCategories: orAbsent(await classWeaponCategories(pack, row.id)),
      spells: orAbsent(await classSpells(pack, row.id)),
      features: orAbsent(await ownerFeatures(pack, 'class_id', row.id)),
      subclasses: orAbsent(await subclasses(pack, row.id)),
    });
  }
  return result;
}

async function grants(
  pack: Pack,
  classId: number,
): Promise<NonNullable<PackClass['grants']>> {
  const rows = await pack.port.all<{ level: number; kind: string; opens: number }>(
    `SELECT class_level AS level, grant_kind AS kind, opens
       FROM class_grant_slot
      WHERE class_id = ?
      ORDER BY class_level, grant_kind`,
    [classId],
  );
  return rows;
}

async function cantripCounts(
  pack: Pack,
  classId: number,
): Promise<NonNullable<PackClass['cantripCounts']>> {
  return pack.port.all<{ level: number; cantrips: number }>(
    `SELECT class_level AS level, cantrips
       FROM class_cantrip_count
      WHERE class_id = ?
      ORDER BY class_level`,
    [classId],
  );
}

async function preparedCounts(
  pack: Pack,
  classId: number,
): Promise<NonNullable<PackClass['preparedCounts']>> {
  return pack.port.all<{ level: number; spellLevel: number; maxPrepared: number }>(
    `SELECT class_level AS level, spell_level AS spellLevel, max_prepared AS maxPrepared
       FROM class_prepared_count
      WHERE class_id = ?
      ORDER BY class_level, spell_level`,
    [classId],
  );
}

async function spellSlots(
  pack: Pack,
  classId: number,
): Promise<NonNullable<PackClass['spellSlots']>> {
  return pack.port.all<{ level: number; slotLevel: number; slotCount: number }>(
    `SELECT class_level AS level, slot_level AS slotLevel, slot_count AS slotCount
       FROM class_spell_slot
      WHERE class_id = ?
      ORDER BY class_level, slot_level`,
    [classId],
  );
}

async function slotRecovery(pack: Pack, classId: number): Promise<PackClass['slotRecovery']> {
  const row = await pack.port.get<{ interval: NonNullable<PackClass['slotRecovery']> }>(
    'SELECT interval FROM class_slot_recovery WHERE class_id = ?',
    [classId],
  );
  if (row === undefined) return null;
  return row.interval;
}

async function classSavingThrows(pack: Pack, classId: number): Promise<AbilityCode[]> {
  const rows = await pack.port.all<{ code: AbilityCode }>(
    `SELECT a.code
       FROM class_saving_throw cs JOIN ability a ON a.id = cs.ability_id
      WHERE cs.class_id = ?
      ORDER BY a.code`,
    [classId],
  );
  return rows.map((row) => row.code);
}

async function classSkills(pack: Pack, classId: number): Promise<{ skill: string }[]> {
  const rows = await pack.port.all<{ slug: string; owner: string | null }>(
    `SELECT s.slug, o.slug AS owner
       FROM class_skill cs
       JOIN skill s ON s.id = cs.skill_id
       LEFT JOIN source o ON o.id = s.source_id
      WHERE cs.class_id = ?
      ORDER BY s.slug`,
    [classId],
  );
  return rows.map((row) => ({ skill: reference(pack, row) }));
}

async function classTools(pack: Pack, classId: number): Promise<{ tool: string }[]> {
  const rows = await pack.port.all<{ slug: string; owner: string | null }>(
    `SELECT t.slug, o.slug AS owner
       FROM class_tool ct
       JOIN tool t ON t.id = ct.tool_id
       LEFT JOIN source o ON o.id = t.source_id
      WHERE ct.class_id = ?
      ORDER BY t.slug`,
    [classId],
  );
  return rows.map((row) => ({ tool: reference(pack, row) }));
}

async function classArmourTypes(pack: Pack, classId: number): Promise<ArmourType[]> {
  const rows = await pack.port.all<{ armour_type: ArmourType }>(
    'SELECT armour_type FROM class_armour_type WHERE class_id = ? ORDER BY armour_type',
    [classId],
  );
  return rows.map((row) => row.armour_type);
}

async function classWeaponCategories(pack: Pack, classId: number): Promise<WeaponCategory[]> {
  const rows = await pack.port.all<{ code: WeaponCategory }>(
    `SELECT w.code
       FROM class_weapon_category cw JOIN weapon_category w ON w.id = cw.category_id
      WHERE cw.class_id = ?
      ORDER BY w.code`,
    [classId],
  );
  return rows.map((row) => row.code);
}

async function classSpells(pack: Pack, classId: number): Promise<string[]> {
  const rows = await pack.port.all<{ slug: string; owner: string | null }>(
    `SELECT sp.slug, o.slug AS owner
       FROM class_spell cs
       JOIN spell sp ON sp.id = cs.spell_id
       LEFT JOIN source o ON o.id = sp.source_id
      WHERE cs.class_id = ?
      ORDER BY sp.slug`,
    [classId],
  );
  return rows.map((row) => reference(pack, row));
}

async function subclasses(pack: Pack, classId: number): Promise<PackSubclass[]> {
  const rows = await pack.port.all<{
    id: number;
    slug: string;
    name: string;
    unlock_level: number;
  }>(
    `SELECT id, slug, name, unlock_level
       FROM subclass
      WHERE source_id = ? AND class_id = ?
      ORDER BY slug`,
    [pack.sourceId, classId],
  );

  const result: PackSubclass[] = [];
  for (const row of rows) {
    result.push({
      key: row.slug,
      name: row.name,
      unlockLevel: row.unlock_level,
      skills: orAbsent(await subclassSkills(pack, row.id)),
      tools: orAbsent(await subclassTools(pack, row.id)),
      armourTypes: orAbsent(await subclassArmourTypes(pack, row.id)),
      features: orAbsent(await ownerFeatures(pack, 'subclass_id', row.id)),
    });
  }
  return result;
}

async function subclassSkills(pack: Pack, subclassId: number): Promise<{ skill: string }[]> {
  const rows = await pack.port.all<{ slug: string; owner: string | null }>(
    `SELECT s.slug, o.slug AS owner
       FROM subclass_skill ss
       JOIN skill s ON s.id = ss.skill_id
       LEFT JOIN source o ON o.id = s.source_id
      WHERE ss.subclass_id = ?
      ORDER BY s.slug`,
    [subclassId],
  );
  return rows.map((row) => ({ skill: reference(pack, row) }));
}

async function subclassTools(pack: Pack, subclassId: number): Promise<{ tool: string }[]> {
  const rows = await pack.port.all<{ slug: string; owner: string | null }>(
    `SELECT t.slug, o.slug AS owner
       FROM subclass_tool st
       JOIN tool t ON t.id = st.tool_id
       LEFT JOIN source o ON o.id = t.source_id
      WHERE st.subclass_id = ?
      ORDER BY t.slug`,
    [subclassId],
  );
  return rows.map((row) => ({ tool: reference(pack, row) }));
}

async function subclassArmourTypes(pack: Pack, subclassId: number): Promise<ArmourType[]> {
  const rows = await pack.port.all<{ armour_type: ArmourType }>(
    'SELECT armour_type FROM subclass_armour_type WHERE subclass_id = ? ORDER BY armour_type',
    [subclassId],
  );
  return rows.map((row) => row.armour_type);
}

// ---- Feats and effects ----

async function feats(pack: Pack): Promise<PackFeat[]> {
  const rows = await pack.port.all<{
    id: number;
    slug: string;
    name: string;
    description: string;
    category: FeatCategory;
  }>(
    `SELECT f.id, f.slug, f.name, f.description, fc.code AS category
       FROM feat f JOIN feat_category fc ON fc.id = f.category_id
      WHERE f.source_id = ?
      ORDER BY f.slug`,
    [pack.sourceId],
  );

  const result: PackFeat[] = [];
  for (const row of rows) {
    result.push({
      key: row.slug,
      name: row.name,
      description: row.description,
      category: row.category,
      abilityPrereqs: orAbsent(await abilityPrereqs(pack, row.id)),
      effects: orAbsent(await junctionEffects(pack, 'feat_effect', row.id)),
    });
  }
  return result;
}

async function abilityPrereqs(pack: Pack, featId: number): Promise<PackAbilityPrereq[]> {
  const rows = await pack.port.all<{ ability: AbilityCode; min_score: number }>(
    `SELECT a.code AS ability, p.min_score
       FROM feat_ability_prereq p JOIN ability a ON a.id = p.ability_id
      WHERE p.feat_id = ?
      ORDER BY a.code`,
    [featId],
  );
  return rows.map((row) => ({ ability: row.ability, minScore: row.min_score }));
}

interface EffectRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  base_value: number;
}

async function junctionEffects(
  pack: Pack,
  junction: EffectJunction,
  parentId: number,
): Promise<PackEffect[]> {
  const rows = await pack.port.all<EffectRow>(
    `SELECT e.id, e.slug, e.name, e.description, e.base_value
       FROM effect e JOIN ${junction} j ON j.effect_id = e.id
      WHERE j.${EFFECT_JUNCTIONS[junction]} = ? AND e.source_id = ?
      ORDER BY e.slug`,
    [parentId, pack.sourceId],
  );

  const effects: PackEffect[] = [];
  for (const row of rows) {
    effects.push(await effect(pack, row));
  }
  return effects;
}

/** The pack's own effects no feat, feature, spell or item carries: the file's
 *  top-level `effects` collection. */
async function unlinkedEffects(pack: Pack): Promise<PackEffect[]> {
  const rows = await pack.port.all<EffectRow>(
    `SELECT e.id, e.slug, e.name, e.description, e.base_value
       FROM effect e
      WHERE e.source_id = ?
        AND NOT EXISTS (SELECT 1 FROM feat_effect WHERE effect_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM feature_effect WHERE effect_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM spell_effect WHERE effect_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM item_effect WHERE effect_id = e.id)
      ORDER BY e.slug`,
    [pack.sourceId],
  );

  const effects: PackEffect[] = [];
  for (const row of rows) {
    effects.push(await effect(pack, row));
  }
  return effects;
}

async function effect(pack: Pack, row: EffectRow): Promise<PackEffect> {
  return {
    key: row.slug,
    name: row.name,
    description: orUndefined(row.description),
    baseValue: row.base_value,
    speed: await effectSpeed(pack, row.id),
    darkvision: await effectDarkvision(pack, row.id),
    crit: await effectCrit(pack, row.id),
    size: await effectSize(pack, row.id),
    weaponProperties: orAbsent(await effectWeaponProperties(pack, row.id)),
    languages: orAbsent(await effectLanguages(pack, row.id)),
    conditionModifiers: orAbsent(await effectConditionModifiers(pack, row.id)),
    rollModifiers: orAbsent(await rollModifiers(pack, row.id)),
    recharge: await recharge(pack, row.id),
    modifiers: orAbsent(await effectModifiers(pack, row.id)),
  };
}

async function effectSpeed(pack: Pack, effectId: number): Promise<PackEffectSpeed | undefined> {
  const row = await pack.port.get<{ speed_delta: number }>(
    'SELECT speed_delta FROM effect_speed WHERE effect_id = ?',
    [effectId],
  );
  if (row === undefined) return undefined;
  return { speedDelta: row.speed_delta };
}

async function effectDarkvision(
  pack: Pack,
  effectId: number,
): Promise<PackEffectDarkvision | undefined> {
  const row = await pack.port.get<{ range_feet: number }>(
    'SELECT range_feet FROM effect_darkvision WHERE effect_id = ?',
    [effectId],
  );
  if (row === undefined) return undefined;
  return { rangeFeet: row.range_feet };
}

async function effectCrit(pack: Pack, effectId: number): Promise<PackEffectCrit | undefined> {
  const row = await pack.port.get<{ threshold: number }>(
    'SELECT threshold FROM effect_crit WHERE effect_id = ?',
    [effectId],
  );
  if (row === undefined) return undefined;
  return { threshold: row.threshold };
}

async function effectSize(pack: Pack, effectId: number): Promise<SpeciesSize | undefined> {
  const row = await pack.port.get<{ size: SpeciesSize }>(
    'SELECT size FROM effect_size WHERE effect_id = ?',
    [effectId],
  );
  if (row === undefined) return undefined;
  return row.size;
}

async function effectWeaponProperties(pack: Pack, effectId: number): Promise<WeaponProperty[]> {
  const rows = await pack.port.all<{ code: WeaponProperty }>(
    `SELECT wp.code
       FROM effect_weapon_property p JOIN weapon_property wp ON wp.id = p.property_id
      WHERE p.effect_id = ?
      ORDER BY wp.code`,
    [effectId],
  );
  return rows.map((row) => row.code);
}

async function effectLanguages(pack: Pack, effectId: number): Promise<string[]> {
  const rows = await pack.port.all<{ slug: string; owner: string | null }>(
    `SELECT l.slug, o.slug AS owner
       FROM effect_language el
       JOIN language l ON l.id = el.language_id
       LEFT JOIN source o ON o.id = l.source_id
      WHERE el.effect_id = ?
      ORDER BY o.slug, l.slug`,
    [effectId],
  );
  return rows.map((row) => reference(pack, row));
}

async function effectConditionModifiers(
  pack: Pack,
  effectId: number,
): Promise<PackConditionModifier[]> {
  const rows = await pack.port.all<{
    slug: string;
    owner: string | null;
    relation: DamageRelation;
  }>(
    `SELECT c.slug, o.slug AS owner, m.relation
       FROM effect_condition_modifier m
       JOIN condition c ON c.id = m.condition_id
       LEFT JOIN source o ON o.id = c.source_id
      WHERE m.effect_id = ?
      ORDER BY o.slug, c.slug, m.relation`,
    [effectId],
  );
  return rows.map((row) => ({
    condition: reference(pack, row),
    relation: row.relation,
  }));
}

async function rollModifiers(pack: Pack, effectId: number): Promise<PackRollModifier[]> {
  const rows = await pack.port.all<{
    scope: string;
    kind: PackRollModifier['kind'];
    amount: number;
    dice: string | null;
    damage_type: string | null;
    trigger_text: string | null;
  }>(
    `SELECT rs.code AS scope, m.kind, m.amount, m.dice, dt.slug AS damage_type, m.trigger_text
       FROM effect_roll_modifier m
       JOIN roll_scope rs ON rs.id = m.scope_id
       LEFT JOIN damage_type dt ON dt.id = m.damage_type_id
      WHERE m.effect_id = ?
      ORDER BY rs.code, m.kind`,
    [effectId],
  );

  return rows.map((row) => ({
    scope: row.scope,
    kind: row.kind,
    amount: row.amount,
    dice: orUndefined(row.dice),
    damageType: orUndefined(row.damage_type),
    triggerText: orUndefined(row.trigger_text),
  }));
}

async function recharge(pack: Pack, effectId: number): Promise<PackRecharge | undefined> {
  const row = await pack.port.get<{
    interval: PackRecharge['interval'];
    uses_max: number;
    short_rest_returns: number | null;
  }>(
    'SELECT interval, uses_max, short_rest_returns FROM effect_recharge WHERE effect_id = ?',
    [effectId],
  );
  if (row === undefined) return undefined;

  return {
    interval: row.interval,
    usesMax: row.uses_max,
    shortRestReturns: orUndefined(row.short_rest_returns),
    levelBonuses: orAbsent(
      await pack.port.all<{ classLevel: number; usesBonus: number }>(
        `SELECT class_level AS classLevel, uses_bonus AS usesBonus
           FROM effect_recharge_level_bonus
          WHERE effect_id = ?
          ORDER BY class_level`,
        [effectId],
      ),
    ),
  };
}

async function effectModifiers(pack: Pack, effectId: number): Promise<PackAbilityModifier[]> {
  const rows = await pack.port.all<{
    ability: AbilityCode;
    amount: number;
    max_score: number;
    max_delta: number | null;
    sets_to_personal_max: number;
  }>(
    `SELECT a.code AS ability, m.amount, m.max_score, m.max_delta, m.sets_to_personal_max
       FROM effect_modifier m JOIN ability a ON a.id = m.ability_id
      WHERE m.effect_id = ?
      ORDER BY a.code`,
    [effectId],
  );

  const modifiers: PackAbilityModifier[] = [];
  for (const row of rows) {
    const modifier: PackAbilityModifier = {
      ability: row.ability,
      amount: row.amount,
      maxScore: row.max_score,
      maxDelta: orUndefined(row.max_delta),
    };
    if (row.sets_to_personal_max === 1) modifier.setsToPersonalMax = true;
    modifiers.push(modifier);
  }
  return modifiers;
}

// ---- Spells ----

async function spells(pack: Pack): Promise<PackSpell[]> {
  const rows = await pack.port.all<{
    id: number;
    slug: string;
    name: string;
    spell_level: number;
    school: PackSpell['school'];
    casting_time: string;
    spell_range: string;
    duration: string;
    concentration: number;
    ritual: number;
    verbal: number;
    somatic: number;
    material: number;
    material_cost_cp: number;
    description: string | null;
  }>(
    `SELECT id, slug, name, spell_level, school, casting_time, spell_range, duration,
            concentration, ritual, verbal, somatic, material, material_cost_cp, description
       FROM spell
      WHERE source_id = ?
      ORDER BY slug`,
    [pack.sourceId],
  );

  const result: PackSpell[] = [];
  for (const row of rows) {
    result.push({
      key: row.slug,
      name: row.name,
      spellLevel: row.spell_level,
      school: row.school,
      castingTime: row.casting_time,
      spellRange: row.spell_range,
      duration: row.duration,
      concentration: row.concentration === 1,
      ritual: row.ritual === 1,
      verbal: row.verbal === 1,
      somatic: row.somatic === 1,
      material: row.material === 1,
      materialCostCp: row.material_cost_cp,
      description: orUndefined(row.description),
      damageTypes: orAbsent(await spellDamageTypes(pack, row.id)),
      effects: orAbsent(await junctionEffects(pack, 'spell_effect', row.id)),
      damageModifiers: orAbsent(await damageModifiers(pack, 'spell_damage_modifier', row.id)),
    });
  }
  return result;
}

async function spellDamageTypes(pack: Pack, spellId: number): Promise<PackSpellDamageType[]> {
  const rows = await pack.port.all<{
    damage_type: string;
    selection: PackSpellDamageType['selection'];
    delivery: PackSpellDamageType['delivery'];
  }>(
    `SELECT dt.slug AS damage_type, s.selection, s.delivery
       FROM spell_damage_type s JOIN damage_type dt ON dt.id = s.damage_type_id
      WHERE s.spell_id = ?
      ORDER BY dt.slug`,
    [spellId],
  );
  return rows.map((row) => ({
    damageType: row.damage_type,
    selection: row.selection,
    delivery: row.delivery,
  }));
}

// ---- Items ----

async function items(pack: Pack): Promise<PackItem[]> {
  const rows = await pack.port.all<{
    id: number;
    slug: string;
    name: string;
    weight: number;
    cost_cp: number;
    description: string | null;
    requires_attunement: number;
    is_ammunition: number;
  }>(
    `SELECT i.id, i.slug, i.name, i.weight, i.cost_cp, i.description, i.requires_attunement,
            EXISTS (SELECT 1 FROM ammunition a WHERE a.item_id = i.id) AS is_ammunition
       FROM item i
      WHERE i.source_id = ?
      ORDER BY i.slug`,
    [pack.sourceId],
  );

  const result: PackItem[] = [];
  for (const row of rows) {
    const item: PackItem = {
      key: row.slug,
      name: row.name,
      weight: row.weight,
      costCp: row.cost_cp,
      description: orUndefined(row.description),
      requiresAttunement: row.requires_attunement === 1,
      weapon: await weapon(pack, row),
      armour: await armour(pack, row),
      effects: orAbsent(await junctionEffects(pack, 'item_effect', row.id)),
      damageModifiers: orAbsent(await damageModifiers(pack, 'item_damage_modifier', row.id)),
    };
    if (row.is_ammunition === 1) item.ammunition = true;
    result.push(item);
  }
  return result;
}

async function weapon(pack: Pack, item: { id: number }): Promise<PackWeapon | undefined> {
  const row = await pack.port.get<{
    category: WeaponCategory;
    damage_dice: string;
    damage_type: string;
    mastery_property: MasteryProperty | null;
    versatile_dice: string | null;
    attack_bonus: number;
    damage_bonus: number;
    thrown_range: number | null;
    ammunition_slug: string | null;
    ammunition_owner: string | null;
  }>(
    `SELECT wc.code AS category, w.damage_dice, dt.slug AS damage_type, mp.code AS mastery_property,
            w.versatile_dice, w.attack_bonus, w.damage_bonus, w.thrown_range,
            ai.slug AS ammunition_slug, ao.slug AS ammunition_owner
       FROM weapon w
       JOIN weapon_category wc ON wc.id = w.category_id
       JOIN damage_type dt ON dt.id = w.damage_type_id
       LEFT JOIN mastery_property mp ON mp.id = w.mastery_property_id
       LEFT JOIN item ai ON ai.id = w.ammunition_id
       LEFT JOIN source ao ON ao.id = ai.source_id
      WHERE w.item_id = ?`,
    [item.id],
  );
  if (row === undefined) return undefined;

  const properties = await pack.port.all<{ code: WeaponProperty }>(
    `SELECT w.code
       FROM weapon_property_map wm JOIN weapon_property w ON w.id = wm.property_id
      WHERE wm.item_id = ?
      ORDER BY w.code`,
    [item.id],
  );

  const result: PackWeapon = {
    category: row.category,
    damageDice: row.damage_dice,
    damageType: row.damage_type,
    masteryProperty: orUndefined(row.mastery_property),
    versatileDice: orUndefined(row.versatile_dice),
    attackBonus: orUndefinedWhenZero(row.attack_bonus),
    damageBonus: orUndefinedWhenZero(row.damage_bonus),
    thrownRange: orUndefined(row.thrown_range),
    properties: orAbsent(properties.map((property) => property.code)),
  };
  if (row.ammunition_slug !== null) {
    result.ammunition = reference(pack, {
      slug: row.ammunition_slug,
      owner: row.ammunition_owner,
    });
  }
  return result;
}

async function armour(pack: Pack, item: { id: number }): Promise<PackArmour | undefined> {
  const row = await pack.port.get<{
    armour_type: ArmourType;
    base_ac: number;
    max_dex_bonus: number | null;
    stealth_disadvantage: number;
  }>(
    `SELECT armour_type, base_ac, max_dex_bonus, stealth_disadvantage
       FROM armour
      WHERE item_id = ?`,
    [item.id],
  );
  if (row === undefined) return undefined;
  return {
    armourType: row.armour_type,
    baseAc: row.base_ac,
    maxDexBonus: orUndefined(row.max_dex_bonus),
    stealthDisadvantage: row.stealth_disadvantage === 1,
  };
}

async function damageModifiers(
  pack: Pack,
  junction: DamageModifierJunction,
  parentId: number,
): Promise<PackDamageModifierRef[]> {
  const column = DAMAGE_MODIFIER_JUNCTIONS[junction];
  const rows = await pack.port.all<{
    damage_type: string;
    relation: PackDamageModifierRef['relation'];
    conditions_note: string | null;
  }>(
    `SELECT dt.slug AS damage_type, dm.relation, j.conditions_note
       FROM ${junction} j
       JOIN damage_modifier dm ON dm.id = j.damage_modifier_id
       JOIN damage_type dt ON dt.id = dm.damage_type_id
      WHERE j.${column} = ?
      ORDER BY dt.slug, dm.relation`,
    [parentId],
  );
  return rows.map((row) => ({
    damageType: row.damage_type,
    relation: row.relation,
    conditionsNote: orUndefined(row.conditions_note),
  }));
}
