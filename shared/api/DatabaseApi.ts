import type { Ability } from '../models/Ability';
import type { PackSummary } from '../models/PackSummary';
import type { ImportTextOptions, PackImportOutcome } from '../packs/importPackText';
import type { PackRemoval } from '../packs/removePack';

/**
 * The whole database surface a renderer may see. Electron answers it from the
 * main process; the renderer never receives a port, a statement or a migration.
 */
export interface DatabaseApi {
  listAbilities(): Promise<Ability[]>;
  listPacks(): Promise<PackSummary[]>;
  importPack(contents: string, options?: ImportTextOptions): Promise<PackImportResult>;
  exportPack(slug: string): Promise<string>;
  removePack(slug: string): Promise<PackRemoval>;
  sqliteVersion(): Promise<string>;
}

/** A thrown error loses its class and its list across IPC, so a refusal comes
 *  back as data the renderer can render without knowing the importer. */
export type PackImportResult =
  | { status: 'ok'; outcome: PackImportOutcome }
  | { status: 'invalid'; problems: string[] }
  | { status: 'blocked'; blockers: string[] };
