import type {
  PackBackground,
  PackClass,
  PackEffect,
  PackFeat,
  PackFeature,
  PackFile,
  PackItem,
  PackSkill,
  PackSkillRef,
  PackSpecies,
  PackSpell,
  PackSubclass,
  PackToolRef,
} from '../models/ContentPack';
import type { DatabasePort } from '../db/DatabasePort';
import {
  CLOSED_TABLES,
  resolveCode,
  resolveReference,
  vocabularySize,
  type ClosedTable,
  type KeyedTable,
} from './references';

/**
 * Phases 1 and 2 of import validation, both entirely before BEGIN, so a
 * malformed file leaves the database untouched. Phase 1 stops at the first
 * problem; phase 2 reports all of them.
 */

/** Carries every problem found, so one error can list them all. */
export class PackValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(summariseProblems(problems));
    this.name = 'PackValidationError';
  }
}

function summariseProblems(problems: string[]): string {
  if (problems.length === 1) {
    return `this pack cannot be imported: ${problems[0]}`;
  }
  const listed = problems.map((problem) => `  - ${problem}`).join('\n');
  return `this pack cannot be imported, ${problems.length} problems:\n${listed}`;
}

const TOP_LEVEL_KEYS = [
  'format',
  'formatVersion',
  'source',
  'skills',
  'tools',
  'languages',
  'conditions',
  'species',
  'backgrounds',
  'classes',
  'feats',
  'spells',
  'effects',
  'items',
] as const;

const COLLECTIONS = TOP_LEVEL_KEYS.filter((key) => key !== 'format' && key !== 'formatVersion' && key !== 'source');

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/** "damage_type" -> "damage type". For prose only, never for SQL. */
function tableNameInProse(table: KeyedTable | ClosedTable): string {
  return table.replace(/_/g, ' ');
}

/** How a value was called in the file, for an error message. */
function describeJsonValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

// ---- Phase 1: structure ----

/** Throws on the first problem: once `species` is known not to be an array,
 *  every check below it would be reporting on nothing. */
export function validateStructure(input: unknown): PackFile {
  if (!isJsonObject(input)) {
    throw new PackValidationError([
      `a pack file must be a JSON object, got ${describeJsonValue(input)}`,
    ]);
  }
  const file = input as Record<string, unknown>;

  if (file['format'] !== 'ember-codex.pack') {
    throw new PackValidationError([
      `"format" must be "ember-codex.pack", got ${JSON.stringify(file['format'])}`,
    ]);
  }
  if (file['formatVersion'] !== 1) {
    throw new PackValidationError([
      `"formatVersion" must be 1, got ${JSON.stringify(file['formatVersion'])}`,
    ]);
  }

  assertSourceBlock(file['source']);

  // A typo in "spellz" would otherwise drop every spell in the file.
  for (const key of Object.keys(file)) {
    if (!TOP_LEVEL_KEYS.includes(key as (typeof TOP_LEVEL_KEYS)[number])) {
      throw new PackValidationError([
        `unknown top-level key "${key}"; a pack file has ${TOP_LEVEL_KEYS.join(', ')}`,
      ]);
    }
  }

  for (const collection of COLLECTIONS) {
    const value = file[collection];
    if (value !== undefined && !Array.isArray(value)) {
      throw new PackValidationError([`"${collection}" must be an array if present`]);
    }
  }

  return file as unknown as PackFile;
}

function assertSourceBlock(source: unknown): void {
  if (!isJsonObject(source)) {
    throw new PackValidationError(['"source" must be an object naming the pack']);
  }
  for (const field of ['key', 'name', 'version'] as const) {
    if (!isNonEmptyString(source[field])) {
      throw new PackValidationError([`"source.${field}" must be a non-empty string`]);
    }
  }
  for (const field of ['license', 'attribution'] as const) {
    const value = source[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      throw new PackValidationError([`"source.${field}" must be a string or null`]);
    }
  }
}

// ---- Phase 2: references ----

