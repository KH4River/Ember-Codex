-- =====================================================================
-- 001_initial.sql  -  Ember Codex database (SQLite)
--
-- RULESET: 2024 Player's Handbook ONLY (labelled "5.5e" on D&D Beyond
-- since March 2026). No rule_year column exists anywhere: the app
-- supports one ruleset, so the column would be a constant.
--
-- Requirements:
--   * SQLite 3.37+ (STRICT tables).
--   * The app MUST run  PRAGMA foreign_keys = ON;  every time it opens a
--     connection. SQLite ignores every FOREIGN KEY / ON DELETE rule below
--     without it. (It cannot live in this file: the pragma does nothing
--     inside a transaction, and migrations run inside one.)
--
-- Conventions:
--   * Booleans are INTEGER 0/1 (SQLite has no boolean type).
--   * Dates are ISO-8601 TEXT in UTC ('2026-09-29T18:30:00Z').
--   * Content tables (catalog) carry source_id + slug. The slug is the
--     stable identifier used by import/export files ("key" in JSON).
--     Column is not called "key": KEY is reserved in MySQL and a keyword
--     in SQLite.
--   * Fixed vocabulary -- ability, damage_type, feat_category, roll_scope,
--     weapon_property, weapon_category, mastery_property, class_grant_kind
--     -- is seeded, globally unique, and carries NO source_id. skill, tool,
--     language and condition are the exception: they are open-ended, so
--     source_id is nullable there and NULL means global. A pack may add its
--     own but may not redefine a global slug, and the importer refuses that.
--   * DELETE POLICY, in two tiers. The distinction matters, because the
--     obvious "ON DELETE CASCADE everywhere" is actively dangerous here:
--     species cascades to player_character, so deleting an imported
--     content pack would silently destroy the user's characters.
--       TIER 1  content -> content   ON DELETE CASCADE. Removing a pack
--               removes that pack's own rows and their internal links.
--       TIER 2  content -> character  ON DELETE RESTRICT. Player data must
--               never delete content, and content must never delete
--               player data. Deleting a species a character uses raises
--               an error naming the blocker; the app then reports which
--               characters depend on it rather than eating the data.
--               Deleting a CHARACTER still cascades to all of that
--               character's rows, which is what you want.
--
-- NOT LEGAL ADVICE, but structurally relevant: this file ships NO rules
-- text. The only seed data is the six ability names and the feat
-- category names -- both are facts about the game's vocabulary, not
-- reproduced content. All spell/class/species/background text arrives via
-- the JSON importer, and source.name / source.version record what the
-- user licensed, with source.license / source.attribution carrying the
-- credit a third-party licence like CC-BY-4.0 requires.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. SOURCES (content packs)
-- ---------------------------------------------------------------------

CREATE TABLE source (
  id          INTEGER PRIMARY KEY,
  slug        TEXT    NOT NULL UNIQUE,              -- 'srd-5.2.1', 'my-homebrew'
  name        TEXT    NOT NULL,
  version     TEXT    NOT NULL,
  -- Which pack replaces this one, when the user chose to keep both rather
  -- than replace in place. NULL on an active pack. ON DELETE SET NULL, not
  -- the tier-1 CASCADE: this is a pointer to a successor, not an ownership
  -- edge. Deleting v2 should un-mark v1, not take v1 with it. The two-tier
  -- policy in the header governs who a row BELONGS to; "what replaced this"
  -- belongs to neither row. It also chains v1 -> v2 -> v3 with no extra
  -- state, which a status TEXT column could not.
  superseded_by INTEGER REFERENCES source (id) ON DELETE SET NULL,
  -- Licence and attribution for reproduced third-party content. A NULL
  -- licence means original content the user owns -- which is what their own
  -- homebrew is -- and needs no external credit. The SRD is CC-BY-4.0, which
  -- requires crediting Wizards of the Coast.
  --
  -- This is provenance, not enforcement. A user types their own claim into
  -- their own JSON and nothing verifies it. What it buys: the app can
  -- attribute SRD content correctly, and a pack can be named at the point
  -- of deletion.
  license     TEXT,
  attribution TEXT,          -- required whenever license is set
  imported_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- Claiming a licence without crediting it is the one bad state. The
  -- length() test is not redundant with IS NOT NULL: '' is not NULL, so an
  -- importer writing an empty string would otherwise satisfy this while
  -- crediting nobody.
  CHECK (license IS NULL OR attribution IS NOT NULL),
  CHECK (attribution IS NULL OR length(attribution) > 0)
) STRICT;


-- ---------------------------------------------------------------------
-- 1. ABILITIES (fixed rules data, seeded, never imported)
-- ---------------------------------------------------------------------

CREATE TABLE ability (
  id   INTEGER PRIMARY KEY,
  code TEXT    NOT NULL UNIQUE CHECK (code IN ('STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA')),
  name TEXT    NOT NULL
) STRICT;


-- ---------------------------------------------------------------------
-- 2. FEATS
--
-- 2024 has four kinds of feat, per D&D Beyond: Origin (background),
-- General (level 4+), Fighting Style (bestowed by class features), and
-- Epic Boons (level 19). They are one table with a category tag, not four
-- tables -- they share an identical shape (a pool of options, one pick,
-- sometimes an ability bonus).
-- ---------------------------------------------------------------------

CREATE TABLE feat_category (
  id   INTEGER PRIMARY KEY,
  code TEXT    NOT NULL UNIQUE
       CHECK (code IN ('origin', 'general', 'fighting_style', 'epic_boon'))
) STRICT;

CREATE TABLE feat (
  id          INTEGER PRIMARY KEY,
  source_id   INTEGER NOT NULL REFERENCES source (id) ON DELETE CASCADE,
  slug        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL,
  category_id INTEGER NOT NULL REFERENCES feat_category (id),
  UNIQUE (source_id, slug)
) STRICT;

-- Some general feats gate on a score ("Resilient: Dex 13+"). The app
-- checks these before offering the feat.
CREATE TABLE feat_ability_prereq (
  feat_id    INTEGER NOT NULL REFERENCES feat (id) ON DELETE CASCADE,
  ability_id INTEGER NOT NULL REFERENCES ability (id),
  min_score  INTEGER NOT NULL CHECK (min_score BETWEEN 1 AND 30),
  PRIMARY KEY (feat_id, ability_id)
) STRICT;


-- ---------------------------------------------------------------------
-- 3. ORIGIN CONTENT
--
-- ASI lives on the BACKGROUND in 2024, not the species. D&D Beyond's
-- species article has a section titled "Ability Score Adjustments No
-- Longer Tied to Species". There is therefore no species_ability table.
--
-- species_variant covers all three 2024 sub-species terms. They are
-- mechanically identical -- "choose one at character creation, it gates
-- traits and spells" -- so they share one table and differ only in the
-- label the rules use:
--   lineage   Elf (Drow/High/Wood), Dwarf (Hill/Mountain),
--             Gnome (Forest/Rock), Halfling (Lightfoot/Stout)
--   ancestry  Goliath (six giant ancestries),
--             Dragonborn (Draconic/Chromatic/Gemfire)
--   legacy    Tiefling (Abyssal/Chthonic/Infernal)
-- Human, Aasimar and Orc have no variant, so variant_id is nullable.
-- Variants grant TRAITS, not feats, and those traits are rows in `feature`.
-- ---------------------------------------------------------------------

CREATE TABLE species (
  id        INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES source (id) ON DELETE CASCADE,
  slug      TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  size      TEXT    NOT NULL CHECK (size IN ('tiny', 'small', 'medium', 'large', 'huge', 'gargantuan')),
  speed     INTEGER NOT NULL CHECK (speed >= 0),         -- feet per round
  UNIQUE (source_id, slug)
) STRICT;

CREATE TABLE species_variant (
  id         INTEGER PRIMARY KEY,
  source_id  INTEGER NOT NULL REFERENCES source (id) ON DELETE CASCADE,
  slug       TEXT    NOT NULL,
  species_id INTEGER NOT NULL REFERENCES species (id) ON DELETE CASCADE,
  -- Display label and importer validation only. The three kinds are
  -- mechanically identical; this just lets the UI say "Lineage: High Elf"
  -- and "Fiendish Legacy: Infernal" using the rules' own wording.
  variant_kind TEXT  NOT NULL DEFAULT 'lineage'
               CHECK (variant_kind IN ('lineage', 'ancestry', 'legacy')),
  name       TEXT    NOT NULL,
  UNIQUE (source_id, slug),
  UNIQUE (id, species_id)          -- composite FK target in player_character
) STRICT;

