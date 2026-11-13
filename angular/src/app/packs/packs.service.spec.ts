import { TestBed } from '@angular/core/testing';

import { DatabaseService } from '@/data/database.service';
import { PackFilesService } from '@/data/pack-files.service';
import { MIGRATIONS } from '@/db/migrations.generated';
import { runMigrations } from '@/db/migrate';
import type { PackFile } from '@/models/ContentPack';
import { NodeSqlitePort } from '@/testing/node-sqlite.port';

import { PacksService, safeFileName } from './packs.service';

/** The feature service forwards to the shared functions and the file seam. The
 *  page depends on this and nothing else. */
describe('PacksService', () => {
  let port: NodeSqlitePort;
  let service: PacksService;

  const files = {
    openPack: vi.fn(),
    savePack: vi.fn(),
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

  beforeEach(async () => {
    port = new NodeSqlitePort();
    await port.open();
    await runMigrations(port, MIGRATIONS);
    files.openPack.mockReset();
    files.savePack.mockReset();

    await TestBed.configureTestingModule({
      providers: [
        PacksService,
        { provide: DatabaseService, useValue: { port: async () => port } },
        { provide: PackFilesService, useValue: files },
      ],
    }).compileComponents();

    service = TestBed.inject(PacksService);
  });

  afterEach(async () => {
    await port.close();
  });

  it('imports text and lists the pack it wrote', async () => {
    expect((await service.import(JSON.stringify(aPack()))).status).toBe('imported');

    expect(await service.list()).toEqual([
      {
        slug: 'my-homebrew',
        name: 'My Homebrew',
        version: '1.0.0',
        importedAt: expect.any(String),
        supersededBy: null,
      },
    ]);
  });

  it('forwards the picked text, and a cancelled picker is null', async () => {
    files.openPack.mockResolvedValueOnce({ name: 'homebrew.json', contents: JSON.stringify(aPack()) });
    expect((await service.importPicked())?.status).toBe('imported');

    files.openPack.mockResolvedValueOnce(null);
    expect(await service.importPicked()).toBeNull();
  });

  it('exports through the file seam under the pack key', async () => {
    await service.import(JSON.stringify(aPack()));
    files.savePack.mockResolvedValueOnce(true);

    expect(await service.export('my-homebrew')).toBe(true);
    expect(files.savePack).toHaveBeenCalledWith(
      expect.stringContaining('ember-codex.pack'),
      'my-homebrew.json',
    );
  });

  it('forwards removal and returns its outcome', async () => {
    await service.import(JSON.stringify(aPack()));

    expect(await service.remove('my-homebrew')).toEqual({ removed: true });
  });

  it('keeps a slug usable as a file name', () => {
    expect(safeFileName('a/b c')).toBe('a_b_c.json');
  });
});
