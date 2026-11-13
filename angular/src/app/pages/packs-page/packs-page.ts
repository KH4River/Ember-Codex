import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

import type { PackSummary } from '@/db/repositories/sources';
import { PackImportError } from '@/packs/importPack';
import type { ImportTextOptions } from '@/packs/importPackText';
import { PacksService } from '@/packs/packs.service';
import { PackValidationError } from '@/packs/validatePack';

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
      const outcome = await this.packsService.importPicked();
      if (outcome === null) {
        return;
      }
      if (outcome.status === 'needs-mode') {
        this.pendingImport.set({ contents: outcome.contents, installed: outcome.installed });
        return;
      }
      await this.imported(outcome.file.source.name);
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
      const outcome = await this.packsService.import(contents, options);
      if (outcome.status !== 'imported') {
        return;
      }
      await this.imported(outcome.file.source.name);
    });
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

/** Both error classes carry a list, so one place flattens them. */
function problemsOf(error: unknown): string[] {
  if (error instanceof PackValidationError) {
    return error.problems;
  }
  if (error instanceof PackImportError) {
    return error.blockers;
  }
  if (error instanceof Error) {
    return [error.message];
  }
  return ['the pack operation failed'];
}
