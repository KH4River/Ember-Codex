// Records every migration's digest in migration-lock.json.
// Run after adding shared/db/migrations/00N_*.sql: node tools/lock-migration.mjs
import { readFileSync, writeFileSync } from 'node:fs';

import { contentDigest, readMigrationSources } from './lib/migration-source.mjs';

const lockUrl = new URL('./migration-lock.json', import.meta.url);
const lock = JSON.parse(readFileSync(lockUrl, 'utf8'));
for (const { name, sql } of readMigrationSources()) {
  lock[name] = contentDigest(sql);
}
writeFileSync(lockUrl, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`migration-lock.json: ${Object.keys(lock).length} files`);
