/**
 * The JSON types of a content pack. These mirror
 * shared/db/migrations/001_initial.sql the way Character.ts does.
 *
 * Four things never appear in a pack file:
 *
 *   - `source_id`. Pack identity is `source.key`.
 *   - `imported_at`. It records when *this user* imported the pack.
 *   - `xp_threshold`. No source_id, no slug, so a file cannot key on it.
 *   - `damage_modifier`. Derived from its referrer, exported inline on it.
 *
 * shared/packs/mapping.ts maps these names to columns.
 */

// ---- Vocabulary, referenced by code rather than by key ----

/** `ability.code`. Closed vocabulary, six values, seeded by the migration. */
export type AbilityCode = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';

/** `feat_category.code`. */
export type FeatCategory = 'origin' | 'general' | 'fighting_style' | 'epic_boon';

/** `class_grant_kind.code`. A fifth mechanic is a seed INSERT, not a schema
 *  change, so a pack may use a value this union does not list. */
export type KnownGrantKind =
  | 'asi_or_feat'
  | 'epic_boon'
  | 'fighting_style'
  | 'weapon_mastery';

/** `class.casting_progression`. */
export type CastingProgression = 'none' | 'full' | 'half' | 'pact';

/** `roll_scope.code`. */
export type RollScope =
  | 'initiative'
  | 'ability_check'
  | 'save'
  | 'attack_roll'
  | 'weapon_attack'
  | 'spell_attack'
  | 'weapon_damage'
  | 'spell_damage'
  | 'spell_save_dc'
  | 'damage_taken'
  | 'death_save'
  | 'all_attacks'
  | 'exhaustion_save';

export type SpeciesSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export type VariantKind = 'lineage' | 'ancestry' | 'legacy';
export type ArmourType = 'light' | 'medium' | 'heavy' | 'shield';
export type WeaponCategory = 'simple_melee' | 'simple_ranged' | 'martial_melee' | 'martial_ranged';
export type WeaponProperty =
  | 'finesse' | 'versatile' | 'heavy' | 'light' | 'loading'
  | 'reach' | 'thrown' | 'two_handed' | 'ammunition' | 'improvised';
export type MasteryProperty =
  | 'cleave' | 'graze' | 'nick' | 'push' | 'sap' | 'slow' | 'topple' | 'vex';
export type SpellSchool =
  | 'abjuration' | 'conjuration' | 'divination' | 'enchantment'
  | 'evocation' | 'illusion' | 'necromancy' | 'transmutation';
export type RestInterval = 'short_rest' | 'long_rest';
export type DamageRelation = 'resistant' | 'immune' | 'vulnerable';
export type RollModifierKind =
  | 'advantage' | 'disadvantage' | 'flat'
  | 'dice' | 'reroll_higher' | 'reroll_lower';
export type SpellDamageSelection = 'fixed' | 'choice';
export type SpellDamageDelivery = 'cast' | 'aura' | 'other';

/** A reference to another row: `skyriding` is this pack's own row, else a
 *  global one; `srd-5.2.1/fireball` is that named pack. */
export type Ref = string;

// ---- The envelope ----

export interface PackSource {
  key: string;
  name: string;
  version: string;
  /** NULL means original content the user owns, which needs no credit. */
  license: string | null;
  /** Required whenever `license` is set. A CHECK enforces that in the DB. */
  attribution: string | null;
}

export interface PackFile {
  format: 'ember-codex.pack';
  formatVersion: 1;
  source: PackSource;

  /** Every collection is optional; absent means "this pack adds none". */
  skills?: PackSkill[];
  tools?: PackTool[];
  languages?: PackLanguage[];
  conditions?: PackCondition[];
  species?: PackSpecies[];
  backgrounds?: PackBackground[];
  classes?: PackClass[];
  feats?: PackFeat[];
  spells?: PackSpell[];
  effects?: PackEffect[];
  items?: PackItem[];
}

// ---- Pack-extensible vocabulary ----
//
// A pack may ADD these but may not REDEFINE a slug that already exists
// globally. That rule is app-level, not a CHECK, because it compares the
// incoming file against rows that already exist -- and it is what makes the
// bare-key resolution in references.ts unable to tie.

export interface PackSkill {
  key: string;
  name: string;
  /** Required even for a custom skill: it is still a check against an
   *  ability, and `ability` stays closed vocabulary. */
  ability: AbilityCode;
}

export interface PackTool {
  key: string;
  name: string;
  isArtisan: boolean;
}

export interface PackLanguage {
  key: string;
  name: string;
}

export interface PackCondition {
  key: string;
  name: string;
  description?: string;
}

// ---- Origin content ----

export interface PackSpecies {
  key: string;
  name: string;
  size: SpeciesSize;
  /** Feet per round. */
  speed: number;
  /** Nested rather than a sibling collection: a variant cannot exist without
   *  its species. */
  variants?: PackSpeciesVariant[];
  features?: PackFeature[];
}

export interface PackSpeciesVariant {
  key: string;
  name: string;
  variantKind: VariantKind;
  features?: PackFeature[];
  grantedSpells?: PackGrantedSpell[];
}

export interface PackGrantedSpell {
  spell: Ref;
  /** NULL means the spell is granted at every level. */
  grantLevel: number | null;
  replaceable: boolean;
}

