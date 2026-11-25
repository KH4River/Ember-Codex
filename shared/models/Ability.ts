import type { AbilityCode } from './ContentPack';

/** One of the six ability scores. Closed vocabulary, seeded by the migration. */
export interface Ability {
  id: number;
  code: AbilityCode;
  name: string;
}
