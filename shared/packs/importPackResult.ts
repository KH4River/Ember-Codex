import type { PackImportResult } from '../api/DatabaseApi';
import type { DatabasePort } from '../db/DatabasePort';
import { PackImportError } from './importPack';
import { importPackText, type ImportTextOptions } from './importPackText';
import { PackValidationError } from './validatePack';

/** The importer refuses by throwing two classes. The IPC boundary cannot
 *  preserve either, so both are mapped to the result the renderer renders. */
export async function importPackResult(
  port: DatabasePort,
  contents: string,
  options: ImportTextOptions = {},
): Promise<PackImportResult> {
  try {
    return { status: 'ok', outcome: await importPackText(port, contents, options) };
  } catch (error) {
    if (error instanceof PackValidationError) {
      return { status: 'invalid', problems: error.problems };
    }
    if (error instanceof PackImportError) {
      return { status: 'blocked', blockers: error.blockers };
    }
    throw error;
  }
}
