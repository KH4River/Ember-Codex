import type { DatabasePort } from './DatabasePort';

/** The engine version. Read at startup so a device build can state what it is
 *  running; it is a property of the device, so it is never stored. */
export async function sqliteVersion(port: DatabasePort): Promise<string> {
  const row = await port.get<{ version: string }>('SELECT sqlite_version() AS version');
  return row?.version ?? 'unknown';
}
