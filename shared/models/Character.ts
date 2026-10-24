/**
 * Shared character models.
 *
 * Ruleset: 2024 Player's Handbook ONLY (labelled "5.5e" on D&D Beyond since
 * March 2026). There is deliberately no `ruleYear` field — the app supports
 * one ruleset, so the value would always be constant. If the app ever
 * supports a second ruleset, that is a `002` migration plus a version
 * discriminator, not a field bolted on here.
 *
 * These types mirror shared/db/migrations/001_initial.sql. If you change one,
 * change the other.
 */

export interface CharacterBaseData {
  name: string;
  imgSrc: string;
  imgAltText: string;
}

export interface CharacterCreationRules {
  /**
   * Milestone levelling predates XP tables; both exist in 2024, and a
   * character is one or the other, never both. Stored as
   * player_character.experience_points: NULL means 'milestone', a number
   * means 'xp' (default 0). There is no leveling_type column.
   */
  levelingType: 'xp' | 'milestone';

  /**
   * 2024 has no averaging. Hit points are fixed from the species die plus
   * CON, or you may roll per level after 1st.
   */
  hpType: 'fixed' | 'rolled';

  /**
   * Only meaningful when hpType is 'rolled'. 2024 fixes 1st-level HP, so
   * this is the first level that can actually vary.
   */
  hpRollL1?: number;

  /** Whether multiclass ability-score and proficiency prerequisites are enforced. */
  obeyMulticlassRequirements: boolean;
}

export interface Character {
  baseData: CharacterBaseData;
  creationRules: CharacterCreationRules;
}