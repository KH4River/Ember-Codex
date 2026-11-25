import { Injectable, inject } from '@angular/core';

import type { Ability } from '@/models/Ability';
import { DatabaseService } from '@/shell/database.service';

/** The ability-score read for the creation wizard. The component never sees a
 *  port; this is the only place the list is fetched. */
@Injectable({ providedIn: 'root' })
export class AbilitiesService {
  private readonly database = inject(DatabaseService);

  list(): Promise<Ability[]> {
    return this.database.listAbilities();
  }
}
