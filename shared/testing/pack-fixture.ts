import type { PackClass, PackFile } from '../models/ContentPack';

/** The fixture is the format: importing it and exporting it again must give
 *  back the same file. The SQL below is the database state it describes. */
const fighter: PackClass = {
  key: 'fighter',
  name: 'Fighter',
  hitDie: 10,
  spellcastingAbility: null,
  castingProgression: 'none',
  slotRecovery: null,
  grants: [
    { level: 1, kind: 'fighting_style', opens: 1 },
    { level: 1, kind: 'weapon_mastery', opens: 3 },
    { level: 4, kind: 'asi_or_feat', opens: 1 },
  ],
  savingThrows: ['CON', 'STR'],
  skills: [{ skill: 'skyriding' }],
  armourTypes: ['heavy', 'light', 'medium', 'shield'],
  weaponCategories: ['martial_melee', 'simple_melee'],
  features: [
    {
      key: 'second-wind',
      name: 'Second Wind',
      description: 'You have a limited well of stamina you can draw on.',
      level: 1,
      effects: [
        {
          key: 'second-wind-heal',
          name: 'Second Wind (heal)',
          baseValue: 1,
          recharge: {
            interval: 'short_rest',
            usesMax: 1,
            shortRestReturns: 1,
            levelBonuses: [{ classLevel: 2, usesBonus: 1 }],
          },
        },
      ],
      damageModifiers: [
        {
          damageType: 'fire',
          relation: 'resistant',
          conditionsNote: 'while the feature is active',
        },
      ],
    },
  ],
  subclasses: [
    {
      key: 'champion',
      name: 'Champion',
      unlockLevel: 3,
      skills: [{ skill: 'skyriding' }],
      tools: [{ tool: 'smiths-tools' }],
      armourTypes: ['heavy'],
      features: [
        {
          key: 'improved-critical',
          name: 'Improved Critical',
          description: 'Your weapon attacks score a critical hit on a roll of 19 or 20.',
          level: 3,
          effects: [
            {
              key: 'improved-critical-threshold',
              name: 'Improved Critical (threshold)',
              baseValue: 0,
              crit: { threshold: 19 },
            },
          ],
        },
      ],
    },
  ],
};

const starPriest: PackClass = {
  key: 'star-priest',
  name: 'Star Priest',
  hitDie: 8,
  spellcastingAbility: 'WIS',
  castingProgression: 'full',
  slotRecovery: 'long_rest',
  cantripCounts: [
    { level: 1, cantrips: 3 },
    { level: 10, cantrips: 4 },
  ],
  preparedCounts: [
    { level: 1, spellLevel: 1, maxPrepared: 4 },
    { level: 3, spellLevel: 2, maxPrepared: 6 },
  ],
  spellSlots: [
    { level: 1, slotLevel: 1, slotCount: 4 },
    { level: 1, slotLevel: 2, slotCount: 2 },
    { level: 3, slotLevel: 2, slotCount: 3 },
  ],
  savingThrows: ['CON', 'WIS'],
  tools: [{ tool: 'smiths-tools' }],
  spells: ['srd-lite/fireball', 'starfall', 'word-of-light'],
  features: [
    {
      key: 'star-favor',
      name: 'Star Favor',
      description: 'The stars answer when you call on them.',
      level: 1,
      spells: ['starfall'],
      grantedSpells: [
        { spell: 'starfall', grantLevel: 5, replaceable: false },
        { spell: 'word-of-light', grantLevel: null, replaceable: true },
      ],
    },
  ],
};

