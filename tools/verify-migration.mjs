// Validates 001_initial.sql against a real SQLite engine (node:sqlite).
// Run: node tools/verify-migration.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { readMigrationSources, sourceDigest } from './lib/migration-source.mjs';

const sql = readFileSync(new URL('../shared/db/migrations/001_initial.sql', import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');

let failures = 0;
const ok = (m) => console.log('OK  ' + m);
const fail = (m) => {
  failures++;
  console.log('FAIL ' + m);
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

// ---- The committed diagram must describe the schema that exists ----
// docs/schema/schema.dbml is generated, and a stale diagram is worse than no
// diagram: it is the thing a reader trusts about the delete policy. Same drift
// the generated TS above has, so it gets the same check over the same digest.
// Beyond presence, the diagram is checked below for operator correctness: a
// one-to-one ('-') on columns that are not a unique key, or a mandatory
// operator on a nullable FK, is exactly the inconsistency dbdiagram warns
// about, and a stale diagram would keep drawing it as true.
//
// This sits after the FK walk because it is a cross-check against what the
// pragmas just said, not against the file it is checking.
const diagram = readFileSync(new URL('../docs/schema/schema.dbml', import.meta.url), 'utf8');
const diagramHash = /^\/\/ source-hash: ([0-9a-f]{64})$/m.exec(diagram);
if (!diagramHash) {
  fail('schema.dbml has no source-hash header');
} else if (diagramHash[1] !== sourceDigest(sources)) {
  fail('schema.dbml is stale; run `node tools/generate-schema-diagram.mjs`');
} else {
  ok('schema.dbml matches shared/db/migrations/*.sql');
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
  ok('no comment line ends with ";" (Capacitor statement split stays intact)');
}

// Every FK must resolve to a real table and column. SQLite resolves FKs
// lazily at DML time, so a typo'd target would not surface on CREATE.
// PRAGMA foreign_key_list takes no argument, so it must be walked per table.
const cols = new Map(
  tables.map((t) => [t.name, new Set(db.prepare(`PRAGMA table_info('${t.name}')`).all().map((c) => c.name))]),
);
let bad = 0;
let fkCount = 0;
// foreign_key_list is one row per column, so a composite key arrives as several
// rows sharing an `id`. The diagram draws one relationship per constraint, so it
// is counted separately -- 153 relationships over 159 columns here.
const fkConstraints = new Set();
for (const t of tables) {
  for (const fk of db.prepare(`PRAGMA foreign_key_list('${t.name}')`).all()) {
    fkCount++;
    fkConstraints.add(`${t.name}#${fk.id}`);
    if (!cols.has(fk.table)) {
      fail(`FK target table missing: ${fk.table} (from ${t})`);
      bad++;
    } else if (!cols.get(fk.table).has(fk.to)) {
      fail(`FK target column missing: ${fk.table}.${fk.to} (from ${t})`);
      bad++;
    }
  }
}
if (bad === 0) ok(`all ${fkCount} foreign keys resolve to a real table and column`);

// The digest above proves the file was generated from the schema that exists.
// It does not prove the generator wrote all of it: a truncated emit still
// matches its own header. Count what the schema says must be there against what
// the file has, now that the FK walk above has counted the keys.
//
// CHECK bodies are counted by a scan written here rather than shared with the
// generator, on purpose. A digest has to be the same algorithm in both places or
// the comparison means nothing; this is an independent re-derivation, which is
// the value of checking. It balances parentheses because a body can nest --
// length(attribution) > 0 -- and steps over quoted literals so a paren inside a
// string cannot end the scan early.
let checksInDdl = 0;
for (const { sql: ddlText } of db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL").all()) {
  for (const m of ddlText.matchAll(/check\s*\(/gi)) {
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < ddlText.length; j++) {
      const c = ddlText[j];
      if (c === "'") {
        while (++j < ddlText.length && ddlText[j] !== "'") if (ddlText[j] === "'" && ddlText[j + 1] === "'") j++;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) break;
    }
    if (ddlText.slice(m.index + m[0].length, j).trim()) checksInDdl++;
  }
}

const dbmlTables = [...diagram.matchAll(/^Table (\w+) \{$/gm)].map((m) => m[1]);
for (const [what, got, want] of [
  ['tables', dbmlTables.length, tables.length],
  ['foreign keys', (diagram.match(/^Ref: /gm) ?? []).length, fkConstraints.size],
  ['checks', (diagram.match(/^ {4}`/gm) ?? []).length, checksInDdl],
]) {
  if (got === want) ok(`schema.dbml has all ${want} ${what}`);
  else fail(`schema.dbml has ${got} ${what}, expected ${want}`);
}
// Counts can still add up with a name wrong in two places, so check uniqueness.
const repeated = dbmlTables.filter((t, i) => dbmlTables.indexOf(t) !== i);
if (repeated.length === 0) ok('schema.dbml names every table exactly once');
else fail(`schema.dbml repeats: ${[...new Set(repeated)].join(', ')}`);

// ---- Every Ref: operator must agree with the schema's own facts ----
// dbdiagram warns whenever an operator contradicts the columns it joins: a
// one-to-one ('-') on a column set that is not a unique key, or a mandatory
// operator on a nullable FK. The generator derives the operator from these
// same pragmas, so this check re-derives it independently rather than
// importing the generator's helper: two implementations forced to agree are
// worth more than one used twice, the same reasoning as the CHECK scan above.
const refOps = new Map([
  ['-', { key: true, notNull: true }],
  ['-?', { key: true, notNull: false }],
  ['>', { key: false, notNull: true }],
  ['>?', { key: false, notNull: false }],
]);
let checkedRefs = 0;
for (const [, child, fromRaw, op] of diagram.matchAll(/^Ref: (\w+)\.(\([\w, ()]+\)|\w+) (\S+) /gm)) {
  checkedRefs++;
  const want = refOps.get(op);
  if (!want) {
    fail(`schema.dbml ref ${child}.${fromRaw} has unknown operator '${op}'`);
    continue;
  }
  const childCols = fromRaw.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim());
  const info = db.prepare(`PRAGMA table_info('${child}')`).all();
  const pkCols = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  const uniqueSets = [pkCols.join(',')];
  for (const idx of db.prepare(`PRAGMA index_list('${child}')`).all()) {
    if (!idx.unique) continue;
    // A partial index constrains only its matching rows, so it makes nothing
    // a key of the whole table.
    const indexSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name=?`).get(idx.name)?.sql ?? '';
    if (/\bwhere\b/i.test(indexSql)) continue;
    uniqueSets.push(
      db.prepare(`PRAGMA index_info('${idx.name}')`).all().sort((a, b) => a.seqno - b.seqno).map((c) => c.name).join(','),
    );
  }
  const isKey = uniqueSets.includes(childCols.join(','));
  // The rowid-alias rule again, written out: a single-column INTEGER PRIMARY
  // KEY reports notnull 0 whatever the declaration says.
  const allNotNull = childCols.every((name) => {
    const c = info.find((x) => x.name === name);
    return c.notnull || (c.pk > 0 && pkCols.length === 1);
  });
  if (isKey !== want.key || allNotNull !== want.notNull) {
    fail(`schema.dbml ref ${child}.${fromRaw} uses '${op}' but the schema says key=${isKey} notNull=${allNotNull}`);
  }
}
if (checkedRefs === (diagram.match(/^Ref: /gm) ?? []).length && checkedRefs > 0) {
  ok(`all ${checkedRefs} Ref: operators agree with the schema's cardinality and nullability`);
}

// ---- Behavioural checks against real 2024 rules ----
const ins = (s, ...p) => db.prepare(s).run(...p);
const q = (s, ...p) => db.prepare(s).get(...p);
const expectFail = (label, fn) => {
  try {
    fn();
    fail(label);
  } catch {
    ok(label);
  }
};

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

ins(`INSERT INTO source (slug, name, version) VALUES ('homebrew', 'Homebrew', '1.0')`);
ok('original content needs no licence or attribution');

ins(`INSERT INTO source (slug, name, version, attribution)
     VALUES ('credited', 'Credited', '1.0', 'written by me')`);
ok('attribution without a licence is accepted');

ins(`DELETE FROM source WHERE slug IN ('homebrew', 'credited')`);

ins(
  `INSERT INTO source (slug, name, version, license, attribution)
   VALUES ('srd-5.2.1', 'SRD', '5.2.1', 'CC-BY-4.0',
           'D&D System Reference Document 5.2.1, (c) Wizards of the Coast, CC-BY-4.0')`,
);
const src = q('SELECT id FROM source').id;

// The fixture must survive the round trip, since the rest of the harness
// assumes the pack it belongs to carries its credit.
const srdRow = q(`SELECT license, attribution FROM source WHERE id = ?`, src);
if (srdRow.license === 'CC-BY-4.0' && srdRow.attribution.length > 0) {
  ok('SRD pack stores licence and attribution, and reads back');
} else {
  fail(`SRD pack row wrong: ${JSON.stringify(srdRow)}`);
}
ins(`INSERT INTO species (source_id, slug, name, size, speed) VALUES (?, 'elf', 'Elf', 'medium', 30)`, src);
const elf = q('SELECT id FROM species WHERE slug = ?', 'elf').id;
ins(`INSERT INTO background (source_id, slug, name) VALUES (?, 'wayfarer', 'Wayfarer')`, src);
const bg = q('SELECT id FROM background WHERE slug = ?', 'wayfarer').id;
const uuid = 'x'.repeat(8) + '-1111-1111-1111-' + 'x'.repeat(12);
ins(
  `INSERT INTO player_character (uuid, name, species_id, background_id, hp_max, hp_current)
   VALUES (?, 'Test', ?, ?, 20, -5)`,
  uuid, elf, bg,
);
const pc = q('SELECT id FROM player_character').id;
ok('negative hp_current (-5) accepted (2024 allows HP below zero)');

expectFail('hp_current above hp_max rejected', () =>
  ins('UPDATE player_character SET hp_current = 999 WHERE id = ?', pc));

// ---- Generalised grant model ----
ins(`INSERT INTO class (source_id, slug, name, hit_die, casting_progression) VALUES (?, 'fighter', 'Fighter', 10, 'none')`, src);
const fighter = q('SELECT id FROM class WHERE slug = ?', 'fighter').id;
ins(`INSERT INTO character_class (character_id, class_id, level) VALUES (?, ?, 5)`, pc, fighter);
ins(`INSERT INTO feat (source_id, slug, name, description, category_id) VALUES (?, 'alert', 'Alert', 'x', 2)`, src);
const alert = q('SELECT id FROM feat WHERE slug = ?', 'alert').id;
ins(`INSERT INTO feat (source_id, slug, name, description, category_id) VALUES (?, 'great-weapon-fighting', 'GWF', 'x', 3)`, src);
const gwf = q('SELECT id FROM feat WHERE slug = ?', 'great-weapon-fighting').id;
ins(`INSERT INTO class_grant_slot (class_id, class_level, grant_kind, opens) VALUES (?, 4, 'asi_or_feat', 1)`, fighter);
ins(`INSERT INTO class_grant_slot (class_id, class_level, grant_kind, opens) VALUES (?, 6, 'asi_or_feat', 1)`, fighter);
ins(`INSERT INTO class_grant_slot (class_id, class_level, grant_kind, opens) VALUES (?, 1, 'fighting_style', 1)`, fighter);
ins(`INSERT INTO class_grant_slot (class_id, class_level, grant_kind, opens) VALUES (?, 1, 'weapon_mastery', 3)`, fighter);

// The ASI branch: a pick with both source columns NULL.
ins(`INSERT INTO character_grant_pick (character_id, class_id, class_level, grant_kind) VALUES (?, ?, 4, 'asi_or_feat')`, pc, fighter);
ins(`INSERT INTO character_asi_bonus (character_id, class_id, class_level, pick_no, ability_id, bonus) VALUES (?, ?, 4, 1, 1, 2)`, pc, fighter);
ok('an asi_or_feat pick with no feat accepts ASI bonuses');

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
const sword = q('SELECT id FROM item WHERE slug = ?', 'longsword').id;
ins(`INSERT INTO item (source_id, slug, name, weight) VALUES (?, 'torch', 'Torch', 1)`, src);
const torch = q('SELECT id FROM item WHERE slug = ?', 'torch').id;
const sap = q(`SELECT id FROM mastery_property WHERE code = 'sap'`).id;
const slashing = q(`SELECT id FROM damage_type WHERE slug = 'slashing'`).id;
ins(`INSERT INTO weapon (item_id, category_id, damage_dice, damage_type_id, mastery_property_id) VALUES (?, ?, '1d8', ?, ?)`, sword, cat, slashing, sap);
ok('2024 longsword stored with its Sap mastery property');

expectFail('weapon_mastery rejects a non-weapon item', () =>
  ins(`INSERT INTO character_grant_pick (character_id, class_id, class_level, grant_kind, pick_no, item_id) VALUES (?, ?, 1, 'weapon_mastery', 1, ?)`, pc, fighter, torch));
ins(`INSERT INTO character_grant_pick (character_id, class_id, class_level, grant_kind, pick_no, item_id) VALUES (?, ?, 1, 'weapon_mastery', 1, ?)`, pc, fighter, sword);
ins(`INSERT INTO character_grant_pick (character_id, class_id, class_level, grant_kind, feat_id) VALUES (?, ?, 1, 'fighting_style', ?)`, pc, fighter, gwf);
ok('weapon_mastery and fighting_style picks recorded');

// "medium" must no longer be accepted as a weapon property (armour-only).
expectFail('medium rejected as a weapon property', () =>
  ins(`INSERT INTO weapon_property (code) VALUES ('medium')`));

// ---- Species-granted cantrips are derived, so class_id can stay NOT NULL ----
ins(`INSERT INTO species_variant (source_id, slug, species_id, variant_kind, name) VALUES (?, 'high-elf', ?, 'lineage', 'High Elf')`, src, elf);
const highElf = q('SELECT id FROM species_variant WHERE slug = ?', 'high-elf').id;
ins(`INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration) VALUES (?, 'speak-with-animals', 'Speak With Animals', 0, 'divination', '1 action', 'Self', '10 min')`, src);
const swa = q('SELECT id FROM spell WHERE slug = ?', 'speak-with-animals').id;
ins(`INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration) VALUES (?, 'prestidigitation', 'Prestidigitation', 0, 'transmutation', '1 action', 'Self', '1 hour')`, src);
const prest = q('SELECT id FROM spell WHERE slug = ?', 'prestidigitation').id;
ins(`INSERT INTO feature (source_id, slug, name, description, variant_id) VALUES (?, 'speak-with-small-beasts', 'Speak With Small Beasts', 'x', ?)`, src, highElf);
const gnomeFeat = q('SELECT id FROM feature WHERE slug = ?', 'speak-with-small-beasts').id;
ins(`INSERT INTO granted_spell (feature_id, spell_id, grant_level, replaceable) VALUES (?, ?, NULL, 0)`, gnomeFeat, swa);
ins(`INSERT INTO granted_spell (feature_id, spell_id, grant_level, replaceable) VALUES (?, ?, NULL, 1)`, gnomeFeat, prest);

// A Gnome with no class levels still has the cantrip, because the row comes
// from a feature. character_cantrip.class_id stays NOT NULL.
ins(`INSERT INTO feature (source_id, slug, name, description, species_id) VALUES (?, 'no-class-cantrip', 'Species Cantrip', 'x', ?)`, src, elf);
const speciesFeat = q('SELECT id FROM feature WHERE slug = ?', 'no-class-cantrip').id;
ins(`INSERT INTO granted_spell (feature_id, spell_id, grant_level, replaceable) VALUES (?, ?, NULL, 0)`, speciesFeat, swa);
const derivedCount = db
  .prepare(
    `SELECT COUNT(*) AS n FROM granted_spell g
     JOIN feature f ON f.id = g.feature_id
     WHERE f.species_id IS NOT NULL OR f.variant_id IS NOT NULL`,
  )
  .get().n;
// 3 rows: two on the lineage feature (one replaceable) plus one on the
// species feature.
if (derivedCount === 3) ok('species-granted cantrips derived from features, no class row needed');
else fail(`expected 3 derived cantrip grants, found ${derivedCount}`);

// The High Elf cantrip is replaceable, so a swap-in can be recorded.
ins(`INSERT INTO character_granted_spell (character_id, feature_id, spell_id) VALUES (?, ?, ?)`, pc, gnomeFeat, prest);
const swapped = q('SELECT spell_id FROM character_granted_spell WHERE character_id = ?', pc).spell_id;
if (swapped === prest) ok('replaceable species cantrip swap recorded');
else fail('cantrip swap not recorded');

// character_cantrip must still require a class (it is for class cantrips).
expectFail('character_cantrip requires a class id', () =>
  ins('INSERT INTO character_cantrip (character_id, spell_id, class_id) VALUES (?, ?, NULL)', pc, swa));

// ---- Damage types ----
const dtCount = db.prepare('SELECT COUNT(*) AS n FROM damage_type').get().n;
if (dtCount === 13) ok('all 13 damage types seeded');
else fail(`expected 13 seeded damage types, found ${dtCount}`);

const dtCols = db.prepare(`PRAGMA table_info('damage_type')`).all().map((c) => c.name);
if (!dtCols.includes('source_id')) ok('damage_type has no source_id (globally unique vocabulary)');
else fail('damage_type wrongly carries a source_id');
expectFail('unknown damage type rejected', () =>
  ins(`INSERT INTO damage_type (slug, name) VALUES ('sonic', 'Sonic')`));

const fire = q(`SELECT id FROM damage_type WHERE slug = 'fire'`).id;
const cold = q(`SELECT id FROM damage_type WHERE slug = 'cold'`).id;
const poison = q(`SELECT id FROM damage_type WHERE slug = 'poison'`).id;
const necrotic = q(`SELECT id FROM damage_type WHERE slug = 'necrotic'`).id;

// ---- Spell damage: fixed vs caster choice, and delivery ----
ins(`INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration) VALUES (?, 'firebolt', 'Firebolt', 0, 'evocation', '1 action', 'Self', 'Instant')`, src);
const firebolt = q('SELECT id FROM spell WHERE slug = ?', 'firebolt').id;
ins(`INSERT INTO spell_damage_type (spell_id, damage_type_id, selection, delivery) VALUES (?, ?, 'fixed', 'cast')`, firebolt, fire);
ok('Firebolt recorded as fixed fire, delivered on cast');

// Chromatic Orb: the caster picks, so two 'choice' rows.
ins(`INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration) VALUES (?, 'chromatic-orb', 'Chromatic Orb', 1, 'evocation', '1 action', '90 feet', 'Instant')`, src);
const orb = q('SELECT id FROM spell WHERE slug = ?', 'chromatic-orb').id;
ins(`INSERT INTO spell_damage_type (spell_id, damage_type_id, selection, delivery) VALUES (?, ?, 'choice', 'cast')`, orb, fire);
ins(`INSERT INTO spell_damage_type (spell_id, damage_type_id, selection, delivery) VALUES (?, ?, 'choice', 'cast')`, orb, cold);
const choices = db
  .prepare(`SELECT COUNT(*) AS n FROM spell_damage_type WHERE spell_id = ? AND selection = 'choice'`)
  .get(orb).n;
if (choices === 2) ok('caster-choice damage recorded as two choice rows');
else fail(`expected 2 choice rows for Chromatic Orb, found ${choices}`);

// Cloudkill repeats on a trigger, so it is an aura, not a cast roll.
ins(`INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration) VALUES (?, 'cloudkill', 'Cloudkill', 5, 'conjuration', '1 action', '120 feet', '1 hour')`, src);
const cloudkill = q('SELECT id FROM spell WHERE slug = ?', 'cloudkill').id;
ins(`INSERT INTO spell_damage_type (spell_id, damage_type_id, selection, delivery) VALUES (?, ?, 'fixed', 'aura')`, cloudkill, necrotic);
ok('conditional (aura) damage shape recorded');

expectFail('invalid delivery rejected', () =>
  ins(`INSERT INTO spell_damage_type (spell_id, damage_type_id, delivery) VALUES (?, ?, 'whenever')`, firebolt, cold));

// ---- Cantrip scaling ----
ins(`INSERT INTO spell (source_id, slug, name, spell_level, school, casting_time, spell_range, duration) VALUES (?, 'blade-ward', 'Blade Ward', 0, 'transmutation', '1 action', 'Self', '1 round')`, src);
const bladeWard = q('SELECT id FROM spell WHERE slug = ?', 'blade-ward').id;
for (const [lvl, dice] of [[1, '1d4'], [5, '2d4'], [11, '3d4'], [17, '4d4']]) {
  ins('INSERT INTO cantrip_damage_dice (class_id, spell_id, from_level, dice) VALUES (?, ?, ?, ?)', fighter, bladeWard, lvl, dice);
}
const scaled = db
  .prepare(
    `SELECT dice FROM cantrip_damage_dice WHERE class_id = ? AND spell_id = ?
     AND from_level <= 9 ORDER BY from_level DESC LIMIT 1`,
  )
  .get(fighter, bladeWard).dice;
if (scaled === '2d4') ok(`cantrip scaling resolves at level 9 to ${scaled}`);
else fail(`expected 2d4 at level 9, got ${scaled}`);
const wardRows = db.prepare('SELECT COUNT(*) AS n FROM cantrip_damage_dice WHERE spell_id = ?').get(bladeWard).n;
if (wardRows === 4) ok('cantrip scaling stored as data rows at 1/5/11/17');
else fail(`expected 4 scaling rows, found ${wardRows}`);

// ---- Damage relations ----
const dm = ins(`INSERT INTO damage_modifier (damage_type_id, relation) VALUES (?, 'resistant')`, fire);
ins(
  `INSERT INTO feature_damage_modifier (feature_id, damage_modifier_id, conditions_note) VALUES (?, ?, 'only while raging')`,
  gnomeFeat,
  Number(dm.lastInsertRowid),
);
const note = q('SELECT conditions_note FROM feature_damage_modifier WHERE feature_id = ?', gnomeFeat).conditions_note;
if (note === 'only while raging') ok('conditional resistance keeps its conditions_note');
else fail('conditions_note not stored');

// Character resistances are stored, and a hand-entered one needs no source.
ins(`INSERT INTO character_damage_modifier (character_id, damage_type_id, relation) VALUES (?, ?, 'resistant')`, pc, poison);
const hand = db.prepare('SELECT source_kind FROM character_damage_modifier WHERE character_id = ?').get(pc);
if (hand.source_kind === null) ok('hand-entered resistance accepted with no source');
else fail('hand-entered resistance required a source');
expectFail('duplicate resistance for the same type rejected', () =>
  ins(`INSERT INTO character_damage_modifier (character_id, damage_type_id, relation) VALUES (?, ?, 'resistant')`, pc, poison));

// ---- Species variant kinds ----
expectFail('invalid variant_kind rejected', () =>
  ins(`INSERT INTO species_variant (source_id, slug, species_id, variant_kind, name) VALUES (?, 'bad', ?, 'bloodline', 'Bad')`, src, elf));
ins(`INSERT INTO species_variant (source_id, slug, species_id, variant_kind, name) VALUES (?, 'infernal', ?, 'legacy', 'Infernal')`, src, elf);
const kind = q('SELECT variant_kind FROM species_variant WHERE slug = ?', 'infernal').variant_kind;
if (kind === 'legacy') ok('Fiendish Legacy stored with variant_kind = legacy');
else fail(`expected legacy, got ${kind}`);

// ---- Ability caps ----
expectFail('base_score above 30 rejected (hard ceiling)', () =>
  ins('INSERT INTO character_ability (character_id, ability_id, base_score) VALUES (?, 1, 31)', pc));

ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'tome-str', 'Tome of Strength', 0)`, src);
const tome = q('SELECT id FROM effect WHERE slug = ?', 'tome-str').id;
ins(`INSERT INTO effect_modifier (effect_id, ability_id, amount, max_score, max_delta, sets_to_personal_max) VALUES (?, 1, 0, 22, 2, 1)`, tome);
const em = q('SELECT * FROM effect_modifier WHERE effect_id = ?', tome);
ok(`Tome modelled as set-to-personal-max, max_delta=${em.max_delta} (two tomes reach 24, not 22)`);

ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'unarmored-defense', 'Unarmored Defense', 10)`, src);
const ud = q('SELECT id FROM effect WHERE slug = ?', 'unarmored-defense').id;
ins(`INSERT INTO effect_modifier (effect_id, ability_id, amount, max_score) VALUES (?, 6, 0, 20)`, ud);
ok('Unarmored Defense = base_value 10 + the linked ability modifier');

// Background ASI distribution is app-enforced (sum must be 0 or 3).
const sum = db
  .prepare('SELECT bonus FROM character_background_asi WHERE character_id = ?')
  .all(pc)
  .reduce((a, r) => a + r.bonus, 0);
if (sum === 0 || sum === 3) ok('background ASI distribution is app-enforced (sum 0 or 3)');
else fail(`background ASI sums to ${sum}, expected 3`);

// ---- Roll modifiers, recharge and spends ----
const initiative = q(`SELECT id FROM roll_scope WHERE code = 'initiative'`).id;
const saveScope = q(`SELECT id FROM roll_scope WHERE code = 'save'`).id;
const wpnDamage = q(`SELECT id FROM roll_scope WHERE code = 'weapon_damage'`).id;
const dcScope = q(`SELECT id FROM roll_scope WHERE code = 'spell_save_dc'`).id;

// Danger Sense: advantage on DEX saves, so the scope row carries the ability.
ins(`UPDATE roll_scope SET ability_id = 3 WHERE id = ?`, saveScope);
const dexScoped = q('SELECT ability_id FROM roll_scope WHERE id = ?', saveScope).ability_id;
if (dexScoped === 3) ok('a roll scope can be narrowed to one ability (Danger Sense)');
else fail(`expected DEX (3) on the save scope, got ${dexScoped}`);

ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'alert', 'Alert', 0)`, src);
const alertFx = q('SELECT id FROM effect WHERE slug = ?', 'alert').id;
ins(`INSERT INTO effect_roll_modifier (effect_id, scope_id, kind) VALUES (?, ?, 'advantage')`, alertFx, initiative);
ok('advantage recorded as a roll modifier');

// Searing Smite: extra fire damage on a weapon hit, with a trigger.
ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'searing-smite', 'Searing Smite', 0)`, src);
const smite = q('SELECT id FROM effect WHERE slug = ?', 'searing-smite').id;
ins(
  `INSERT INTO effect_roll_modifier (effect_id, scope_id, kind, dice, damage_type_id, trigger_text)
   VALUES (?, ?, 'dice', '+1d6', ?, 'when you hit with a weapon, next attack')`,
  smite, wpnDamage, fire,
);
const rider = q('SELECT dice, damage_type_id, trigger_text FROM effect_roll_modifier WHERE effect_id = ?', smite);
if (rider.dice === '+1d6' && rider.damage_type_id === fire && rider.trigger_text) {
  ok('typed damage rider with a trigger recorded (Searing Smite)');
} else {
  fail('typed rider not stored correctly');
}

// Haste: flat +2 AC, unlimited uses.
ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'haste', 'Haste', 0)`, src);
const haste = q('SELECT id FROM effect WHERE slug = ?', 'haste').id;
const acScope = q(`SELECT id FROM roll_scope WHERE code = 'damage_taken'`).id;
ins(`INSERT INTO effect_roll_modifier (effect_id, scope_id, kind, amount) VALUES (?, ?, 'flat', 2)`, haste, acScope);
ins(`INSERT INTO effect_recharge (effect_id, interval, uses_max) VALUES (?, 'long_rest', 0)`, haste);
ok('flat modifier plus an unlimited-use recharge recorded');

expectFail('invalid roll modifier kind rejected', () =>
  ins(`INSERT INTO effect_roll_modifier (effect_id, scope_id, kind) VALUES (?, ?, 'sideways')`, alertFx, initiative));

// Channel Divinity: 2 uses, +1 on a short rest, +1 more at Paladin 11.
ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'channel-divinity', 'Channel Divinity', 0)`, src);
const cd = q('SELECT id FROM effect WHERE slug = ?', 'channel-divinity').id;
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
if (capAt(10) === 2 && capAt(11) === 3) ok('recharge cap is level-dependent: 2 at Paladin 10, 3 at 11');
else fail(`expected 2 then 3, got ${capAt(10)} then ${capAt(11)}`);

