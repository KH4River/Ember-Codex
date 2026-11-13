import { PackFilesService } from './pack-files.service';

describe('pack file seam', () => {
  afterEach(() => {
    delete window.electronAPI;
  });

  it('picks the Electron driver when the preload exposes files', async () => {
    const openPack = vi.fn(async () => ({ name: 'homebrew.json', contents: '{}' }));
    const savePack = vi.fn(async () => true);
    window.electronAPI = { files: { openPack, savePack } };

    expect(await new PackFilesService().openPack()).toEqual({
      name: 'homebrew.json',
      contents: '{}',
    });
    expect(openPack).toHaveBeenCalled();
  });
});