CREATE TABLE background (
  id          INTEGER PRIMARY KEY,
  source_id   INTEGER NOT NULL REFERENCES source (id) ON DELETE CASCADE,
  slug        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  UNIQUE (source_id, slug)
) STRICT;

-- Each background lists exactly three abilities. From that list the
-- character applies +2/+1/+1 OR +1/+1/+1 -- never more, never a fourth
-- ability. The app enforces the distribution; a CHECK cannot, because it
-- would have to count rows in this table.
CREATE TABLE background_ability (
  background_id INTEGER NOT NULL REFERENCES background (id) ON DELETE CASCADE,
  ability_id    INTEGER NOT NULL REFERENCES ability (id),
  PRIMARY KEY (background_id, ability_id)
) STRICT;

-- Origin feat pool. No rows = "an Origin feat of your choice", which is
-- what a 2014 background converted to 2024 gets (and what the 2024 Human
-- Versatile trait adds on top).
CREATE TABLE background_origin_feat (
  background_id INTEGER NOT NULL REFERENCES background (id) ON DELETE CASCADE,
  feat_id       INTEGER NOT NULL REFERENCES feat (id) ON DELETE CASCADE,
  PRIMARY KEY (background_id, feat_id)
) STRICT;


-- ---------------------------------------------------------------------
-- 4. CLASSES, SUBCLASSES AND FEATURES
-- ---------------------------------------------------------------------

CREATE TABLE class (
  id                      INTEGER PRIMARY KEY,
  source_id               INTEGER NOT NULL REFERENCES source (id) ON DELETE CASCADE,
  slug                    TEXT    NOT NULL,
  name                    TEXT    NOT NULL,
  hit_die                 INTEGER NOT NULL CHECK (hit_die IN (6, 8, 10, 12)),
  spellcasting_ability_id INTEGER REFERENCES ability (id),   -- NULL for non-casters
  -- How the class scales its spell access. Derived max spell level is
  -- computed from this plus the slot table, which is far less data than
  -- recording an unlock level per spell per class.
  --   full = every slot level the class reaches
  --   half = up to half the highest slot level
  --   pact = Warlock. Limited to slot levels 1-5, single slot level per
  --          class level, short-rest recovery.
  casting_progression     TEXT    NOT NULL DEFAULT 'none'
                          CHECK (casting_progression IN ('none', 'full', 'half', 'pact')),
  UNIQUE (source_id, slug)
) STRICT;