/** `kind` decides how it resolves: a pack reference may live in this pack or
 *  another, a vocabulary value may only be the global row. */
interface ReferenceSite {
  kind: 'pack' | 'vocabulary';
  /** The table being referenced, e.g. 'spell' or 'damage_type'. */
  table: KeyedTable | ClosedTable;
  /** The text in the file, e.g. 'skyriding' or 'srd-5.2.1/fireball'. */
  value: string;
  /** What holds the reference, e.g. 'spell "searing-smite"'. */
  heldBy: string;
  /** Where in the file, e.g. 'spells[0].damageTypes[0].damageType'. */
  atPath: string;
}

/** Gathers every reference in a pack file so phase 2 can resolve them. */
class ReferenceCollector {
  private readonly found: ReferenceSite[] = [];

  all(): readonly ReferenceSite[] {
    return this.found;
  }

  /** A `key` or `source/key` reference: spell, skill, feat, effect, ... */
  addPackReference(table: KeyedTable, value: string, heldBy: string, atPath: string): void {
    if (!isNonEmptyString(value)) return;
    this.found.push({ kind: 'pack', table, value, heldBy, atPath });
  }

  /** The same, for a list of references such as `spells: Ref[]`. */
  addPackReferences(
    table: KeyedTable,
    values: readonly string[] | undefined,
    heldBy: string,
    atPath: string,
  ): void {
    for (const [index, value] of (values ?? []).entries()) {
      this.addPackReference(table, value, heldBy, `${atPath}[${index}]`);
    }
  }

  /** A closed-vocabulary value: an ability code, a damage type slug, ... */
  addVocabularyReference(table: ClosedTable, value: string, heldBy: string, atPath: string): void {
    if (!isNonEmptyString(value)) return;
    this.found.push({ kind: 'vocabulary', table, value, heldBy, atPath });
  }

  /** The same, for a list of values such as `abilities: AbilityCode[]`. */
  addVocabularyReferences(
    table: ClosedTable,
    values: readonly string[] | undefined,
    heldBy: string,
    atPath: string,
  ): void {
    for (const [index, value] of (values ?? []).entries()) {
      this.addVocabularyReference(table, value, heldBy, `${atPath}[${index}]`);
    }
  }
}

/** Walks every collection and records every reference it finds. A collection
 *  nobody visits is a reference nobody checks, so each gets its own function. */
function collectEveryReference(file: PackFile): readonly ReferenceSite[] {
  const references = new ReferenceCollector();

  for (const [index, skill] of (file.skills ?? []).entries()) {
    collectSkill(references, skill, index);
  }
  for (const [index, species] of (file.species ?? []).entries()) {
    collectSpecies(references, species, index);
  }
  for (const [index, background] of (file.backgrounds ?? []).entries()) {
    collectBackground(references, background, index);
  }
  for (const [index, classEntry] of (file.classes ?? []).entries()) {
    collectClass(references, classEntry, index);
  }
  for (const [index, feat] of (file.feats ?? []).entries()) {
    collectFeat(references, feat, index);
  }
  for (const [index, spell] of (file.spells ?? []).entries()) {
    collectSpell(references, spell, index);
  }
  for (const [index, effect] of (file.effects ?? []).entries()) {
    collectEffect(references, effect, `effect "${effect.key}"`, `effects[${index}]`);
  }
  for (const [index, item] of (file.items ?? []).entries()) {
    collectItem(references, item, index);
  }

  return references.all();
}

function collectSkill(references: ReferenceCollector, skill: PackSkill, index: number): void {
  // Required even for a custom skill: it is still a check against an ability.
  references.addVocabularyReference(
    'ability',
    skill.ability,
    `skill "${skill.key}"`,
    `skills[${index}].ability`,
  );
}

