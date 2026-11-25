import type { ElectronApi } from '@/api/ElectronApi';

/**
 * The surface Electron's preload exposes. It is optional: the same bundle also
 * runs in a plain browser (ng serve) and inside a Capacitor WebView, where
 * there is no preload at all.
 */
declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}
