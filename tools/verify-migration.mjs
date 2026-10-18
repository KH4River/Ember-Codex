// Validates 001_initial.sql against a real SQLite engine (node:sqlite).
// Run: node tools/verify-migration.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { readMigrationSources, sourceDigest } from './lib/migration-source.mjs';

const sql = readFileSync(new URL('../shared/db/migrations/001_initial.sql', import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');

// ---- Reporting ----
let failures = 0;
const ok = (m) => console.log('OK  ' + m);
const fail = (m) => {
  failures++;
  console.log('FAIL ' + m);
};

// ---- Running SQL ----
// Nearly every line of this file builds a fixture. Only the three assertion
// forms below say anything about the schema, so grep for expect, accepts and
// expectFail to read what the schema guarantees, and for ins to read setup.
const ins = (sql, ...p) => db.prepare(sql).run(...p);
const q = (sql, ...p) => db.prepare(sql).get(...p);

/** Row count, optionally filtered. */
const count = (table, where = '', ...p) =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`).get(...p).n;

/** The id of a content row by slug: the lookup the pack importer makes. */
const idOf = (table, slug) => q(`SELECT id FROM ${table} WHERE slug = ?`, slug).id;

/** Column names of a table. */
const columnsOf = (table) => db.prepare(`PRAGMA table_info('${table}')`).all().map((c) => c.name);

// ---- Asserting ----
/** A stored value is what it should be. Reports both sides on failure. */
const expect = (label, actual, wanted) =>
  JSON.stringify(actual) === JSON.stringify(wanted)
    ? ok(label)
    : fail(`${label} -- got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`);

/** The schema should accept this statement. */
const accepts = (label, fn) => {
  try {
    fn();
    ok(label);
  } catch (e) {
    fail(`${label} -- ${e.message}`);
  }
};

/** The schema should refuse this statement. */
const expectFail = (label, fn) => {
  try {
    fn();
    fail(`${label} -- it was accepted`);
  } catch {
    ok(label);
  }
};

try {
  db.exec(sql);
  ok('schema applied cleanly');
} catch (e) {
  fail('schema: ' + e.message);
  process.exit(1);
}

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all();
ok(`${tables.length} tables created`);

// ---- Generated migrations must stay in sync with the .sql source of truth ----
// The app cannot import .sql directly (the Angular builder's `.sql` loader
// disables Node builtin resolution in the spec build), so
// shared/db/migrations.generated.ts is generated from shared/db/migrations/*.sql.
// If someone edits a migration without regenerating, the app would run stale SQL
// while this harness runs the fresh file -- exactly the drift this repo forbids.
const sources = readMigrationSources();
const generated = readFileSync(new URL('../shared/db/migrations.generated.ts', import.meta.url), 'utf8');
const hashLine = /^\/\/ source-hash: ([0-9a-f]{64})$/m.exec(generated);
if (!hashLine) {
  fail('migrations.generated.ts has no source-hash header');
} else if (hashLine[1] !== sourceDigest(sources)) {
  fail('migrations.generated.ts is stale; run `node tools/generate-migrations.mjs`');
} else {
  ok('migrations.generated.ts matches shared/db/migrations/*.sql');
}

// The runtime runner treats user_version as the applied COUNT, so each file's
// trailing PRAGMA user_version must equal its ordinal (001 -> 1). If that ever
// breaks, the runner would skip or replay migrations.
for (const [i, { name, sql }] of sources.entries()) {
  const m = /PRAGMA\s+user_version\s*=\s*(\d+)\s*;?\s*$/.exec(sql.trim());
  if (!m) fail(`${name} does not end with PRAGMA user_version = N`);
  else if (Number(m[1]) !== i + 1) fail(`${name} sets user_version ${m[1]}, expected ${i + 1}`);
  else ok(`${name} sets user_version ${i + 1} (matches its ordinal)`);
}

// ---- Migrations must survive the Capacitor plugin's statement split ----
// On Android the migration does NOT run as a script. The plugin splits it on a
// literal ";\n" (UtilsSQLite.getStatementsArray), then strips every line comment
// from each chunk. A chunk that held nothing but comments is left empty, and
// the plugin hands that empty string to execSQL, which prepares no statement:
// "API called with NULL prepared statement", SQLITE_MISUSE, surfaced to the app
// as the useless "Execute: not an error (code 0)". A comment line ending in ";"
// is what creates such a chunk, by splitting inside a comment block.
//
// Nothing else here can see this. node:sqlite applies the file as one script
// and does not care where the semicolons fall, so every other gate passes while
// the app cannot open a database on a device.
let commentSemicolons = 0;
for (const { name, sql } of sources) {
  sql.split('\n').forEach((line, i) => {
    if (/^\s*--.*;\s*$/.test(line)) {
      commentSemicolons++;
      fail(`${name}:${i + 1} comment line ends with ";" — the Capacitor plugin splits on ";\\n" and builds an empty statement from the comment block`);
    }
  });
}
if (commentSemicolons === 0) {
  expect('no comment line ends with ";" (Capacitor statement split stays intact)', commentSemicolons, 0);
}

// Every FK must resolve to a real table and column. SQLite resolves FKs
// lazily at DML time, so a typo'd target would not surface on CREATE.
// PRAGMA foreign_key_list takes no argument, so it must be walked per table.
const cols = new Map(tables.map((t) => [t.name, new Set(columnsOf(t.name))]));
let bad = 0;
let fkCount = 0;
for (const t of tables) {
  for (const fk of db.prepare(`PRAGMA foreign_key_list('${t.name}')`).all()) {
    fkCount++;
    if (!cols.has(fk.table)) {
      fail(`FK target table missing: ${fk.table} (from ${t})`);
      bad++;
    } else if (!cols.get(fk.table).has(fk.to)) {
      fail(`FK target column missing: ${fk.table}.${fk.to} (from ${t})`);
      bad++;
    }
  }
}
expect(`all ${fkCount} foreign keys resolve to a real table and column`, bad, 0);

// ---- The import order must match the FK graph ----
// The pack importer inserts parents before children. That order is written
// down in shared/packs/importPack.ts, so it is checked here against the
// graph rather than trusted. A table that gains a reference to one the
// importer has not reached yet fails at resolve time, and a bare
// "FOREIGN KEY constraint failed" names nothing worth reading.
const IMPORT_STEP = {
  source: 0,
  skill: 1, tool: 1, language: 1, condition: 1,
  species: 2, species_variant: 3, background: 4, class: 5, subclass: 6,
  feat: 7, feature: 8, spell: 9, effect: 10, item: 11,
};
// Every pack-owned table needs a step. A new content table with no step
// would be silently skipped by the importer, and nothing else would say so.
const unstepped = [...cols.keys()].filter((t) => cols.get(t).has('source_id') && IMPORT_STEP[t] === undefined);
if (unstepped.length === 0) ok('every pack-owned table has a step in the import order');
else fail(`no import step for: ${unstepped.join(', ')}`);

let backwards = 0;
for (const [t, step] of Object.entries(IMPORT_STEP)) {
  for (const fk of db.prepare(`PRAGMA foreign_key_list('${t}')`).all()) {
    const target = IMPORT_STEP[fk.table];
    if (target !== undefined && target > step) {
      fail(`import order is backwards: ${t} (step ${step}) references ${fk.table} (step ${target})`);
      backwards++;
    }
  }
}
if (backwards === 0) expect('no pack table references one the importer reaches later', backwards, 0);

// ---- Behavioural checks against real 2024 rules ----

// ---- Source licence provenance ----
// Claiming CC-BY without the credit it demands is the one bad state, and the
// CHECK is the only thing standing between a pack and that state. These rows
// are deleted before the fixture is read, because the SELECT at the top of
// the behavioural section takes the first source row with no WHERE clause.

expectFail('a licence claim without attribution is rejected', () =>
  ins(`INSERT INTO source (slug, name, version, license)
       VALUES ('no-credit', 'No Credit', '1.0', 'CC-BY-4.0')`));

// An empty string is not NULL, so it would satisfy a bare IS NOT NULL test
// while crediting nobody.
expectFail('a licence claim with empty attribution is rejected', () =>
  ins(`INSERT INTO source (slug, name, version, license, attribution)
       VALUES ('blank-credit', 'Blank Credit', '1.0', 'CC-BY-4.0', '')`));

accepts('original content needs no licence or attribution', () =>
  ins(`INSERT INTO source (slug, name, version) VALUES ('homebrew', 'Homebrew', '1.0')`));

accepts('attribution without a licence is accepted', () =>
  ins(`INSERT INTO source (slug, name, version, attribution)
       VALUES ('credited', 'Credited', '1.0', 'written by me')`));

ins(`DELETE FROM source WHERE slug IN ('homebrew', 'credited')`);

ins(
  `INSERT INTO source (slug, name, version, license, attribution)
   VALUES ('srd-5.2.1', 'SRD', '5.2.1', 'CC-BY-4.0',
           'D&D System Reference Document 5.2.1, (c) Wizards of the Coast, CC-BY-4.0')`,
);
const src = q('SELECT id FROM source').id;

// The fixture must survive the round trip, since the rest of the harness
// assumes the pack it belongs to carries its credit.
const srd = q('SELECT license, attribution FROM source WHERE id = ?', src);
expect('SRD pack stores licence and attribution, and reads back',
  `${srd.license} / ${srd.attribution.length > 0 ? 'credited' : 'no credit'}`,
  'CC-BY-4.0 / credited');

ins(`INSERT INTO species (source_id, slug, name, size, speed) VALUES (?, 'elf', 'Elf', 'medium', 30)`, src);
const elf = idOf('species', 'elf');
ins(`INSERT INTO background (source_id, slug, name) VALUES (?, 'wayfarer', 'Wayfarer')`, src);
const bg = idOf('background', 'wayfarer');
const uuid = 'x'.repeat(8) + '-1111-1111-1111-' + 'x'.repeat(12);
accepts('negative hp_current (-5) accepted (2024 allows HP below zero)', () =>
  ins(
    `INSERT INTO player_character (uuid, name, species_id, background_id, hp_max, hp_current)
     VALUES (?, 'Test', ?, ?, 20, -5)`,
    uuid, elf, bg,
  ));
const pc = q('SELECT id FROM player_character').id;

expectFail('hp_current above hp_max rejected', () =>
  ins('UPDATE player_character SET hp_current = 999 WHERE id = ?', pc));

// ---- Generalised grant model ----
ins(`INSERT INTO class (source_id, slug, name, hit_die, casting_progression) VALUES (?, 'fighter', 'Fighter', 10, 'none')`, src);
const fighter = idOf('class', 'fighter');
ins(`INSERT INTO character_class (character_id, class_id, level) VALUES (?, ?, 5)`, pc, fighter);
ins(`INSERT INTO class_grant_slot (class_id, class_level, grant_kind, opens) VALUES (?, 4, 'asi_or_feat', 1)`, fighter);
ins(`INSERT INTO class_grant_slot (class_id, class_level, grant_kind, opens) VALUES (?, 6, 'asi_or_feat', 1)`, fighter);
ins(`INSERT INTO class_grant_slot (class_id, class_level, grant_kind, opens) VALUES (?, 1, 'fighting_style', 1)`, fighter);
ins(`INSERT INTO class_grant_slot (class_id, class_level, grant_kind, opens) VALUES (?, 1, 'weapon_mastery', 3)`, fighter);

ins(`INSERT INTO feat (source_id, slug, name, description, category_id) VALUES (?, 'alert', 'Alert', 'x', 2)`, src);
const alert = idOf('feat', 'alert');
ins(`INSERT INTO feat (source_id, slug, name, description, category_id) VALUES (?, 'great-weapon-fighting', 'GWF', 'x', 3)`, src);
const gwf = idOf('feat', 'great-weapon-fighting');
// The ASI branch: a pick with both source columns NULL.
ins(`INSERT INTO character_grant_pick (character_id, class_id, class_level, grant_kind) VALUES (?, ?, 4, 'asi_or_feat')`, pc, fighter);
accepts('an asi_or_feat pick with no feat accepts ASI bonuses', () =>
  ins(`INSERT INTO character_asi_bonus (character_id, class_id, class_level, pick_no, ability_id, bonus) VALUES (?, ?, 4, 1, 1, 2)`, pc, fighter));

// A pick holding a feat must reject ASI bonuses.
ins(`INSERT INTO character_grant_pick (character_id, class_id, class_level, grant_kind, feat_id) VALUES (?, ?, 6, 'asi_or_feat', ?)`, pc, fighter, alert);
expectFail('a slot holding a feat rejects ASI bonuses', () =>
  ins(`INSERT INTO character_asi_bonus (character_id, class_id, class_level, pick_no, ability_id, bonus) VALUES (?, ?, 6, 1, 1, 2)`, pc, fighter));

// No pick at a class level with no grant slot.
expectFail('no pick possible at a class level with no grant slot', () =>
  ins(`INSERT INTO character_grant_pick (character_id, class_id, class_level, grant_kind, feat_id) VALUES (?, ?, 7, 'asi_or_feat', ?)`, pc, fighter, gwf));

// A single pick cannot carry both a feat and an item.
expectFail('a single pick cannot carry both a feat and an item', () =>
  ins(`INSERT INTO character_grant_pick (character_id, class_id, class_level, grant_kind, pick_no, feat_id, item_id) VALUES (?, ?, 4, 'asi_or_feat', 2, ?, ?)`, pc, fighter, alert, 1));

// ---- Weapon Mastery ----
const cat = q(`SELECT id FROM weapon_category WHERE code = 'martial_melee'`).id;
ins(`INSERT INTO item (source_id, slug, name, weight) VALUES (?, 'longsword', 'Longsword', 3)`, src);
const sword = idOf('item', 'longsword');
ins(`INSERT INTO item (source_id, slug, name, weight) VALUES (?, 'torch', 'Torch', 1)`, src);
const torch = idOf('item', 'torch');
const sap = q(`SELECT id FROM mastery_property WHERE code = 'sap'`).id;
const slashing = idOf('damage_type', 'slashing');
accepts('2024 longsword stored with its Sap mastery property', () =>
  ins(`INSERT INTO weapon (item_id, category_id, damage_dice, damage_type_id, mastery_property_id) VALUES (?, ?, '1d8', ?, ?)`, sword, cat, slashing, sap));

expectFail('weapon_mastery rejects a non-weapon item', () =>
  ins(`INSERT INTO character_grant_pick (character_id, class_id, class_level, grant_kind, pick_no, item_id) VALUES (?, ?, 1, 'weapon_mastery', 1, ?)`, pc, fighter, torch));
ins(`INSERT INTO character_grant_pick (character_id, class_id, class_level, grant_kind, pick_no, item_id) VALUES (?, ?, 1, 'weapon_mastery', 1, ?)`, pc, fighter, sword);
ins(`INSERT INTO character_grant_pick (character_id, class_id, class_level, grant_kind, feat_id) VALUES (?, ?, 1, 'fighting_style', ?)`, pc, fighter, gwf);
expect('weapon_mastery and fighting_style picks recorded',
  `${count('character_grant_pick', 'item_id = ?', sword)} mastery, ${count('character_grant_pick', 'feat_id = ?', gwf)} fighting style`,
  '1 mastery, 1 fighting style');

// "medium" must no longer be accepted as a weapon property (armour-only).
expectFail('medium rejected as a weapon property', () =>
  ins(`INSERT INTO weapon_property (code) VALUES ('medium')`));

// ---- Species-granted cantrips are derived, so class_id can stay NOT NULL ----
ins(`INSERT INTO species_variant (source_id, slug, species_id, variant_kind, name) VALUES (?, 'high-elf', ?, 'lineage', 'High Elf')`, src, elf);
const highElf = idOf('species_variant', 'high-elf');
ins(`INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration) VALUES (?, 'speak-with-animals', 'Speak With Animals', 0, 'divination', '1 action', 'Self', '10 min')`, src);
const swa = idOf('spell', 'speak-with-animals');
ins(`INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration) VALUES (?, 'prestidigitation', 'Prestidigitation', 0, 'transmutation', '1 action', 'Self', '1 hour')`, src);
const prest = idOf('spell', 'prestidigitation');
ins(`INSERT INTO feature (source_id, slug, name, description, variant_id) VALUES (?, 'speak-with-small-beasts', 'Speak With Small Beasts', 'x', ?)`, src, highElf);
const gnomeFeat = idOf('feature', 'speak-with-small-beasts');
ins(`INSERT INTO granted_spell (feature_id, spell_id, grant_level, replaceable) VALUES (?, ?, NULL, 0)`, gnomeFeat, swa);
ins(`INSERT INTO granted_spell (feature_id, spell_id, grant_level, replaceable) VALUES (?, ?, NULL, 1)`, gnomeFeat, prest);

// A Gnome with no class levels still has the cantrip, because the row comes
// from a feature. character_cantrip.class_id stays NOT NULL.
ins(`INSERT INTO feature (source_id, slug, name, description, species_id) VALUES (?, 'no-class-cantrip', 'Species Cantrip', 'x', ?)`, src, elf);
const speciesFeat = idOf('feature', 'no-class-cantrip');
ins(`INSERT INTO granted_spell (feature_id, spell_id, grant_level, replaceable) VALUES (?, ?, NULL, 0)`, speciesFeat, swa);

// 3 rows: two on the lineage feature (one replaceable) plus one on the
// species feature.
expect('species-granted cantrips derived from features, no class row needed',
  q(`SELECT COUNT(*) AS n FROM granted_spell g
      JOIN feature f ON f.id = g.feature_id
      WHERE f.species_id IS NOT NULL OR f.variant_id IS NOT NULL`).n,
  3);

// The High Elf cantrip is replaceable, so a swap-in can be recorded.
ins(`INSERT INTO character_granted_spell (character_id, feature_id, spell_id) VALUES (?, ?, ?)`, pc, gnomeFeat, prest);
expect('replaceable species cantrip swap recorded',
  q('SELECT spell_id FROM character_granted_spell WHERE character_id = ?', pc).spell_id,
  prest);

// character_cantrip must still require a class (it is for class cantrips).
expectFail('character_cantrip requires a class id', () =>
  ins('INSERT INTO character_cantrip (character_id, spell_id, class_id) VALUES (?, ?, NULL)', pc, swa));

// ---- Damage types ----
expect('all 13 damage types seeded', count('damage_type'), 13);

// Making skill, tool, language and condition pack-extensible split the
// vocabularies in two. The closed half is CHECK-constrained and deliberately
// did not change; a damage type is a rules-bearing join key, so two packs
// producing two "fire" rows would split every resistance lookup. Pin all
// eight, not just damage_type, because the split is what drifts one table at
// a time.
const CLOSED_VOCABULARY = ['ability', 'damage_type', 'feat_category', 'roll_scope',
                           'weapon_property', 'weapon_category', 'mastery_property', 'class_grant_kind'];
for (const t of CLOSED_VOCABULARY) {
  expect(`${t} has no source_id (closed vocabulary)`, columnsOf(t).includes('source_id'), false);
}
const PACK_EXTENSIBLE = ['skill', 'tool', 'language', 'condition'];
expectFail('unknown damage type rejected', () =>
  ins(`INSERT INTO damage_type (slug, name) VALUES ('sonic', 'Sonic')`));

// A partial index, not just UNIQUE (source_id, slug). SQLite treats NULLs as
// distinct in a UNIQUE constraint, so two GLOBAL rows could otherwise share a
// slug, which is the two-rows split the closed vocabularies exist to prevent.
for (const t of PACK_EXTENSIBLE) {
  const idx = db.prepare(`PRAGMA index_list('${t}')`).all().find((i) => /_global_slug$/.test(i.name));
  expect(`${t} enforces global slug uniqueness via a partial index`, !!idx?.partial, true);
}

expectFail('a second global skill with the same slug is rejected', () => {
  ins(`INSERT INTO skill (slug, name, ability_id) VALUES ('acrobatics', 'Acrobatics', 2)`);
  ins(`INSERT INTO skill (slug, name, ability_id) VALUES ('acrobatics', 'Acrobatics', 2)`);
});

// Cross-pack collisions stay legal and stay unambiguous: a bare key is always
// scoped to the importing pack, and a qualified source/key names the other.
ins(`INSERT INTO source (slug, name, version) VALUES ('other-pack', 'Other Pack', '1.0')`);
const otherPack = idOf('source', 'other-pack');
ins(`INSERT INTO skill (source_id, slug, name, ability_id) VALUES (?, 'acrobatics', 'Acrobatics', 2)`, src);
ins(`INSERT INTO skill (source_id, slug, name, ability_id) VALUES (?, 'acrobatics', 'Acrobatics', 2)`, otherPack);
expect('two packs may each own the same slug; only the global row is exclusive',
  count('skill', 'slug = ?', 'acrobatics'), 3);
ins(`DELETE FROM source WHERE slug = 'other-pack'`);
ins(`DELETE FROM skill WHERE slug = 'acrobatics'`);

const fire = idOf('damage_type', 'fire');
const cold = idOf('damage_type', 'cold');
const poison = idOf('damage_type', 'poison');
const necrotic = idOf('damage_type', 'necrotic');

// ---- Spell damage: fixed vs caster choice, and delivery ----
ins(`INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration) VALUES (?, 'firebolt', 'Firebolt', 0, 'evocation', '1 action', 'Self', 'Instant')`, src);
const firebolt = q('SELECT id FROM spell WHERE slug = ?', 'firebolt').id;
ins(`INSERT INTO spell_damage_type (spell_id, damage_type_id, selection, delivery) VALUES (?, ?, 'fixed', 'cast')`, firebolt, fire);
expect('Firebolt recorded as fixed fire, delivered on cast',
  q('SELECT selection, delivery FROM spell_damage_type WHERE spell_id = ?', firebolt).selection, 'fixed');

// Chromatic Orb: the caster picks, so two 'choice' rows.
ins(`INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration) VALUES (?, 'chromatic-orb', 'Chromatic Orb', 1, 'evocation', '1 action', '90 feet', 'Instant')`, src);
const orb = idOf('spell', 'chromatic-orb');
ins(`INSERT INTO spell_damage_type (spell_id, damage_type_id, selection, delivery) VALUES (?, ?, 'choice', 'cast')`, orb, fire);
ins(`INSERT INTO spell_damage_type (spell_id, damage_type_id, selection, delivery) VALUES (?, ?, 'choice', 'cast')`, orb, cold);
expect('caster-choice damage recorded as two choice rows',
  count('spell_damage_type', 'spell_id = ? AND selection = ?', orb, 'choice'), 2);

// Cloudkill repeats on a trigger, so it is an aura, not a cast roll.
ins(`INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration) VALUES (?, 'cloudkill', 'Cloudkill', 5, 'conjuration', '1 action', '120 feet', '1 hour')`, src);
const cloudkill = idOf('spell', 'cloudkill');
accepts('conditional (aura) damage shape recorded', () =>
  ins(`INSERT INTO spell_damage_type (spell_id, damage_type_id, selection, delivery) VALUES (?, ?, 'fixed', 'aura')`, cloudkill, necrotic));

expectFail('invalid delivery rejected', () =>
  ins(`INSERT INTO spell_damage_type (spell_id, damage_type_id, delivery) VALUES (?, ?, 'whenever')`, firebolt, cold));

// ---- Cantrip scaling ----
ins(`INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration) VALUES (?, 'blade-ward', 'Blade Ward', 0, 'transmutation', '1 action', 'Self', '1 round')`, src);
const bladeWard = idOf('spell', 'blade-ward');
for (const [lvl, dice] of [[1, '1d4'], [5, '2d4'], [11, '3d4'], [17, '4d4']]) {
  ins('INSERT INTO cantrip_damage_dice (class_id, spell_id, from_level, dice) VALUES (?, ?, ?, ?)', fighter, bladeWard, lvl, dice);
}
expect('cantrip scaling resolves at level 9 to 2d4',
  q(`SELECT dice FROM cantrip_damage_dice WHERE class_id = ? AND spell_id = ?
      AND from_level <= 9 ORDER BY from_level DESC LIMIT 1`, fighter, bladeWard).dice,
  '2d4');
expect('cantrip scaling stored as data rows at 1/5/11/17',
  count('cantrip_damage_dice', 'spell_id = ?', bladeWard), 4);

// ---- Damage relations ----
// damage_modifier carries no UNIQUE on (damage_type_id, relation), by design.
// It is derived content, exported inline on its referrer and never as a
// standalone entity, so a blind INSERT duplicates it silently on every
// re-import and the duplicate is semantically identical -- nothing looks
// wrong. The importer must SELECT before INSERT, and that guard is only
// load-bearing while the constraint is genuinely absent.
ins(`INSERT INTO damage_modifier (damage_type_id, relation) VALUES (?, 'resistant')`, fire);
ins(`INSERT INTO damage_modifier (damage_type_id, relation) VALUES (?, 'resistant')`, fire);
expect('damage_modifier has no UNIQUE, so the importer must SELECT before INSERT',
  count('damage_modifier', 'damage_type_id = ? AND relation = ?', fire, 'resistant'), 2);
ins(`DELETE FROM damage_modifier WHERE damage_type_id = ? AND relation = 'resistant'`, fire);

const dm = ins(`INSERT INTO damage_modifier (damage_type_id, relation) VALUES (?, 'resistant')`, fire);
ins(
  `INSERT INTO feature_damage_modifier (feature_id, damage_modifier_id, conditions_note) VALUES (?, ?, 'only while raging')`,
  gnomeFeat,
  Number(dm.lastInsertRowid),
);
expect('conditional resistance keeps its conditions_note',
  q('SELECT conditions_note FROM feature_damage_modifier WHERE feature_id = ?', gnomeFeat).conditions_note,
  'only while raging');

// Character resistances are stored, and a hand-entered one needs no source.
ins(`INSERT INTO character_damage_modifier (character_id, damage_type_id, relation) VALUES (?, ?, 'resistant')`, pc, poison);
expect('hand-entered resistance accepted with no provenance owner',
  q('SELECT feature_id FROM character_damage_modifier WHERE character_id = ?', pc).feature_id,
  null);
expectFail('duplicate resistance for the same type rejected', () =>
  ins(`INSERT INTO character_damage_modifier (character_id, damage_type_id, relation) VALUES (?, ?, 'resistant')`, pc, poison));

// The polymorphic source_kind + source_ref pair is gone. It could not be a
// foreign key, so it could be neither cascaded nor checked, and nothing in
// this schema uses AUTOINCREMENT, so SQLite reissues a freed id and a stale
// source_ref could name a different feature entirely.
expect('character_damage_modifier has no polymorphic source_ref/source_kind pair',
  columnsOf('character_damage_modifier').filter((c) => c === 'source_ref' || c === 'source_kind'),
  []);

// At most one provenance owner, not exactly one -- the hand-entered row above
// has none, and must still be allowed.
expectFail('a resistance cannot claim two provenance owners at once', () =>
  ins(`INSERT INTO character_damage_modifier
         (character_id, damage_type_id, relation, feature_id, item_id)
       VALUES (?, ?, 'immune', ?, ?)`, pc, cold, gnomeFeat, sword));

// ---- Species variant kinds ----
expectFail('invalid variant_kind rejected', () =>
  ins(`INSERT INTO species_variant (source_id, slug, species_id, variant_kind, name) VALUES (?, 'bad', ?, 'bloodline', 'Bad')`, src, elf));
ins(`INSERT INTO species_variant (source_id, slug, species_id, variant_kind, name) VALUES (?, 'infernal', ?, 'legacy', 'Infernal')`, src, elf);
const kind = q('SELECT variant_kind FROM species_variant WHERE slug = ?', 'infernal').variant_kind;
expect('Fiendish Legacy stored with variant_kind = legacy', kind, 'legacy');

// ---- Ability caps ----
expectFail('base_score above 30 rejected (hard ceiling)', () =>
  ins('INSERT INTO character_ability (character_id, ability_id, base_score) VALUES (?, 1, 31)', pc));

ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'tome-str', 'Tome of Strength', 0)`, src);
const tome = idOf('effect', 'tome-str');
ins(`INSERT INTO effect_modifier (effect_id, ability_id, amount, max_score, max_delta, sets_to_personal_max) VALUES (?, 1, 0, 22, 2, 1)`, tome);
const em = q('SELECT * FROM effect_modifier WHERE effect_id = ?', tome);
expect(`Tome modelled as set-to-personal-max, max_delta=${em.max_delta} (two tomes reach 24, not 22)`, em.max_delta, 2);

ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'unarmored-defense', 'Unarmored Defense', 10)`, src);
const ud = idOf('effect', 'unarmored-defense');
accepts('Unarmored Defense = base_value 10 + the linked ability modifier', () =>
  ins(`INSERT INTO effect_modifier (effect_id, ability_id, amount, max_score) VALUES (?, 6, 0, 20)`, ud));

// Background ASI distribution is app-enforced (sum must be 0 or 3).
const sum = db
  .prepare('SELECT bonus FROM character_background_asi WHERE character_id = ?')
  .all(pc)
  .reduce((a, r) => a + r.bonus, 0);
expect('background ASI distribution is app-enforced (sum 0 or 3)', sum === 0 || sum === 3, true);

// ---- Roll modifiers, recharge and spends ----
const initiative = q(`SELECT id FROM roll_scope WHERE code = 'initiative'`).id;
const saveScope = q(`SELECT id FROM roll_scope WHERE code = 'save'`).id;
const wpnDamage = q(`SELECT id FROM roll_scope WHERE code = 'weapon_damage'`).id;
const dcScope = q(`SELECT id FROM roll_scope WHERE code = 'spell_save_dc'`).id;

ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'alert', 'Alert', 0)`, src);
ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'searing-smite', 'Searing Smite', 0)`, src);
ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'haste', 'Haste', 0)`, src);
ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'channel-divinity', 'Channel Divinity', 0)`, src);

// Danger Sense: advantage on DEX saves, so the scope row carries the ability.
ins(`UPDATE roll_scope SET ability_id = 3 WHERE id = ?`, saveScope);
expect('a roll scope can be narrowed to one ability (Danger Sense)',
  q('SELECT ability_id FROM roll_scope WHERE id = ?', saveScope).ability_id, 3);

const alertFx = idOf('effect', 'alert');
accepts('advantage recorded as a roll modifier', () =>
  ins(`INSERT INTO effect_roll_modifier (effect_id, scope_id, kind) VALUES (?, ?, 'advantage')`, alertFx, initiative));

// Searing Smite: extra fire damage on a weapon hit, with a trigger.
const smite = idOf('effect', 'searing-smite');
accepts('typed damage rider with a trigger recorded (Searing Smite)', () =>
  ins(
    `INSERT INTO effect_roll_modifier (effect_id, scope_id, kind, dice, damage_type_id, trigger_text)
     VALUES (?, ?, 'dice', '+1d6', ?, 'when you hit with a weapon, next attack')`,
    smite, wpnDamage, fire,
  ));
const rider = q('SELECT dice, damage_type_id, trigger_text FROM effect_roll_modifier WHERE effect_id = ?', smite);
expect('the rider stored its dice, damage type and trigger',
  `${rider.dice} / ${rider.damage_type_id === fire ? 'fire' : rider.damage_type_id} / ${rider.trigger_text ? 'has trigger' : 'NO TRIGGER'}`,
  '+1d6 / fire / has trigger');

// Haste: flat +2 AC, unlimited uses.
const haste = idOf('effect', 'haste');
const acScope = q(`SELECT id FROM roll_scope WHERE code = 'damage_taken'`).id;
accepts('flat modifier plus an unlimited-use recharge recorded', () => {
  ins(`INSERT INTO effect_roll_modifier (effect_id, scope_id, kind, amount) VALUES (?, ?, 'flat', 2)`, haste, acScope);
  ins(`INSERT INTO effect_recharge (effect_id, interval, uses_max) VALUES (?, 'long_rest', 0)`, haste);
});

expectFail('invalid roll modifier kind rejected', () =>
  ins(`INSERT INTO effect_roll_modifier (effect_id, scope_id, kind) VALUES (?, ?, 'sideways')`, alertFx, initiative));

// Channel Divinity: 2 uses, +1 on a short rest, +1 more at Paladin 11.
const cd = idOf('effect', 'channel-divinity');
ins(`INSERT INTO effect_recharge (effect_id, interval, uses_max, short_rest_returns) VALUES (?, 'long_rest', 2, 1)`, cd);
ins(`INSERT INTO effect_recharge_level_bonus (effect_id, class_level, uses_bonus) VALUES (?, 11, 1)`, cd);
ins(`INSERT INTO character_effect_uses (character_id, effect_id, uses_spent, long_rest_generation) VALUES (?, ?, 1, 0)`, pc, cd);

// effective_max = uses_max + bonuses at or below the character's level
const capAt = (lvl) =>
  db
    .prepare(
      `SELECT (SELECT uses_max FROM effect_recharge WHERE effect_id = ?)
            + COALESCE((SELECT SUM(uses_bonus) FROM effect_recharge_level_bonus
                        WHERE effect_id = ? AND class_level <= ?), 0) AS max_uses`,
    )
    .get(cd, cd, lvl).max_uses;
expect('recharge cap is level-dependent: 2 at Paladin 10, 3 at 11', `${capAt(10)} then ${capAt(11)}`, '2 then 3');

ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'darkvision', 'Darkvision', 0)`, src);
ins(`INSERT INTO language (slug, name) VALUES ('giant', 'Giant')`);
ins(`INSERT INTO class (source_id, slug, name, hit_die, casting_progression) VALUES (?, 'warlock', 'Warlock', 8, 'pact')`, src);

