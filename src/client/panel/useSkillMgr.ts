/**
 * useSkillMgr — 面板的状态聚合根：只持有跨域共享的通知状态与纯视图状态，
 * 各域状态与动作分散在 ./hooks/*，这里按依赖顺序组装（meta → 目录 → 回收站
 * → 工作区），刷新策略与派生组装在此。
 *
 * 市场、来源跟踪与仓库导入随功能一起移除；技能页签变成一张平铺表格，因此
 * 也不再需要分组折叠、编辑模式与整组开关——删除已经是行内动作。
 *
 * 目录本身不再秒级轮询：Remote 客户端缓存一份 snapshot，每个写操作都会让
 * 它失效，因此挂载、每次写、显式刷新按钮各自重读，后台只保留每分钟一次的
 * 慢刷新（一次 snapshot 读取）。
 *
 * All hooks run unconditionally at the top, so the panel may early-return for
 * the detail view without violating the rules of hooks.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SkillMgrApi } from '../api.ts'
import { useMetaFlow } from './hooks/useMetaFlow.ts'
import { useCatalogFlow } from './hooks/useCatalogFlow.ts'
import { useTrashFlow } from './hooks/useTrashFlow.ts'
import { SLOW_POLL_MS, type FlowNotices } from './hooks/shared.ts'

/** The hook's result: the panel's complete state + action surface. */
export type SkillMgrState = ReturnType<typeof useSkillMgr>

export function useSkillMgr(api: SkillMgrApi) {
  // ------------------------------------------------------- shared notices
  // 多域共用的报错/成功条幅与忙碌开关：setter 本身引用稳定，memo 常驻后
  // 各域回调依赖它不会失稳。
  const [loadError, setLoadError] = useState<string | null>(null)
  /** Green success banner (create/delete/restore finished); shown outside dialogs. */
  const [successBanner, setSuccessBanner] = useState<string | null>(null)
  const [opBusy, setOpBusy] = useState(false)
  const shared = useMemo<FlowNotices>(() => ({
    fail: (message: string) => setLoadError(message),
    clearFail: () => setLoadError(null),
    succeed: (message: string | null) => setSuccessBanner(message),
    setOpBusy,
  }), [])

  // ------------------------------------------------------------ view state
  // 纯视图状态：不触发数据加载，只影响渲染。
  const [showLegend, setShowLegend] = useState(false)
  /** 删除确认对话框里的技能名（null = 关闭）。 */
  const [deleteSkillDialog, setDeleteSkillDialog] = useState<string | null>(null)
  /** 清空回收站确认对话框。 */
  const [confirmClearTrash, setConfirmClearTrash] = useState(false)

  // ------------------------------------------------------------ meta first
  // 更新检查/统计/配置只依赖 api，最先组装。
  const meta = useMetaFlow(api)

  // ---------------------------------------------------------------- catalog
  const catalogFlow = useCatalogFlow(api, meta.uses, shared)

  // ---------------------------------------------------------------- trash
  const trashFlow = useTrashFlow(api, shared, catalogFlow.load)


  // ---------------------------------------------------------------- refresh
  /**
   * 全量重读：先让 Remote 客户端的 snapshot 缓存失效，再并行取各域切片
   * （同一份 snapshot，只打一次往返）。挂载、慢刷新与「刷新」按钮共用它。
   */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      await api.refresh()
    } catch {
      // 快照取不到时下面的各域读取会各自报出真实错误。
    }
    await Promise.all([
      catalogFlow.load(),
      trashFlow.load(),
      meta.loadUses(),
    ])
  }, [api, catalogFlow.load, trashFlow.load, meta.loadUses])

  useEffect(() => {
    void refresh()
    // 慢刷新：每分钟一次 snapshot 读取，替代原先 5 秒的目录轮询。
    const slow = window.setInterval(() => { void refresh() }, SLOW_POLL_MS)
    return () => { window.clearInterval(slow) }
  }, [refresh])

  // ------------------------------------------------------------- deletion
  /** 行内删除按钮：先开确认对话框（删除可恢复，但仍要先确认）。 */
  const requestDeleteSkill = useCallback((name: string): void => {
    setDeleteSkillDialog(name)
  }, [])

  /** 确认后的删除：目录与回收站各自重读。 */
  const runDeleteSkill = useCallback(async (): Promise<void> => {
    if (deleteSkillDialog === null) return
    const name = deleteSkillDialog
    setDeleteSkillDialog(null)
    await catalogFlow.deleteSkill(name)
    await trashFlow.load()
  }, [deleteSkillDialog, catalogFlow.deleteSkill, trashFlow.load])

  /** 确认后的清空回收站。 */
  const clearTrash = useCallback(async (): Promise<void> => {
    setConfirmClearTrash(false)
    await trashFlow.clearAll()
  }, [trashFlow.clearAll])

  return {
    // state
    catalog: catalogFlow.catalog, loading: catalogFlow.loading, loadError, successBanner,
    search: catalogFlow.search, sourceFilter: catalogFlow.sourceFilter,
    invocationFilter: catalogFlow.invocationFilter, sortKey: catalogFlow.sortKey,
    detail: catalogFlow.detail, detailLoading: catalogFlow.detailLoading,
    busyNames: catalogFlow.busyNames, opBusy,
    showForm: catalogFlow.showForm, formName: catalogFlow.formName, formDesc: catalogFlow.formDesc,
    formRoot: catalogFlow.formRoot, formBusy: catalogFlow.formBusy, formMessage: catalogFlow.formMessage,
    uses: meta.uses, mgrConfig: meta.mgrConfig,
    showLegend,
    trash: trashFlow.trash,
    deleteSkillDialog, confirmClearTrash,
    // derived
    filtered: catalogFlow.filtered, sorted: catalogFlow.sorted,
    sortedDisabled: catalogFlow.sortedDisabled,
    shortenedCount: catalogFlow.shortenedCount, sourceOptions: catalogFlow.sourceOptions,
    totalCount: catalogFlow.totalCount,
    // actions + setters
    setLoadError, setSuccessBanner, setShowLegend,
    setSearch: catalogFlow.setSearch, setSourceFilter: catalogFlow.setSourceFilter,
    setInvocationFilter: catalogFlow.setInvocationFilter, setSortKey: catalogFlow.setSortKey,
    setDetail: catalogFlow.setDetail, setShowForm: catalogFlow.setShowForm,
    setFormName: catalogFlow.setFormName, setFormDesc: catalogFlow.setFormDesc,
    setFormRoot: catalogFlow.setFormRoot, setFormMessage: catalogFlow.setFormMessage,
    setDeleteSkillDialog, setConfirmClearTrash,
    refresh,
    openDetail: catalogFlow.openDetail, toggle: catalogFlow.toggle, enableDisabled: catalogFlow.enableDisabled,
    create: catalogFlow.create, clearListFilters: catalogFlow.clearListFilters,
    fixingPaths: catalogFlow.fixingPaths, fixDiagnostic: catalogFlow.fixDiagnostic,
    requestDeleteSkill, runDeleteSkill,
    restoreTrash: trashFlow.restore, clearTrash,
  }
}