/**
 * Registry schema migration and hydration.
 *
 * Every older shape this package (or the plugin it was refactored from) ever
 * wrote is normalized here, and then validated bucket by bucket: a corrupt
 * entry is dropped and a corrupt bucket degrades to empty, but one bad row can
 * never discard the whole registry.
 *
 * The manager is flat now — no upstream sources, no market, no origin or
 * collection grouping — so those buckets of an older file are read and
 * deliberately ignored (and disappear on the next write). What survives is the
 * disabled-skill list, the trash and the usage-statistics checkpoint.
 *
 * @module dsh-skill-mgr/store/migrate
 */

import type { DisabledSkill, TrashEntry } from '../wire.ts'
import { STORE_VERSION } from './paths.ts'
import type { SkillStatsCheckpoint } from './types.ts'

/** Normalized raw registry document after schema migration (fields still unvalidated). */
export interface MigratedStore {
  version: number
  skills: unknown
  trash?: unknown
  skillStats?: unknown
}

/**
 * Normalize an arbitrary parsed registry document to the current schema.
 *
 * - v1 → v2 (inherited): skills were not tracked individually yet; the
 *   `disabled` list is adopted as-is.
 * - v2 → v3 (inherited): market sources become records (`{repo, ref?,
 *   commitSha?}`) instead of bare repo slugs.
 * - v4 → v5 (inherited): the `disabled` bucket becomes `skills` and the
 *   profile registry moves to `<profile>/.dsh/dshsk/skills.json`.
 * - v5 → flat (this refactor): `sources`, `marketSources`, `marketStats`,
 *   `origins`, `tags`, `collectionOrder` and `sourceGroupOrder` are accepted
 *   from an older file and dropped. Their content has no representation in the
 *   flat surface, and re-writing them would resurrect the removed features.
 *
 * A file claiming a newer schema than this plugin understands returns `null`,
 * so the caller starts empty instead of risking data loss.
 * @param parsed - the parsed JSON document.
 * @returns the normalized document, or null when it is unreadable.
 */
export function migrateStore(parsed: unknown): MigratedStore | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const version = typeof record.version === 'number' ? record.version : 0
  if (version > STORE_VERSION) return null

  const skills = Array.isArray(record.skills) ? record.skills : Array.isArray(record.disabled) ? record.disabled : []
  const trash = Array.isArray(record.trash) ? record.trash : undefined

  return {
    version: STORE_VERSION,
    skills,
    ...(trash !== undefined ? { trash } : {}),
    // Pure additions: older files simply lack the field, and the hydration
    // pass below validates its shape.
    ...(record.skillStats !== undefined ? { skillStats: record.skillStats } : {}),
  }
}

/** Validated in-memory state hydrated from a migrated document. */
export interface HydratedState {
  entries: Map<string, DisabledSkill>
  trashByName: Map<string, TrashEntry>
  skillStats: SkillStatsCheckpoint | undefined
}

/**
 * Validate one per-skill count map, dropping entries that are not numbers.
 * @param counts - raw bucket.
 * @returns the cleaned map.
 */
function cleanCounts(counts: unknown): Record<string, { count: number; lastUsed: number }> {
  const clean: Record<string, { count: number; lastUsed: number }> = {}
  if (counts === null || typeof counts !== 'object') return clean
  for (const [name, stat] of Object.entries(counts as Record<string, unknown>)) {
    if (stat !== null && typeof stat === 'object'
      && typeof (stat as { count?: unknown }).count === 'number'
      && typeof (stat as { lastUsed?: unknown }).lastUsed === 'number') {
      clean[name] = { count: (stat as { count: number }).count, lastUsed: (stat as { lastUsed: number }).lastUsed }
    }
  }
  return clean
}

/**
 * Validate the cold-path revision bucket: a corrupt entry degrades to a
 * re-read (its revision simply misses), never to bad counts.
 * @param raw - raw bucket.
 * @returns the cleaned bucket.
 */
