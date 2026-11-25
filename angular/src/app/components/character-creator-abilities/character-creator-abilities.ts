import { Component, inject, signal } from '@angular/core';

import { AbilitiesService } from '@/data/abilities.service';
import type { Ability } from '@/models/Ability';

/**
 * Reads the six seeded abilities through the ability controller, on whichever
 * platform the app is running. It is also the seed of the ability-score step.
 */
@Component({
  selector: 'app-character-creator-abilities',
  templateUrl: './character-creator-abilities.html',
  styleUrl: './character-creator-abilities.scss',
})
export class CharacterCreatorAbilities {
  private readonly abilitiesService = inject(AbilitiesService);

  readonly abilities = signal<Ability[]>([]);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.abilities.set(await this.abilitiesService.list());
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : 'Database unavailable');
    }
  }
}
