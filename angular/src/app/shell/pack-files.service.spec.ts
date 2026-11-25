import type { DatabaseApi } from '@/api/DatabaseApi';
import type { ElectronApi } from '@/api/ElectronApi';

import { PackFilesService } from './pack-files.service';

const database: DatabaseApi = {
  listAbilities: async () => [],
  listPacks: async () => [],
  importPack: async () => ({ status: 'blocked', blockers: [] }),
  exportPack: async () => '',
  removePack: async () => ({ removed: true }),
  sqliteVersion: async () => '3.0.0',
};

describe('pack file seam', () => {
  afterEach(() => {
    delete window.electronAPI;
  });

  it('picks the Electron channel when the preload exposes pack files', async () => {
    const openPack = vi.fn(async () => ({ name: 'homebrew.json', contents: '{}' }));
    const savePack = vi.fn(async () => true);
    const api: ElectronApi = {
      rendererReady: () => undefined,
      database,
      packFiles: { openPack, savePack },
    };
    window.electronAPI = api;

    expect(await new PackFilesService().openPack()).toEqual({
      name: 'homebrew.json',
      contents: '{}',
    });
    expect(openPack).toHaveBeenCalled();
  });
});
