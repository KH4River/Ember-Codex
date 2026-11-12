// Preload runs in the renderer's context. It exposes exactly the database
// primitives and pack file channels the renderer needs and nothing else.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  rendererReady: () => ipcRenderer.send('renderer-ready'),
  db: {
    version: () => ipcRenderer.invoke('db:version'),
    exec: (sql: string) => ipcRenderer.invoke('db:exec', sql),
    run: (sql: string, params: unknown[]) => ipcRenderer.invoke('db:run', sql, params),
    all: (sql: string, params: unknown[]) => ipcRenderer.invoke('db:all', sql, params),
    get: (sql: string, params: unknown[]) => ipcRenderer.invoke('db:get', sql, params),
  },
  files: {
    openPack: () => ipcRenderer.invoke('pack:open'),
    savePack: (contents: string, suggestedName: string) =>
      ipcRenderer.invoke('pack:save', contents, suggestedName),
  },
});
