/**
 * Live client-side view of the plugin's own settings, plus the installed
 * version — what the panel and the settings card read.
 *
 * Why a module store instead of a prop: the browser half talks to exactly one
 * Remote (`skillMgr`), whose wire contract deliberately carries no
 * configuration, so the panel's props stay `{ api }`. The configuration the two
 * surfaces share lives in the Loader settings scope `ctx.configForms.get(...)`
 * that the settings card edits; `index.tsx` binds that scope here once, and
 * both consumers subscribe through `useSyncExternalStore`, so a save in the
 * card reaches the panel (dot colors, usage chips) without a reload.
 *
 * @module dsh-skill-mgr/client/panel-config
 */

import { useSyncExternalStore } from 'react'
import type { FormScope } from './settings-form.ts'

/** The configuration subset the panel renders with. */
export interface PanelConfig {
  /** Show the amber invocation-count chip on skill rows. */
  showUseCount: boolean
  /** Show the relative last-used time on skill rows. */
  showUseTime: boolean
  /** User-chosen model-invocable dot color; absent keeps the CSS default. */
  dotModelColor?: string
  /** User-chosen user-invocable dot color; absent keeps the CSS default. */
  dotUserColor?: string
}

/** Everything the panel/settings card read from this module. */
interface PanelState {
  config: PanelConfig
  /** Installed plugin version (package.json); empty until the first catalog read. */
  pluginVersion: string
}

/** Before the settings scope resolves: the shipped defaults. */
const DEFAULT_CONFIG: PanelConfig = { showUseCount: true, showUseTime: true }

let state: PanelState = { config: DEFAULT_CONFIG, pluginVersion: '' }
const listeners = new Set<() => void>()

function publish(next: PanelState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Stable snapshot reader for useSyncExternalStore (same object until a publish). */
const getState = (): PanelState => state

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined
}

/** Project the settings section value onto the panel's config view. */
function projectConfig(value: Record<string, unknown> | undefined): PanelConfig {
  const dotModelColor = asColor(value?.dotModelColor)
  const dotUserColor = asColor(value?.dotUserColor)
  return {
    showUseCount: asBoolean(value?.showUseCount, DEFAULT_CONFIG.showUseCount),
    showUseTime: asBoolean(value?.showUseTime, DEFAULT_CONFIG.showUseTime),
    ...(dotModelColor !== undefined ? { dotModelColor } : {}),
    ...(dotUserColor !== undefined ? { dotUserColor } : {}),
  }
}

/**
 * Bind this module to the plugin's settings scope: publish the current value
 * now and on every change.
 * @param scope - the Loader settings scope the settings card edits.
 * @returns the scope unsubscribe.
 */
export function bindPanelConfigScope(scope: FormScope): () => void {
  const read = (): void => { publish({ ...state, config: projectConfig(scope.getSnapshot().value) }) }
  read()
  return scope.subscribe(read)
}

/** Publish the installed plugin version (read once from the catalog). */
export function setPluginVersion(version: string): void {
  if (version === '' || state.pluginVersion === version) return
  publish({ ...state, pluginVersion: version })
}

/** The panel's current configuration (never null: defaults until the scope lands). */
export function usePanelConfig(): PanelConfig {
  return useSyncExternalStore(subscribe, getState, getState).config
}

/** The installed plugin version ('' until the first catalog read). */
export function usePluginVersion(): string {
  return useSyncExternalStore(subscribe, getState, getState).pluginVersion
}