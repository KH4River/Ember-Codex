import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

import type { PackImportResult } from '@/api/DatabaseApi';
import type { PackSummary } from '@/models/PackSummary';
import type { ImportTextOptions } from '@/packs/importPackText';
import { PacksService } from '@/packs/packs.service';

export interface PendingImport {
  contents: string;
  installed: PackSummary;
}

/** The pack screen. Every flow is one call into PacksService plus one signal;
 *  the page never parses, validates or names a file. */
@Component({
  selector: 'app-packs-page',
  imports: [MatButtonModule],
  templateUrl: './packs-page.html',
  styleUrl: './packs-page.scss',
})
export class PacksPage {
  private readonly packsService = inject(PacksService);

  readonly packs = signal<PackSummary[]>([]);
  readonly problems = signal<string[]>([]);
  readonly notice = signal<string | null>(null);
  readonly busy = signal(false);
  readonly pendingImport = signal<PendingImport | null>(null);
  readonly confirmingRemoval = signal<PackSummary | null>(null);
  readonly newKey = signal('');

  constructor() {
    void this.load();
  }

  async importPicked(): Promise<void> {
    await this.busyDuring(async () => {
      const result = await this.packsService.importPicked();
      if (result === null) {
        return;
      }
      await this.handleImport(result);
    });
  }

  async replaceInstalled(): Promise<void> {
    const pending = this.pendingImport();
    if (pending === null) {
      return;
    }
    await this.finishImport(pending.contents, { mode: 'replace' });
  }

  async keepBoth(): Promise<void> {
    const pending = this.pendingImport();
    if (pending === null) {
      return;
    }
    const newSlug = this.newKey().trim();
    if (newSlug === '') {
      this.problems.set(['enter a new key to keep both packs']);
      return;
    }
    await this.finishImport(pending.contents, { mode: 'keep-both', newSlug });
  }

  cancelImport(): void {
    this.pendingImport.set(null);
    this.newKey.set('');
  }

  async exportPack(slug: string): Promise<void> {
    await this.busyDuring(async () => {
      if (await this.packsService.export(slug)) {
        this.notice.set(`Exported "${slug}".`);
      }
    });
  }

  askToRemove(pack: PackSummary): void {
    this.confirmingRemoval.set(pack);
  }

  cancelRemoval(): void {
    this.confirmingRemoval.set(null);
  }

  async remove(pack: PackSummary): Promise<void> {
    await this.busyDuring(async () => {
      const outcome = await this.packsService.remove(pack.slug);
      if (!outcome.removed) {
        this.problems.set(outcome.blockers);
        return;
      }
      this.confirmingRemoval.set(null);
      this.notice.set(`Removed "${pack.slug}".`);
      await this.load();
    });
  }

  private async finishImport(contents: string, options: ImportTextOptions): Promise<void> {
    await this.busyDuring(async () => {
      await this.handleImport(await this.packsService.import(contents, options));
    });
  }

  private async handleImport(result: PackImportResult): Promise<void> {
    if (result.status === 'invalid') {
      this.problems.set(result.problems);
      return;
    }
    if (result.status === 'blocked') {
      this.problems.set(result.blockers);
      return;
    }
    if (result.outcome.status === 'needs-mode') {
      this.pendingImport.set({
        contents: result.outcome.contents,
        installed: result.outcome.installed,
      });
      return;
    }
    await this.imported(result.outcome.file.source.name);
  }

  private async imported(name: string): Promise<void> {
    this.pendingImport.set(null);
    this.newKey.set('');
    this.notice.set(`Imported "${name}".`);
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      this.packs.set(await this.packsService.list());
    } catch (error) {
      this.problems.set(problemsOf(error));
    }
  }

  private async busyDuring(work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.problems.set([]);
    this.notice.set(null);
    try {
      await work();
    } catch (error) {
      this.problems.set(problemsOf(error));
    } finally {
      this.busy.set(false);
    }
  }
}

/** The file seam and the transport still throw plain errors; the importer's
 *  two refusals arrive as data instead. */
function problemsOf(error: unknown): string[] {
  if (error instanceof Error) {
    return [error.message];
  }
  return ['the pack operation failed'];
}
