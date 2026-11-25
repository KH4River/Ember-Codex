import type { DatabasePort } from '@/db/DatabasePort';

import type { PortMethod, PortRequest, PortResponse } from './database.protocol';

type Waiter = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/** The worker's side of DatabasePort. Each call is one message to the main
 *  thread, which is the only place the Capacitor plugin is reachable. Calls
 *  are serialized so an import cannot interleave with another statement. */
export class RpcDatabasePort implements DatabasePort {
  private nextId = 1;
  private readonly pending = new Map<number, Waiter>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly rpc: MessagePort) {
    rpc.addEventListener('message', (event: MessageEvent) => {
      const message = event.data as PortResponse;
      if (message.kind !== 'port-result') {
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
    rpc.start();
  }

  open(): Promise<void> {
    return this.call('open', []);
  }

  exec(sql: string): Promise<void> {
    return this.call('exec', [sql]);
  }

  run(sql: string, params: readonly unknown[] = []): Promise<void> {
    return this.call('run', [sql, params]);
  }

  all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.call<T[]>('all', [sql, params]);
  }

  get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
    return this.call<T | undefined>('get', [sql, params]);
  }

  close(): Promise<void> {
    return this.call('close', []);
  }

  private call<T>(method: PortMethod, args: unknown[]): Promise<T> {
    const result = this.queue.then(
      () => this.send<T>(method, args),
      () => this.send<T>(method, args),
    );
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private send<T>(method: PortMethod, args: unknown[]): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      const request: PortRequest = { kind: 'port', id, method, args };
      this.rpc.postMessage(request);
    });
  }
}
