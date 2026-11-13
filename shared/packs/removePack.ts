import type { DatabasePort } from '../db/DatabasePort';
import { usagesOfRemovedRows, type RemovedRowUsage } from '../db/repositories/character-usage';
import { deletePackSource, findPackSource } from '../db/repositories/sources';
import type { KeyedTable } from './references';

/** Removal is a user action with an expected refusal, so "in use" comes back as
 *  blockers rather than an exception. Only an unknown slug throws. */

export type PackRemoval = { removed: true } | { removed: false; blockers: string[] };

export async function removePack(port: DatabasePort, slug: string): Promise<PackRemoval> {
  const source = await findPackSource(port, slug);
  if (source === undefined) throw new Error(`no pack named "${slug}" is installed`);

  const removed = await usagesOfRemovedRows(port, source.id, new Map());
  if (removed.length > 0) {
    return { removed: false, blockers: removalBlockers(slug, removed) };
  }

  try {
    await deletePackSource(port, source.id);
    return { removed: true };
  } catch {
    return {
      removed: false,
      blockers: [`cannot remove pack "${slug}"; its content is still in use`],
    };
  }
}

/** A named usage is the useful answer; the cascade's bare foreign-key error is
 *  the fallback for whatever the usage table does not cover. */
function removalBlockers(slug: string, removed: RemovedRowUsage[]): string[] {
  return removed.map(({ table, slug: rowSlug, usage }) => {
    return `cannot remove pack "${slug}": ${tableNameInProse(table)} "${rowSlug}" is used by character "${usage.character}" (${usage.via})`;
  });
}

function tableNameInProse(table: KeyedTable): string {
  return table.replace(/_/g, ' ');
}
