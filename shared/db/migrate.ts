import type { DatabasePort } from './DatabasePort';

/**
 * Applies each pending migration, in order, exactly once. `user_version` is the
 * applied count, and each file sets its own trailing `PRAGMA user_version = N`.
 * `foreign_keys` is set before the first transaction because the pragma is a
 * no-op inside one.
 */
export async function runMigrations(
  port: DatabasePort,
  migrations: readonly string[],
): Promise<void> {
  await port.exec('PRAGMA foreign_keys = ON');

  const row = await port.get<{ user_version: number }>('PRAGMA user_version');
  const applied = row?.user_version ?? 0;
  if (applied >= migrations.length) {
    return;
  }

  for (let i = applied; i < migrations.length; i++) {
    await port.exec('BEGIN');
    try {
      await port.exec(migrations[i]);
      await port.exec('COMMIT');
    } catch (error) {
      await port.exec('ROLLBACK');
      throw error;
    }
  }
}
