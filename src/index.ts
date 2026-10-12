/**
 * dsh-skill-mgr — host half.
 *
 * The plugin owns three things:
 * 1. the `skillMgr` Typert Remote (`gateway.ts`), the only management surface —
 *    the browser half calls it from the left-sidebar panel;
 * 2. a skill provider registered into the GLOBAL layer of the official
 *    `ctx.skills` registry, which is what makes the panel's inventory
 *    session-independent;
 * 3. the profile registry (`<profile>/.dsh/dshsk/skills.json`), reconciled on
 *    startup.
 *
 * Nothing here reaches outside official npm SDK packages — no dsh source
 * changes.
 *
 * @module dsh-skill-mgr
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { SkillProviderControl } from '@deepseek-ai/dsh-skill'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
// dsh's own fork, NOT the plain `schemastery` package: `.volatile()` (and the
// loader's `fiber.runtime.Config` handling) only exist here. Every official
// plugin imports it under this name.
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-settings'
import { HEX_COLOR_RE, MGR_CONFIG_DEFAULTS, MGR_ENTRY_ID, resolveMgrConfig, type MgrConfig } from './config.ts'
import type { SkillMgrDeps } from './deps.ts'
import { SkillMgrGateway } from './gateway.ts'
import { SkillMgrProvider } from './provider.ts'
import { reconcileDisabledSkills } from './reconcile.ts'
import { dshHome, registryFilePath, resolveProfileRoot } from './registry.ts'
import { LEGACY_STATE_FILES, SkillMgrStore } from './store.ts'
import { asPersistenceSeam, createSkillStatsReader, type SessionPersistenceLike, type SessionQueryLike, type SkillStatsReader } from './stats.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'skill-mgr'

/**
 * Services required before the management surfaces can mount.
 *
 * `settings` is deliberately absent: the plugin reads its own volatile config
 * refs and only reaches for the settings service when it is present.
 */
export const inject = ['skills', 'systemPrompt']

/**
 * Plugin config, validated by the same-named schemastery schema.
 *
 * dsh 0.1.7 replaced the "plugin registers a settings namespace" model with
 * "the Loader entry's Config IS the settings namespace", so this one schema is
 * both the composition config and the settings page. Every field is volatile:
 * the Loader re-resolves volatile values in place and re-enters apply()
 * instead of rebuilding the fiber, and only volatile fields are writable
 * through the settings transport.
 */
export interface Config {
  /** Master switch: when false the plugin contributes no skills and no announcement. The panel keeps working so it can be turned back on. */
  enabled: Volatile<boolean>
  /** When true (default), a system-prompt section announces the manager to every agent. */
  announceToAgent: Volatile<boolean>
  /** Show per-skill invocation count chip. Default true. */
  showUseCount: Volatile<boolean>
  /** Show per-skill last-used relative time. Default true. */
  showUseTime: Volatile<boolean>
  /** 模型可调圆点颜色（#rrggbb）；缺省用面板默认色。 */
  dotModelColor: Volatile<string | undefined>
  /** 用户可调圆点颜色（#rrggbb）；缺省用面板默认色。 */
  dotUserColor: Volatile<string | undefined>
  /** 统计滚动窗口天数：只统计最近 N 天的使用；0 = 全部历史。 */
  statsWindowDays: Volatile<number>
  /** 自动统计扫描间隔（分钟，最小 1）。 */
  statsScanMinutes: Volatile<number>
}

/**
 * The durable field schemas, plain (non-volatile) so the same definitions can
 * back both the live view below and the wire form the settings page renders
 * from `.toJSON()`. `description` is what the auto-generated page shows with
 * each row; `role('secret')` makes the settings layer redact the value on
 * every wire read.
 */
