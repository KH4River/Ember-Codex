/** A pack as the list shows it. `supersededBy` is the successor's slug, not
 *  its id, because the list only ever displays it. */
export interface PackSummary {
  slug: string;
  name: string;
  version: string;
  importedAt: string;
  supersededBy: string | null;
}
