import type { PackSource } from '../../models/ContentPack';
import type { DatabasePort } from '../DatabasePort';

export interface PackSourceRow {
  id: number;
  slug: string;
}

/** A pack as the list shows it. `supersededBy` is the successor's slug, not
 *  its id, because the list only ever displays it. */
export interface PackSummary {
  slug: string;
  name: string;
  version: string;
  importedAt: string;
  supersededBy: string | null;
}

export async function listPacks(port: DatabasePort): Promise<PackSummary[]> {
  return port.all<PackSummary>(
    `SELECT s.slug, s.name, s.version, s.imported_at AS importedAt,
            p.slug AS supersededBy
       FROM source s LEFT JOIN source p ON p.id = s.superseded_by
      ORDER BY s.slug`,
  );
}

export async function getPack(
  port: DatabasePort,
  slug: string,
): Promise<PackSummary | undefined> {
  return port.get<PackSummary>(
    `SELECT s.slug, s.name, s.version, s.imported_at AS importedAt,
            p.slug AS supersededBy
       FROM source s LEFT JOIN source p ON p.id = s.superseded_by
      WHERE s.slug = ?`,
    [slug],
  );
}

export async function findPackSource(
  port: DatabasePort,
  slug: string,
): Promise<PackSourceRow | undefined> {
  return port.get<PackSourceRow>('SELECT id, slug FROM source WHERE slug = ?', [slug]);
}

/** Replacing a pack touches its row in place, so characters keep pointing at
 *  the same content ids. A new key inserts. */
export async function upsertPackSource(
  port: DatabasePort,
  source: PackSource,
  existing: PackSourceRow | undefined,
  slug: string,
): Promise<number> {
  if (existing && existing.slug === slug) {
    await port.run(
      `UPDATE source
          SET name = ?, version = ?, license = ?, attribution = ?,
              imported_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
              superseded_by = NULL
        WHERE id = ?`,
      [source.name, source.version, source.license, source.attribution, existing.id],
    );
    return existing.id;
  }

  await port.run(
    'INSERT INTO source (slug, name, version, license, attribution) VALUES (?, ?, ?, ?, ?)',
    [slug, source.name, source.version, source.license, source.attribution],
  );
  return (await findPackSource(port, slug))!.id;
}

/** The keep-both pointer. The old pack stays installed and keeps its content. */
export async function markSuperseded(
  port: DatabasePort,
  oldId: number,
  newId: number,
): Promise<void> {
  await port.run('UPDATE source SET superseded_by = ? WHERE id = ?', [newId, oldId]);
}

export async function deletePackSource(port: DatabasePort, id: number): Promise<void> {
  await port.run('DELETE FROM source WHERE id = ?', [id]);
}
