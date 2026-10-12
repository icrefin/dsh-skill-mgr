/**
 * Pure list helpers for the skill-mgr panel (no React/DOM deps, so the
 * filter/sort logic stays unit-testable).
 *
 * The grouped view is gone with the market and the upstream source tracking,
 * so nothing here derives groups any more: the Skills tab renders one flat
 * table and only needs the catalog ordering plus the relative-time buckets the
 * rows and the trash section print.
 */

import type { CatalogSkill } from '../wire.ts'

/** Catalog sort keys offered by the filter bar. */
export type SortKey = 'name' | 'added' | 'uses'

/**
 * Sort a skill list in place-safe copy order: name ascending, added
 * descending (newest first, unknown addedAt last), or uses descending
 * (most-called first). Unknown values always trail.
 */
export function sortSkills(skills: readonly CatalogSkill[], key: SortKey, getUses?: (name: string) => number | undefined): CatalogSkill[] {
  const list = [...skills]
  if (key === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name))
  } else if (key === 'added') {
    list.sort((a, b) => (b.addedAt ?? -Infinity) - (a.addedAt ?? -Infinity))
  } else if (key === 'uses') {
    list.sort((a, b) => (getUses?.(b.name) ?? 0) - (getUses?.(a.name) ?? 0))
  }
  return list
}

/** Localized relative-time tuple; the caller resolves it via tt(). */
export interface RelativeTime {
  key: 'time.justNow' | 'time.minutesAgo' | 'time.hoursAgo' | 'time.daysAgo' | 'time.weeksAgo'
  value?: number
}

/** Format an epoch-ms timestamp as a short relative time bucket. */
export function formatRelativeTime(ms: number, now = Date.now()): RelativeTime {
  const diff = Math.max(0, now - ms)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return { key: 'time.justNow' }
  if (minutes < 60) return { key: 'time.minutesAgo', value: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { key: 'time.hoursAgo', value: hours }
  const days = Math.floor(hours / 24)
  if (days < 7) return { key: 'time.daysAgo', value: days }
  return { key: 'time.weeksAgo', value: Math.floor(days / 7) }
}