export const packFixture: PackFile = {
  format: 'ember-codex.pack',
  formatVersion: 1,
  source: {
    key: 'my-homebrew',
    name: 'My Homebrew',
    version: '1.0.0',
    license: 'CC-BY-4.0',
    attribution: "Adventurer's Almanac, used with permission",
  },
  skills: [{ key: 'skyriding', name: 'Skyriding', ability: 'DEX' }],
  tools: [{ key: 'smiths-tools', name: "Smith's Tools", isArtisan: true }],
  languages: [{ key: 'old-tongue', name: 'Old Tongue' }],
  conditions: [
    {
      key: 'marked',
      name: 'Marked',
      description: 'A creature bearing this sigil can be found by its maker.',
    },
  ],
  species: [
    {
      key: 'elf',
      name: 'Elf',
      size: 'medium',
      speed: 30,
      variants: [
        {
          key: 'high-elf',
          name: 'High Elf',
          variantKind: 'lineage',
          features: [
            {
              key: 'trance',
              name: 'Trance',
              description: 'You do not need to sleep.',
              level: null,
            },
          ],
        },
      ],
      features: [
        {
          key: 'elf-darkvision',
          name: 'Darkvision',
          description: 'You can see in dim light within 60 feet as if it were bright light.',
          level: null,
        },
      ],
    },
    { key: 'human', name: 'Human', size: 'medium', speed: 30 },
  ],
  backgrounds: [
    {
      key: 'wayfarer',
      name: 'Wayfarer',
      description: 'You have always been on the move.',
      abilities: ['CON', 'DEX', 'WIS'],
      originFeats: ['alert'],
      features: [
        {
          key: 'roadwise',
          name: 'Roadwise',
          description: 'You gain a knack for reading roads and maps.',
          level: null,
        },
      ],
    },
  ],
  classes: [fighter, starPriest],
  feats: [
    {
      key: 'alert',
      name: 'Alert',
      description: 'Always on the lookout for danger.',
      category: 'general',
      abilityPrereqs: [{ ability: 'DEX', minScore: 13 }],
      effects: [
        {
          key: 'alert-initiative',
          name: 'Alert (initiative)',
          baseValue: 0,
          rollModifiers: [{ scope: 'initiative', kind: 'advantage', amount: 0 }],
        },
      ],
    },
    {
      key: 'ember-brand',
      name: 'Ember Brand',
      description: 'Your strikes leave burning marks.',
      category: 'general',
      effects: [
        {
          key: 'ember-brand-fire',
          name: 'Ember Brand (fire)',
          baseValue: 0,
          rollModifiers: [
            {
              scope: 'weapon_damage',
              kind: 'dice',
              amount: 0,
              dice: '1d6',
              damageType: 'fire',
              triggerText: 'once per turn when you hit with a weapon',
            },
          ],
        },
      ],
    },
  ],
  spells: [
    {
      key: 'starfall',
      name: 'Starfall',
      spellLevel: 5,
      school: 'evocation',
      castingTime: '1 action',
      spellRange: '120 feet',
      duration: 'Instantaneous',
      concentration: false,
      ritual: false,
      verbal: true,
      somatic: true,
      material: true,
      materialCostCp: 0,
      description: 'A falling star burns where it lands.',
      damageTypes: [{ damageType: 'fire', selection: 'choice', delivery: 'cast' }],
      effects: [
        {
          key: 'starfall-glow',
          name: 'Starfall Glow',
          baseValue: 0,
          darkvision: { rangeFeet: 60 },
        },
      ],
      damageModifiers: [
        {
          damageType: 'fire',
          relation: 'resistant',
          conditionsNote: 'while standing in the embers',
        },
      ],
    },
    {
      key: 'word-of-light',
      name: 'Word of Light',
      spellLevel: 0,
      school: 'evocation',
      castingTime: '1 action',
      spellRange: '30 feet',
      duration: '1 round',
      concentration: false,
      ritual: false,
      verbal: true,
      somatic: false,
      material: false,
      materialCostCp: 0,
    },
  ],
  effects: [
    {
      key: 'ancestral-boon',
      name: 'Ancestral Boon',
      baseValue: 0,
      speed: { speedDelta: 10 },
      languages: ['old-tongue'],
      conditionModifiers: [{ condition: 'frightened', relation: 'immune' }],
      modifiers: [
        { ability: 'CON', amount: 0, maxScore: 25, maxDelta: 2 },
        { ability: 'DEX', amount: 1, maxScore: 20, setsToPersonalMax: true },
      ],
    },
    {
      key: 'giants-blood',
      name: "Giant's Blood",
      baseValue: 0,
      size: 'large',
    },
  ],
  items: [
    { key: 'arrow', name: 'Arrow', weight: 0.05, costCp: 1, requiresAttunement: false, ammunition: true },
    {
      key: 'chain-shirt',
      name: 'Chain Shirt',
      weight: 20,
      costCp: 5000,
      requiresAttunement: false,
      armour: {
        armourType: 'medium',
        baseAc: 13,
        maxDexBonus: 2,
        stealthDisadvantage: false,
      },
    },
    {
      key: 'ember-dagger',
      name: 'Ember Dagger',
      weight: 1,
      costCp: 500,
      description: 'A blade that never cools.',
      requiresAttunement: true,
      weapon: {
        category: 'simple_melee',
        damageDice: '1d4',
        damageType: 'piercing',
        masteryProperty: 'nick',
        thrownRange: 20,
        properties: ['finesse', 'light'],
      },
      effects: [
        {
          key: 'dagger-warmth',
          name: 'Dagger Warmth',
          baseValue: 0,
          weaponProperties: ['thrown'],
          conditionModifiers: [{ condition: 'marked', relation: 'immune' }],
          rollModifiers: [{ scope: 'ability_check', kind: 'flat', amount: 1 }],
        },
      ],
      damageModifiers: [{ damageType: 'fire', relation: 'resistant', conditionsNote: 'while attuned' }],
    },
    {
      key: 'longsword',
      name: 'Longsword',
      weight: 3,
      costCp: 1500,
      requiresAttunement: false,
      weapon: {
        category: 'martial_melee',
        damageDice: '1d8',
        damageType: 'slashing',
        masteryProperty: 'sap',
        versatileDice: '1d10',
        attackBonus: 1,
        damageBonus: 1,
        properties: ['versatile'],
      },
    },
    {
      key: 'shortbow',
      name: 'Shortbow',
      weight: 2,
      costCp: 2500,
      requiresAttunement: false,
      weapon: {
        category: 'simple_ranged',
        damageDice: '1d6',
        damageType: 'piercing',
        masteryProperty: 'vex',
        ammunition: 'arrow',
        properties: ['two_handed'],
      },
    },
    { key: 'traveler-pack', name: "Traveler's Pack", weight: 5, costCp: 400, requiresAttunement: false },
  ],
};

