import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAX_PACK_BYTES,
  assertPackSize,
  readPackFile,
  writePackFile,
} from '../../../../electron/files';

/**
 * The Electron main-process file helpers have no Electron imports, so they run
 * under plain Node. The dialogs stay in ipc.ts, which has no harness.
 */
describe('pack files (Electron main process)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ember-pack-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes and reads a pack back unchanged', () => {
    const path = join(dir, 'homebrew.json');
    writePackFile(path, '{"format":"ember-codex.pack"}');

    expect(readPackFile(path)).toBe('{"format":"ember-codex.pack"}');
  });

  it('accepts a file at the limit and refuses one byte more', () => {
    expect(() => assertPackSize(MAX_PACK_BYTES)).not.toThrow();
    expect(() => assertPackSize(MAX_PACK_BYTES + 1)).toThrow(/at most/);
  });
});