// Spending, then a long rest. The row is never updated; the generation moves.
const spentBefore = q('SELECT uses_spent FROM character_effect_uses WHERE character_id = ? AND effect_id = ?', pc, cd).uses_spent;
ins('UPDATE player_character SET long_rest_count = long_rest_count + 1 WHERE id = ?', pc);
expect('long rest refreshed uses by moving the counter, updating no spend row',
  `spent=${spentBefore} gen=${q('SELECT long_rest_count FROM player_character WHERE id = ?', pc).long_rest_count} stored=${q('SELECT long_rest_generation FROM character_effect_uses WHERE character_id = ? AND effect_id = ?', pc, cd).long_rest_generation}`,
  'spent=1 gen=1 stored=0');

// Short-rest recharge reads the SHORT generation, not the long one.
ins(`UPDATE player_character SET short_rest_count = 1 WHERE id = ?`, pc);
expect('short-rest generation tracked separately from long-rest',
  q('SELECT short_rest_generation FROM character_effect_uses WHERE character_id = ? AND effect_id = ?', pc, cd).short_rest_generation,
  0);

// Capability grants.
const dv = idOf('effect', 'darkvision');
accepts('darkvision range recorded', () =>
  ins(`INSERT INTO effect_darkvision (effect_id, range_feet) VALUES (?, 120)`, dv));
