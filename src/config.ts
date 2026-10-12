/**
 * The plugin's own runtime configuration.
 *
 * One namespace backs both the Loader entry's `Config` (the host half reads its
 * volatile refs) and the settings card the browser half renders through
 * `ctx.configForms`. `MGR_CONFIG_DEFAULTS` is the single source of the
 * defaults; `resolveMgrConfig` is the single merge rule.
 *
 * @module dsh-skill-mgr/config
 */

/** The skill manager's own runtime configuration, edited from the settings card. */
export interface MgrConfig {
  /** Master switch: when false the plugin contributes no skills and no announcement. */
  enabled: boolean
  /** When true, a system-prompt section announces the manager to every agent. */
  announceToAgent: boolean
  /** Model-invocable dot color (#rrggbb); absent means the panel default. */
  dotModelColor?: string
  /** User-invocable dot color (#rrggbb); absent means the panel default. */
  dotUserColor?: string
  /** Show per-skill invocation count chip. Default true. */
  showUseCount?: boolean
  /** Show per-skill last-used relative time. Default true. */
  showUseTime?: boolean
  /** 统计滚动窗口天数：只统计最近 N 天的使用；0 = 全部历史。默认 0。 */
  statsWindowDays?: number
  /** 自动统计扫描间隔（分钟，最小 1）。默认 5。 */
  statsScanMinutes?: number
}

/**
 * The resolved shape of the manager's settings namespace (schema defaults, then
 * the composition base, then the user layer). Kept as a type alias so the
 * browser-side settings scope snapshot is index-compatible with the card
 * form's record shape.
 */
export type MgrSettingsValue = {
  enabled: boolean
  announceToAgent: boolean
  showUseCount: boolean
  showUseTime: boolean
  /** Model-invocable dot color (#rrggbb); absent means the panel default. */
  dotModelColor?: string
  /** User-invocable dot color (#rrggbb); absent means the panel default. */
  dotUserColor?: string
  /** 统计滚动窗口天数（0 = 全部历史）。 */
  statsWindowDays?: number
  /** 自动统计扫描间隔（分钟）。 */
  statsScanMinutes?: number
}

/**
 * This plugin's Loader entry id — the settings namespace dsh serves its config
 * under. It is cordis.patch.yml's insert id, NOT the package name, and it is
 * shared by contract because the browser half addresses the same form through
 * `ctx.configForms.get(MGR_ENTRY_ID)` while the host half reads the volatile
 * refs the Loader resolves from it.
 */
export const MGR_ENTRY_ID = 'skill-mgr'

/**
 * Config defaults — the single source every layer reads: the cordis schema
 * (index.ts), the host's saved-override merge, and the panel's fallbacks.
 * Changing a default here changes all of them.
 */
export const MGR_CONFIG_DEFAULTS = {
  enabled: true,
  announceToAgent: true,
  showUseCount: true,
  showUseTime: true,
  statsWindowDays: 14,
  statsScanMinutes: 5,
} as const

/**
 * Resolve the effective config: explicit values win over defaults, dot colors
 * pass through only when set, and the numeric statistics knobs are clamped to
 * their sane ranges (window ≥ 0, scan interval ≥ 1 minute).
 * @param saved - the user layer.
 * @param base - the composition layer under it.
 * @returns the resolved configuration.
 */
export function resolveMgrConfig(saved: Partial<MgrConfig>, base: Partial<MgrConfig> = {}): MgrConfig {
  const dotModelColor = saved.dotModelColor !== undefined ? saved.dotModelColor : base.dotModelColor
  const dotUserColor = saved.dotUserColor !== undefined ? saved.dotUserColor : base.dotUserColor
  const windowDays = clampNumber(saved.statsWindowDays ?? base.statsWindowDays, 0) ?? MGR_CONFIG_DEFAULTS.statsWindowDays
  const scanMinutes = clampNumber(saved.statsScanMinutes ?? base.statsScanMinutes, 1) ?? MGR_CONFIG_DEFAULTS.statsScanMinutes
  return {
    enabled: saved.enabled ?? base.enabled ?? MGR_CONFIG_DEFAULTS.enabled,
    announceToAgent: saved.announceToAgent ?? base.announceToAgent ?? MGR_CONFIG_DEFAULTS.announceToAgent,
    showUseCount: saved.showUseCount ?? base.showUseCount ?? MGR_CONFIG_DEFAULTS.showUseCount,
    showUseTime: saved.showUseTime ?? base.showUseTime ?? MGR_CONFIG_DEFAULTS.showUseTime,
    statsWindowDays: windowDays,
    statsScanMinutes: scanMinutes,
    ...(dotModelColor !== undefined ? { dotModelColor } : {}),
    ...(dotUserColor !== undefined ? { dotUserColor } : {}),
  }
}

/** Clamp a numeric override into a valid value; undefined/invalid stays undefined. */
function clampNumber(value: unknown, min: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) return undefined
  return Math.floor(value)
}

/** HEX color validation shared by the host config schema and the settings card. */
export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i