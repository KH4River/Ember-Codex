import type { DatabasePort } from '@/db/DatabasePort';

import { CapacitorSqliteDriver } from './capacitor-sqlite.driver';
import type { ConnectMessage, PortRequest, PortResponse, ReadyMessage } from './database.protocol';

/** The main-thread side of the worker: it owns the Capacitor connection and
 *  answers the worker's DatabasePort calls. It contains no shared logic. */
export class DatabaseTransport {
  private readonly channel = new MessageChannel();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly worker: Worker,
    private readonly driver: DatabasePort = new CapacitorSqliteDriver(),
  ) {
    this.channel.port1.addEventListener('message', (event: MessageEvent) => {
      const request = event.data as PortRequest;
      if (request.kind !== 'port') {
        return;
      }
      void this.respond(request);
    });
    this.channel.port1.start();
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('the database worker did not start')), 10_000);

      const onMessage = (event: MessageEvent) => {
        const message = event.data as ReadyMessage;
        if (message.kind !== 'ready') {
          return;
        }
        clearTimeout(timeout);
        this.worker.removeEventListener('message', onMessage);
        this.worker.removeEventListener('error', onError);
        resolve();
      };
      const onError = (event: ErrorEvent) => {
        clearTimeout(timeout);
        this.worker.removeEventListener('message', onMessage);
        this.worker.removeEventListener('error', onError);
        reject(new Error(event.message || 'the database worker failed'));
      };

      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onError);

      const message: ConnectMessage = { kind: 'connect', port: this.channel.port2 };
      this.worker.postMessage(message, [this.channel.port2]);
    });
  }

  private respond(request: PortRequest): void {
    const result = this.queue.then(
      () => this.run(request),
      () => this.run(request),
    );
    this.queue = result.then(() => undefined, () => undefined);
  }

  private async run(request: PortRequest): Promise<void> {
    try {
      const value = await this.call(request.method, request.args);
      const response: PortResponse = { kind: 'port-result', id: request.id, ok: true, value };
      this.channel.port1.postMessage(response);
    } catch (error) {
      const response: PortResponse = {
        kind: 'port-result',
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      this.channel.port1.postMessage(response);
    }
  }

  private call(method: PortRequest['method'], args: unknown[]): Promise<unknown> {
    switch (method) {
      case 'open':
        return this.driver.open();
      case 'exec':
        return this.driver.exec(args[0] as string);
      case 'run':
        return this.driver.run(args[0] as string, args[1] as readonly unknown[]);
      case 'all':
        return this.driver.all(args[0] as string, args[1] as readonly unknown[]);
      case 'get':
        return this.driver.get(args[0] as string, args[1] as readonly unknown[]);
      case 'close':
        return this.driver.close();
      default:
        return Promise.reject(new Error(`unknown database port method: ${String(method)}`));
    }
  }
}