function cleanColdRevisions(raw: unknown): { coldRevisions?: SkillStatsCheckpoint['coldRevisions'] } {
  if (raw === null || typeof raw !== 'object') return {}
  const revisions: NonNullable<SkillStatsCheckpoint['coldRevisions']> = {}
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry === null || typeof entry !== 'object') continue
    const { rev, createdAt, counts } = entry as { rev?: unknown; createdAt?: unknown; counts?: unknown }
    if (typeof rev !== 'string' || typeof createdAt !== 'number') continue
    revisions[id] = { rev, createdAt, counts: cleanCounts(counts) }
  }
  return { coldRevisions: revisions }
}

/**
 * Turn a migrated document into validated in-memory state.
 * @param migrated - the normalized document.
 * @returns the hydrated buckets.
 */
export function hydrateMigratedState(migrated: MigratedStore): HydratedState {
  const entries = new Map<string, DisabledSkill>()
  if (Array.isArray(migrated.skills)) {
    for (const entry of migrated.skills as DisabledSkill[]) {
      if (typeof entry?.name === 'string' && typeof entry?.path === 'string') entries.set(entry.name, entry)
    }
  }

  const trashByName = new Map<string, TrashEntry>()
  if (Array.isArray(migrated.trash)) {
    for (const entry of migrated.trash as unknown[]) {
      const item = entry as { name?: unknown; path?: unknown; movedAt?: unknown; sourcePath?: unknown } | null
      if (item !== null && typeof item === 'object' && typeof item.name === 'string' && typeof item.path === 'string') {
        // A legacy `origin` (upstream source snapshot) is dropped: restoring no
        // longer re-attaches a source record, so there is nothing to keep.
        trashByName.set(item.name, {
          name: item.name,
          path: item.path,
          movedAt: typeof item.movedAt === 'number' ? item.movedAt : 0,
          ...(typeof item.sourcePath === 'string' && item.sourcePath !== '' ? { sourcePath: item.sourcePath } : {}),
        })
      }
    }
  }

  let skillStats: SkillStatsCheckpoint | undefined
  const savedStats = migrated.skillStats as Partial<SkillStatsCheckpoint> | null | undefined
  if (savedStats !== null && savedStats !== undefined && typeof savedStats === 'object'
    && typeof savedStats.frozenBefore === 'number' && typeof savedStats.lastFullReconcile === 'number'
    && typeof savedStats.windowDays === 'number'
    && typeof savedStats.frozenSessions === 'object' && savedStats.frozenSessions !== null) {
    // Validate entry shapes too: a corrupt bucket degrades to a fresh
    // checkpoint (one extra full reconciliation), never to bad counts.
    const sessions: SkillStatsCheckpoint['frozenSessions'] = {}
    for (const [id, entry] of Object.entries(savedStats.frozenSessions)) {
      if (entry === null || typeof entry !== 'object' || typeof entry.createdAt !== 'number') continue
      sessions[id] = { createdAt: entry.createdAt, counts: cleanCounts(entry.counts) }
    }
    const rawTotals = (savedStats as { lastTotals?: unknown }).lastTotals
    const lastTotals = Array.isArray(rawTotals)
      ? rawTotals
          .filter((entry): entry is { name: string; count: number; lastUsed?: number } =>
            entry !== null && typeof entry === 'object'
            && typeof (entry as { name?: unknown }).name === 'string'
            && typeof (entry as { count?: unknown }).count === 'number')
          .map((entry) => ({
            name: entry.name,
            count: entry.count,
            ...(typeof entry.lastUsed === 'number' ? { lastUsed: entry.lastUsed } : {}),
          }))
      : undefined
    skillStats = {
      windowDays: savedStats.windowDays,
      frozenBefore: savedStats.frozenBefore,
      frozenSessions: sessions,
      lastFullReconcile: savedStats.lastFullReconcile,
      ...(lastTotals !== undefined ? { lastTotals } : {}),
      ...cleanColdRevisions((savedStats as { coldRevisions?: unknown }).coldRevisions),
    }
  }

  return { entries, trashByName, skillStats }
}