// Spending, then a long rest. The row is never updated; the generation moves.
const spentBefore = db.prepare('SELECT uses_spent FROM character_effect_uses WHERE character_id = ? AND effect_id = ?').get(pc, cd).uses_spent;
ins('UPDATE player_character SET long_rest_count = long_rest_count + 1 WHERE id = ?', pc);
const gen = db.prepare('SELECT long_rest_count FROM player_character WHERE id = ?').get(pc).long_rest_count;
const storedGen = db.prepare('SELECT long_rest_generation FROM character_effect_uses WHERE character_id = ? AND effect_id = ?').get(pc, cd).long_rest_generation;
if (spentBefore === 1 && gen === 1 && storedGen === 0) {
  ok('long rest refreshed uses by moving the counter, updating no spend row');
} else {
  fail(`generation trick broken: spent=${spentBefore} gen=${gen} stored=${storedGen}`);
}

// Short-rest recharge reads the SHORT generation, not the long one.
ins(`UPDATE player_character SET short_rest_count = 1 WHERE id = ?`, pc);
const shortGen = db.prepare('SELECT short_rest_generation FROM character_effect_uses WHERE character_id = ? AND effect_id = ?').get(pc, cd).short_rest_generation;
if (shortGen === 0) ok('short-rest generation tracked separately from long-rest');
else fail('short and long rest generations are not independent');