CREATE TABLE subclass (
  id           INTEGER PRIMARY KEY,
  source_id    INTEGER NOT NULL REFERENCES source (id) ON DELETE CASCADE,
  slug         TEXT    NOT NULL,
  class_id     INTEGER NOT NULL REFERENCES class (id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  unlock_level INTEGER NOT NULL CHECK (unlock_level BETWEEN 1 AND 20),
  UNIQUE (source_id, slug),
  UNIQUE (id, class_id)          -- composite FK target in character_class
) STRICT;

-- Exactly ONE of the five owner columns is filled.
CREATE TABLE feature (
  id             INTEGER PRIMARY KEY,
  source_id      INTEGER NOT NULL REFERENCES source (id) ON DELETE CASCADE,
  slug           TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  description    TEXT    NOT NULL,
  level          INTEGER CHECK (level BETWEEN 1 AND 20),  -- 20 = capstone
  class_id       INTEGER REFERENCES class (id) ON DELETE CASCADE,
  subclass_id    INTEGER REFERENCES subclass (id) ON DELETE CASCADE,
  species_id     INTEGER REFERENCES species (id) ON DELETE CASCADE,
  variant_id     INTEGER REFERENCES species_variant (id) ON DELETE CASCADE,
  background_id  INTEGER REFERENCES background (id) ON DELETE CASCADE,
  UNIQUE (source_id, slug),
  CHECK (
      (class_id       IS NOT NULL)
    + (subclass_id    IS NOT NULL)
    + (species_id     IS NOT NULL)
    + (variant_id     IS NOT NULL)
    + (background_id  IS NOT NULL) = 1
  )
) STRICT;


-- ---------------------------------------------------------------------
-- 5. LEVEL PROGRESSION (data, not structure)
--
-- Every "you gain something at class level N" rule lives here as rows.
-- That is why Fighter getting feats at 4/6/8/12/14/16 while Rogue gets
-- them at 4/8/10/12/16 needs no special case -- it is just different
-- rows.
-- ---------------------------------------------------------------------

-- Every "you gain a choice at class level N" mechanic uses this one shape:
-- a pool of options, some number of picks, the allowance growing at
-- specific class levels. That covers ASI/feat, Epic Boons, Fighting
-- Styles and Weapon Masteries without a table per mechanic, and it is the
-- shape a JSON importer wants.
--
-- Adding a fifth mechanic later (Sorcerer Metamagic options, Warlock
-- Eldritch Invocations, Cleric Divine Orders) is a seed INSERT here plus
-- its own content catalog -- not a schema change.
CREATE TABLE class_grant_kind (
  code        TEXT PRIMARY KEY,
  description TEXT NOT NULL
) STRICT;

INSERT INTO class_grant_kind (code, description) VALUES
  ('asi_or_feat',    'Ability Score Increase OR a general feat, never both'),
  ('epic_boon',      'Epic Boon feat, at class level 19'),
  ('fighting_style', 'Fighting Style feat'),
  ('weapon_mastery', 'Weapon Mastery for one chosen weapon');

-- How many picks OPEN at each class level. This is INCREMENTAL, so the
-- allowance a character holds is SUM(opens) for the levels they reached.
--   Fighter     (1,'fighting_style',1) (4..16,'asi_or_feat',1 each)
--               (1,'weapon_mastery',3) (4,'weapon_mastery',1) ...
--   Battle Master subclass adds a 2nd Fighting Style at class level 7
--   Rogue       (4,8,10,12,16,'asi_or_feat',1)
CREATE TABLE class_grant_slot (
  class_id    INTEGER NOT NULL REFERENCES class (id) ON DELETE CASCADE,
  class_level INTEGER NOT NULL CHECK (class_level BETWEEN 1 AND 20),
  grant_kind  TEXT    NOT NULL REFERENCES class_grant_kind (code),
  opens       INTEGER NOT NULL DEFAULT 1 CHECK (opens > 0),
  PRIMARY KEY (class_id, class_level, grant_kind)
) STRICT;

-- Cantrips known at each class level (Sorcerer 4 at 1st -> 6 at 10th+).
CREATE TABLE class_cantrip_count (
  class_id    INTEGER NOT NULL REFERENCES class (id) ON DELETE CASCADE,
  class_level INTEGER NOT NULL CHECK (class_level BETWEEN 1 AND 20),
  cantrips    INTEGER NOT NULL CHECK (cantrips >= 0),
  PRIMARY KEY (class_id, class_level)
) STRICT;

-- Spells preparable of each level at each class level. This stores the
-- TABLE value, not the computed total: the character's casting-ability
-- modifier is added at read time so an ASI changes the total with no data
-- migration.
CREATE TABLE class_prepared_count (
  class_id     INTEGER NOT NULL REFERENCES class (id) ON DELETE CASCADE,
  class_level  INTEGER NOT NULL CHECK (class_level BETWEEN 1 AND 20),
  spell_level  INTEGER NOT NULL CHECK (spell_level BETWEEN 1 AND 9),
  max_prepared INTEGER NOT NULL CHECK (max_prepared >= 0),
  PRIMARY KEY (class_id, class_level, spell_level)
) STRICT;

-- Spell slots. A full caster has several rows per class level (one per
-- slot level); the Warlock has exactly one, because all its Pact Magic
-- slots are the same level. Identical query for both -- no special case.
CREATE TABLE class_spell_slot (
  class_id    INTEGER NOT NULL REFERENCES class (id) ON DELETE CASCADE,
  class_level INTEGER NOT NULL CHECK (class_level BETWEEN 1 AND 20),
  slot_level  INTEGER NOT NULL CHECK (slot_level BETWEEN 1 AND 9),
  slot_count  INTEGER NOT NULL CHECK (slot_count >= 0),
  PRIMARY KEY (class_id, class_level, slot_level)
) STRICT;

-- Warlock Pact Magic recovers on a short rest; everyone else on a long
-- rest. Magical Cunning's half-restore and the level-20 full-restore are
-- features, not concerns of this table.
CREATE TABLE class_slot_recovery (
  class_id INTEGER PRIMARY KEY REFERENCES class (id) ON DELETE CASCADE,
  interval TEXT NOT NULL CHECK (interval IN ('short_rest', 'long_rest'))
) STRICT;


-- ---------------------------------------------------------------------
-- 6. SPELLS
--
-- 2024 has no "known spells" for any class: every caster prepares from
-- a list at a long rest. Cantrips are the only spells known outright,
-- and they are stored separately in character_cantrip because they never
-- touch a spell slot.
-- ---------------------------------------------------------------------

CREATE TABLE spell (
  id            INTEGER PRIMARY KEY,
  source_id     INTEGER NOT NULL REFERENCES source (id) ON DELETE CASCADE,
  slug          TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  spell_level   INTEGER NOT NULL CHECK (spell_level BETWEEN 0 AND 9),  -- 0 = cantrip
  school        TEXT    NOT NULL CHECK (school IN ('abjuration', 'conjuration', 'divination', 'enchantment',
                                                   'evocation', 'illusion', 'necromancy', 'transmutation')),
  casting_time  TEXT    NOT NULL,
  spell_range   TEXT    NOT NULL,   -- not "range": reserved in MySQL, keyword in SQLite
  duration      TEXT    NOT NULL,
  concentration INTEGER NOT NULL DEFAULT 0 CHECK (concentration IN (0, 1)),
  ritual        INTEGER NOT NULL DEFAULT 0 CHECK (ritual IN (0, 1)),   -- adds 10 min to casting time
  verbal        INTEGER NOT NULL DEFAULT 1 CHECK (verbal IN (0, 1)),
  somatic       INTEGER NOT NULL DEFAULT 1 CHECK (somatic IN (0, 1)),
  material      INTEGER NOT NULL DEFAULT 0 CHECK (material IN (0, 1)),
  material_cost_cp INTEGER NOT NULL DEFAULT 0 CHECK (material_cost_cp >= 0),  -- 0 = no consumable cost
  description   TEXT,
  UNIQUE (source_id, slug)
) STRICT;

-- What a class CAN learn. Max spell level the character may actually cast
-- is derived from class.casting_progression + class_spell_slot.
CREATE TABLE class_spell (
  class_id INTEGER NOT NULL REFERENCES class (id) ON DELETE CASCADE,
  spell_id INTEGER NOT NULL REFERENCES spell (id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, spell_id)
) STRICT;

-- A class FEATURE that references a spell (Magic Initiate, Spellcasting
-- Adept). Distinct from trait_spell, which is a lineage GRANTING the
-- spell. Kept separate so a nullable level column is not forced onto
-- every feature-spell link.
CREATE TABLE feature_spell (
  feature_id INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
  spell_id   INTEGER NOT NULL REFERENCES spell (id) ON DELETE CASCADE,
  PRIMARY KEY (feature_id, spell_id)
) STRICT;

-- Spells and cantrips GRANTED by a species lineage or a patron subclass.
-- Always prepared, castable without a slot, and they do NOT count against
-- the character's prepared-spell total.
--
--   Elf / Tiefling lineage : a pair at class levels 3 and 5
--   Celestial Patron       : Aid, Cure Wounds, Guiding Bolt, Lesser
--                            Restoration, Light, Sacred Flame at 3,
--                            Daylight, Revivify at 5; Guardian of Faith,
--                            Wall of Fire at 7; Greater Restoration,
--                            Summon Celestial at 9
--   High Elf               : Prestidigitation, replaceable with any
--                            Wizard cantrip each long rest (replaceable=1)
--   Wood Elf               : Druidcraft
--   Rock Gnome             : Mending and Prestidigitation
--   Forest Gnome           : Speak With Animals
--
-- These are NEVER written to character_spell or character_cantrip: they
-- are derived at read time, so a character cannot desync or delete them.
-- That is also why character_cantrip.class_id can stay NOT NULL -- a Gnome
-- with no class levels still records Speak With Animals, because that row
-- comes from a feature rather than from a class.
--
-- grant_level is the CLASS level at which the spell arrives; NULL means
-- innate, which is the case for every species and lineage cantrip.
-- What DAMAGE a spell deals, as distinct from the damage_type_id columns
-- elsewhere: 2024 spells often have no single fixed type. Chromatic Orb
-- lets the caster pick, Destructive Wave is radiant OR necrotic, Spirit
-- Guardians likewise. That is a rules mechanic, not a data-entry quirk.
--
-- Two rows with selection = 'choice' means "pick one of these".
--
-- delivery exists because "Cloudkill deals necrotic damage" and "Firebolt
-- deals fire damage" are not the same kind of statement: the first repeats
-- on a trigger, the second is rolled once.
--
-- Deliberately NOT stored here: damage dice. Firebolt is 1d10 at 1st but
-- 4d10 at 17th, so a static dice string cannot express cantrip scaling.
-- See cantrip_damage_dice for that. The per-occurrence dice and the
-- trigger wording stay in the description.
CREATE TABLE spell_damage_type (
  spell_id       INTEGER NOT NULL REFERENCES spell (id) ON DELETE CASCADE,
  damage_type_id INTEGER NOT NULL REFERENCES damage_type (id) ON DELETE CASCADE,
  selection      TEXT    NOT NULL DEFAULT 'fixed' CHECK (selection IN ('fixed', 'choice')),
  delivery       TEXT    NOT NULL DEFAULT 'cast'
                 CHECK (delivery IN ('cast', 'aura', 'bonus_action', 'pool', 'beam', 'environmental')),
  PRIMARY KEY (spell_id, damage_type_id)
) STRICT;

-- Cantrip damage scales at class levels 1, 5, 11 and 17 (Firebolt 1d10 ->
-- 2d10 -> 3d10 -> 4d10). Stored as rows so the breakpoints are data, not
-- baked-in columns.
--
-- Keyed by class because only CLASS-granted cantrips scale: an Eldritch
-- Knight's Blade Ward is 1d4/2d4/3d4/4d4, while species cantrips such as
-- Mending never scale and simply have no rows here. Resolve at read time
-- with the highest from_level at or below the character's class level.
CREATE TABLE cantrip_damage_dice (
  class_id   INTEGER NOT NULL REFERENCES class (id) ON DELETE CASCADE,
  spell_id   INTEGER NOT NULL REFERENCES spell (id) ON DELETE CASCADE,
  from_level INTEGER NOT NULL CHECK (from_level BETWEEN 1 AND 20),
  dice       TEXT    NOT NULL,          -- '2d10'
  PRIMARY KEY (class_id, spell_id, from_level)
) STRICT;

CREATE TABLE granted_spell (
  feature_id  INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
  spell_id    INTEGER NOT NULL REFERENCES spell (id) ON DELETE CASCADE,
  grant_level INTEGER CHECK (grant_level BETWEEN 1 AND 20),
  replaceable INTEGER NOT NULL DEFAULT 0 CHECK (replaceable IN (0, 1)),
  PRIMARY KEY (feature_id, spell_id)
) STRICT;

-- A character's swap-in for a replaceable granted cantrip (High Elf trading
-- Prestidigitation for a different Wizard cantrip). Only meaningful where
-- granted_spell.replaceable = 1, which the app validates.
CREATE TABLE character_granted_spell (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  feature_id   INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
  spell_id     INTEGER NOT NULL REFERENCES spell (id) ON DELETE RESTRICT,
  PRIMARY KEY (character_id, feature_id)
) STRICT;


-- ---------------------------------------------------------------------
-- 7. EFFECTS AND CONDITIONS
--
-- `effect` is the general numeric-rules carrier: base values, ability
-- modifier deltas, speed deltas. `condition` is separate because the
-- standard conditions are fixed rules data, not imported content -- if
-- they were per-source, importing two overlapping packs would give you
-- two "Poisoned" conditions and split a poisoned character's state.
-- ---------------------------------------------------------------------

CREATE TABLE effect (
  id          INTEGER PRIMARY KEY,
  source_id   INTEGER NOT NULL REFERENCES source (id) ON DELETE CASCADE,
  slug        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  -- A constant this effect contributes: the 10 in Unarmored Defense, a
  -- flat proficiency or speed number, and so on.
  base_value  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source_id, slug)
) STRICT;