export interface PackBackground {
  key: string;
  name: string;
  description?: string;
  /** Exactly three. App-enforced: a CHECK cannot count rows in another table. */
  abilities: AbilityCode[];
  originFeats?: Ref[];
  features?: PackFeature[];
}

// ---- Classes ----

export interface PackClass {
  key: string;
  name: string;
  hitDie: 6 | 8 | 10 | 12;
  spellcastingAbility: AbilityCode | null;
  castingProgression: CastingProgression;
  grants?: PackGrant[];
  cantripCounts?: PackCantripCount[];
  preparedCounts?: PackPreparedCount[];
  spellSlots?: PackSpellSlot[];
  slotRecovery: RestInterval | null;
  savingThrows?: AbilityCode[];
  skills?: PackSkillRef[];
  tools?: PackToolRef[];
  armourTypes?: ArmourType[];
  weaponCategories?: WeaponCategory[];
  spells?: Ref[];
  features?: PackFeature[];
  subclasses?: PackSubclass[];
}

export interface PackGrant {
  level: number;
  kind: string;
  opens: number;
}

export interface PackCantripCount {
  level: number;
  cantrips: number;
}

export interface PackPreparedCount {
  level: number;
  spellLevel: number;
  maxPrepared: number;
}

export interface PackSpellSlot {
  level: number;
  slotLevel: number;
  slotCount: number;
}

/** `class_skill`, as an object so a junction can grow columns later without
 *  changing every pack file already written. */
export interface PackSkillRef {
  skill: Ref;
}

export interface PackToolRef {
  tool: Ref;
}

export interface PackSubclass {
  key: string;
  name: string;
  unlockLevel: number;
  skills?: PackSkillRef[];
  tools?: PackToolRef[];
  armourTypes?: ArmourType[];
  savingThrows?: AbilityCode[];
  weaponCategories?: WeaponCategory[];
  spells?: Ref[];
  features?: PackFeature[];
}

// ---- Features ----
//
// `feature` has exactly one of five owner columns, and the owner is implied
// by which collection it is nested in. The CHECK at 001_initial.sql:259-265
// is therefore unrepresentable to violate in JSON.

export interface PackFeature {
  key: string;
  name: string;
  description: string;
  /** NULL, or 20 for a capstone. */
  level: number | null;
  spells?: Ref[];
  grantedSpells?: PackGrantedSpell[];
  effects?: PackEffect[];
}

// ---- Feats ----

export interface PackFeat {
  key: string;
  name: string;
  description: string;
  category: FeatCategory;
  abilityPrereqs?: PackAbilityPrereq[];
  effects?: PackEffect[];
}

export interface PackAbilityPrereq {
  ability: AbilityCode;
  minScore: number;
}

// ---- Effects ----

export interface PackEffect {
  key: string;
  name: string;
  description?: string;
  /** A constant this effect contributes: the 10 in Unarmored Defense. */
  baseValue: number;
  rollModifiers?: PackRollModifier[];
  recharge?: PackRecharge;
  modifiers?: PackAbilityModifier[];
  damageModifiers?: PackDamageModifierRef[];
}

export interface PackRollModifier {
  /** `roll_scope.code`. */
  scope: string;
  kind: RollModifierKind;
  amount: number;
  dice?: string;
  damageType?: Ref;
  triggerText?: string;
}

export interface PackRecharge {
  interval: RestInterval;
  usesMax: number;
  shortRestReturns?: number;
  levelBonuses?: PackRechargeLevelBonus[];
}

export interface PackRechargeLevelBonus {
  classLevel: number;
  usesBonus: number;
}

export interface PackAbilityModifier {
  ability: AbilityCode;
  /** Added to that ability's MODIFIER, so 0 means "add the modifier". */
  amount: number;
  maxScore?: number;
  maxDelta?: number;
  setsToPersonalMax?: boolean;
}

/** Inline, not a collection: `damage_modifier` is derived from this pair. */
export interface PackDamageModifierRef {
  damageType: Ref;
  relation: DamageRelation;
  conditionsNote?: string;
}

// ---- Spells ----

export interface PackSpell {
  key: string;
  name: string;
  /** 0 = cantrip. */
  spellLevel: number;
  school: SpellSchool;
  castingTime: string;
  /** Named `spellRange`, not `range`: reserved in MySQL, keyword in SQLite. */
  spellRange: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  verbal: boolean;
  somatic: boolean;
  material: boolean;
  materialCostCp: number;
  description?: string;
  damageTypes?: PackSpellDamageType[];
}

export interface PackSpellDamageType {
  damageType: Ref;
  selection: SpellDamageSelection;
  delivery: SpellDamageDelivery;
}

// ---- Items ----

export interface PackItem {
  key: string;
  name: string;
  /** Pounds. */
  weight: number;
  costCp: number;
  description?: string;
  requiresAttunement: boolean;
  weapon?: PackWeapon;
  damageModifiers?: PackDamageModifierRef[];
}

export interface PackWeapon {
  category: WeaponCategory;
  damageDice: string;
  damageType?: Ref;
  masteryProperty: MasteryProperty;
  properties?: WeaponProperty[];
}
