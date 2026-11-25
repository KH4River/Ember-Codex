// Preload runs in the renderer's context. It exposes the typed operations the
// renderer needs and nothing else: no SQL, no port, no schema.
import { contextBridge, ipcRenderer } from 'electron';

import type { ElectronApi } from '../shared/api/ElectronApi';

const api: ElectronApi = {
  rendererReady: () => ipcRenderer.send('renderer-ready'),
  database: {
    listAbilities: () => ipcRenderer.invoke('database:list-abilities'),
    listPacks: () => ipcRenderer.invoke('database:list-packs'),
    importPack: (contents, options) =>
      ipcRenderer.invoke('database:import-pack', contents, options),
    exportPack: (slug) => ipcRenderer.invoke('database:export-pack', slug),
    removePack: (slug) => ipcRenderer.invoke('database:remove-pack', slug),
    sqliteVersion: () => ipcRenderer.invoke('database:sqlite-version'),
  },
  packFiles: {
    openPack: () => ipcRenderer.invoke('pack:open'),
    savePack: (contents, suggestedName) =>
      ipcRenderer.invoke('pack:save', contents, suggestedName),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