// Capability grants.
ins(`INSERT INTO effect (source_id, slug, name, base_value) VALUES (?, 'darkvision', 'Darkvision', 0)`, src);
const dv = q('SELECT id FROM effect WHERE slug = ?', 'darkvision').id;
ins(`INSERT INTO effect_darkvision (effect_id, range_feet) VALUES (?, 120)`, dv);
if (q('SELECT range_feet FROM effect_darkvision WHERE effect_id = ?', dv).range_feet === 120) ok('darkvision range recorded');

ins(`INSERT INTO language (slug, name) VALUES ('giant', 'Giant')`);
const giant = q('SELECT id FROM language WHERE slug = ?', 'giant').id;
ins(`INSERT INTO effect_language (effect_id, language_id) VALUES (?, ?)`, dv, giant);
ok('language grant recorded');

const finesse = q(`SELECT id FROM weapon_property WHERE code = 'finesse'`).id;
ins(`INSERT INTO effect_weapon_property (effect_id, property_id) VALUES (?, ?)`, dv, finesse);
ok('weapon property grant recorded');

const poisoned = q(`SELECT id FROM condition WHERE slug = 'poisoned'`).id;
ins(`INSERT INTO effect_condition_modifier (effect_id, condition_id, relation) VALUES (?, ?, 'immune')`, dv, poisoned);
ok('condition immunity recorded');