function collectSpecies(references: ReferenceCollector, species: PackSpecies, index: number): void {
  for (const [variantIndex, variant] of (species.variants ?? []).entries()) {
    const variantPath = `species[${index}].variants[${variantIndex}]`;
    const heldBy = `species variant "${variant.key}"`;

    collectFeatures(references, variant.features, `${variantPath}.features`);
    for (const [grantIndex, granted] of (variant.grantedSpells ?? []).entries()) {
      references.addPackReference(
        'spell',
        granted.spell,
        heldBy,
        `${variantPath}.grantedSpells[${grantIndex}].spell`,
      );
    }
  }
  collectFeatures(references, species.features, `species[${index}].features`);
}

function collectBackground(
  references: ReferenceCollector,
  background: PackBackground,
  index: number,
): void {
  const heldBy = `background "${background.key}"`;
  const atPath = `backgrounds[${index}]`;

  references.addVocabularyReferences('ability', background.abilities, heldBy, `${atPath}.abilities`);
  references.addPackReferences('feat', background.originFeats, heldBy, `${atPath}.originFeats`);
  collectFeatures(references, background.features, `${atPath}.features`);
}

function collectClass(references: ReferenceCollector, classEntry: PackClass, index: number): void {
  const heldBy = `class "${classEntry.key}"`;
  const atPath = `classes[${index}]`;

  if (classEntry.spellcastingAbility !== null && classEntry.spellcastingAbility !== undefined) {
    references.addVocabularyReference(
      'ability',
      classEntry.spellcastingAbility,
      heldBy,
      `${atPath}.spellcastingAbility`,
    );
  }
  for (const [grantIndex, grant] of (classEntry.grants ?? []).entries()) {
    references.addVocabularyReference(
      'class_grant_kind',
      grant.kind,
      heldBy,
      `${atPath}.grants[${grantIndex}].kind`,
    );
  }

  collectProficiencies(references, heldBy, atPath, classEntry);
  references.addPackReferences('spell', classEntry.spells, heldBy, `${atPath}.spells`);
  collectFeatures(references, classEntry.features, `${atPath}.features`);

  for (const [subclassIndex, subclass] of (classEntry.subclasses ?? []).entries()) {
    collectSubclass(references, subclass, `${atPath}.subclasses[${subclassIndex}]`);
  }
}

function collectSubclass(references: ReferenceCollector, subclass: PackSubclass, atPath: string): void {
  const heldBy = `subclass "${subclass.key}"`;

  collectProficiencies(references, heldBy, atPath, subclass);
  references.addPackReferences('spell', subclass.spells, heldBy, `${atPath}.spells`);
  collectFeatures(references, subclass.features, `${atPath}.features`);
}

/** The proficiency lists a class and a subclass both carry. `armourTypes` is not
 *  one of them: armour_type is a CHECK, not a seeded table, so phase 3 refuses it. */
interface ProficiencyGrants {
  skills?: PackSkillRef[];
  tools?: PackToolRef[];
  weaponCategories?: string[];
  savingThrows?: string[];
}

function collectProficiencies(
  references: ReferenceCollector,
  heldBy: string,
  atPath: string,
  grants: ProficiencyGrants,
): void {
  for (const [index, skill] of (grants.skills ?? []).entries()) {
    references.addPackReference('skill', skill.skill, heldBy, `${atPath}.skills[${index}].skill`);
  }
  for (const [index, tool] of (grants.tools ?? []).entries()) {
    references.addPackReference('tool', tool.tool, heldBy, `${atPath}.tools[${index}].tool`);
  }
  references.addVocabularyReferences(
    'weapon_category',
    grants.weaponCategories,
    heldBy,
    `${atPath}.weaponCategories`,
  );
  references.addVocabularyReferences(
    'ability',
    grants.savingThrows,
    heldBy,
    `${atPath}.savingThrows`,
  );
}

