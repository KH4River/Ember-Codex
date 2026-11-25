import { Injectable, inject } from '@angular/core';

import type { PackImportResult } from '@/api/DatabaseApi';
import type { PackSummary } from '@/models/PackSummary';
import type { ImportTextOptions } from '@/packs/importPackText';
import type { PackRemoval } from '@/packs/removePack';

import { DatabaseService } from '@/shell/database.service';
import { PackFilesService } from '@/shell/pack-files.service';

/** The pack feature's entry point: the page and any future extractor call this
 *  and nothing below it. */
@Injectable({ providedIn: 'root' })
export class PacksService {
  private readonly database = inject(DatabaseService);
  private readonly files = inject(PackFilesService);

  list(): Promise<PackSummary[]> {
    return this.database.listPacks();
  }

  import(contents: string, options: ImportTextOptions = {}): Promise<PackImportResult> {
    return this.database.importPack(contents, options);
  }

  /** Null means the user cancelled the picker. */
  async importPicked(options: ImportTextOptions = {}): Promise<PackImportResult | null> {
    const opened = await this.files.openPack();
    if (opened === null) {
      return null;
    }
    return this.import(opened.contents, options);
  }

  async export(slug: string): Promise<boolean> {
    const contents = await this.database.exportPack(slug);
    return this.files.savePack(contents, safeFileName(slug));
  }

  remove(slug: string): Promise<PackRemoval> {
    return this.database.removePack(slug);
  }
}

/** The slug is a key, not a path: anything it cannot hold becomes `_`. */
export function safeFileName(slug: string): string {
  return `${slug.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}