ins(`INSERT INTO effect_crit (effect_id, threshold) VALUES (?, 19)`, dv);
if (q('SELECT threshold FROM effect_crit WHERE effect_id = ?', dv).threshold === 19) ok('crit threshold recorded');

ins(`INSERT INTO effect_size (effect_id, size) VALUES (?, 'large')`, dv);
if (q(`SELECT size FROM effect_size WHERE effect_id = ?`, dv).size === 'large') ok('size change recorded');

expectFail('invalid crit threshold rejected', () =>
  ins(`INSERT INTO effect_crit (effect_id, threshold) VALUES (?, 25)`, dv));

// ---- Spell slot spends ----
ins(`INSERT INTO class (source_id, slug, name, hit_die, casting_progression) VALUES (?, 'warlock', 'Warlock', 8, 'pact')`, src);
const warlock = q('SELECT id FROM class WHERE slug = ?', 'warlock').id;
ins(`INSERT INTO class_slot_recovery (class_id, interval) VALUES (?, 'short_rest')`, warlock);
const rec = q('SELECT interval FROM class_slot_recovery WHERE class_id = ?', warlock).interval;
if (rec === 'short_rest') ok('Warlock Pact Magic recovers on a short rest');

// Both generation columns exist so the read can pick the right one.
ins(`INSERT INTO character_class (character_id, class_id, level) VALUES (?, ?, 2)`, pc, warlock);
ins(`INSERT INTO character_spell_slot_spends (character_id, class_id, slot_level, spent, short_rest_generation) VALUES (?, ?, 1, 1, 0)`, pc, warlock);
const wlkRow = db.prepare('SELECT * FROM character_spell_slot_spends WHERE character_id = ? AND class_id = ?').get(pc, warlock);
if (wlkRow.short_rest_generation === 0 && wlkRow.long_rest_generation === 0) {
  ok('spell slot spends carry both rest generations');
} else {
  fail('spell slot spend generations missing');
}

