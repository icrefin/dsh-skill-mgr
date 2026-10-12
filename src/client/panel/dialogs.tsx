/**
 * Shared dialog family for the panel: one overlay shell plus the dialogs the
 * flat manager still needs — the destructive confirmation and the new-skill
 * form. Every dialog closes on outside click and keeps the same role/aria
 * shell; the panel owns all dialog state. The sync/branch/version/market
 * dialogs are gone with the market and the source tracking they served.
 */

import { useEffect, type FormEvent, type JSX, type ReactNode } from 'react'
import type { WritableRoot } from '../../wire.ts'
import { tt } from '../helpers.ts'
import css from './panel.module.css'

/** Overlay + centered dialog shell; outside click or Escape cancels. */
export function DialogShell(props: { onClose: () => void; children: ReactNode; role?: 'dialog' | 'alertdialog' }): JSX.Element {
  const { onClose, role = 'alertdialog' } = props
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  })
  return (
    <div className={css.dialogOverlay} onClick={onClose}>
      <div className={css.dialog} role={role} aria-modal='true' onClick={(event) => { event.stopPropagation() }}>
        {props.children}
      </div>
    </div>
  )
}

/** Simple confirm dialog: title + text + optional name list + cancel/confirm. */
export function ConfirmDialog(props: {
  title: string
  text: string
  /** Optional names listed between the text and the buttons. */
  items?: readonly string[]
  confirmLabel: string
  /** Danger-styled confirm button (destructive actions). */
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  const { title, text, items, confirmLabel, danger, onCancel, onConfirm } = props
  return (
    <DialogShell onClose={onCancel}>
      <h3 className={css.dialogTitle}>{title}</h3>
      <p className={css.dialogText}>{text}</p>
      {items !== undefined ? (
        <ul className={css.dialogList}>
          {items.map((name) => <li key={name}><span className={css.rowNameText}>{name}</span></li>)}
        </ul>
      ) : null}
      <div className={css.dialogActions}>
        <button type='button' className={css.button} onClick={onCancel}>{tt('form.cancel')}</button>
        <button type='button' className={css.button + (danger === true ? ' ' + css.danger : ' ' + css.primary)} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </DialogShell>
  )
}

/** The new-skill form inside a dialog (the table header's New button opens it). */
export function NewSkillDialog(props: {
  name: string
  desc: string
  root: WritableRoot
  busy: boolean
  message: { kind: 'error' | 'success'; text: string } | null
  onName: (value: string) => void
  onDesc: (value: string) => void
  onRoot: (value: WritableRoot) => void
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
}): JSX.Element {
  const { name, desc, root, busy, message, onName, onDesc, onRoot, onSubmit, onCancel } = props
  return (
    <DialogShell onClose={onCancel} role='dialog'>
      <h3 className={css.dialogTitle}>{tt('form.title')}</h3>
      <form onSubmit={onSubmit}>
        <p className={css.hintLine}>{tt('form.capabilityHint')}</p>
        <div className={css.formRow}>
          <label className={css.formLabel}>{tt('form.name')}</label>
          <input className={css.input} value={name} onChange={(event) => { onName(event.target.value) }} placeholder='code-review' />
        </div>
        <div className={css.formRow}>
          <label className={css.formLabel}>{tt('form.desc')}</label>
          <input className={css.input} value={desc} onChange={(event) => { onDesc(event.target.value) }} placeholder={tt('form.descPlaceholder')} />
        </div>
        <div className={css.formRow}>
          <label className={css.formLabel}>{tt('form.root')}</label>
          <select className={css.select} value={root} onChange={(event) => { onRoot(event.target.value as WritableRoot) }}>
            <option value='user-dsh'>~/.dsh/skills</option>
            <option value='user-agents'>~/.agents/skills</option>
          </select>
        </div>
        {message !== null ? <div className={message.kind === 'error' ? css.formError : css.formSuccess}>{message.text}</div> : null}
        <div className={css.dialogActions}>
          <button type='button' className={css.button} onClick={onCancel}>{tt('form.cancel')}</button>
          <button type='submit' className={css.button + ' ' + css.primary} disabled={busy}>{busy ? tt('form.busy') : tt('form.submit')}</button>
        </div>
      </form>
    </DialogShell>
  )
}