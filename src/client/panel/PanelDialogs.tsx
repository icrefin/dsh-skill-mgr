/**
 * PanelDialogs — SkillMgrPanel 底部的对话框接线层（删除技能确认、清空回收站
 * 确认）。状态与动作仍由 useSkillMgr 的 mgr 持有；这里只收窄成显式 props，
 * 渲染顺序与拆分前一致。
 *
 * 同步/分支/版本/市场同步对话框随市场与来源跟踪一起移除。
 */

import type { JSX } from 'react'
import { tt } from '../helpers.ts'
import { ConfirmDialog } from './dialogs.tsx'
import type { SkillMgrState } from './useSkillMgr.ts'

export interface PanelDialogsProps {
  /** 删除单个技能确认（移入回收站）。 */
  deleteSkillDialog: SkillMgrState['deleteSkillDialog']
  setDeleteSkillDialog: SkillMgrState['setDeleteSkillDialog']
  runDeleteSkill: SkillMgrState['runDeleteSkill']
  /** 清空回收站确认。 */
  confirmClearTrash: SkillMgrState['confirmClearTrash']
  setConfirmClearTrash: SkillMgrState['setConfirmClearTrash']
  clearTrash: SkillMgrState['clearTrash']
}

export function PanelDialogs(props: PanelDialogsProps): JSX.Element {
  const {
    deleteSkillDialog, setDeleteSkillDialog, runDeleteSkill,
    confirmClearTrash, setConfirmClearTrash, clearTrash,
  } = props
  return (
    <>
      {deleteSkillDialog !== null ? (
        <ConfirmDialog
          title={tt('delete.confirmTitle')}
          text={tt('delete.confirmText', { name: deleteSkillDialog })}
          confirmLabel={tt('delete.confirm')}
          danger
          onCancel={() => { setDeleteSkillDialog(null) }}
          onConfirm={() => { void runDeleteSkill() }}
        />
      ) : null}

      {confirmClearTrash ? (
        <ConfirmDialog
          title={tt('trash.clearConfirmTitle')}
          text={tt('trash.clearConfirmText')}
          confirmLabel={tt('trash.clearConfirm')}
          danger
          onCancel={() => { setConfirmClearTrash(false) }}
          onConfirm={() => { void clearTrash() }}
        />
      ) : null}
    </>
  )
}