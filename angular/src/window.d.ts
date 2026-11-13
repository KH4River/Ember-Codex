/**
 * The surface Electron's preload exposes. Every field is optional: the same
 * bundle also runs in a plain browser (ng serve) and inside a Capacitor WebView,
 * where there is no preload at all.
 */
interface ElectronDatabaseApi {
  version(): Promise<string>;
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  all(sql: string, params?: unknown[]): Promise<unknown[]>;
  get(sql: string, params?: unknown[]): Promise<unknown>;
}

interface ElectronFilesApi {
  openPack(): Promise<{ name: string; contents: string } | null>;
  savePack(contents: string, suggestedName: string): Promise<boolean>;
}

interface ElectronAPI {
  rendererReady?: () => void;
  db?: ElectronDatabaseApi;
  files?: ElectronFilesApi;
}

interface Window {
  electronAPI?: ElectronAPI;
}
