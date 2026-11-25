import { TestBed } from '@angular/core/testing';

import type { PackImportResult } from '@/api/DatabaseApi';
import type { PackFile } from '@/models/ContentPack';
import type { PackSummary } from '@/models/PackSummary';
import { DatabaseService } from '@/shell/database.service';
import { PackFilesService } from '@/shell/pack-files.service';

import { PacksService, safeFileName } from './packs.service';

/** The feature service forwards to the typed database client and the file
 *  seam. The page depends on this and nothing else. */
describe('PacksService', () => {
  const database = {
    listPacks: vi.fn(),
    importPack: vi.fn(),
    exportPack: vi.fn(),
    removePack: vi.fn(),
  };
  const files = {
    openPack: vi.fn(),
    savePack: vi.fn(),
  };
  let service: PacksService;

  const homebrew: PackSummary = {
    slug: 'my-homebrew',
    name: 'My Homebrew',
    version: '1.0.0',
    importedAt: '2026-11-10T18:00:00Z',
    supersededBy: null,
  };

  const aPack = (): PackFile => ({
    format: 'ember-codex.pack',
    formatVersion: 1,
    source: {
      key: 'my-homebrew',
      name: 'My Homebrew',
      version: '1.0.0',
      license: null,
      attribution: null,
    },
    skills: [{ key: 'skyriding', name: 'Skyriding', ability: 'DEX' }],
  });

  const imported: PackImportResult = {
    status: 'ok',
    outcome: {
      status: 'imported',
      file: aPack(),
      result: { sourceId: 1, sourceSlug: 'my-homebrew' },
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      providers: [
        PacksService,
        { provide: DatabaseService, useValue: database },
        { provide: PackFilesService, useValue: files },
      ],
    }).compileComponents();
    service = TestBed.inject(PacksService);
  });

  it('lists through the typed client', async () => {
    database.listPacks.mockResolvedValue([homebrew]);

    expect(await service.list()).toEqual([homebrew]);
  });

  it('forwards import text and options', async () => {
    database.importPack.mockResolvedValue(imported);

    expect(await service.import('{"pack":true}', { mode: 'replace' })).toBe(imported);
    expect(database.importPack).toHaveBeenCalledWith('{"pack":true}', { mode: 'replace' });
  });

  it('forwards the picked text, and a cancelled picker is null', async () => {
    files.openPack.mockResolvedValueOnce({ name: 'homebrew.json', contents: '{"pack":true}' });
    database.importPack.mockResolvedValue(imported);
    expect(await service.importPicked()).toEqual(imported);

    files.openPack.mockResolvedValueOnce(null);
    expect(await service.importPicked()).toBeNull();
  });

  it('exports through the file seam under the pack key', async () => {
    database.exportPack.mockResolvedValue('{"pack":true}');
    files.savePack.mockResolvedValueOnce(true);

    expect(await service.export('my-homebrew')).toBe(true);
    expect(files.savePack).toHaveBeenCalledWith('{"pack":true}', 'my-homebrew.json');
  });

  it('forwards removal and returns its outcome', async () => {
    database.removePack.mockResolvedValue({ removed: true });

    expect(await service.remove('my-homebrew')).toEqual({ removed: true });
  });

  it('keeps a slug usable as a file name', () => {
    expect(safeFileName('a/b c')).toBe('a_b_c.json');
  });
});