function collectFeat(references: ReferenceCollector, feat: PackFeat, index: number): void {
  const heldBy = `feat "${feat.key}"`;
  const atPath = `feats[${index}]`;

  references.addVocabularyReference('feat_category', feat.category, heldBy, `${atPath}.category`);
  for (const [prereqIndex, prereq] of (feat.abilityPrereqs ?? []).entries()) {
    references.addVocabularyReference(
      'ability',
      prereq.ability,
      heldBy,
      `${atPath}.abilityPrereqs[${prereqIndex}].ability`,
    );
  }
  for (const [effectIndex, effect] of (feat.effects ?? []).entries()) {
    collectEffect(references, effect, heldBy, `${atPath}.effects[${effectIndex}]`);
  }
}

function collectSpell(references: ReferenceCollector, spell: PackSpell, index: number): void {
  for (const [damageIndex, damage] of (spell.damageTypes ?? []).entries()) {
    references.addVocabularyReference(
      'damage_type',
      damage.damageType,
      `spell "${spell.key}"`,
      `spells[${index}].damageTypes[${damageIndex}].damageType`,
    );
  }
}

function collectItem(references: ReferenceCollector, item: PackItem, index: number): void {
  const heldBy = `item "${item.key}"`;
  const atPath = `items[${index}]`;

  if (item.weapon?.damageType !== undefined) {
    references.addVocabularyReference(
      'damage_type',
      item.weapon.damageType,
      heldBy,
      `${atPath}.weapon.damageType`,
    );
  }
  collectDamageModifiers(references, heldBy, `${atPath}.damageModifiers`, item.damageModifiers);
}

/** Features nest inside the thing that owns them, never inside another feature. */
function collectFeatures(
  references: ReferenceCollector,
  features: readonly PackFeature[] | undefined,
  atPath: string,
): void {
  for (const [index, feature] of (features ?? []).entries()) {
    const featurePath = `${atPath}[${index}]`;
    const heldBy = `feature "${feature.key}"`;

    references.addPackReferences('spell', feature.spells, heldBy, `${featurePath}.spells`);
    for (const [grantIndex, granted] of (feature.grantedSpells ?? []).entries()) {
      references.addPackReference(
        'spell',
        granted.spell,
        heldBy,
        `${featurePath}.grantedSpells[${grantIndex}].spell`,
      );
    }
    for (const [effectIndex, effect] of (feature.effects ?? []).entries()) {
      collectEffect(references, effect, heldBy, `${featurePath}.effects[${effectIndex}]`);
    }
  }
}

function collectEffect(
  references: ReferenceCollector,
  effect: PackEffect,
  heldBy: string,
  atPath: string,
): void {
  for (const [index, modifier] of (effect.rollModifiers ?? []).entries()) {
    references.addVocabularyReference(
      'roll_scope',
      modifier.scope,
      heldBy,
      `${atPath}.rollModifiers[${index}].scope`,
    );
    if (modifier.damageType !== undefined) {
      references.addVocabularyReference(
        'damage_type',
        modifier.damageType,
        heldBy,
        `${atPath}.rollModifiers[${index}].damageType`,
      );
    }
  }
  for (const [index, modifier] of (effect.modifiers ?? []).entries()) {
    references.addVocabularyReference(
      'ability',
      modifier.ability,
      heldBy,
      `${atPath}.modifiers[${index}].ability`,
    );
  }
  collectDamageModifiers(references, heldBy, `${atPath}.damageModifiers`, effect.damageModifiers);
}

function collectDamageModifiers(
  references: ReferenceCollector,
  heldBy: string,
  atPath: string,
  modifiers: readonly { damageType: string }[] | undefined,
): void {
  for (const [index, modifier] of (modifiers ?? []).entries()) {
    references.addVocabularyReference(
      'damage_type',
      modifier.damageType,
      heldBy,
      `${atPath}[${index}].damageType`,
    );
  }
}

/** The message for one reference that did not resolve. */
function describeUnresolved(
  site: ReferenceSite,
  reason: 'no-such-key' | 'no-such-pack',
  missingPack?: string,
): string {
  if (reason === 'no-such-pack') {
    return `${site.heldBy} references "${site.value}" but no pack "${missingPack}" is installed`;
  }
  const subject = tableNameInProse(site.table as KeyedTable);
  return `${subject} "${site.value}" is referenced by ${site.heldBy} at ${site.atPath} but is not in this pack`;
}

