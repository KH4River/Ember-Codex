import type { DatabaseApi } from '@/api/DatabaseApi';

/** The worker owns shared/db; the main thread owns the Capacitor connection.
 *  These are the only two messages that cross each channel. */
export type PortMethod = 'open' | 'exec' | 'run' | 'all' | 'get' | 'close';

export interface ConnectMessage {
  kind: 'connect';
  port: MessagePort;
}

export interface ReadyMessage {
  kind: 'ready';
}

export interface ApiRequest {
  kind: 'api';
  id: number;
  method: keyof DatabaseApi;
  args: unknown[];
}

export type ApiResponse =
  | { kind: 'api-result'; id: number; ok: true; value: unknown }
  | { kind: 'api-result'; id: number; ok: false; error: string };

export interface PortRequest {
  kind: 'port';
  id: number;
  method: PortMethod;
  args: unknown[];
}

export type PortResponse =
  | { kind: 'port-result'; id: number; ok: true; value: unknown }
  | { kind: 'port-result'; id: number; ok: false; error: string };

export type MainToWorker = ConnectMessage | ApiRequest | PortResponse;
export type WorkerToMain = ReadyMessage | ApiResponse | PortRequest;
