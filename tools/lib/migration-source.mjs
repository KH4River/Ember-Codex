// Shared reader for shared/db/migrations/*.sql.
//
// Both the generator (tools/generate-migrations.mjs) and the verifier
// (tools/verify-migration.mjs) import this, so the "in sync" check uses the
// exact same digest the generator wrote. Duplicating the algorithm in both
// places would be a drift bug of its own.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const migrationsDir = join(repoRoot, 'shared', 'db', 'migrations');

/** Migration files, sorted by filename (001, 002, ...). */
export function readMigrationSources() {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: normaliseEol(readFileSync(join(migrationsDir, name), 'utf8')) }));
}

/**
 * The digest must not depend on the checkout's line endings: `.gitattributes`
 * normalises to LF in the repository but checks files out with the platform
 * convention, so Windows sees CRLF and CI sees LF. Fold CRLF to LF before
 * hashing or generating.
 */
function normaliseEol(text) {
  return text.replace(/\r\n/g, '\n');
}

/** One migration file's digest, with the same line-ending folding. */
export function contentDigest(sql) {
  return createHash('sha256').update(normaliseEol(sql)).digest('hex');
}

/**
 * Digest over name + content of every migration, in order. A change to any
 * migration changes this; the generated TS embeds it and the verifier compares.
 */
export function sourceDigest(sources) {
  const hash = createHash('sha256');
  for (const { name, sql } of sources) {
    hash.update(name);
    hash.update('\0');
    hash.update(sql);
    hash.update('\0');
  }
  return hash.digest('hex');
}