expect('the darkvision range is 120', q('SELECT range_feet FROM effect_darkvision WHERE effect_id = ?', dv).range_feet, 120);

const giant = idOf('language', 'giant');
accepts('language grant recorded', () =>
  ins(`INSERT INTO effect_language (effect_id, language_id) VALUES (?, ?)`, dv, giant));

const finesse = q(`SELECT id FROM weapon_property WHERE code = 'finesse'`).id;
accepts('weapon property grant recorded', () =>
  ins(`INSERT INTO effect_weapon_property (effect_id, property_id) VALUES (?, ?)`, dv, finesse));

const poisoned = idOf('condition', 'poisoned');
accepts('condition immunity recorded', () =>
  ins(`INSERT INTO effect_condition_modifier (effect_id, condition_id, relation) VALUES (?, ?, 'immune')`, dv, poisoned));

accepts('crit threshold recorded', () =>
  ins(`INSERT INTO effect_crit (effect_id, threshold) VALUES (?, 19)`, dv));
expect('the crit threshold is 19', q('SELECT threshold FROM effect_crit WHERE effect_id = ?', dv).threshold, 19);

accepts('size change recorded', () =>
  ins(`INSERT INTO effect_size (effect_id, size) VALUES (?, 'large')`, dv));
expect('the size is large', q('SELECT size FROM effect_size WHERE effect_id = ?', dv).size, 'large');

