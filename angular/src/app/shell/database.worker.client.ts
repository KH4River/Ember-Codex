import type { DatabaseApi, PackImportResult } from '@/api/DatabaseApi';
import type { Ability } from '@/models/Ability';
import type { PackSummary } from '@/models/PackSummary';
import type { ImportTextOptions } from '@/packs/importPackText';
import type { PackRemoval } from '@/packs/removePack';

import { DatabaseTransport } from './database.transport';
import type { ApiRequest, WorkerToMain } from './database.protocol';

type Waiter = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/** The UI-thread client. It sends typed operations to the worker and never
 *  imports shared/db or shared/packs. */
export class WorkerDatabaseClient implements DatabaseApi {
  private nextId = 1;
  private readonly pending = new Map<number, Waiter>();

  private constructor(
    private readonly worker: Worker,
    private readonly transport: DatabaseTransport,
  ) {
    worker.addEventListener('message', (event: MessageEvent) => {
      const message = event.data as WorkerToMain;
      if (message.kind !== 'api-result') {
        return;
      }
      const waiter = this.pending.get(message.id);
      if (waiter === undefined) {
        return;
      }
      this.pending.delete(message.id);
      if (message.ok) {
        waiter.resolve(message.value);
      } else {
        waiter.reject(new Error(message.error));
      }
    });
    worker.addEventListener('error', (event) => {
      this.fail(new Error(event.message || 'the database worker failed'));
    });
  }

  static async create(): Promise<WorkerDatabaseClient> {
    const worker = new Worker(new URL('./database.worker', import.meta.url), { type: 'module' });
    const transport = new DatabaseTransport(worker);
    await transport.connect();
    return new WorkerDatabaseClient(worker, transport);
  }

  listAbilities(): Promise<Ability[]> {
    return this.call('listAbilities', []);
  }

  listPacks(): Promise<PackSummary[]> {
    return this.call('listPacks', []);
  }

  importPack(contents: string, options?: ImportTextOptions): Promise<PackImportResult> {
    return this.call('importPack', [contents, options]);
  }

  exportPack(slug: string): Promise<string> {
    return this.call('exportPack', [slug]);
  }

  removePack(slug: string): Promise<PackRemoval> {
    return this.call('removePack', [slug]);
  }

  sqliteVersion(): Promise<string> {
    return this.call('sqliteVersion', []);
  }

  private call<T>(method: keyof DatabaseApi, args: unknown[]): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      const request: ApiRequest = { kind: 'api', id, method, args };
      this.worker.postMessage(request);
    });
  }

  private fail(error: Error): void {
    for (const waiter of this.pending.values()) {
      waiter.reject(error);
    }
    this.pending.clear();
  }
}
