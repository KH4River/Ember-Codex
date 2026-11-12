import type { DatabasePort } from '../db/DatabasePort';
import { getPack, type PackSummary } from '../db/repositories/sources';
import type { PackFile } from '../models/ContentPack';
import {
  importPack,
  type ImportMode,
  type ImportResult,
} from './importPack';
import { PackValidationError, validateStructure } from './validatePack';

/** Text is the entry point every caller shares: the pages, and any extractor
 *  that emits a pack file. Choosing replace or keep-both is the only decision
 *  it leaves open, and it never guesses. */

export interface ImportTextOptions {
  /** Omit to have an installed key reported as `needs-mode`; `importPack`
   *  itself defaults to `replace`. */
  mode?: ImportMode;
  newSlug?: string;
}

export type PackImportOutcome =
  | { status: 'imported'; file: PackFile; result: ImportResult }
  | { status: 'needs-mode'; contents: string; file: PackFile; installed: PackSummary };

export async function importPackText(
  port: DatabasePort,
  contents: string,
  options: ImportTextOptions = {},
): Promise<PackImportOutcome> {
  const file = parsePack(contents);

  if (options.mode === undefined) {
    const installed = await getPack(port, file.source.key);
    if (installed !== undefined) {
      return { status: 'needs-mode', contents, file, installed };
    }
  }

  const result = await importPack(port, file, options);
  return { status: 'imported', file, result };
}

function parsePack(contents: string): PackFile {
  let input: unknown;
  try {
    input = JSON.parse(contents);
  } catch (error) {
    throw new PackValidationError([`a pack file must be valid JSON: ${describeError(error)}`]);
  }
  return validateStructure(input);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
