import { readFileSync, statSync, writeFileSync } from 'node:fs';

/** The guard is a wrong-file guard, not a rule: any real pack is far below it. */
export const MAX_PACK_BYTES = 16 * 1024 * 1024;

export function assertPackSize(bytes: number): void {
  if (bytes > MAX_PACK_BYTES) {
    throw new RangeError(`a pack file must be at most ${MAX_PACK_BYTES} bytes, got ${bytes}`);
  }
}

export function readPackFile(path: string): string {
  assertPackSize(statSync(path).size);
  const contents = readFileSync(path, 'utf8');
  assertPackSize(Buffer.byteLength(contents, 'utf8'));
  return contents;
}

export function writePackFile(path: string, contents: string): void {
  assertPackSize(Buffer.byteLength(contents, 'utf8'));
  writeFileSync(path, contents, 'utf8');
}
