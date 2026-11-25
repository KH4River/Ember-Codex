import type { DatabaseApi } from './DatabaseApi';
import type { PackFilesApi } from './PackFilesApi';

/** The preload surface. `electron/preload.ts` and the renderer's `window`
 *  declaration both use it, so a drift on either side is a type error. */
export interface ElectronApi {
  rendererReady(): void;
  database: DatabaseApi;
  packFiles: PackFilesApi;
}
