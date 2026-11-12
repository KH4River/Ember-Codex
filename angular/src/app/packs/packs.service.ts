import { Injectable, inject } from '@angular/core';

import { listPacks, type PackSummary } from '@/db/repositories/sources';
import { exportPack } from '@/packs/exportPack';
import {
  importPackText,
  type ImportTextOptions,
  type PackImportOutcome,
} from '@/packs/importPackText';
import { removePack, type PackRemoval } from '@/packs/removePack';

import { DatabaseService } from '@/data/database.service';
import { PackFilesService } from '@/data/pack-files.service';

/** The pack feature's entry point: the page and any future extractor call this
 *  and nothing below it. */
@Injectable({ providedIn: 'root' })
export class PacksService {
  private readonly database = inject(DatabaseService);
  private readonly files = inject(PackFilesService);

  async list(): Promise<PackSummary[]> {
    return listPacks(await this.database.port());
  }

  async import(contents: string, options: ImportTextOptions = {}): Promise<PackImportOutcome> {
    return importPackText(await this.database.port(), contents, options);
  }

  /** Null means the user cancelled the picker. */
  async importPicked(options: ImportTextOptions = {}): Promise<PackImportOutcome | null> {
    const opened = await this.files.openPack();
    if (opened === null) {
      return null;
    }
    return this.import(opened.contents, options);
  }

  async export(slug: string): Promise<boolean> {
    const contents = await exportPack(await this.database.port(), slug);
    return this.files.savePack(contents, safeFileName(slug));
  }

  async remove(slug: string): Promise<PackRemoval> {
    return removePack(await this.database.port(), slug);
  }
}

/** The slug is a key, not a path: anything it cannot hold becomes `_`. */
export function safeFileName(slug: string): string {
  return `${slug.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}