/** The four vocabularies a pack may extend. The table name and the collection
 *  that declares it differ: `condition` is declared in `conditions`. */
const PACK_EXTENSIBLE_VOCABULARY = [
  { table: 'skill', declaredIn: 'skills' },
  { table: 'tool', declaredIn: 'tools' },
  { table: 'language', declaredIn: 'languages' },
  { table: 'condition', declaredIn: 'conditions' },
] as const satisfies readonly { table: KeyedTable; declaredIn: ExtendableCollection }[];

type ExtendableCollection = 'skills' | 'tools' | 'languages' | 'conditions';

/** A pack may add vocabulary, but not redefine a global slug. On `condition`
 *  that is what stops two packs producing two "Poisoned" rows. A CHECK cannot
 *  express it: it compares the file against rows that already exist. */
async function findRedefinedGlobalVocabulary(
  port: DatabasePort,
  file: PackFile,
): Promise<string[]> {
  const problems: string[] = [];
  for (const { table, declaredIn } of PACK_EXTENSIBLE_VOCABULARY) {
    for (const entry of file[declaredIn] ?? []) {
      if (!isNonEmptyString(entry.key)) continue;
      const existing = await port.get<{ id: number }>(
        `SELECT id FROM "${table}" WHERE source_id IS NULL AND slug = ?`,
        [entry.key],
      );
      if (!existing) continue;
      const subject = tableNameInProse(table);
      problems.push(
        `${subject} "${entry.key}" already exists as global vocabulary — reference it rather than redefining it`,
      );
    }
  }
  return problems;
}

/** An unseeded vocabulary table is reported apart from an unknown value: the
 *  first means missing seed data, the second means a bad pack. */
export async function validateReferences(
  port: DatabasePort,
  file: PackFile,
  ownSourceId: number,
): Promise<string[]> {
  const missingSeedTables = await findTablesWithNoSeedData(port);
  if (missingSeedTables.length > 0) {
    return missingSeedTables.map(
      (table) =>
        `cannot check this pack: the ${tableNameInProse(table)} table is empty, so the seed data is missing`,
    );
  }

  const problems = await findRedefinedGlobalVocabulary(port, file);
  for (const site of collectEveryReference(file)) {
    const problem = await checkOne(site, port, ownSourceId);
    if (problem !== undefined) problems.push(problem);
  }
  return problems;
}

async function findTablesWithNoSeedData(port: DatabasePort): Promise<ClosedTable[]> {
  const empty: ClosedTable[] = [];
  for (const table of Object.keys(CLOSED_TABLES) as ClosedTable[]) {
    const size = await vocabularySize(port, table);
    if (size === 0) empty.push(table);
  }
  return empty;
}

async function checkOne(
  site: ReferenceSite,
  port: DatabasePort,
  ownSourceId: number,
): Promise<string | undefined> {
  if (site.kind === 'vocabulary') {
    const result = await resolveCode(port, site.table as ClosedTable, site.value);
    if (result.found) return undefined;
    const subject = tableNameInProse(site.table as ClosedTable);
    return `${site.value} is referenced by ${site.heldBy} at ${site.atPath} but is not a known ${subject}`;
  }

  const result = await resolveReference(port, site.table as KeyedTable, site.value, ownSourceId);
  if (result.found) return undefined;
  if (result.reason === 'no-such-pack') {
    return describeUnresolved(site, result.reason, result.source ?? undefined);
  }
  return describeUnresolved(site, result.reason);
}

/** Runs phase 1 then phase 2, and throws once with everything found. */
export async function validatePack(
  port: DatabasePort,
  input: unknown,
  ownSourceId: number,
): Promise<PackFile> {
  const file = validateStructure(input);
  const problems = await validateReferences(port, file, ownSourceId);
  if (problems.length > 0) throw new PackValidationError(problems);
  return file;
}