const ConfigFields = {
  enabled: z.boolean().default(MGR_CONFIG_DEFAULTS.enabled).description('关闭后本插件不再向 Agent 提供技能与公告；管理面板仍可用，便于重新开启。'),
  announceToAgent: z.boolean().default(MGR_CONFIG_DEFAULTS.announceToAgent).description('在系统提示中加入本插件说明，用户提到技能管理时 Agent 知道如何协作。'),
  dotModelColor: z.string().pattern(HEX_COLOR_RE).description('技能行与聊天「/」菜单中「模型可调」圆点的颜色（#rrggbb）。'),
  dotUserColor: z.string().pattern(HEX_COLOR_RE).description('技能行与聊天「/」菜单中「仅用户可调」圆点的颜色（#rrggbb）。'),
  showUseCount: z.boolean().default(MGR_CONFIG_DEFAULTS.showUseCount).description('在技能名旁显示调用次数。'),
  showUseTime: z.boolean().default(MGR_CONFIG_DEFAULTS.showUseTime).description('在技能名行显示最近调用时间。'),
  statsWindowDays: z.number().min(0).max(3650).default(MGR_CONFIG_DEFAULTS.statsWindowDays).description('只统计最近 N 天的使用次数；0 = 全部历史。'),
  statsScanMinutes: z.number().min(1).max(1440).default(MGR_CONFIG_DEFAULTS.statsScanMinutes).description('后台扫描会话日志的间隔（分钟，最小 1）。'),
}

/**
 * The live plugin config the settings page edits. Field order here is the row
 * order the auto-generated page renders.
 */
export const Config = z.object({
  enabled: ConfigFields.enabled.volatile(),
  announceToAgent: ConfigFields.announceToAgent.volatile(),
  dotModelColor: ConfigFields.dotModelColor.volatile(),
  dotUserColor: ConfigFields.dotUserColor.volatile(),
  showUseCount: ConfigFields.showUseCount.volatile(),
  showUseTime: ConfigFields.showUseTime.volatile(),
  statsWindowDays: ConfigFields.statsWindowDays.volatile(),
  statsScanMinutes: ConfigFields.statsScanMinutes.volatile(),
})

/**
 * The settings namespace this plugin's config lives under, narrowed to the
 * settings package's branded type. The browser half resolves the same form
 * through `ctx.configForms.get(MGR_ENTRY_ID)`.
 */
export const ENTRY_ID = MGR_ENTRY_ID as SettingsNamespace

/** Every config field, in the order the settings page renders them (used to walk the volatile refs). */
const CONFIG_FIELDS = [
  'enabled',
  'announceToAgent',
  'dotModelColor',
  'dotUserColor',
  'showUseCount',
  'showUseTime',
  'statsWindowDays',
  'statsScanMinutes',
] as const

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 152

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const SKILL_MGR_GUIDANCE = [
  '本机已安装 dsh-skill-mgr 插件（DSH Web GUI 技能管理器）：侧边栏左列「技能管理」面板是管理主页（在「插件」下方）。能力：Profile 技能清单（用户级 ~/.dsh/skills 与 ~/.agents/skills，走官方 ctx.skills 注册表，含第三方 provider），单个或批量启用/禁用（禁用即把 SKILL.md 改名，可随时恢复）、查看正文、发现诊断一键修复、新建技能向导、删除（移入回收站，可恢复）；调用次数与最近使用时间统计。限制：只有用户级技能可写，项目/内置/运行时技能只读展示。用户提到「技能管理 / 技能列表 / 技能开关 / 删除技能 / 更新技能 / 新建技能」时即指本插件，请据此协作。',
  'The dsh-skill-mgr plugin is installed (the DSH Web GUI skill manager): the "Skills" panel in the left sidebar (just under Plugins) is the management page. Capabilities: the profile skill inventory (user roots ~/.dsh/skills and ~/.agents/skills, via the official ctx.skills registry including third-party providers), per-skill and batch enable/disable (disabling renames SKILL.md, and is reversible), body inspection, one-click repair of discovery diagnostics, a new-skill wizard, and deletion into a restorable trash; invocation counts and last-used times. Limits: only user-level skills are writable; project/bundled/runtime skills are read-only. When the user mentions "skill management / skill list / skill toggle / delete skill / update skills / new skill", this plugin is what they mean — collaborate accordingly.',
].join('\n\n')

