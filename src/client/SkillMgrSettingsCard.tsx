/**
 * The dsh-skill-mgr plugin settings card: bridges the mgr's settings
 * namespace (bound through the official settings transport) onto the
 * family-style staged card form (enabled master switch + agent announcement).
 * Registered into `plugins.bundle.config` under the bundle's package name, so
 * the Plugins manager renders it on dsh-skill-mgr's own page. That slot is
 * dispatched with `view: 'page'` only, so the card always renders its full
 * form (no `summary` one-liner variant).
 */

import type { ReactElement } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MgrKey } from './locales.ts'
import { usePluginVersion } from './panel-config.ts'
import { ColorField, NumberField, PluginSettingsCard, SwitchField } from './settings-card.tsx'
import { booleanField, CardForm, colorField, numberField, type CardShell, type FieldState, type FormScope } from './settings-form.ts'
// Single source for the TS-side dot defaults (the panel CSS mirrors these).
import { DEFAULT_DOT_MODEL_COLOR, DEFAULT_DOT_USER_COLOR } from './panel/format.ts'

/** The card's projected state. */
export interface SkillMgrSettingsState extends CardShell {
  enabled: FieldState
  announceToAgent: FieldState
  dotModelColor: FieldState
  dotUserColor: FieldState
  showUseCount: FieldState
  showUseTime: FieldState
  statsWindowDays: FieldState
  statsScanMinutes: FieldState
}

/** The card's editable config fields (every projected key beyond the CardShell). */
type SkillMgrField = Exclude<keyof SkillMgrSettingsState, keyof CardShell>

/** One staged field row: which control renders it and the copy keys it uses. */
type FieldRow =
  | { kind: 'switch'; field: SkillMgrField; label: MgrKey; hint: MgrKey }
  | { kind: 'color'; field: SkillMgrField; id: string; label: MgrKey; hint: MgrKey; defaultColor: string }
  | { kind: 'number'; field: SkillMgrField; id: string; label: MgrKey; hint: MgrKey }

/** The business face the card's slot registration injects. */
export interface SkillMgrSettingsCardFace {
  hooks: {
    /** The card's snapshot store (projected form state). */
    skillMgrSettingsCard: SnapshotStore<SkillMgrSettingsState>
  }
  save: () => void
  discard: () => void
  edit: (field: string, text: string) => void
  resetField: (field: string) => void
}

/** Props the slot renderer binds (locale copy + injected form actions). */
export type SkillMgrSettingsCardProps =
  PropsRuntime<'plugins.bundle.config'> & PropsLocale<'dsh-skill-mgr'> & InjectFace<SkillMgrSettingsCardFace>

/** Bridges the mgr's config scope onto the card's staged form. */
export class SkillMgrSettingsCardController {
  private readonly form: CardForm
  private readonly store: SnapshotStore<SkillMgrSettingsState>

  /** @param scope - the mgr settings scope the card edits (FormScope-compatible). */
  constructor(scope: FormScope) {
    this.form = new CardForm(scope, [booleanField('enabled'), booleanField('announceToAgent'), colorField('dotModelColor'), colorField('dotUserColor'), booleanField('showUseCount'), booleanField('showUseTime'), numberField('statsWindowDays', { min: 0, max: 3650 }), numberField('statsScanMinutes', { min: 1, max: 1440 })])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SkillMgrSettingsState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      announceToAgent: this.form.field('announceToAgent'),
      dotModelColor: this.form.field('dotModelColor'),
      dotUserColor: this.form.field('dotUserColor'),
      showUseCount: this.form.field('showUseCount'),
      showUseTime: this.form.field('showUseTime'),
      statsWindowDays: this.form.field('statsWindowDays'),
      statsScanMinutes: this.form.field('statsScanMinutes'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot hook and its form actions.
   */
  inject(): SkillMgrSettingsCardFace {
    return {
      hooks: { skillMgrSettingsCard: this.store },
      ...this.form.actions(),
    }
  }
}

/** The card's field rows in render order; the rendered DOM order follows it. */
const FIELD_ROWS: readonly FieldRow[] = [
  { kind: 'switch', field: 'enabled', label: 'settings.enabled', hint: 'settings.enabledHint' },
  { kind: 'switch', field: 'announceToAgent', label: 'settings.announceToAgent', hint: 'settings.announceToAgentHint' },
  { kind: 'color', field: 'dotModelColor', id: 'skill-mgr-dot-model-color', label: 'settings.dotModelColor', hint: 'settings.dotModelColorHint', defaultColor: DEFAULT_DOT_MODEL_COLOR },
  { kind: 'color', field: 'dotUserColor', id: 'skill-mgr-dot-user-color', label: 'settings.dotUserColor', hint: 'settings.dotUserColorHint', defaultColor: DEFAULT_DOT_USER_COLOR },
  { kind: 'switch', field: 'showUseCount', label: 'settings.showUseCount', hint: 'settings.showUseCountHint' },
  { kind: 'switch', field: 'showUseTime', label: 'settings.showUseTime', hint: 'settings.showUseTimeHint' },
  { kind: 'number', field: 'statsWindowDays', id: 'skill-mgr-stats-window-days', label: 'settings.statsWindowDays', hint: 'settings.statsWindowDaysHint' },
  { kind: 'number', field: 'statsScanMinutes', id: 'skill-mgr-stats-scan-minutes', label: 'settings.statsScanMinutes', hint: 'settings.statsScanMinutesHint' },
]

/**
 * Render the dsh-skill-mgr card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function SkillMgrSettingsCard(props: SkillMgrSettingsCardProps): ReactElement {
  const { t } = props
  const state = props.useSkillMgrSettingsCard((snapshot) => snapshot)
  // 插件自身版本：与面板标题徽标同源（panel-config 的实时模块，index.tsx
  // 在挂载时从目录读一次）；读不到时保持不显示。
  const pluginVersion = usePluginVersion()
  const disabled = !state.writable
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    disabled,
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey='settings.title'
      descriptionKey='settings.description'
      version={pluginVersion !== '' ? pluginVersion : undefined}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      {FIELD_ROWS.map((row) => {
        const value = state[row.field]
        const common = {
          label: t(row.label),
          hint: t(row.hint),
          ...fieldProps,
          ...value,
          onEdit: (text: string) => { props.edit(row.field, text) },
          onReset: () => { props.resetField(row.field) },
        }
        if (row.kind === 'switch') return <SwitchField key={row.field} {...common} />
        if (row.kind === 'color') return <ColorField key={row.field} {...common} id={row.id} inheritLabel={t('settings.inherit')} defaultColor={row.defaultColor} />
        return <NumberField key={row.field} {...common} id={row.id} inheritLabel={t('settings.inherit')} />
      })}
    </PluginSettingsCard>
  )
}
