/**
 * On-disk shape and location of the profile skill registry.
 *
 * @module dsh-skill-mgr/store/paths
 */

import type { DisabledSkill, TrashEntry } from '../wire.ts'
import type { SkillStatsCheckpoint } from './types.ts'

/** Wire shape persisted in `<profile>/.dsh/dshsk/skills.json`. */
export interface StoreFile {
  version: number
  /** Disabled skills only; a skill absent from this list is enabled. */
  skills: DisabledSkill[]
  /** Trashed skills (moved out of discovery; restorable). */
  trash?: TrashEntry[]
  /** Usage-statistics incremental-scan checkpoint. */
  skillStats?: SkillStatsCheckpoint
}

/**
 * Current registry schema version.
 *
 * Kept at 5 through the flat-surface refactor: the shape only *shrinks* (the
 * source, market and origin buckets are gone) and the migrator tolerates the
 * extra keys of an older file, so a v4/v5 install loads with its disabled
 * skills, trash and statistics intact. Bumping the number would be worse — an
 * older build reading a v6 file returns `null` and starts empty, i.e. a
 * downgrade would lose the disabled records.
 */
export const STORE_VERSION = 5

/**
 * Files an earlier install left behind, in priority order.
 *
 * `dsh-skill-hub.json` is the sidecar of the plugin this package was refactored
 * from; `dsh-skill-mgr.json` is this package's own earlier name for it.
 * Whichever exists is read once, on the first load that finds no registry at
 * the new path, so an upgrade keeps its disabled skills, trash and statistics
 * (the source/market buckets of an older file are read and dropped).
 */
export const LEGACY_STATE_FILES = ['dsh-skill-mgr.json', 'dsh-skill-hub.json'] as const