-- Ability score deltas. `amount` is added to that ability's MODIFIER,
-- so amount 0 means "add this ability's modifier", which is exactly how
-- Unarmored Defense works.
--
-- max_score is the ceiling for this specific source, and that is why it
-- lives here rather than on the feat:
--   20  ASI, general feats, background ASI
--   22  a Tome sets the score to 22
--   25  Primal Champion (+4)
--   30  Epic Boon
-- max_delta is the Tome rule specifically: it raises the character's own
-- ceiling by 2 each time and sets the score to that ceiling, so two
-- Tomes reach 24 rather than both capping at 22.
CREATE TABLE effect_modifier (
  effect_id  INTEGER NOT NULL REFERENCES effect (id) ON DELETE CASCADE,
  ability_id INTEGER NOT NULL REFERENCES ability (id),
  amount     INTEGER NOT NULL,
  max_score  INTEGER NOT NULL DEFAULT 20 CHECK (max_score BETWEEN 1 AND 30),
  max_delta  INTEGER CHECK (max_delta IS NULL OR max_delta > 0),
  sets_to_personal_max INTEGER NOT NULL DEFAULT 0 CHECK (sets_to_personal_max IN (0, 1)),
  PRIMARY KEY (effect_id, ability_id)
) STRICT;

-- Longstrider +10, Haste doubling, 2024 Goliath Large Form +10.
CREATE TABLE effect_speed (
  effect_id   INTEGER PRIMARY KEY REFERENCES effect (id) ON DELETE CASCADE,
  speed_delta INTEGER NOT NULL
) STRICT;

-- ---------------------------------------------------------------------
-- 7a. ROLL MODIFIERS AND RECHARGES
--
-- Most of what an "effect" does in 2024 is modify a roll, and it differs
-- only in KIND, not in shape. So it is one table:
--
--   Alert              initiative     advantage
--   Danger Sense       save:DEX       advantage
--   Haste              AC             flat +2
--   Innate Sorcery     spell_save_dc  flat +1
--   Innate Sorcery     spell_attack   advantage
--   Elemental Weapon   weapon_damage  dice +1d4
--   Searing Smite      weapon_damage  dice +1d6 fire
--   Savage Attacker    weapon_damage  reroll_higher
-- ---------------------------------------------------------------------

CREATE TABLE roll_scope (
  id         INTEGER PRIMARY KEY,
  code       TEXT    NOT NULL UNIQUE
    CHECK (code IN ('initiative', 'ability_check', 'save', 'attack_roll',
                    'weapon_attack', 'spell_attack', 'weapon_damage',
                    'spell_damage', 'spell_save_dc', 'damage_taken',
                    'death_save', 'all_attacks', 'exhaustion_save')),
  -- Which ability the scope refers to; NULL means any. Danger Sense sets
  -- this to DEX so it covers DEX saves without a second table.
  ability_id INTEGER REFERENCES ability (id)
) STRICT;

CREATE TABLE effect_roll_modifier (
  effect_id      INTEGER NOT NULL REFERENCES effect (id) ON DELETE CASCADE,
  scope_id       INTEGER NOT NULL REFERENCES roll_scope (id) ON DELETE CASCADE,
  kind           TEXT    NOT NULL
    CHECK (kind IN ('advantage', 'disadvantage', 'flat', 'dice', 'reroll_higher', 'reroll_lower')),
  amount  INTEGER NOT NULL DEFAULT 0,
  dice    TEXT,          -- kind = 'dice'
  damage_type_id INTEGER REFERENCES damage_type (id) ON DELETE SET NULL,  -- typed riders
  -- WHEN the rider applies. Genuinely prose: "when you hit with a weapon",
  -- "when you take damage", "when a creature you can see damages you"
  -- -- these do not reduce to a small enumeration. NULL when there is no
  -- trigger (Second Wind is just a turn).
  trigger_text TEXT,
  PRIMARY KEY (effect_id, scope_id, kind)
) STRICT;

-- A single `uses_per_long_rest` integer is not enough. Paladin Channel
-- Divinity is the case that breaks it: "You can use this twice. You regain
-- ONE of its expended uses when you finish a Short Rest, and you regain
-- ALL ... when you finish a Long Rest", and you gain an additional use at
-- Paladin level 11 -- so the cap is neither constant nor short-vs-long only.
CREATE TABLE effect_recharge (
  effect_id INTEGER PRIMARY KEY REFERENCES effect (id) ON DELETE CASCADE,
  interval  TEXT    NOT NULL CHECK (interval IN ('short_rest', 'long_rest', 'permanent')),
  uses_max  INTEGER NOT NULL DEFAULT 0 CHECK (uses_max >= 0),   -- 0 = unlimited
  short_rest_returns INTEGER CHECK (short_rest_returns IS NULL OR short_rest_returns >= 0),
  CHECK (short_rest_returns IS NULL OR interval IN ('short_rest', 'long_rest'))
) STRICT;

-- Extra uses at specific class levels, so effective_max = uses_max + the
-- sum of bonuses at or below the character's level in the owning class.
CREATE TABLE effect_recharge_level_bonus (
  effect_id   INTEGER NOT NULL REFERENCES effect (id) ON DELETE CASCADE,
  class_level INTEGER NOT NULL CHECK (class_level BETWEEN 1 AND 20),
  uses_bonus  INTEGER NOT NULL CHECK (uses_bonus > 0),
  PRIMARY KEY (effect_id, class_level)
) STRICT;

CREATE TABLE feat_effect (
  feat_id   INTEGER NOT NULL REFERENCES feat (id) ON DELETE CASCADE,
  effect_id INTEGER NOT NULL REFERENCES effect (id) ON DELETE CASCADE,
  PRIMARY KEY (feat_id, effect_id)
) STRICT;

CREATE TABLE feature_effect (
  feature_id INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
  effect_id  INTEGER NOT NULL REFERENCES effect (id) ON DELETE CASCADE,
  PRIMARY KEY (feature_id, effect_id)
) STRICT;

CREATE TABLE spell_effect (
  spell_id  INTEGER NOT NULL REFERENCES spell (id) ON DELETE CASCADE,
  effect_id INTEGER NOT NULL REFERENCES effect (id) ON DELETE CASCADE,
  PRIMARY KEY (spell_id, effect_id)
) STRICT;

-- The fifteen standard conditions (Frightened, Grappled, Prone, Poisoned, ...)
-- are seeded below with source_id NULL, which is what makes them global.
--
-- A pack may ADD its own -- a bespoke "marked" -- and may not REDEFINE a
-- global one. That distinction is the point of the nullable column. Without
-- it, importing two overlapping packs gives you two "Poisoned" conditions
-- and a poisoned character stops being poisoned. The importer refuses a pack
-- that defines a slug which already exists globally; see shared/packs.
CREATE TABLE condition (
  id          INTEGER PRIMARY KEY,
  -- NULL = global vocabulary shipped with the app. Set = pack-owned.
  source_id   INTEGER REFERENCES source (id) ON DELETE CASCADE,
  slug        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  UNIQUE (source_id, slug)
) STRICT;

-- REQUIRED, not an optimisation. SQLite treats NULLs as distinct in a UNIQUE
-- constraint, so UNIQUE (source_id, slug) on its own would happily hold two
-- global rows sharing a slug. This index restores global uniqueness for the
-- NULL case only. Cross-pack duplicates stay legal on purpose: two packs may
-- each define "marked", and a bare key never resolves outside the pack it
-- appears in.
CREATE UNIQUE INDEX condition_global_slug ON condition (slug) WHERE source_id IS NULL;

-- ---------------------------------------------------------------------
-- 7c. CAPABILITY GRANTS
--
-- Small, mostly display-only, but each is a couple of rows across a whole
-- PHB, so modelling them is cheap.
-- ---------------------------------------------------------------------

-- Every species has darkvision (60 or 120 feet); wall spells grant it too.
CREATE TABLE effect_darkvision (
  effect_id   INTEGER PRIMARY KEY REFERENCES effect (id) ON DELETE CASCADE,
  range_feet  INTEGER NOT NULL CHECK (range_feet > 0)
) STRICT;

-- Feats that hand a weapon a property (Finesse, Reach).
CREATE TABLE effect_weapon_property (
  effect_id    INTEGER NOT NULL REFERENCES effect (id) ON DELETE CASCADE,
  property_id  INTEGER NOT NULL REFERENCES weapon_property (id) ON DELETE CASCADE,
  PRIMARY KEY (effect_id, property_id)
) STRICT;