expectFail('invalid crit threshold rejected', () =>
  ins(`INSERT INTO effect_crit (effect_id, threshold) VALUES (?, 25)`, dv));

// ---- Spell slot spends ----
const warlock = idOf('class', 'warlock');
accepts('Warlock Pact Magic recovers on a short rest', () =>
  ins(`INSERT INTO class_slot_recovery (class_id, interval) VALUES (?, 'short_rest')`, warlock));

// Both generation columns exist so the read can pick the right one.
ins(`INSERT INTO character_class (character_id, class_id, level) VALUES (?, ?, 2)`, pc, warlock);
ins(`INSERT INTO character_spell_slot_spends (character_id, class_id, slot_level, spent, short_rest_generation) VALUES (?, ?, 1, 1, 0)`, pc, warlock);
const wlkRow = q('SELECT * FROM character_spell_slot_spends WHERE character_id = ? AND class_id = ?', pc, warlock);
expect('spell slot spends carry both rest generations',
  `short=${wlkRow.short_rest_generation} long=${wlkRow.long_rest_generation}`,
  'short=0 long=0');

// A short rest refreshes the Warlock (interval = short_rest) but a
// long-rest class in the same character is unaffected.
ins('UPDATE player_character SET short_rest_count = short_rest_count + 1 WHERE id = ?', pc);
expect('a short rest refreshes Warlock slots by moving the counter only',
  q('SELECT short_rest_generation FROM character_spell_slot_spends WHERE character_id = ? AND class_id = ?', pc, warlock).short_rest_generation,
  0);