/**
 * Mount the Remote, the skill provider and the announcement.
 * @param ctx - host plugin context carrying skills/systemPrompt/settings.
 * @param config - the Loader entry's volatile config refs.
 */
export function apply(ctx: Context, config?: Config): void {
  /**
   * Read the runtime config out of our own volatile config refs.
   *
   * This is the whole point of `volatile()`: the Loader updates those values
   * **in place** without rebuilding the fiber, so a held reference always
   * answers `.get()` with the current value. Consequences worth remembering:
   * no `settings.describe()` per request, no subscription needed for reading,
   * and the plugin keeps working when the Settings service is absent.
   */
  const readConfig = (): Partial<MgrConfig> => {
    const out: Record<string, unknown> = {}
    for (const field of CONFIG_FIELDS) {
      const ref = (config as unknown as Record<string, { get?: () => unknown } | undefined> | undefined)?.[field]
      const value = ref !== undefined && typeof ref.get === 'function' ? ref.get() : ref
      if (value !== undefined) out[field] = value
    }
    return out as Partial<MgrConfig>
  }
  const current = (): MgrConfig => resolveMgrConfig({}, readConfig())

  const home = dshHome()
  const profileRoot = resolveProfileRoot(ctx as unknown as { baseUrl?: string })
  const registryPath = registryFilePath(profileRoot)
  const store = new SkillMgrStore(
    registryPath,
    LEGACY_STATE_FILES.map((file) => join(home, file)),
  )

  let disposeSection: (() => void) | undefined
  let disposeProvider: (() => void) | undefined
  let providerControl: SkillProviderControl | undefined

  /**
   * The dependency view every operation is written against. `stats` is filled
   * in later, once a session-query seam appears, so it stays a mutable field.
   */
  const deps: SkillMgrDeps = {
    skills: ctx.skills,
    store,
    registryPath,
    profileRoot,
    home,
    invalidate: () => { providerControl?.invalidate() },
    config: current,
  }

  // The Remote mount is unconditional: the panel is how the plugin gets turned
  // back on, so withdrawing the namespace when `enabled` is false would leave
  // the user with no surface at all.
  new SkillMgrGateway(ctx, deps)

  // Register (or drop) every configurable surface. Each group is kept under one
  // disposer so re-registering tears the old one down first.
  const sync = (): void => {
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (disposeProvider !== undefined) {
      disposeProvider()
      disposeProvider = undefined
    }
    const value = current()
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-skill-mgr',
        order: SECTION_ORDER,
        text: SKILL_MGR_GUIDANCE,
      })
    }
    if (value.enabled) {
      providerControl = undefined
      disposeProvider = ctx.effect(
        () => ctx.skills.registerProvider((control) => {
          providerControl = control
          return new SkillMgrProvider(control, home)
        }),
        'dsh-skill-mgr: provider',
      )
    }
    ctx.logger.info(`[dsh-skill-mgr] surfaces synced: enabled=${value.enabled} announceToAgent=${value.announceToAgent}`)
  }

  // Initial registration from the composition entry. Later changes — the
  // settings card — rewrite this Loader entry, which re-enters apply(), so no
  // in-process watcher is needed.
  sync()

  // Startup housekeeping, off the critical path: adopt disabled skills the
  // registry lost track of, and drop records whose file disappeared behind the
  // manager's back.
  void (async () => {
    try {
      const reconciled = await reconcileDisabledSkills(store, home)
      if (reconciled.length > 0) {
        ctx.logger.info(`[dsh-skill-mgr] startup reconciled ${reconciled.length} disabled skill record(s): ${reconciled.map((entry) => entry.name).join(', ')}`)
      }
    } catch (error) {
      ctx.logger.warn('[dsh-skill-mgr] startup disabled-skill reconcile failed', error)
    }
    try {
      const dropped = await store.pruneDisabled((entry) => existsSync(entry.path))
      if (dropped.length > 0) {
        ctx.logger.info(`[dsh-skill-mgr] startup dropped ${dropped.length} stale disabled record(s): ${dropped.map((entry) => entry.name).join(', ')}`)
      }
    } catch (error) {
      ctx.logger.warn('[dsh-skill-mgr] startup stale-record prune failed', error)
    }
  })()

  // Optional trigger statistics: while a session-query service exists, wire a
  // cached invocation-count reader into `skillStats`. Scans are strictly lazy —
  // the first one starts on the panel's first call, never at plugin startup.
  //
  // Read-path preference: the host's sessionPersistence seam serves raw stored
  // logs (decompress + parse only), with the query seam covering live sessions.
  // Mount ordering between the two is not guaranteed, so the reader is rebuilt
  // generation-guarded: a query-only reader wires immediately, and a
  // later-arriving persistence service upgrades it to the cold path.
  let statsQuery: SessionQueryLike | undefined
  let statsPersistence: SessionPersistenceLike | undefined
  let statsGeneration = 0
  const wireStats = (): void => {
    const query = statsQuery
    if (query === undefined) return
    const generation = ++statsGeneration
    const cold = statsPersistence
    void (async () => {
      const checkpoint = await store.getSkillStatsState().catch(() => undefined)
      if (generation !== statsGeneration) return
      const scanMinutes = (): number => {
        const value = current().statsScanMinutes
        return typeof value === 'number' && value >= 1 ? Math.floor(value) : MGR_CONFIG_DEFAULTS.statsScanMinutes
      }
      const windowDays = (): number => {
        const value = current().statsWindowDays
        return typeof value === 'number' && value >= 0 ? Math.floor(value) : MGR_CONFIG_DEFAULTS.statsWindowDays
      }
      const reader: SkillStatsReader = createSkillStatsReader(query, () => scanMinutes() * 60_000, {
        checkpoint,
        windowDays,
        ...(cold === undefined ? {} : {
          persistence: cold,
          listLiveIds: async () => {
            try {
              const records = await query.listSessions()
              return records.filter((record) => (record as { live?: unknown }).live === true).map((record) => record.header.id)
            } catch {
              return []
            }
          },
          readLiveSession: async (id) => {
            try {
              return { events: (await query.readSession(id)).events }
            } catch {
              return undefined
            }
          },
        }),
        onCheckpoint: (next) => {
          void store.saveSkillStatsState(next).catch((error) => {
            ctx.logger.warn('[dsh-skill-mgr] persisting skill-stats checkpoint failed', error)
          })
        },
      })
      if (generation !== statsGeneration) return
      ctx.logger.info(`[dsh-skill-mgr] stats seam: ${cold === undefined ? 'session-query (fallback)' : 'session-persistence (cold)'}`)
      deps.stats = reader
    })()
  }
  ctx.inject(['sessionQuery'], (sctx) => {
    statsQuery = sctx.sessionQuery as unknown as SessionQueryLike
    wireStats()
    sctx.inject(['sessionPersistence'] as unknown as ['sessionQuery'], (pctx) => {
      void (async () => {
        const raw = (pctx as unknown as { sessionPersistence?: unknown }).sessionPersistence
        const seam = asPersistenceSeam(raw)
        if (seam === undefined) {
          ctx.logger.warn('[dsh-skill-mgr] sessionPersistence shape mismatch, staying on query fallback')
          return
        }
        try {
          await seam.list() // probe: headers only, must succeed before trusting the cold path
        } catch (error) {
          ctx.logger.warn('[dsh-skill-mgr] persistence seam probe failed, staying on query fallback', error)
          return
        }
        statsPersistence = seam
        wireStats()
      })()
    })
  })
}