CREATE TABLE language (
  id   INTEGER PRIMARY KEY,
  source_id INTEGER REFERENCES source (id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (source_id, slug)
) STRICT;

CREATE UNIQUE INDEX language_global_slug ON language (slug) WHERE source_id IS NULL;

CREATE TABLE effect_language (
  effect_id   INTEGER NOT NULL REFERENCES effect (id) ON DELETE CASCADE,
  language_id INTEGER NOT NULL REFERENCES language (id) ON DELETE CASCADE,
  PRIMARY KEY (effect_id, language_id)
) STRICT;

-- Immunity to a CONDITION, as distinct from a damage type. Satyr: immune
-- to Charmed. Githzerai: immune to Frightened.
CREATE TABLE effect_condition_modifier (
  effect_id    INTEGER NOT NULL REFERENCES effect (id) ON DELETE CASCADE,
  condition_id INTEGER NOT NULL REFERENCES condition (id) ON DELETE CASCADE,
  relation     TEXT    NOT NULL CHECK (relation IN ('resistant', 'immune', 'vulnerable')),
  PRIMARY KEY (effect_id, condition_id, relation)
) STRICT;

-- Champion's Improved Critical lowers the nat-20 threshold to 19.
CREATE TABLE effect_crit (
  effect_id INTEGER PRIMARY KEY REFERENCES effect (id) ON DELETE CASCADE,
  threshold INTEGER NOT NULL CHECK (threshold BETWEEN 1 AND 20)
) STRICT;

-- 2024 Goliath Large Form: Medium becomes Large.
CREATE TABLE effect_size (
  effect_id  INTEGER PRIMARY KEY REFERENCES effect (id) ON DELETE CASCADE,
  size       TEXT    NOT NULL CHECK (size IN ('tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'))
) STRICT;


-- ---------------------------------------------------------------------
-- 7b. DAMAGE TYPES AND RELATIONS
--
-- Thirteen types, fixed vocabulary like ability, so seeded and globally
-- unique with no source_id. Without that, importing two overlapping packs
-- gives you two "fire" rows and silently splits every resistance lookup.
-- Unlike skill, tool, language and condition, this table stays closed: a
-- damage type is a rules-bearing join key, so a second "fire" corrupts a
-- lookup rather than duplicating a preference.
-- ---------------------------------------------------------------------

CREATE TABLE damage_type (
  id   INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE
       CHECK (slug IN ('acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
                       'necrotic', 'piercing', 'poison', 'psychic', 'radiant',
                       'slashing', 'thunder')),
  name TEXT NOT NULL
) STRICT;

-- Resistance / immunity / vulnerability as content. All THREE of feature,
-- item and spell hand these out in 2024 -- Dwarven Resilience, Padded
-- Armor of Fire Resistance, Fire Shield -- so all three need a link.
CREATE TABLE damage_modifier (
  id             INTEGER PRIMARY KEY,
  damage_type_id INTEGER NOT NULL REFERENCES damage_type (id) ON DELETE CASCADE,
  relation       TEXT    NOT NULL CHECK (relation IN ('resistant', 'immune', 'vulnerable'))
) STRICT;

CREATE TABLE feature_damage_modifier (
  feature_id         INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
  damage_modifier_id INTEGER NOT NULL REFERENCES damage_modifier (id) ON DELETE CASCADE,
  -- "only while raging", "while inside your Aura of Warding". Prose on
  -- purpose: evaluating WHEN a conditional applies is out of scope, and
  -- pretending otherwise would be worse than saying so.
  conditions_note TEXT,
  PRIMARY KEY (feature_id, damage_modifier_id)
) STRICT;

CREATE TABLE item_damage_modifier (
  item_id           INTEGER NOT NULL REFERENCES item (id) ON DELETE CASCADE,
  damage_modifier_id INTEGER NOT NULL REFERENCES damage_modifier (id) ON DELETE CASCADE,
  conditions_note TEXT,
  PRIMARY KEY (item_id, damage_modifier_id)
) STRICT;

CREATE TABLE spell_damage_modifier (
  spell_id          INTEGER NOT NULL REFERENCES spell (id) ON DELETE CASCADE,
  damage_modifier_id INTEGER NOT NULL REFERENCES damage_modifier (id) ON DELETE CASCADE,
  conditions_note TEXT,
  PRIMARY KEY (spell_id, damage_modifier_id)
) STRICT;

-- Character resistances are STORED, not derived. Deriving would require
-- knowing which features a character has, and features are granted
-- implicitly by species + variant + class level rather than owned as rows
-- -- a Bear Totem Barbarian's resistance is gated on a class level, not a
-- row the character holds. So the user owns this list, and the four
-- provenance columns below record which content granted an entry.
CREATE TABLE character_damage_modifier (
  character_id   INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  damage_type_id INTEGER NOT NULL REFERENCES damage_type (id) ON DELETE CASCADE,
  relation       TEXT    NOT NULL CHECK (relation IN ('resistant', 'immune', 'vulnerable')),
  -- Provenance. Four nullable columns with a one-of CHECK rather than the
  -- source_kind + source_ref pair this table used to carry, because a
  -- polymorphic pair cannot be a foreign key and so can be neither enforced,
  -- cascaded nor checked. It was worse than dangling: no table here uses
  -- AUTOINCREMENT, so SQLite reissues a freed id to the next insert, and a
  -- stale source_ref could point at a different, unrelated feature that
  -- inherited the number.
  --
  -- ON DELETE RESTRICT throughout, per the tier-2 policy above. Content must
  -- never silently delete player data, and a provenance pointer that quietly
  -- went NULL would hide the removal rather than surface it.
  species_id  INTEGER REFERENCES species (id)         ON DELETE RESTRICT,
  variant_id  INTEGER REFERENCES species_variant (id) ON DELETE RESTRICT,
  feature_id  INTEGER REFERENCES feature (id)         ON DELETE RESTRICT,
  item_id     INTEGER REFERENCES item (id)            ON DELETE RESTRICT,
  conditions_note TEXT,
  PRIMARY KEY (character_id, damage_type_id, relation),
  -- At most one, not exactly one: a player may enter a resistance by hand,
  -- and then there is no content that granted it. Summed as IS NOT NULL
  -- rather than negated for the same reason character_grant_pick sums rather
  -- than negates.
  CHECK ((species_id IS NOT NULL) + (variant_id IS NOT NULL)
       + (feature_id IS NOT NULL) + (item_id    IS NOT NULL) <= 1)
) STRICT;


-- ---------------------------------------------------------------------
-- 8. SKILLS AND PROFICIENCIES
--
-- 2024 folds Athletics into Strength and everything else Dexterity-
-- flavoured into Dexterity; there is one proficiency per ability, not a
-- separate Athletics/Acrobatics split as in 2014.
-- ---------------------------------------------------------------------

CREATE TABLE skill (
  id         INTEGER PRIMARY KEY,
  -- NULL = global vocabulary shipped with the app. Set = pack-owned.
  source_id  INTEGER REFERENCES source (id) ON DELETE CASCADE,
  slug       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  ability_id INTEGER NOT NULL REFERENCES ability (id),
  UNIQUE (source_id, slug)
) STRICT;

CREATE UNIQUE INDEX skill_global_slug ON skill (slug) WHERE source_id IS NULL;

CREATE TABLE tool (
  id         INTEGER PRIMARY KEY,
  source_id  INTEGER REFERENCES source (id) ON DELETE CASCADE,
  slug       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  is_artisan INTEGER NOT NULL DEFAULT 0 CHECK (is_artisan IN (0, 1)),
  UNIQUE (source_id, slug)
) STRICT;

CREATE UNIQUE INDEX tool_global_slug ON tool (slug) WHERE source_id IS NULL;

-- D&D Beyond lists saving throws per class ("Saves: Strength &
-- Constitution"). Without this the multiclass prerequisite check in
-- character_rule_preference.obey_multiclass_requirements has nothing to
-- validate against.
CREATE TABLE class_saving_throw (
  class_id  INTEGER NOT NULL REFERENCES class (id) ON DELETE CASCADE,
  ability_id INTEGER NOT NULL REFERENCES ability (id),
  PRIMARY KEY (class_id, ability_id)
) STRICT;

CREATE TABLE class_skill (
  class_id INTEGER NOT NULL REFERENCES class (id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skill (id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, skill_id)
) STRICT;

CREATE TABLE class_tool (
  class_id INTEGER NOT NULL REFERENCES class (id) ON DELETE CASCADE,
  tool_id  INTEGER NOT NULL REFERENCES tool (id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, tool_id)
) STRICT;

CREATE TABLE class_armour_type (
  class_id    INTEGER NOT NULL REFERENCES class (id) ON DELETE CASCADE,
  armour_type TEXT    NOT NULL CHECK (armour_type IN ('light', 'medium', 'heavy', 'shield')),
  PRIMARY KEY (class_id, armour_type)
) STRICT;

-- Which weapon CATEGORIES this class may take mastery properties for.
-- The class-specific exceptions (Rogue limited to Simple plus Martial
-- with Finesse or Light) additionally consult weapon_property_map, so that
-- half stays an app-level check.
CREATE TABLE class_weapon_category (
  class_id    INTEGER NOT NULL REFERENCES class (id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES weapon_category (id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, category_id)
) STRICT;

-- Subclasses grant proficiencies too -- Eldritch Knight armour, College of
-- Lore skills -- so each of these has a subclass-scoped twin rather than
-- forcing those grants onto the parent class.
CREATE TABLE subclass_skill (
  subclass_id INTEGER NOT NULL REFERENCES subclass (id) ON DELETE CASCADE,
  skill_id    INTEGER NOT NULL REFERENCES skill (id) ON DELETE CASCADE,
  PRIMARY KEY (subclass_id, skill_id)
) STRICT;

CREATE TABLE subclass_tool (
  subclass_id INTEGER NOT NULL REFERENCES subclass (id) ON DELETE CASCADE,
  tool_id     INTEGER NOT NULL REFERENCES tool (id) ON DELETE CASCADE,
  PRIMARY KEY (subclass_id, tool_id)
) STRICT;

CREATE TABLE subclass_armour_type (
  subclass_id INTEGER NOT NULL REFERENCES subclass (id) ON DELETE CASCADE,
  armour_type TEXT    NOT NULL CHECK (armour_type IN ('light', 'medium', 'heavy', 'shield')),
  PRIMARY KEY (subclass_id, armour_type)
) STRICT;

-- XP thresholds per level, so xp levelling (experience_points IS NOT NULL)
-- can resolve what level a character has earned. A milestone character has
-- no XP to look up.
CREATE TABLE xp_threshold (
  level       INTEGER PRIMARY KEY CHECK (level BETWEEN 1 AND 20),
  xp_required INTEGER NOT NULL CHECK (xp_required >= 0)
) STRICT;


-- ---------------------------------------------------------------------
-- 9. ITEMS
-- ---------------------------------------------------------------------

CREATE TABLE item (
  id          INTEGER PRIMARY KEY,
  source_id   INTEGER NOT NULL REFERENCES source (id) ON DELETE CASCADE,
  slug        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  weight      REAL    NOT NULL DEFAULT 0 CHECK (weight >= 0),      -- pounds
  cost_cp     INTEGER NOT NULL DEFAULT 0 CHECK (cost_cp >= 0),     -- price in copper
  description TEXT,
  -- 2024: attunement is once per long rest, not a lifetime cap of 3.
  requires_attunement INTEGER NOT NULL DEFAULT 0 CHECK (requires_attunement IN (0, 1)),
  UNIQUE (source_id, slug)
) STRICT;

-- No own columns: exists so weapon.ammunition_id can only point to real
-- ammunition.
CREATE TABLE ammunition (
  item_id INTEGER PRIMARY KEY REFERENCES item (id) ON DELETE CASCADE
) STRICT;

-- Weapon CATEGORY. Separate from properties because Weapon Mastery
-- eligibility is expressed over categories: a Fighter may master any
-- weapon, a Barbarian only Simple and Martial MELEE, a Rogue only Simple
-- plus Martial weapons carrying Finesse or Light.
CREATE TABLE weapon_category (
  id   INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE
    CHECK (code IN ('simple_melee', 'simple_ranged', 'martial_melee', 'martial_ranged'))
) STRICT;

-- Regular weapon properties, normalised because they are rules-bearing,
-- not flavour: Finesse picks STR or DEX, Versatile doubles the dice
-- two-handed, Heavy requires STR 13 and two hands, Light/Reach change AC
-- and Stealth.
--
-- 2024 dropped "medium" as a weapon property (it was never one in any
-- edition -- Medium is an ARMOUR type) and added "loading" for muskets
-- and pistols.
CREATE TABLE weapon_property (
  id   INTEGER PRIMARY KEY,
  code TEXT    NOT NULL UNIQUE
       CHECK (code IN ('finesse', 'versatile', 'heavy', 'light', 'loading',
                       'reach', 'thrown', 'two_handed', 'ammunition', 'improvised'))
) STRICT;

-- MASTERY properties: a 2024 mechanic, and the REPLACEMENT for weapon
-- proficiency rather than an addition to it. Each weapon lists exactly
-- ONE mastery property "in addition to" its regular properties, which is
-- why this is a lookup with a single FK on `weapon` instead of another
-- row in weapon_property_map -- the cardinality is 1:1, not N:M.
CREATE TABLE mastery_property (
  id   INTEGER PRIMARY KEY,
  code TEXT    NOT NULL UNIQUE
       CHECK (code IN ('cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex'))
) STRICT;

CREATE TABLE weapon (
  item_id       INTEGER PRIMARY KEY REFERENCES item (id) ON DELETE CASCADE,
  category_id   INTEGER NOT NULL REFERENCES weapon_category (id) ON DELETE RESTRICT,
  damage_dice   TEXT    NOT NULL,       -- '1d8'
  damage_type_id INTEGER NOT NULL REFERENCES damage_type (id) ON DELETE RESTRICT,
  versatile_dice TEXT,                  -- '1d10': two-handed damage for versatile weapons
  attack_bonus  INTEGER NOT NULL DEFAULT 0 CHECK (attack_bonus >= 0),   -- magic weapon +1/+2/+3
  damage_bonus  INTEGER NOT NULL DEFAULT 0 CHECK (damage_bonus >= 0),
  thrown_range  INTEGER CHECK (thrown_range IS NULL OR thrown_range > 0),
  ammunition_id INTEGER REFERENCES ammunition (item_id) ON DELETE SET NULL,
  mastery_property_id INTEGER REFERENCES mastery_property (id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE weapon_property_map (
  item_id      INTEGER NOT NULL REFERENCES weapon (item_id) ON DELETE CASCADE,
  property_id  INTEGER NOT NULL REFERENCES weapon_property (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, property_id)
) STRICT;

CREATE TABLE item_effect (
  item_id   INTEGER NOT NULL REFERENCES item (id) ON DELETE CASCADE,
  effect_id INTEGER NOT NULL REFERENCES effect (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, effect_id)
) STRICT;

CREATE TABLE armour (
  item_id              INTEGER PRIMARY KEY REFERENCES item (id) ON DELETE CASCADE,
  armour_type          TEXT    NOT NULL CHECK (armour_type IN ('light', 'medium', 'heavy', 'shield')),
  base_ac              INTEGER NOT NULL CHECK (base_ac >= 0),
  max_dex_bonus        INTEGER CHECK (max_dex_bonus >= 0),   -- NULL = no limit
  stealth_disadvantage INTEGER NOT NULL DEFAULT 0 CHECK (stealth_disadvantage IN (0, 1))
) STRICT;


-- ---------------------------------------------------------------------
-- 10. PLAYER DATA
--     Total level is NOT stored: SUM(character_class.level).
-- ---------------------------------------------------------------------

CREATE TABLE player_character (
  id                INTEGER PRIMARY KEY,
  uuid              TEXT    NOT NULL UNIQUE CHECK (length(uuid) = 36),   -- generated by the app
  name              TEXT    NOT NULL,
  species_id        INTEGER NOT NULL REFERENCES species (id) ON DELETE RESTRICT,
  variant_id        INTEGER,
  background_id     INTEGER NOT NULL REFERENCES background (id) ON DELETE RESTRICT,
  -- NULL = milestone levelling: the DM decides when the character levels,
  -- so there is no XP to track. A number = xp levelling; DEFAULT 0 matches
  -- the app's default rules screen ('xp' at 0 XP). CHECK still rejects
  -- negatives; NULL passes it.
  experience_points INTEGER DEFAULT 0 CHECK (experience_points >= 0),
  -- 2024 allows HP to go NEGATIVE: 0 means dying, below 0 means an
  -- automatic failed death save. The old upper-only bound was wrong.
  hp_max            INTEGER NOT NULL CHECK (hp_max >= 1),
  hp_current        INTEGER NOT NULL CHECK (hp_current <= hp_max),
  hp_temp           INTEGER NOT NULL DEFAULT 0 CHECK (hp_temp >= 0),
  -- 2024 Inspiration: gained on a long rest, capped at one.
  inspiration       INTEGER NOT NULL DEFAULT 0 CHECK (inspiration IN (0, 1)),
  -- Rest GENERATIONS. Incrementing a counter is the entire "take a rest"
  -- operation: a spend row is only counted when its generation matches the
  -- character's current count, so a rest needs no UPDATE on any spend table.
  -- Stale generations simply read as unspent.
  short_rest_count  INTEGER NOT NULL DEFAULT 0 CHECK (short_rest_count >= 0),
  long_rest_count   INTEGER NOT NULL DEFAULT 0 CHECK (long_rest_count >= 0),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),  -- app updates on save
  FOREIGN KEY (variant_id, species_id) REFERENCES species_variant (id, species_id) ON DELETE RESTRICT
) STRICT;

-- Housekeeping preferences. These were TypeScript-only, which meant they
-- vanished the moment a character was saved. hp_roll_l1 is only used when
-- hp_type = 'rolled'; 2024 has no averaging.
-- Levelling mode is not here: it is player_character.experience_points IS
-- NULL — one fact, one encoding.
CREATE TABLE character_rule_preference (
  character_id               INTEGER PRIMARY KEY REFERENCES player_character (id) ON DELETE CASCADE,
  hp_type                    TEXT NOT NULL DEFAULT 'fixed' CHECK (hp_type IN ('fixed', 'rolled')),
  hp_roll_l1                 INTEGER CHECK (hp_roll_l1 IS NULL OR hp_roll_l1 >= 1),
  ignore_coin_weight         INTEGER NOT NULL DEFAULT 1 CHECK (ignore_coin_weight IN (0, 1)),  -- 2024: coins weigh nothing
  obey_multiclass_requirements INTEGER NOT NULL DEFAULT 1 CHECK (obey_multiclass_requirements IN (0, 1))
) STRICT;

CREATE TABLE character_ability (
  character_id  INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  ability_id    INTEGER NOT NULL REFERENCES ability (id),
  base_score    INTEGER NOT NULL CHECK (base_score BETWEEN 1 AND 30),
  is_proficient INTEGER NOT NULL DEFAULT 0 CHECK (is_proficient IN (0, 1)),
  PRIMARY KEY (character_id, ability_id)
) STRICT;

-- Background ASI: exactly three rows summing to 3, drawn only from that
-- background's background_ability pool. Distribution is app-enforced.
CREATE TABLE character_background_asi (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  ability_id   INTEGER NOT NULL REFERENCES ability (id),
  bonus        INTEGER NOT NULL CHECK (bonus IN (1, 2)),
  PRIMARY KEY (character_id, ability_id)
) STRICT;

CREATE TABLE character_skill (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  skill_id     INTEGER NOT NULL REFERENCES skill (id),
  is_proficient INTEGER NOT NULL DEFAULT 0 CHECK (is_proficient IN (0, 1)),
  PRIMARY KEY (character_id, skill_id)
) STRICT;

CREATE TABLE character_tool (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  tool_id      INTEGER NOT NULL REFERENCES tool (id),
  is_proficient INTEGER NOT NULL DEFAULT 1 CHECK (is_proficient IN (0, 1)),
  PRIMARY KEY (character_id, tool_id)
) STRICT;

-- One row per class the character has levels in (multiclassing).
CREATE TABLE character_class (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  class_id     INTEGER NOT NULL REFERENCES class (id) ON DELETE RESTRICT,
  level        INTEGER NOT NULL CHECK (level BETWEEN 1 AND 20),
  subclass_id  INTEGER,
  PRIMARY KEY (character_id, class_id),
  FOREIGN KEY (subclass_id, class_id) REFERENCES subclass (id, class_id) ON DELETE SET NULL
) STRICT;

-- What the character took from a class grant.
--
-- An asi_or_feat pick spent on an Ability Score Increase has BOTH feat_id
-- AND item_id NULL -- that is the ASI branch, and it is now structural
-- rather than merely "the absence of a row", which is what the previous
-- design relied on.
--
-- The composite FK to class_grant_slot means a pick cannot be recorded
-- for a slot the class never opens, which the old design could not
-- guarantee.
CREATE TABLE character_grant_pick (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  class_id     INTEGER NOT NULL,
  class_level  INTEGER NOT NULL,
  grant_kind   TEXT    NOT NULL REFERENCES class_grant_kind (code),
  pick_no      INTEGER NOT NULL DEFAULT 1 CHECK (pick_no > 0),
  feat_id      INTEGER REFERENCES feat (id) ON DELETE RESTRICT,
  item_id      INTEGER REFERENCES item (id) ON DELETE RESTRICT,
  PRIMARY KEY (character_id, class_id, class_level, grant_kind, pick_no),
  FOREIGN KEY (character_id, class_id) REFERENCES character_class (character_id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (class_id, class_level, grant_kind)
    REFERENCES class_grant_slot (class_id, class_level, grant_kind),
  -- Never BOTH sources at once. Written as "not both non-NULL" rather
  -- than summing the IS NULL tests, because the asi_or_feat ASI branch
  -- legitimately has BOTH columns NULL and the sum form would reject it.
  CHECK (NOT (feat_id IS NOT NULL AND item_id IS NOT NULL))
) STRICT;

-- ASI bonuses, one row per ability per asi_or_feat pick. Bonuses
-- accumulate per choice, so two feats each granting +1 STR are two picks
-- in two slots totalling +2. Feat-granted bonuses are NOT copied here:
-- they are read through feat -> feat_effect -> effect_modifier, so there
-- is no second place for the importer to write a conflicting value.
CREATE TABLE character_asi_bonus (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  class_id     INTEGER NOT NULL,
  class_level  INTEGER NOT NULL,
  pick_no      INTEGER NOT NULL DEFAULT 1,
  ability_id   INTEGER NOT NULL REFERENCES ability (id),
  bonus        INTEGER NOT NULL CHECK (bonus BETWEEN 1 AND 2),   -- ASI shape only
  PRIMARY KEY (character_id, class_id, class_level, pick_no, ability_id)
) STRICT;

-- MUTUAL EXCLUSION: an asi_or_feat pick is EITHER an Ability Score
-- Increase OR a feat, never both. The CHECK on character_grant_pick
-- stops one row carrying two sources, but cannot stop an ASI bonus being
-- attached to a pick that already holds a feat. This trigger closes that
-- gap, and unlike the previous symmetric pair it only has to run one way:
-- the pick must exist AND have no feat.
CREATE TRIGGER character_asi_requires_featless_pick
BEFORE INSERT ON character_asi_bonus
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM character_grant_pick p
  WHERE p.character_id = NEW.character_id
    AND p.class_id     = NEW.class_id
    AND p.class_level  = NEW.class_level
    AND p.pick_no      = NEW.pick_no
    AND p.grant_kind   = 'asi_or_feat'
    AND p.feat_id IS NULL
)
BEGIN
  SELECT RAISE(ABORT,
    'ASI bonuses require an asi_or_feat pick with no feat (an ASI is the pick)');
END;

-- A Weapon Mastery pick must reference an actual weapon, not any item.
CREATE TRIGGER character_weapon_mastery_requires_weapon
BEFORE INSERT ON character_grant_pick
FOR EACH ROW
WHEN NEW.grant_kind = 'weapon_mastery' AND NOT EXISTS (
  SELECT 1 FROM weapon w WHERE w.item_id = NEW.item_id
)
BEGIN
  SELECT RAISE(ABORT, 'a weapon_mastery pick must reference a weapon item');
END;

-- Feats from the background and from traits, not from a class slot. The
-- 2024 Human gains two (background + Versatile), so this is one-to-many.
CREATE TABLE character_origin_feat (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  feat_id      INTEGER NOT NULL REFERENCES feat (id) ON DELETE RESTRICT,
  origin       TEXT    NOT NULL CHECK (origin IN ('background', 'species')),
  PRIMARY KEY (character_id, feat_id, origin)
) STRICT;

-- Level 1+ spells the character has prepared. In 2024 EVERY caster
-- prepares -- Cleric, Druid, Paladin, Ranger, Wizard, Artificer,
-- Sorcerer and Warlock alike -- so is_prepared is always meaningful and no
-- known/prepared mode exists. class_id records which class taught it:
-- provenance only, never extra daily casts, because casts are bounded by
-- spell slots.
CREATE TABLE character_spell (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  spell_id     INTEGER NOT NULL REFERENCES spell (id) ON DELETE RESTRICT,
  class_id     INTEGER NOT NULL REFERENCES class (id) ON DELETE RESTRICT,
  is_prepared  INTEGER NOT NULL DEFAULT 0 CHECK (is_prepared IN (0, 1)),
  PRIMARY KEY (character_id, spell_id, class_id)
) STRICT;

-- Cantrips are known outright, never slotted, never prepared. Split out so
-- they cannot pollute the slot economy.
--
-- ALWAYS-PREPARED SPELLS ARE NOT STORED HERE. Lineage and patron spells
-- arrive via granted_spell and are derived at read time, so the character
-- physically cannot delete or desync them. Ordinary prepared spells --
-- including every Warlock spell, since 2024 Warlocks prepare like all
-- other casters -- live in character_spell.
CREATE TABLE character_cantrip (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  spell_id     INTEGER NOT NULL REFERENCES spell (id) ON DELETE RESTRICT,
  class_id     INTEGER NOT NULL REFERENCES class (id) ON DELETE RESTRICT,
  PRIMARY KEY (character_id, spell_id, class_id)
) STRICT;

-- The same condition does not stack in 5e. Exhaustion severity is carried
-- by severity, not by a second row.
CREATE TABLE character_condition (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE. While conditions were global this was
  -- unreachable for pack content; a pack may now own one, and a cascade
  -- would strip the condition off every character that had it with no
  -- report. RESTRICT matches character_skill and character_tool, which
  -- declare no clause at all (NO ACTION), so skill, tool and condition now
  -- behave alike -- loudly rather than silently.
  condition_id INTEGER NOT NULL REFERENCES condition (id) ON DELETE RESTRICT,
  remaining_rounds INTEGER CHECK (remaining_rounds IS NULL OR remaining_rounds >= 0),  -- NULL = until removed
  severity   INTEGER NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 6),  -- 1-6 for Exhaustion
  PRIMARY KEY (character_id, condition_id)
) STRICT;

CREATE TABLE character_item (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  item_id      INTEGER NOT NULL REFERENCES item (id) ON DELETE RESTRICT,
  quantity     INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  is_equipped  INTEGER NOT NULL DEFAULT 0 CHECK (is_equipped IN (0, 1)),
  is_attuned   INTEGER NOT NULL DEFAULT 0 CHECK (is_attuned IN (0, 1)),
  PRIMARY KEY (character_id, item_id)
) STRICT;

-- Post-20 progression. What is settled is that class levels stop at 20,
-- which is why no class_* table above needed widening, and that epic
-- boons are available from 19.
--
-- HOW progression continues past 20 is contested; sources disagree on
-- whether class progression continues or only feat picks do. The 30,000
-- XP figure that circulates is the optional 2014 DMG "Bonus Feats at
-- Level 20" rule, not 2024 core. threshold_xp stores whatever ruling
-- the table uses rather than assuming one, and NULL means no XP gate at
-- all — milestone levelling, or a DM grant.
CREATE TABLE character_epic_boon (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  feat_id      INTEGER NOT NULL REFERENCES feat (id) ON DELETE RESTRICT,
  threshold_xp INTEGER CHECK (threshold_xp >= 0),
  PRIMARY KEY (character_id, feat_id)
) STRICT;

-- ---------------------------------------------------------------------
-- 10b. SPENDING LIMITED EFFECTS AND SPELL SLOTS
--
-- Both tables hold one generation column PER INTERVAL rather than a
-- polymorphic interval column, because the content side already says which
-- interval governs: effect_recharge.interval for effects,
-- class_slot_recovery.interval for slots. The read therefore never has to
-- keep two copies of the same fact in sync.
--
-- A spend counts only while its generation matches the character's current
-- counter, so taking a rest is one counter increment and no UPDATE here.
--
-- KNOWN GAP, app-enforced: neither table can CHECK spends against the
-- maximum, because the maximum lives in another table. The app must reject
-- overspending. Same class of rule as the background ASI distribution.
-- ---------------------------------------------------------------------

CREATE TABLE character_effect_uses (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE. A cascade here discarded a character's
  -- uses_spent and rest-generation counters when the effect's pack was
  -- removed: the character survived, their spends silently reset to full.
  effect_id    INTEGER NOT NULL REFERENCES effect (id) ON DELETE RESTRICT,
  uses_spent   INTEGER NOT NULL DEFAULT 0 CHECK (uses_spent >= 0),
  short_rest_generation INTEGER NOT NULL DEFAULT 0,
  long_rest_generation  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, effect_id)
) STRICT;

CREATE TABLE character_spell_slot_spends (
  character_id INTEGER NOT NULL REFERENCES player_character (id) ON DELETE CASCADE,
  class_id     INTEGER NOT NULL,
  slot_level   INTEGER NOT NULL CHECK (slot_level BETWEEN 1 AND 9),
  spent        INTEGER NOT NULL DEFAULT 0 CHECK (spent >= 0),
  -- A Warlock compares against short_rest_generation (Pact Magic recovers
  -- on a short rest); everyone else compares against long_rest_generation.
  short_rest_generation INTEGER NOT NULL DEFAULT 0,
  long_rest_generation  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, class_id, slot_level),
  FOREIGN KEY (character_id, class_id) REFERENCES character_class (character_id, class_id) ON DELETE CASCADE
) STRICT;


-- ---------------------------------------------------------------------
-- 11. SEED DATA
--
-- Rules-text-free on purpose. Nothing here is reproduced content; every
-- descriptive string is the name of a game concept.
-- ---------------------------------------------------------------------

INSERT INTO ability (code, name) VALUES
  ('STR', 'Strength'),
  ('DEX', 'Dexterity'),
  ('CON', 'Constitution'),
  ('INT', 'Intelligence'),
  ('WIS', 'Wisdom'),
  ('CHA', 'Charisma');

INSERT INTO feat_category (code) VALUES
  ('origin'),
  ('general'),
  ('fighting_style'),
  ('epic_boon');

-- The standard conditions. Names and identifiers only; each condition's
-- mechanical effect is described in the app's own words, not copied from
-- the rulebook.
INSERT INTO condition (slug, name) VALUES
  ('blinded',        'Blinded'),
  ('charmed',        'Charmed'),
  ('deafened',       'Deafened'),
  ('exhaustion',     'Exhaustion'),
  ('frightened',     'Frightened'),
  ('grappled',       'Grappled'),
  ('incapacitated',  'Incapacitated'),
  ('invisible',      'Invisible'),
  ('paralyzed',      'Paralyzed'),
  ('petrified',      'Petrified'),
  ('poisoned',       'Poisoned'),
  ('prone',          'Prone'),
  ('restrained',     'Restrained'),
  ('stunned',        'Stunned'),
  ('unconscious',    'Unconscious');

-- 2024 regular properties. "medium" is NOT here: Medium is an armour type
-- and was never a weapon property in any edition.
INSERT INTO weapon_property (code) VALUES
  ('finesse'),
  ('versatile'),
  ('heavy'),
  ('light'),
  ('loading'),
  ('reach'),
  ('thrown'),
  ('two_handed'),
  ('ammunition'),
  ('improvised');

-- The eight 2024 mastery properties. A weapon carries exactly one.
INSERT INTO mastery_property (code) VALUES
  ('cleave'),
  ('graze'),
  ('nick'),
  ('push'),
  ('sap'),
  ('slow'),
  ('topple'),
  ('vex');

INSERT INTO weapon_category (code) VALUES
  ('simple_melee'),
  ('simple_ranged'),
  ('martial_melee'),
  ('martial_ranged');

-- What a roll modifier applies to. ability_id is filled per row where the
-- scope names a specific ability, e.g. save:DEX for Danger Sense.
INSERT INTO roll_scope (code, ability_id) VALUES
  ('initiative',     NULL),
  ('ability_check',  NULL),   -- narrow further per effect if needed
  ('save',           NULL),
  ('attack_roll',    NULL),
  ('weapon_attack',  NULL),
  ('spell_attack',   NULL),
  ('weapon_damage',  NULL),
  ('spell_damage',   NULL),
  ('spell_save_dc',  NULL),
  ('damage_taken',   NULL),
  ('death_save',     NULL),
  ('all_attacks',    NULL),
  ('exhaustion_save', NULL);

-- The thirteen damage types. Seeded like ability and condition: fixed
-- vocabulary, so no source_id and a globally unique slug. Without that,
-- two overlapping packs would give two "fire" rows and split every
-- resistance lookup.
INSERT INTO damage_type (slug, name) VALUES
  ('acid',       'Acid'),
  ('bludgeoning', 'Bludgeoning'),
  ('cold',       'Cold'),
  ('fire',       'Fire'),
  ('force',      'Force'),
  ('lightning',  'Lightning'),
  ('necrotic',   'Necrotic'),
  ('piercing',   'Piercing'),
  ('poison',     'Poison'),
  ('psychic',    'Psychic'),
  ('radiant',    'Radiant'),
  ('slashing',   'Slashing'),
  ('thunder',    'Thunder');


-- ---------------------------------------------------------------------
-- Schema version: the migration runner reads this to know which
-- migrations are already applied.
-- ---------------------------------------------------------------------

PRAGMA user_version = 1;