/// <reference lib="webworker" />

import { createDatabaseApi } from '@/api/createDatabaseApi';
import type { DatabasePort } from '@/db/DatabasePort';
import { openDatabase } from '@/db/openDatabase';
import type { ImportTextOptions } from '@/packs/importPackText';

import type { ApiRequest, ApiResponse, ConnectMessage } from './database.protocol';
import { RpcDatabasePort } from './database.port.rpc';

const worker = self as unknown as DedicatedWorkerGlobalScope;

let resolveRpc: ((port: MessagePort) => void) | undefined;
const rpcReady = new Promise<MessagePort>((resolve) => {
  resolveRpc = resolve;
});

let connection: Promise<DatabasePort> | undefined;
function port(): Promise<DatabasePort> {
  connection ??= rpcReady.then((rpc) => openDatabase(new RpcDatabasePort(rpc)));
  return connection;
}

const api = createDatabaseApi(port);
let queue: Promise<void> = Promise.resolve();

worker.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as ConnectMessage | ApiRequest;
  if (message.kind === 'connect') {
    resolveRpc?.(message.port);
    worker.postMessage({ kind: 'ready' });
    return;
  }
  queue = queue.then(
    () => handle(message),
    () => handle(message),
  );
});

async function handle(request: ApiRequest): Promise<void> {
  try {
    const value = await call(request);
    const response: ApiResponse = { kind: 'api-result', id: request.id, ok: true, value };
    worker.postMessage(response);
  } catch (error) {
    const response: ApiResponse = {
      kind: 'api-result',
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    worker.postMessage(response);
  }
}

function call(request: ApiRequest): Promise<unknown> {
  switch (request.method) {
    case 'listAbilities':
      return api.listAbilities();
    case 'listPacks':
      return api.listPacks();
    case 'importPack': {
      const [contents, options] = request.args as [string, ImportTextOptions | undefined];
      return api.importPack(contents, options);
    }
    case 'exportPack':
      return api.exportPack(request.args[0] as string);
    case 'removePack':
      return api.removePack(request.args[0] as string);
    case 'sqliteVersion':
      return api.sqliteVersion();
    default:
      return Promise.reject(new Error(`unknown database method: ${String(request.method)}`));
  }
}
