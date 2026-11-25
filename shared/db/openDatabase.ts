import type { DatabasePort } from './DatabasePort';
import { runMigrations } from './migrate';
import { MIGRATIONS } from './migrations.generated';

/** Open a port and apply every pending migration. The caller owns the port;
 *  this is the one place the schema is applied, so a host adapter never has to
 *  import the generated SQL. */
export async function openDatabase(port: DatabasePort): Promise<DatabasePort> {
  await port.open();
  await runMigrations(port, MIGRATIONS);
  return port;
}
