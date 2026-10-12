/**
 * useTrashFlow — 回收站域：条目列表、单个恢复、清空。恢复会把技能放回可写根，
 * 所以恢复成功后除回收站外还要重读目录（由聚合根注入的 reloadCatalog）；
 * 清空只是永久删除回收站内容，目录不受影响。
 */

import { useCallback, useState } from 'react'
import type { TrashEntry } from '../../../wire.ts'
import type { SkillMgrApi } from '../../api.ts'
import { errorMessage, tt } from '../../helpers.ts'
import type { FlowNotices } from './shared.ts'

export function useTrashFlow(
  api: SkillMgrApi,
  shared: FlowNotices,
  /** 目录重载（恢复技能后它重新出现在目录里，目录域提供）。 */
  reloadCatalog: () => Promise<void>,
) {
  const [trash, setTrash] = useState<readonly TrashEntry[]>([])

  /** 读一次 snapshot 的回收站切片。 */
  const load = useCallback(async (): Promise<void> => {
    try {
      setTrash(await api.trash())
    } catch (error) {
      shared.fail(errorMessage(error))
    }
  }, [api, shared])

  /** 从回收站恢复一个技能。 */
  const restore = useCallback(async (name: string): Promise<void> => {
    shared.setOpBusy(true)
    try {
      await api.restoreTrash(name)
      await Promise.all([load(), reloadCatalog()])
      shared.clearFail()
      shared.succeed(tt('trash.restored', { name }))
    } catch (error) {
      shared.fail(errorMessage(error))
    } finally {
      shared.setOpBusy(false)
    }
  }, [api, load, reloadCatalog, shared])

  /** 永久删除回收站里的全部内容。 */
  const clearAll = useCallback(async (): Promise<void> => {
    shared.setOpBusy(true)
    try {
      await api.clearTrash()
      await load()
      shared.clearFail()
      shared.succeed(tt('trash.cleared'))
    } catch (error) {
      shared.fail(errorMessage(error))
    } finally {
      shared.setOpBusy(false)
    }
  }, [api, load, shared])

  return { trash, load, restore, clearAll }
}