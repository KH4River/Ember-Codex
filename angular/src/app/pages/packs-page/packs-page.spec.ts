import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { PackSummary } from '@/db/repositories/sources';
import type { PackFile } from '@/models/ContentPack';
import { PackImportError } from '@/packs/importPack';
import { PacksService } from '@/packs/packs.service';
import { PackValidationError } from '@/packs/validatePack';

import { PacksPage } from './packs-page';

/** The page is a thin view over PacksService: every case here is one outcome
 *  the service can return, rendered. */
describe('PacksPage', () => {
  const packsService = {
    list: vi.fn(),
    import: vi.fn(),
    importPicked: vi.fn(),
    export: vi.fn(),
    remove: vi.fn(),
  };

  const homebrew: PackSummary = {
    slug: 'my-homebrew',
    name: 'My Homebrew',
    version: '1.0.0',
    importedAt: '2026-11-10T18:00:00Z',
    supersededBy: null,
  };

  const aPack: PackFile = {
    format: 'ember-codex.pack',
    formatVersion: 1,
    source: {
      key: 'my-homebrew',
      name: 'My Homebrew',
      version: '1.0.0',
      license: null,
      attribution: null,
    },
  };

  const importedOutcome = () => ({
    status: 'imported',
    file: aPack,
    result: { sourceId: 1, sourceSlug: 'my-homebrew' },
  });

  const needsMode = () => ({
    status: 'needs-mode',
    contents: '{"pack":true}',
    file: aPack,
    installed: homebrew,
  });

  const open = async (): Promise<ComponentFixture<PacksPage>> => {
    const fixture = TestBed.createComponent(PacksPage);
    await fixture.whenStable();
    return fixture;
  };

  const text = (fixture: ComponentFixture<PacksPage>): string =>
    (fixture.nativeElement as HTMLElement).textContent ?? '';

  const buttons = (fixture: ComponentFixture<PacksPage>, label: string): HTMLButtonElement[] => {
    const all = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ) as HTMLButtonElement[];
    return all.filter((button) => (button.textContent ?? '').trim() === label);
  };

  const click = async (fixture: ComponentFixture<PacksPage>, label: string): Promise<void> => {
    const [button] = buttons(fixture, label);
    if (button === undefined) {
      throw new Error(`no button labelled "${label}"`);
    }
    button.click();
    await fixture.whenStable();
  };

  const openModePanel = async (): Promise<ComponentFixture<PacksPage>> => {
    packsService.importPicked.mockResolvedValue(needsMode());
    const fixture = await open();
    await click(fixture, 'Import pack');
    return fixture;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    packsService.list.mockResolvedValue([]);

    await TestBed.configureTestingModule({
      imports: [PacksPage],
      providers: [{ provide: PacksService, useValue: packsService }],
    }).compileComponents();
  });

  it('renders the packs the service lists', async () => {
    packsService.list.mockResolvedValue([homebrew]);

    const fixture = await open();

    expect(text(fixture)).toContain('My Homebrew');
    expect(text(fixture)).toContain('my-homebrew');
  });

  it('imports the picked file and reloads the list', async () => {
    packsService.importPicked.mockResolvedValue(importedOutcome());
    packsService.list.mockResolvedValueOnce([]).mockResolvedValue([homebrew]);

    const fixture = await open();
    await click(fixture, 'Import pack');

    expect(text(fixture)).toContain('Imported "My Homebrew".');
    expect(packsService.list).toHaveBeenCalledTimes(2);
  });

  it('asks about an installed pack before writing anything', async () => {
    const fixture = await openModePanel();

    const input = (fixture.nativeElement as HTMLElement).querySelector('input');
    expect(text(fixture)).toContain('"My Homebrew" (my-homebrew) is already installed.');
    expect(input?.placeholder).toBe('my-homebrew-v2');
    expect(packsService.list).toHaveBeenCalledTimes(1);
  });

  it('replaces the installed pack with the same text', async () => {
    packsService.import.mockResolvedValue(importedOutcome());
    const fixture = await openModePanel();

    await click(fixture, 'Replace my-homebrew');

    expect(packsService.import).toHaveBeenCalledWith('{"pack":true}', { mode: 'replace' });
  });

  it('keeps both under the key the user types', async () => {
    packsService.import.mockResolvedValue(importedOutcome());
    const fixture = await openModePanel();

    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    input.value = 'my-homebrew-v2';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    await click(fixture, 'Keep both');

    expect(packsService.import).toHaveBeenCalledWith('{"pack":true}', {
      mode: 'keep-both',
      newSlug: 'my-homebrew-v2',
    });
  });

  it('blocks keep-both while the key is empty', async () => {
    const fixture = await openModePanel();

    await click(fixture, 'Keep both');

    expect(packsService.import).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('enter a new key');
  });

  it('renders every validation problem', async () => {
    packsService.importPicked.mockRejectedValue(
      new PackValidationError(['problem one', 'problem two']),
    );

    const fixture = await open();
    await click(fixture, 'Import pack');

    expect(text(fixture)).toContain('problem one');
    expect(text(fixture)).toContain('problem two');
  });

  it('renders every import blocker', async () => {
    packsService.importPicked.mockRejectedValue(
      new PackImportError(['blocker one', 'blocker two']),
    );

    const fixture = await open();
    await click(fixture, 'Import pack');

    expect(text(fixture)).toContain('blocker one');
    expect(text(fixture)).toContain('blocker two');
  });

  it('reports a written export', async () => {
    packsService.list.mockResolvedValue([homebrew]);
    packsService.export.mockResolvedValue(true);

    const fixture = await open();
    await click(fixture, 'Export');

    expect(packsService.export).toHaveBeenCalledWith('my-homebrew');
    expect(text(fixture)).toContain('Exported "my-homebrew".');
  });

  it('renders removal blockers and keeps the row', async () => {
    packsService.list.mockResolvedValue([homebrew]);
    packsService.remove.mockResolvedValue({
      removed: false,
      blockers: ['cannot remove pack "my-homebrew": item "x" is used by character "Thia"'],
    });

    const fixture = await open();
    await click(fixture, 'Remove');
    expect(text(fixture)).toContain('Remove my-homebrew?');

    const [, confirm] = buttons(fixture, 'Remove');
    confirm.click();
    await fixture.whenStable();

    expect(text(fixture)).toContain('is used by character');
    expect(packsService.list).toHaveBeenCalledTimes(1);
  });

  it('reloads after a clean removal', async () => {
    packsService.list.mockResolvedValue([homebrew]);
    packsService.remove.mockResolvedValue({ removed: true });

    const fixture = await open();
    await click(fixture, 'Remove');
    const [, confirm] = buttons(fixture, 'Remove');
    confirm.click();
    await fixture.whenStable();

    expect(text(fixture)).toContain('Removed "my-homebrew".');
    expect(packsService.list).toHaveBeenCalledTimes(2);
  });

  it('reports a platform with no file channel', async () => {
    packsService.importPicked.mockRejectedValue(
      new Error('opening and saving pack files needs the desktop or mobile app'),
    );

    const fixture = await open();
    await click(fixture, 'Import pack');

    expect(text(fixture)).toContain('needs the desktop or mobile app');
    expect(packsService.list).toHaveBeenCalledTimes(1);
  });
});
