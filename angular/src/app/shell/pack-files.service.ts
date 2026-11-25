import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import type { OpenedPack, PackFilesApi } from '@/api/PackFilesApi';

/**
 * The renderer's file seam: pick the platform driver once and forward. The
 * choice and the Capacitor plugins are deferred to the first call, so desktop
 * never loads them.
 */
@Injectable({ providedIn: 'root' })
export class PackFilesService implements PackFilesApi {
  private api?: Promise<PackFilesApi>;

  async openPack(): Promise<OpenedPack | null> {
    return (await this.files()).openPack();
  }

  async savePack(contents: string, suggestedName: string): Promise<boolean> {
    return (await this.files()).savePack(contents, suggestedName);
  }

  private files(): Promise<PackFilesApi> {
    this.api ??= PackFilesService.create();
    return this.api;
  }

  private static async create(): Promise<PackFilesApi> {
    const desktop = window.electronAPI?.packFiles;
    if (desktop !== undefined) {
      return desktop;
    }
    if (Capacitor.isNativePlatform()) {
      const { CapacitorPackFilesDriver } = await import('./capacitor-pack-files.driver');
      return new CapacitorPackFilesDriver();
    }
    throw new Error('opening and saving pack files needs the desktop or mobile app');
  }
}
