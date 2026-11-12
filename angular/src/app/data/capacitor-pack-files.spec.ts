import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugins = vi.hoisted(() => ({
  pickFiles: vi.fn(),
  writeFile: vi.fn(),
  getUri: vi.fn(),
  canShare: vi.fn(),
  share: vi.fn(),
}));

vi.mock('@capawesome/capacitor-file-picker', () => ({
  FilePicker: { pickFiles: plugins.pickFiles },
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: plugins.writeFile, getUri: plugins.getUri },
}));

vi.mock('@capacitor/share', () => ({
  Share: { canShare: plugins.canShare, share: plugins.share },
}));

import { CapacitorPackFilesDriver } from './capacitor-pack-files.driver';

/** The mobile driver against the three plugins' documented shapes. The device
 *  check in unit 11 is what confirms the webPath scheme in practice. */
describe('CapacitorPackFilesDriver', () => {
  let driver: CapacitorPackFilesDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new CapacitorPackFilesDriver();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads a picked file by fetching its web path', async () => {
    plugins.pickFiles.mockResolvedValue({
      files: [
        {
          name: 'homebrew.json',
          mimeType: 'application/json',
          size: 24,
          webPath: 'blob:pack',
        },
      ],
    });
    const fetch = vi.fn(async () => ({ text: async () => '{"format":"ember-codex.pack"}' }));
    vi.stubGlobal('fetch', fetch);

    expect(await driver.openPack()).toEqual({
      name: 'homebrew.json',
      contents: '{"format":"ember-codex.pack"}',
    });
    expect(fetch).toHaveBeenCalledWith('blob:pack');
  });

  it('returns null when the picker is dismissed', async () => {
    plugins.pickFiles.mockResolvedValue({ files: [] });

    expect(await driver.openPack()).toBeNull();
  });

  it('writes UTF-8 into the cache and shares the file uri', async () => {
    plugins.canShare.mockResolvedValue({ value: true });
    plugins.writeFile.mockResolvedValue({ uri: 'file:///cache/homebrew.json' });
    plugins.getUri.mockResolvedValue({ uri: 'file:///cache/homebrew.json' });
    plugins.share.mockResolvedValue({ activityType: '' });

    expect(await driver.savePack('{}', 'homebrew.json')).toBe(true);
    expect(plugins.writeFile).toHaveBeenCalledWith({
      path: 'homebrew.json',
      data: '{}',
      directory: 'CACHE',
      encoding: 'utf8',
    });
    expect(plugins.share).toHaveBeenCalledWith({
      title: 'homebrew.json',
      url: 'file:///cache/homebrew.json',
    });
  });

  it('does not write or share when the platform cannot share', async () => {
    plugins.canShare.mockResolvedValue({ value: false });

    expect(await driver.savePack('{}', 'homebrew.json')).toBe(false);
    expect(plugins.writeFile).not.toHaveBeenCalled();
    expect(plugins.share).not.toHaveBeenCalled();
  });
});
