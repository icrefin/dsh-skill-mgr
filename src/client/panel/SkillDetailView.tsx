/**
 * Full-page skill detail view: metadata plus the raw SKILL.md body. Pure
 * presentation — every state value and action arrives as a prop, so the
 * panel stays the single owner of state.
 *
 * The upstream source card (check/sync/follow-delete) is gone with the source
 * tracking: a skill is managed from the profile inventory only.
 *
 * The root is a fragment on purpose: its siblings are direct children of the
 * panel's page container, which supplies the width and spacing.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import type { SkillDetail } from '../../wire.ts'
import type { PanelConfig } from '../panel-config.ts'
import { copyTextToClipboard, isDisplayNameDistinct, tt } from '../helpers.ts'
import css from './panel.module.css'
import { dotStyle, formatDateTime } from './format.ts'

export interface SkillDetailViewProps {
  detail: SkillDetail
  /** Live panel configuration (dot colors). */
  mgrConfig: PanelConfig
  /** skillName → usage stat (count + last used). */
  uses: ReadonlyMap<string, { count: number; lastUsed?: number }>
  /** Whether the skill is currently mgr-disabled (served from the .disabled file). */
  disabled?: boolean
  /** Re-enable a mgr-disabled skill. */
  onEnable?: () => void
  onBack: () => void
}

export function SkillDetailView(props: SkillDetailViewProps): JSX.Element {
  const { detail, mgrConfig, uses, disabled, onEnable, onBack } = props
  const [copied, setCopied] = useState<string | null>(null)
  const copyTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => { window.clearTimeout(copyTimer.current) }, [])
  const copyText = (text: string, key: string): void => {
    void copyTextToClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(key)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => { setCopied(null) }, 1200)
    })
  }
  return (
    <>
      <div className={css.detailHead}>
        <button type='button' className={css.back} onClick={onBack}>{tt('detail.back')}</button>
        <span className={css.detailName} style={{ display:'inline-flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
          {detail.name}
          {isDisplayNameDistinct(detail.name, detail.displayName) ? <span className={css.displayName} style={{ fontSize:13, marginLeft:0 }}>{detail.displayName}</span> : null}
          {detail.invocation.modelInvocable
            ? <span className={css.dot + ' ' + css.dotModel} style={dotStyle(mgrConfig.dotModelColor)} title={tt('legend.model')} />
            : detail.invocation.userInvocable
              ? <span className={css.dot + ' ' + css.dotUser} style={dotStyle(mgrConfig.dotUserColor)} title={tt('legend.user')} />
              : null}
        </span>
        <span className={css.actions} style={{ marginLeft: 'auto', gap: 6 }}>
          {disabled === true && onEnable !== undefined ? <button type='button' className={css.opBtn} role='switch' aria-checked={false} aria-label={tt('row.enable')} onClick={onEnable}>{tt('row.enable')}</button> : null}
          <button type='button' className={css.opBtn} onClick={() => { copyText('$' + detail.name, 'mention') }}>{copied === 'mention' ? tt('detail.copied') : tt('detail.copyMention')}</button>
          {detail.path !== undefined ? <button type='button' className={css.opBtn} onClick={() => { const path = detail.path; if (path !== undefined) copyText(path, 'path') }}>{copied === 'path' ? tt('detail.copied') : tt('detail.copyPath')}</button> : null}
        </span>
      </div>
      <div className={css.detailMeta}>
        <div className={css.detailMetaLine}>{tt('detail.provider')}: {detail.provider}</div>
        {detail.addedAt !== undefined ? <div className={css.detailMetaLine}>{tt('detail.addedAt')}: {formatDateTime(detail.addedAt)}</div> : null}
        {detail.updatedAt !== undefined ? <div className={css.detailMetaLine}>{tt('detail.updatedAt')}: {formatDateTime(detail.updatedAt)}</div> : null}
        {detail.path !== undefined ? <div className={css.detailMetaLine}>{tt('detail.path')}: {detail.path}</div> : null}
        {detail.whenToUse !== undefined ? <div className={css.detailMetaLine}>{tt('detail.whenToUse')}: {detail.whenToUse}</div> : null}
        {(() => {
          const stat = uses.get(detail.name)
          if (stat === undefined || stat.count === 0) return null
          const at = stat.lastUsed !== undefined ? ' · ' + new Date(stat.lastUsed).toLocaleString() : ''
          return <div className={css.detailMetaLine}>{tt('detail.uses')}: {stat.count}{at}</div>
        })()}
      </div>
      <pre className={css.detailContent}>{detail.content}</pre>
    </>
  )
}