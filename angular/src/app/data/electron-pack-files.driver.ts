import type { OpenedPack, PackFilesPort } from './pack-files.port';

/** Desktop adapter: forwards to the main process, which owns the dialogs and
 *  the disk. */
export class ElectronPackFilesDriver implements PackFilesPort {
  constructor(private readonly files: ElectronFilesApi) {}

  async openPack(): Promise<OpenedPack | null> {
    return this.files.openPack();
  }

  async savePack(contents: string, suggestedName: string): Promise<boolean> {
    return this.files.savePack(contents, suggestedName);
  }
}
