import type { PortRequest, PortResponse } from './database.protocol';
import { RpcDatabasePort } from './database.port.rpc';

class FakePort {
  private listener?: (event: MessageEvent<PortResponse>) => void;
  readonly sent: PortRequest[] = [];

  addEventListener(_type: string, listener: (event: MessageEvent<PortResponse>) => void): void {
    this.listener = listener;
  }

  start(): void {}

  postMessage(message: PortRequest): void {
    this.sent.push(message);
  }

  respond(response: PortResponse): void {
    this.listener?.({ data: response } as MessageEvent<PortResponse>);
  }
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve));
};

describe('RpcDatabasePort', () => {
  it('correlates a response with its request', async () => {
    const port = new FakePort();
    const rpc = new RpcDatabasePort(port as unknown as MessagePort);

    const pending = rpc.all<{ n: number }>('SELECT 1', []);
    await flush();
    expect(port.sent[0]).toEqual({ kind: 'port', id: 1, method: 'all', args: ['SELECT 1', []] });

    port.respond({ kind: 'port-result', id: 1, ok: true, value: [{ n: 1 }] });
    await expect(pending).resolves.toEqual([{ n: 1 }]);
  });

  it('rejects with the transport message', async () => {
    const port = new FakePort();
    const rpc = new RpcDatabasePort(port as unknown as MessagePort);

    const pending = rpc.exec('BEGIN');
    await flush();
    port.respond({ kind: 'port-result', id: 1, ok: false, error: 'no connection' });

    await expect(pending).rejects.toThrow('no connection');
  });

  it('serializes calls so an import cannot interleave', async () => {
    const port = new FakePort();
    const rpc = new RpcDatabasePort(port as unknown as MessagePort);

    const first = rpc.run('INSERT INTO t VALUES (?)', [1]);
    const second = rpc.run('INSERT INTO t VALUES (?)', [2]);
    await flush();
    expect(port.sent).toHaveLength(1);

    port.respond({ kind: 'port-result', id: 1, ok: true, value: undefined });
    await first;
    await flush();
    expect(port.sent).toHaveLength(2);

    port.respond({ kind: 'port-result', id: 2, ok: true, value: undefined });
    await second;
  });
});