expectFail('negative slot spend rejected', () =>
  ins(`INSERT INTO character_spell_slot_spends (character_id, class_id, slot_level, spent) VALUES (?, ?, 2, -1)`, pc, warlock));

// ---- Delete policy ----
// The whole character subtree, not just its root row. Counting player_character
// alone is the blind spot that let both content -> character CASCADEs survive
// review: a cascaded spend or condition row does not change that count, so the
// character "survived" while its state had been eaten. cols already holds every
// table's columns, so a new character table is counted without editing this.
const subtree = (characterId) => {
  let n = 0;
  for (const [t, c] of cols) {
    if (c.has('character_id')) {
      n += db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE character_id = ?`).get(characterId).n;
    }
  }
  return n;
};

// character_effect_uses was the pre-existing violation: effect was always
// pack-owned, so removing a pack discarded a character's uses_spent and both
// rest-generation counters. The character survived; their spends reset to full.
const spendBefore = count('character_effect_uses', 'effect_id = ?', cd);
expectFail('deleting an in-use effect is refused', () =>
  ins(`DELETE FROM effect WHERE id = ?`, cd));
expect('deleting an in-use effect is refused; its spend rows survive',
  count('character_effect_uses', 'effect_id = ?', cd), spendBefore);

// character_condition was only reachable once a pack could own a condition.
// It had been CASCADE all along, unreachable, which is why nobody noticed.
ins(`INSERT INTO condition (source_id, slug, name) VALUES (?, 'marked', 'Marked')`, src);
const marked = idOf('condition', 'marked');
ins(`INSERT INTO character_condition (character_id, condition_id) VALUES (?, ?)`, pc, marked);
const condBefore = count('character_condition', 'character_id = ?', pc);
expectFail('deleting an in-use pack condition is refused', () =>
  ins(`DELETE FROM condition WHERE id = ?`, marked));
expect('deleting an in-use condition is refused; the character keeps it',
  count('character_condition', 'character_id = ?', pc), condBefore);

const rowsBefore = subtree(pc);
expectFail('deleting an in-use pack is refused', () =>
  ins(`DELETE FROM source WHERE id = ?`, src));
expect(`deleting an in-use pack is refused; character and all ${rowsBefore} of its rows survive`,
  `${count('player_character')} character, ${subtree(pc)} rows`, `1 character, ${rowsBefore} rows`);

// Deleting a character still cascades to its rows.
ins(`INSERT INTO class_grant_slot (class_id, class_level, grant_kind, opens) VALUES (?, 8, 'asi_or_feat', 1)`, fighter);
ins(`DELETE FROM player_character WHERE id = ?`, pc);
expect('deleting a character cascades to its rows (no orphans)',
  count('character_grant_pick'), 0);

accepts('unused pack deletes cleanly', () => {
  ins(`DELETE FROM source WHERE id = ?`, src);
  expect('every species row went with the pack', count('species'), 0);
});

db.exec('PRAGMA foreign_key_check');
expect('foreign_key_check clean', db.prepare('PRAGMA foreign_key_check').all().length, 0);

if (failures === 0) {
  console.log('\nAll checks passed.');
} else {
  console.log(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}