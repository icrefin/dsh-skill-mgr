/**
 * Browser-half entry for the dsh-skill-mgr plugin — runs inside the dsh web
 * GUI.
 *
 * Registers this plugin's locale dictionaries and mounts:
 *  - the management panel in the left sidebar: a `sidebar.panellist` row under
 *    **Plugins** and the `main` page it opens, both keyed by `skillMgr`.
 *    Selecting the row is a layout lookup in the live `main` registry, so the
 *    two registrations must share the id;
 *  - the plugin's own configuration card in the Plugins manager
 *    (`plugins.bundle.config`, keyed by the BUNDLE PACKAGE NAME);
 *  - the chat "/" menu skill dots, colored from the same config the panel reads.
 *
 * `dsh.client.inject` in package.json orders this bundle after
 * `dsh-client-ui-sidebar` and `dsh-client-ui-layout` — the two packages that
 * declare those slots — so both `slots.inject` calls resolve.
 *
 * Failure policy: mounting problems are logged, never thrown — the web shell
 * fails the whole boot when a plugin apply throws, and an external plugin must
 * not take the GUI down.
 *
 * Export discipline (packages/client rule): the /client surface carries what
 * cordis loading needs plus types only — all value exports stay internal.
 *
 * @module dsh-skill-mgr/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the configForms service merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the Context merge for ctx.inputTriggers (slash-dots wiring).
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
// Type-only: pulls the plugin-manager SlotMap merge (plugins.bundle.config).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: pulls the connection/reset event.
import type {} from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls `main` and `sidebar.panellist` into the SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls this package's remote-namespace augmentation.
import type {} from '../typert.remote-client.ts'

// The slots service is owned by ui-renderer; augment the Context locally so the
// browser half typechecks against a runtime this build does not depend on.
declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: any
  }
}
import { MGR_ENTRY_ID, type MgrSettingsValue } from '../config.ts'
import { createSkillMgrClient, type SkillMgrApi } from './api.ts'
import { en, zh, type MgrKey } from './locales.ts'
import { bindPanelConfigScope, setPluginVersion } from './panel-config.ts'
import { setupSkillSlashDots } from './slash-dots.tsx'
import { SkillMgrSettingsCard, SkillMgrSettingsCardController } from './SkillMgrSettingsCard.tsx'
import { SkillMgrPanelIcon } from './SkillMgrPanelIcon.tsx'
import { SkillMgrPanel } from './panel/SkillMgrPanel.tsx'

/** Locale namespace this plugin owns. */
const NS = 'dsh-skill-mgr'

/**
 * The id shared by the sidebar row and the main panel it opens.
 *
 * The sidebar hands this to `ctx.layout.selectPanel`, which looks it up in the
 * live `main` registry — a missing `main` entry throws instead of switching
 * panels, so the two registrations cannot drift apart.
 */
export const PANEL_ID = 'skillMgr'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-skill-mgr surface copy. */
    'dsh-skill-mgr': MgrKey
  }
}

/**
 * Required services (fiber inject waiting — the runtime must be up first).
 * `connection`/`remote` are the Remote transport's own prerequisites,
 * `configForms` is the shared settings-form service, and the two layout
 * packages are what declare the slots this bundle registers into.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'configForms', 'inputTriggers']

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { SkillMgrPanelProps } from './panel/SkillMgrPanel.tsx'
export type { SkillMgrSettingsState } from './SkillMgrSettingsCard.tsx'
export type { MgrKey } from './locales.ts'

/**
 * Mount the sidebar panel, the plugin config card and the slash dots.
 * @param ctx - client root context (slots, locale, remote).
 */
export async function apply(ctx: ClientContext): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-skill-mgr: dictionaries')
  const t = ctx.locale.bind(NS)

  // The panel's data client needs the Remote namespace to exist first, so the
  // slot registrations wait for the mount — the api-remotes pattern.
  let client: { api: SkillMgrApi; dispose: () => void }
  try {
    client = await createSkillMgrClient(ctx)
  } catch (error) {
    ctx.logger?.error?.('[dsh-skill-mgr] mounting the skillMgr Remote failed', error)
    return
  }
  ctx.effect(() => () => client.dispose(), 'dsh-skill-mgr: remote mount')
  const api = client.api

  // The manager's config form is the same Loader entry the host reads and the
  // Plugins manager renders; the browser half reads it to colour the dots and to
  // drive the plugin's own configuration card.
  const scope = ctx.configForms.get<MgrSettingsValue>(MGR_ENTRY_ID)
  const settingsCard = new SkillMgrSettingsCardController(scope)

  // 面板与设置卡共用一份实时设置视图（圆点色、用量显示开关）：这里绑定
  // 设置作用域，任何一次保存都会推送给两个消费者，无需重载。
  ctx.effect(() => bindPanelConfigScope(scope), 'dsh-skill-mgr: panel config')

  // 版本徽标：面板自己渲染目录里的版本号，设置卡通过同一个模块读它；面板
  // 没打开时也先取一次（snapshot 会被缓存，面板挂载时复用同一次往返）。
  void api.catalog().then((view) => { setPluginVersion(view.pluginVersion) }).catch(() => {
    // 版本徽标是装饰性的：取不到就不显示。
  })

  // Chat `/` 菜单技能圆点：为每个候选行加可调用性圆点（蓝=模型可调，绿=仅用户），颜色与面板图例同步；仅装饰，不自动预填 "/"
  ctx.effect(() => setupSkillSlashDots(ctx, api, scope), 'dsh-skill-mgr: slash dots')

  // The plugin's own configuration page. It must be registered here: the
  // Plugins manager only renders the config section for bundles that appear in
  // `plugins.bundle.config`, and its key is the BUNDLE PACKAGE NAME.
  ctx.effect(
    () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
      name: 'plugins.bundle.config',
      key: 'dsh-skill-mgr',
      locale: NS,
      inject: () => settingsCard.inject(),
    }, SkillMgrSettingsCard)),
    'dsh-skill-mgr: plugin config',
  )

  // The sidebar row: `order: 1` sits directly under the Plugins entry (order 0).
  ctx.effect(
    () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 1,
      label: () => t('entry.label'),
      locale: NS,
    }, SkillMgrPanelIcon)),
    'dsh-skill-mgr: sidebar entry',
  )

  // The page that row opens in the centre column.
  ctx.effect(
    () => ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: () => ({ api }),
    }, SkillMgrPanel)),
    'dsh-skill-mgr: main panel',
  )
}