/**
 * Shared display helpers for the panel views (the skills table, the workspace
 * boxes and the dialogs): dot color styling, relative/absolute time text and
 * the short path form used by the workspace chips.
 *
 * The invocation-status dot defaults live here (not in the settings card) so
 * both the panel legend and the chat `/` skill menu draw from one source and
 * so this primitives-free module stays unit-testable.
 */

import type { CSSProperties } from 'react'
import { formatRelativeTime } from '../grouping.ts'
import { tt } from '../helpers.ts'

/** Model-invocable dot color default — the settings card's color-picker swatch
 *  (user-chosen colors are applied inline; an unchosen row falls back to the
 *  panel CSS, which resolves the theme's business token). */
export const DEFAULT_DOT_MODEL_COLOR = '#2f81f7'
/** User-invocable dot color default — the settings card's color-picker swatch. */
export const DEFAULT_DOT_USER_COLOR = '#3fb950'

/** Dot inline style from the user-chosen color (undefined keeps the CSS default). */
export function dotStyle(color: string | undefined): CSSProperties | undefined {
  if (color === undefined) return undefined
  return { background: color, borderColor: color }
}

/**
 * The selection one workspace checkbox writes.
 *
 * An empty stored selection means "every profile skill" (the state a workspace
 * that never chose is in), so unchecking a row under that state has to write
 * the *explicit* remainder — writing `[]` back would mean "all" again. The
 * result never carries duplicates.
 * @param profileNames - every profile skill name, in catalog order.
 * @param use - the workspace's stored selection (empty = all).
 * @param name - the skill whose checkbox changed.
 * @param checked - the checkbox's new value.
 * @returns the complete selection to persist.
 */
/** Localized relative-time text for a Unix-ms timestamp. */
export function relativeTimeText(ms: number): string {
  const rt = formatRelativeTime(ms)
  return tt(rt.key, rt.value !== undefined ? { value: rt.value } : undefined)
}

/** Localized absolute time for the detail meta (e.g. "2026/8/16 11:00:00"). */
export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString()
}
