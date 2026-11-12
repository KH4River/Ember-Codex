import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FilePicker } from '@capawesome/capacitor-file-picker';

import type { OpenedPack, PackFilesPort } from './pack-files.port';

/** Mobile adapter: the system picker for reading, and a cache file handed to
 *  the system share sheet for writing. The app cannot see what the user does
 *  inside that sheet. */
export class CapacitorPackFilesDriver implements PackFilesPort {
  async openPack(): Promise<OpenedPack | null> {
    // Android 9 and older call .json octet-stream, and some document providers
    // do the same on any version.
    const picked = await FilePicker.pickFiles({
      types: ['application/json', 'application/octet-stream'],
      limit: 1,
    });
    const file = picked.files[0];
    if (file === undefined) {
      return null;
    }
    if (file.webPath === undefined) {
      throw new Error(`the picked file "${file.name}" cannot be read in the web view`);
    }

    // fetch reads the file as text without loading it as base64 into memory.
    const response = await fetch(file.webPath);
    return { name: file.name, contents: await response.text() };
  }

  async savePack(contents: string, suggestedName: string): Promise<boolean> {
    const { value: canShare } = await Share.canShare();
    if (!canShare) {
      return false;
    }

    // The cache directory is app-owned and is where Android shares from.
    await Filesystem.writeFile({
      path: suggestedName,
      data: contents,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    const { uri } = await Filesystem.getUri({ path: suggestedName, directory: Directory.Cache });
    await Share.share({ title: suggestedName, url: uri });
    return true;
  }
}
