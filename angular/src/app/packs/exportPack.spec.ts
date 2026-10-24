import { NodeSqlitePort } from '@/testing/node-sqlite.port';
import { runMigrations } from '@/db/migrate';
import { MIGRATIONS } from '@/db/migrations.generated';
import { exportPack } from '@/packs/exportPack';
import type { PackClass, PackFile } from '@/models/ContentPack';

/** Written before the export exists: the fixture is the format, and the SQL
 *  below is what a database must hold for it. Lists are in export order. */

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

const fixture: PackFile = {
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
      modifiers: [
        { ability: 'CON', amount: 0, maxScore: 25, maxDelta: 2 },
        { ability: 'DEX', amount: 1, maxScore: 20, setsToPersonalMax: true },
      ],
    },
  ],
  items: [
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
        properties: ['finesse', 'light'],
      },
      damageModifiers: [{ damageType: 'fire', relation: 'resistant', conditionsNote: 'while attuned' }],
    },
    { key: 'traveler-pack', name: "Traveler's Pack", weight: 5, costCp: 400, requiresAttunement: false },
  ],
};

/** The fixture, row by row. Parents come before children, and every foreign
 *  key is a subquery on the row's own key rather than an assumed id. */
const FIXTURE_SQL = `
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
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'second-wind-heal', 'Second Wind (heal)', 1);

INSERT INTO effect_roll_modifier (effect_id, scope_id, kind, amount, dice, damage_type_id, trigger_text) VALUES
  ((SELECT id FROM effect WHERE slug = 'alert-initiative'),
   (SELECT id FROM roll_scope WHERE code = 'initiative'), 'advantage', 0, NULL, NULL, NULL),
  ((SELECT id FROM effect WHERE slug = 'ember-brand-fire'),
   (SELECT id FROM roll_scope WHERE code = 'weapon_damage'), 'dice', 0, '1d6',
   (SELECT id FROM damage_type WHERE slug = 'fire'), 'once per turn when you hit with a weapon');

INSERT INTO effect_modifier (effect_id, ability_id, amount, max_score, max_delta, sets_to_personal_max) VALUES
  ((SELECT id FROM effect WHERE slug = 'ancestral-boon'), (SELECT id FROM ability WHERE code = 'CON'), 0, 25, 2, 0),
  ((SELECT id FROM effect WHERE slug = 'ancestral-boon'), (SELECT id FROM ability WHERE code = 'DEX'), 1, 20, NULL, 1);

INSERT INTO effect_recharge (effect_id, interval, uses_max, short_rest_returns) VALUES
  ((SELECT id FROM effect WHERE slug = 'second-wind-heal'), 'short_rest', 1, 1);

INSERT INTO effect_recharge_level_bonus (effect_id, class_level, uses_bonus) VALUES
  ((SELECT id FROM effect WHERE slug = 'second-wind-heal'), 2, 1);

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
  ((SELECT id FROM feature WHERE slug = 'second-wind'), (SELECT id FROM effect WHERE slug = 'second-wind-heal'));

INSERT INTO granted_spell (feature_id, spell_id, grant_level, replaceable) VALUES
  ((SELECT id FROM feature WHERE slug = 'star-favor'), (SELECT id FROM spell WHERE slug = 'starfall'), 5, 0),
  ((SELECT id FROM feature WHERE slug = 'star-favor'), (SELECT id FROM spell WHERE slug = 'word-of-light'), NULL, 1);

INSERT INTO feature_spell (feature_id, spell_id) VALUES
  ((SELECT id FROM feature WHERE slug = 'star-favor'), (SELECT id FROM spell WHERE slug = 'starfall'));

INSERT INTO spell_damage_type (spell_id, damage_type_id, selection, delivery) VALUES
  ((SELECT id FROM spell WHERE slug = 'starfall'), (SELECT id FROM damage_type WHERE slug = 'fire'),
   'choice', 'cast');

INSERT INTO item (source_id, slug, name, weight, cost_cp, description, requires_attunement) VALUES
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'ember-dagger', 'Ember Dagger', 1, 500,
   'A blade that never cools.', 1),
  ((SELECT id FROM source WHERE slug = 'my-homebrew'), 'traveler-pack', 'Traveler''s Pack', 5, 400, NULL, 0);

INSERT INTO weapon (item_id, category_id, damage_dice, damage_type_id, mastery_property_id) VALUES
  ((SELECT id FROM item WHERE slug = 'ember-dagger'),
   (SELECT id FROM weapon_category WHERE code = 'simple_melee'), '1d4',
   (SELECT id FROM damage_type WHERE slug = 'piercing'),
   (SELECT id FROM mastery_property WHERE code = 'nick'));

INSERT INTO weapon_property_map (item_id, property_id) VALUES
  ((SELECT id FROM item WHERE slug = 'ember-dagger'), (SELECT id FROM weapon_property WHERE code = 'finesse')),
  ((SELECT id FROM item WHERE slug = 'ember-dagger'), (SELECT id FROM weapon_property WHERE code = 'light'));

INSERT INTO damage_modifier (damage_type_id, relation) VALUES
  ((SELECT id FROM damage_type WHERE slug = 'fire'), 'resistant');

INSERT INTO item_damage_modifier (item_id, damage_modifier_id, conditions_note) VALUES
  ((SELECT id FROM item WHERE slug = 'ember-dagger'),
   (SELECT id FROM damage_modifier
     WHERE damage_type_id = (SELECT id FROM damage_type WHERE slug = 'fire') AND relation = 'resistant'),
   'while attuned');
`;

describe('exporting a pack', () => {
  let port: NodeSqlitePort;

  beforeEach(async () => {
    port = new NodeSqlitePort();
    await port.open();
    await runMigrations(port, MIGRATIONS);
    await port.exec(FIXTURE_SQL);
  });

  afterEach(async () => {
    await port.close();
  });

  it('gives back the pack it was pointed at', async () => {
    const exported = JSON.parse(await exportPack(port, 'my-homebrew'));
    expect(exported).toEqual(fixture);
  });

  it('writes the same bytes every time', async () => {
    expect(await exportPack(port, 'my-homebrew')).toBe(await exportPack(port, 'my-homebrew'));
  });

  it('names the pack it cannot find', async () => {
    await expect(exportPack(port, 'srd-9')).rejects.toThrow('no pack named "srd-9" is installed');
  });
});