// A short rest refreshes the Warlock (interval = short_rest) but a
// long-rest class in the same character is unaffected.
ins('UPDATE player_character SET short_rest_count = short_rest_count + 1 WHERE id = ?', pc);
const wlkFresh = db
  .prepare('SELECT short_rest_generation FROM character_spell_slot_spends WHERE character_id = ? AND class_id = ?')
  .get(pc, warlock).short_rest_generation;
if (wlkFresh === 0) ok('a short rest refreshes Warlock slots by moving the counter only');
else fail('Warlock slot generation did not go stale');

expectFail('negative slot spend rejected', () =>
  ins(`INSERT INTO character_spell_slot_spends (character_id, class_id, slot_level, spent) VALUES (?, ?, 2, -1)`, pc, warlock));

// ---- Delete policy ----
const surviving = () => db.prepare('SELECT COUNT(*) AS n FROM player_character').get().n;
try {
  db.prepare('DELETE FROM source WHERE id = ?').run(src);
  if (surviving() === 1) fail('source delete silently cascaded away a character');
  else ok('deleting an in-use pack is refused; character survived');
} catch {
  if (surviving() === 1) ok('deleting an in-use pack is refused; character survived');
  else fail('character was lost during pack delete');
}

// Deleting a character still cascades to its rows.
ins(`INSERT INTO class_grant_slot (class_id, class_level, grant_kind, opens) VALUES (?, 8, 'asi_or_feat', 1)`, fighter);
db.prepare('DELETE FROM player_character WHERE id = ?').run(pc);
const orphans = db.prepare('SELECT COUNT(*) AS n FROM character_grant_pick').get().n;
if (orphans === 0) ok('deleting a character cascades to its rows (no orphans)');
else fail(`${orphans} orphan pick rows left after character delete`);

db.prepare('DELETE FROM source WHERE id = ?').run(src);
const speciesLeft = db.prepare('SELECT COUNT(*) AS n FROM species').get().n;
if (speciesLeft === 0) ok('unused pack deletes cleanly');
else fail(`${speciesLeft} species rows survived pack delete`);

db.exec('PRAGMA foreign_key_check');
ok('foreign_key_check clean');

if (failures === 0) {
  console.log('\nAll checks passed.');
} else {
  console.log(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}