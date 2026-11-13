import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { CapacitorPackFilesDriver } from './capacitor-pack-files.driver';
import { ElectronPackFilesDriver } from './electron-pack-files.driver';
import type { OpenedPack, PackFilesPort } from './pack-files.port';

/**
 * The renderer's file seam: pick the platform driver once and forward. The
 * choice is deferred to the first call so a platform without a file channel
 * reports at use, not at injection.
 */
@Injectable({ providedIn: 'root' })
export class PackFilesService implements PackFilesPort {
  private port?: PackFilesPort;

  async openPack(): Promise<OpenedPack | null> {
    return this.files().openPack();
  }

  async savePack(contents: string, suggestedName: string): Promise<boolean> {
    return this.files().savePack(contents, suggestedName);
  }

  private files(): PackFilesPort {
    this.port ??= PackFilesService.createPort();
    return this.port;
  }

  private static createPort(): PackFilesPort {
    const electronFiles = window.electronAPI?.files;
    if (electronFiles) {
      return new ElectronPackFilesDriver(electronFiles);
    }
    if (Capacitor.isNativePlatform()) {
      return new CapacitorPackFilesDriver();
    }
    throw new Error('opening and saving pack files needs the desktop or mobile app');
  }
}