/** The fixture, row by row. Parents come before children, and every foreign
 *  key is a subquery on the row's own key rather than an assumed id. */
export const FIXTURE_SQL = `
INSERT INTO source (slug, name, version, license, attribution) VALUES
  ('my-homebrew', 'My Homebrew', '1.0.0', 'CC-BY-4.0', 'Adventurer''s Almanac, used with permission'),
  ('srd-lite', 'SRD Lite', '1.0', NULL, NULL);

INSERT INTO skill (source_id, slug, name, ability_id) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'skyriding', 'Skyriding',
   (SELECT id FROM ability WHERE code = 'DEX'));

INSERT INTO tool (source_id, slug, name, is_artisan) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'smiths-tools', 'Smith''s Tools', 1);

INSERT INTO language (source_id, slug, name) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'old-tongue', 'Old Tongue');

INSERT INTO condition (source_id, slug, name, description) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'marked', 'Marked',
   'A creature bearing this sigil can be found by its maker.');

-- srd-lite owns nothing but the one spell another pack points at.
INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range,
                   duration, concentration, ritual, verbal, somatic, material,
                   material_cost_cp, description) VALUES
  ((SELECT id FROM source WHERE slug = 'srd-lite'), 'fireball', 'Fireball', 3, 'evocation',
   '1 action', '150 feet', 'Instantaneous', 0, 0, 1, 1, 0, 0, NULL),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'starfall', 'Starfall', 5, 'evocation',
   '1 action', '120 feet', 'Instantaneous', 0, 0, 1, 1, 1, 0, 'A falling star burns where it lands.'),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'word-of-light', 'Word of Light', 0, 'evocation',
   '1 action', '30 feet', '1 round', 0, 0, 1, 0, 0, 0, NULL);

INSERT INTO species (source_id, slug, name, size, speed) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'elf', 'Elf', 'medium', 30),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'human', 'Human', 'medium', 30);

INSERT INTO species_variant (source_id, slug, species_id, variant_kind, name) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'high-elf',
   (SELECT id FROM species WHERE slug = 'elf'), 'lineage', 'High Elf');

INSERT INTO feature (source_id, slug, name, description, level, species_id) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'elf-darkvision', 'Darkvision',
   'You can see in dim light within 60 feet as if it were bright light.', NULL,
   (SELECT id FROM species WHERE slug = 'elf'));

INSERT INTO feature (source_id, slug, name, description, level, variant_id) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'trance', 'Trance',
   'You do not need to sleep.', NULL,
   (SELECT id FROM species_variant WHERE slug = 'high-elf'));

INSERT INTO background (source_id, slug, name, description) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'wayfarer', 'Wayfarer',
   'You have always been on the move.');

INSERT INTO background_ability (background_id, ability_id) VALUES
  ((SELECT id FROM background WHERE slug = 'wayfarer'), (SELECT id FROM ability WHERE code = 'CON')),
  ((SELECT id FROM background WHERE slug = 'wayfarer'), (SELECT id FROM ability WHERE code = 'DEX')),
  ((SELECT id FROM background WHERE slug = 'wayfarer'), (SELECT id FROM ability WHERE code = 'WIS'));

INSERT INTO feat (source_id, slug, name, description, category_id) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'alert', 'Alert',
   'Always on the lookout for danger.', (SELECT id FROM feat_category WHERE code = 'general')),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'ember-brand', 'Ember Brand',
   'Your strikes leave burning marks.', (SELECT id FROM feat_category WHERE code = 'general'));

INSERT INTO feat_ability_prereq (feat_id, ability_id, min_score) VALUES
  ((SELECT id FROM feat WHERE slug = 'alert'), (SELECT id FROM ability WHERE code = 'DEX'), 13);

INSERT INTO effect (source_id, slug, name, base_value) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'alert-initiative', 'Alert (initiative)', 0),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'ember-brand-fire', 'Ember Brand (fire)', 0),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'ancestral-boon', 'Ancestral Boon', 0),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'giants-blood', 'Giant''s Blood', 0),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'improved-critical-threshold', 'Improved Critical (threshold)', 0),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'second-wind-heal', 'Second Wind (heal)', 1),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'starfall-glow', 'Starfall Glow', 0),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'dagger-warmth', 'Dagger Warmth', 0);

INSERT INTO effect_roll_modifier (effect_id, scope_id, kind, amount, dice, damage_type_id, trigger_text) VALUES
  ((SELECT id FROM effect WHERE slug = 'alert-initiative'),
   (SELECT id FROM roll_scope WHERE code = 'initiative'), 'advantage', 0, NULL, NULL, NULL),
  ((SELECT id FROM effect WHERE slug = 'ember-brand-fire'),
   (SELECT id FROM roll_scope WHERE code = 'weapon_damage'), 'dice', 0, '1d6',
   (SELECT id FROM damage_type WHERE slug = 'fire'), 'once per turn when you hit with a weapon'),
  ((SELECT id FROM effect WHERE slug = 'dagger-warmth'),
   (SELECT id FROM roll_scope WHERE code = 'ability_check'), 'flat', 1, NULL, NULL, NULL);

INSERT INTO effect_modifier (effect_id, ability_id, amount, max_score, max_delta, sets_to_personal_max) VALUES
  ((SELECT id FROM effect WHERE slug = 'ancestral-boon'), (SELECT id FROM ability WHERE code = 'CON'), 0, 25, 2, 0),
  ((SELECT id FROM effect WHERE slug = 'ancestral-boon'), (SELECT id FROM ability WHERE code = 'DEX'), 1, 20, NULL, 1);

INSERT INTO effect_recharge (effect_id, interval, uses_max, short_rest_returns) VALUES
  ((SELECT id FROM effect WHERE slug = 'second-wind-heal'), 'short_rest', 1, 1);

INSERT INTO effect_recharge_level_bonus (effect_id, class_level, uses_bonus) VALUES
  ((SELECT id FROM effect WHERE slug = 'second-wind-heal'), 2, 1);

INSERT INTO effect_speed (effect_id, speed_delta) VALUES
  ((SELECT id FROM effect WHERE slug = 'ancestral-boon'), 10);

INSERT INTO effect_darkvision (effect_id, range_feet) VALUES
  ((SELECT id FROM effect WHERE slug = 'starfall-glow'), 60);

INSERT INTO effect_crit (effect_id, threshold) VALUES
  ((SELECT id FROM effect WHERE slug = 'improved-critical-threshold'), 19);

INSERT INTO effect_size (effect_id, size) VALUES
  ((SELECT id FROM effect WHERE slug = 'giants-blood'), 'large');

INSERT INTO effect_weapon_property (effect_id, property_id) VALUES
  ((SELECT id FROM effect WHERE slug = 'dagger-warmth'),
   (SELECT id FROM weapon_property WHERE code = 'thrown'));

INSERT INTO effect_language (effect_id, language_id) VALUES
  ((SELECT id FROM effect WHERE slug = 'ancestral-boon'),
   (SELECT id FROM language WHERE slug = 'old-tongue'));

INSERT INTO effect_condition_modifier (effect_id, condition_id, relation) VALUES
  ((SELECT id FROM effect WHERE slug = 'ancestral-boon'),
   (SELECT id FROM condition WHERE slug = 'frightened'), 'immune'),
  ((SELECT id FROM effect WHERE slug = 'dagger-warmth'),
   (SELECT id FROM condition WHERE slug = 'marked'), 'immune');

INSERT INTO feat_effect (feat_id, effect_id) VALUES
  ((SELECT id FROM feat WHERE slug = 'alert'), (SELECT id FROM effect WHERE slug = 'alert-initiative')),
  ((SELECT id FROM feat WHERE slug = 'ember-brand'), (SELECT id FROM effect WHERE slug = 'ember-brand-fire'));

INSERT INTO background_origin_feat (background_id, feat_id) VALUES
  ((SELECT id FROM background WHERE slug = 'wayfarer'), (SELECT id FROM feat WHERE slug = 'alert'));

INSERT INTO feature (source_id, slug, name, description, level, background_id) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'roadwise', 'Roadwise',
   'You gain a knack for reading roads and maps.', NULL,
   (SELECT id FROM background WHERE slug = 'wayfarer'));

INSERT INTO class (source_id, slug, name, hit_die, spellcasting_ability_id, casting_progression) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'fighter', 'Fighter', 10, NULL, 'none'),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'star-priest', 'Star Priest', 8,
   (SELECT id FROM ability WHERE code = 'WIS'), 'full');

INSERT INTO class_grant_slot (class_id, class_level, grant_kind, opens) VALUES
  ((SELECT id FROM class WHERE slug = 'fighter'), 1, 'fighting_style', 1),
  ((SELECT id FROM class WHERE slug = 'fighter'), 1, 'weapon_mastery', 3),
  ((SELECT id FROM class WHERE slug = 'fighter'), 4, 'asi_or_feat', 1);

INSERT INTO class_saving_throw (class_id, ability_id) VALUES
  ((SELECT id FROM class WHERE slug = 'fighter'), (SELECT id FROM ability WHERE code = 'CON')),
  ((SELECT id FROM class WHERE slug = 'fighter'), (SELECT id FROM ability WHERE code = 'STR')),
  ((SELECT id FROM class WHERE slug = 'star-priest'), (SELECT id FROM ability WHERE code = 'CON')),
  ((SELECT id FROM class WHERE slug = 'star-priest'), (SELECT id FROM ability WHERE code = 'WIS'));

INSERT INTO class_armour_type (class_id, armour_type) VALUES
  ((SELECT id FROM class WHERE slug = 'fighter'), 'light'),
  ((SELECT id FROM class WHERE slug = 'fighter'), 'medium'),
  ((SELECT id FROM class WHERE slug = 'fighter'), 'heavy'),
  ((SELECT id FROM class WHERE slug = 'fighter'), 'shield');

INSERT INTO class_weapon_category (class_id, category_id) VALUES
  ((SELECT id FROM class WHERE slug = 'fighter'), (SELECT id FROM weapon_category WHERE code = 'simple_melee')),
  ((SELECT id FROM class WHERE slug = 'fighter'), (SELECT id FROM weapon_category WHERE code = 'martial_melee'));

INSERT INTO class_skill (class_id, skill_id) VALUES
  ((SELECT id FROM class WHERE slug = 'fighter'), (SELECT id FROM skill WHERE slug = 'skyriding'));

INSERT INTO class_tool (class_id, tool_id) VALUES
  ((SELECT id FROM class WHERE slug = 'star-priest'), (SELECT id FROM tool WHERE slug = 'smiths-tools'));

INSERT INTO class_slot_recovery (class_id, interval) VALUES
  ((SELECT id FROM class WHERE slug = 'star-priest'), 'long_rest');

INSERT INTO class_cantrip_count (class_id, class_level, cantrips) VALUES
  ((SELECT id FROM class WHERE slug = 'star-priest'), 1, 3),
  ((SELECT id FROM class WHERE slug = 'star-priest'), 10, 4);

INSERT INTO class_prepared_count (class_id, class_level, spell_level, max_prepared) VALUES
  ((SELECT id FROM class WHERE slug = 'star-priest'), 1, 1, 4),
  ((SELECT id FROM class WHERE slug = 'star-priest'), 3, 2, 6);

INSERT INTO class_spell_slot (class_id, class_level, slot_level, slot_count) VALUES
  ((SELECT id FROM class WHERE slug = 'star-priest'), 1, 1, 4),
  ((SELECT id FROM class WHERE slug = 'star-priest'), 1, 2, 2),
  ((SELECT id FROM class WHERE slug = 'star-priest'), 3, 2, 3);

INSERT INTO class_spell (class_id, spell_id) VALUES
  ((SELECT id FROM class WHERE slug = 'star-priest'), (SELECT id FROM spell WHERE slug = 'fireball')),
  ((SELECT id FROM class WHERE slug = 'star-priest'), (SELECT id FROM spell WHERE slug = 'starfall')),
  ((SELECT id FROM class WHERE slug = 'star-priest'), (SELECT id FROM spell WHERE slug = 'word-of-light'));

INSERT INTO subclass (source_id, slug, class_id, name, unlock_level) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'champion',
   (SELECT id FROM class WHERE slug = 'fighter'), 'Champion', 3);

INSERT INTO subclass_skill (subclass_id, skill_id) VALUES
  ((SELECT id FROM subclass WHERE slug = 'champion'), (SELECT id FROM skill WHERE slug = 'skyriding'));

INSERT INTO subclass_tool (subclass_id, tool_id) VALUES
  ((SELECT id FROM subclass WHERE slug = 'champion'), (SELECT id FROM tool WHERE slug = 'smiths-tools'));

INSERT INTO subclass_armour_type (subclass_id, armour_type) VALUES
  ((SELECT id FROM subclass WHERE slug = 'champion'), 'heavy');

INSERT INTO feature (source_id, slug, name, description, level, class_id) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'second-wind', 'Second Wind',
   'You have a limited well of stamina you can draw on.', 1,
   (SELECT id FROM class WHERE slug = 'fighter')),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'star-favor', 'Star Favor',
   'The stars answer when you call on them.', 1,
   (SELECT id FROM class WHERE slug = 'star-priest'));

INSERT INTO feature (source_id, slug, name, description, level, subclass_id) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'improved-critical', 'Improved Critical',
   'Your weapon attacks score a critical hit on a roll of 19 or 20.', 3,
   (SELECT id FROM subclass WHERE slug = 'champion'));

INSERT INTO feature_effect (feature_id, effect_id) VALUES
  ((SELECT id FROM feature WHERE slug = 'second-wind'), (SELECT id FROM effect WHERE slug = 'second-wind-heal')),
  ((SELECT id FROM feature WHERE slug = 'improved-critical'),
   (SELECT id FROM effect WHERE slug = 'improved-critical-threshold'));

INSERT INTO granted_spell (feature_id, spell_id, grant_level, replaceable) VALUES
  ((SELECT id FROM feature WHERE slug = 'star-favor'), (SELECT id FROM spell WHERE slug = 'starfall'), 5, 0),
  ((SELECT id FROM feature WHERE slug = 'star-favor'), (SELECT id FROM spell WHERE slug = 'word-of-light'), NULL, 1);

INSERT INTO feature_spell (feature_id, spell_id) VALUES
  ((SELECT id FROM feature WHERE slug = 'star-favor'), (SELECT id FROM spell WHERE slug = 'starfall'));

INSERT INTO spell_damage_type (spell_id, damage_type_id, selection, delivery) VALUES
  ((SELECT id FROM spell WHERE slug = 'starfall'), (SELECT id FROM damage_type WHERE slug = 'fire'),
   'choice', 'cast');

INSERT INTO item (source_id, slug, name, weight, cost_cp, description, requires_attunement) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'arrow', 'Arrow', 0.05, 1, NULL, 0),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'chain-shirt', 'Chain Shirt', 20, 5000, NULL, 0),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'ember-dagger', 'Ember Dagger', 1, 500,
   'A blade that never cools.', 1),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'longsword', 'Longsword', 3, 1500, NULL, 0),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'shortbow', 'Shortbow', 2, 2500, NULL, 0),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'traveler-pack', 'Traveler''s Pack', 5, 400, NULL, 0);

INSERT INTO ammunition (item_id) VALUES
  ((SELECT id FROM item WHERE slug = 'arrow'));

INSERT INTO armour (item_id, armour_type, base_ac, max_dex_bonus, stealth_disadvantage) VALUES
  ((SELECT id FROM item WHERE slug = 'chain-shirt'), 'medium', 13, 2, 0);

INSERT INTO weapon
  (item_id, category_id, damage_dice, damage_type_id, versatile_dice, attack_bonus,
   damage_bonus, thrown_range, ammunition_id, mastery_property_id)
VALUES
  ((SELECT id FROM item WHERE slug = 'ember-dagger'),
   (SELECT id FROM weapon_category WHERE code = 'simple_melee'), '1d4',
   (SELECT id FROM damage_type WHERE slug = 'piercing'), NULL, 0, 0, 20, NULL,
   (SELECT id FROM mastery_property WHERE code = 'nick')),
  ((SELECT id FROM item WHERE slug = 'longsword'),
   (SELECT id FROM weapon_category WHERE code = 'martial_melee'), '1d8',
   (SELECT id FROM damage_type WHERE slug = 'slashing'), '1d10', 1, 1, NULL, NULL,
   (SELECT id FROM mastery_property WHERE code = 'sap')),
  ((SELECT id FROM item WHERE slug = 'shortbow'),
   (SELECT id FROM weapon_category WHERE code = 'simple_ranged'), '1d6',
   (SELECT id FROM damage_type WHERE slug = 'piercing'), NULL, 0, 0, NULL,
   (SELECT item_id FROM ammunition WHERE item_id = (SELECT id FROM item WHERE slug = 'arrow')),
   (SELECT id FROM mastery_property WHERE code = 'vex'));

INSERT INTO weapon_property_map (item_id, property_id) VALUES
  ((SELECT id FROM item WHERE slug = 'ember-dagger'), (SELECT id FROM weapon_property WHERE code = 'finesse')),
  ((SELECT id FROM item WHERE slug = 'ember-dagger'), (SELECT id FROM weapon_property WHERE code = 'light')),
  ((SELECT id FROM item WHERE slug = 'longsword'), (SELECT id FROM weapon_property WHERE code = 'versatile')),
  ((SELECT id FROM item WHERE slug = 'shortbow'), (SELECT id FROM weapon_property WHERE code = 'two_handed'));

INSERT INTO damage_modifier (damage_type_id, relation) VALUES
  ((SELECT id FROM damage_type WHERE slug = 'fire'), 'resistant');

INSERT INTO item_damage_modifier (item_id, damage_modifier_id, conditions_note) VALUES
  ((SELECT id FROM item WHERE slug = 'ember-dagger'),
   (SELECT id FROM damage_modifier
     WHERE damage_type_id = (SELECT id FROM damage_type WHERE slug = 'fire') AND relation = 'resistant'),
   'while attuned');

INSERT INTO feature_damage_modifier (feature_id, damage_modifier_id, conditions_note) VALUES
  ((SELECT id FROM feature WHERE slug = 'second-wind'),
   (SELECT id FROM damage_modifier
     WHERE damage_type_id = (SELECT id FROM damage_type WHERE slug = 'fire') AND relation = 'resistant'),
   'while the feature is active');

INSERT INTO spell_damage_modifier (spell_id, damage_modifier_id, conditions_note) VALUES
  ((SELECT id FROM spell WHERE slug = 'starfall'),
   (SELECT id FROM damage_modifier
     WHERE damage_type_id = (SELECT id FROM damage_type WHERE slug = 'fire') AND relation = 'resistant'),
   'while standing in the embers');

INSERT INTO item_effect (item_id, effect_id) VALUES
  ((SELECT id FROM item WHERE slug = 'ember-dagger'), (SELECT id FROM effect WHERE slug = 'dagger-warmth'));

INSERT INTO spell_effect (spell_id, effect_id) VALUES
  ((SELECT id FROM spell WHERE slug = 'starfall'), (SELECT id FROM effect WHERE slug = 'starfall-glow'));
`;

/** Only the other pack the fixture references, so an import has someone to
 *  point srd-lite/fireball at. */
export const SRD_SQL = `
INSERT INTO source (slug, name, version, license, attribution) VALUES
  ('srd-lite', 'SRD Lite', '1.0', NULL, NULL);

INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range,
                   duration, concentration, ritual, verbal, somatic, material,
                   material_cost_cp, description) VALUES
  ((SELECT id FROM source WHERE slug = 'srd-lite'), 'fireball', 'Fireball', 3, 'evocation',
   '1 action', '150 feet', 'Instantaneous', 0, 0, 1, 1, 0, 0, NULL);
`;