import { TestBed } from '@angular/core/testing';

import { AbilitiesService } from '@/data/abilities.service';

import { CharacterCreatorAbilities } from './character-creator-abilities';

describe('CharacterCreatorAbilities', () => {
  it('renders the abilities the database returns', async () => {
    await TestBed.configureTestingModule({
      imports: [CharacterCreatorAbilities],
      providers: [
        {
          provide: AbilitiesService,
          useValue: {
            list: async () => [
              { id: 1, code: 'STR', name: 'Strength' },
              { id: 2, code: 'DEX', name: 'Dexterity' },
            ],
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CharacterCreatorAbilities);
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Strength');
    expect(text).toContain('DEX');
  });

  it('reports a database failure instead of rendering an empty list', async () => {
    await TestBed.configureTestingModule({
      imports: [CharacterCreatorAbilities],
      providers: [
        {
          provide: AbilitiesService,
          useValue: { list: async () => Promise.reject(new Error('no connection')) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CharacterCreatorAbilities);
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('no connection');
  });
});
