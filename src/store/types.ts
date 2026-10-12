/**
 * Host-side persisted state shapes that never cross the Remote.
 *
 * Anything a management call can return lives in `wire.ts` instead; these are
 * the registry's internal buckets.
 *
 * @module dsh-skill-mgr/store/types
 */

/** Per-skill invocation counts inside one cached session. */
export interface SessionCounts {
  /** Skill name → how many times it was invoked, and when it last was. */
  [skill: string]: { count: number; lastUsed: number }
}

/** One cold-path cache entry: what a session's log contained at a revision. */
export interface ColdRevisionEntry {
  /** The persistence seam's opaque revision token, stringified. */
  rev: string
  /** `header.createdAt` at read time (0 when the header carried none). */
  createdAt: number
  /** Per-skill counts (empty when the session invoked no skill). */
  counts: SessionCounts
}

/**
 * The persisted incremental-scan checkpoint for usage statistics. Two buckets
 * cover the two read paths:
 *
 * - `coldRevisions` (preferred): per-session counts keyed by the persistence
 *   seam's opaque revision token. A session is re-read only when its revision
 *   changes, so resumed old sessions are picked up exactly and a daily full
 *   reconciliation is unnecessary on this path.
 * - `frozenSessions` + `frozenBefore` + `lastFullReconcile` (fallback): the
 *   legacy time-watermark scheme used when only the heavier `sessionQuery`
 *   seam is available. Sessions older than the effective watermark are treated
 *   as finalized and are not re-read on incremental scans; a daily full
 *   reconciliation rebuilds the cache and advances the watermark.
 */
export interface SkillStatsCheckpoint {
  /** The rolling-window configuration this checkpoint was built for (0 = all history). */
  windowDays: number
  /** Watermark: every session with `header.createdAt` below this is frozen. */
  frozenBefore: number
  /** Per-session counts of finalized sessions, keyed by session id. */
  frozenSessions: Record<string, { createdAt: number; counts: SessionCounts }>
  /** Epoch ms of the last full reconciliation (drives the daily cadence). */
  lastFullReconcile: number
  /** Totals from the last completed scan, served instantly on cold start. */
  lastTotals?: Array<{ name: string; count: number; lastUsed?: number }>
  /** Per-session counts read through the persistence seam, keyed by session id. */
  coldRevisions?: Record<string, ColdRevisionEntry>
}