/**
 * useCatalogFlow — 目录域：catalog 加载、详情、单个技能开关（含禁用态复原）、
 * 删除、新建、诊断修复，以及平铺表格的过滤/排序派生。跨域刷新只通过 shared
 * 通知，不直接碰其他域的 state。
 *
 * 分组视图随市场与来源跟踪一起移除：这里不再派生分组、也不再有整组开关，
 * 表格行由视图把 `sorted`（启用）与 `filteredDisabled`（已禁用）拼成一张表。
 */

import { useCallback, useMemo, useState, type FormEvent } from 'react'
import type { CatalogSkill, DisabledSkill, SkillDetail, WritableRoot } from '../../../wire.ts'
import type { CatalogView, SkillMgrApi } from '../../api.ts'
import { errorMessage, tt } from '../../helpers.ts'
import { setPluginVersion } from '../../panel-config.ts'
import { sortSkills, type SortKey } from '../../grouping.ts'
import { runFlow, type FlowNotices, type UsesMap } from './shared.ts'

export function useCatalogFlow(api: SkillMgrApi, uses: UsesMap, shared: FlowNotices) {
  const [catalog, setCatalog] = useState<CatalogView | null>(null)
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busyNames, setBusyNames] = useState<ReadonlySet<string>>(new Set())
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [invocationFilter, setInvocationFilter] = useState<'all' | 'model' | 'user'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  /** 「新建技能」对话框的开合（表头的新建按钮打开它）。 */
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formRoot, setFormRoot] = useState<WritableRoot>('user-dsh')
  const [formBusy, setFormBusy] = useState(false)
  const [formMessage, setFormMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [fixingPaths, setFixingPaths] = useState<ReadonlySet<string>>(new Set())

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await api.catalog()
      setCatalog(next)
      // 版本号跟着目录一起到；设置卡片的徽标从这里取（面板自己直接渲染）。
      setPluginVersion(next.pluginVersion)
      shared.clearFail()
    } catch (error) {
      shared.fail(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [api, shared])

  const openDetail = useCallback(async (name: string): Promise<void> => {
    setDetailLoading(true)
    await runFlow(shared, async () => {
      setDetail(await api.skill(name))
    }, () => setDetailLoading(false))
  }, [api, shared])

  const toggle = useCallback(async (skill: CatalogSkill, enabled: boolean): Promise<void> => {
    setBusyNames((previous) => new Set(previous).add(skill.name))
    await runFlow(shared, async () => {
      setCatalog(await api.toggle(skill.name, enabled))
    }, () => {
      setBusyNames((previous) => {
        const next = new Set(previous)
        next.delete(skill.name)
        return next
      })
    })
  }, [api, shared])

  const enableDisabled = useCallback(async (record: DisabledSkill): Promise<void> => {
    setBusyNames((previous) => new Set(previous).add(record.name))
    await runFlow(shared, async () => {
      setCatalog(await api.toggle(record.name, true))
    }, () => {
      setBusyNames((previous) => {
        const next = new Set(previous)
        next.delete(record.name)
        return next
      })
    })
  }, [api, shared])

  /** 删除单个技能（移入回收站）；目录与回收站由调用方各自重读。 */
  const deleteSkill = useCallback(async (name: string): Promise<void> => {
    setBusyNames((previous) => new Set(previous).add(name))
    await runFlow(shared, async () => {
      await api.deleteSkill(name)
      await load()
      shared.succeed(tt('delete.done', { name }))
    }, () => {
      setBusyNames((previous) => {
        const next = new Set(previous)
        next.delete(name)
        return next
      })
    })
  }, [api, load, shared])

  const fixDiagnostic = useCallback(async (path: string): Promise<void> => {
    setFixingPaths((previous) => new Set(previous).add(path))
    await runFlow(shared, async () => {
      const confirmed = window.confirm(tt('diag.fixConfirm', { path }))
      if (!confirmed) return
      await api.fixDiagnostic(path)
      await load()
      shared.succeed(tt('diag.fixed'))
    }, () => {
      setFixingPaths((previous) => {
        const next = new Set(previous)
        next.delete(path)
        return next
      })
    })
  }, [api, load, shared])

  const create = useCallback(async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setFormBusy(true)
    setFormMessage(null)
    shared.succeed(null)
    try {
      const result = await api.create({ name: formName, description: formDesc, root: formRoot })
      // The dialog closes on success, so the confirmation lives in the green
      // banner outside it (a success message inside the closing dialog is
      // never visible).
      shared.succeed(tt('form.success') + result.path)
      setFormName('')
      setFormDesc('')
      setShowForm(false)
      await load()
    } catch (error) {
      setFormMessage({ kind: 'error', text: tt('form.error') + errorMessage(error) })
    } finally {
      setFormBusy(false)
    }
  }, [api, formName, formDesc, formRoot, load, shared])

  // ------------------------------------------------------------- derived

  const normalized = search.trim().toLocaleLowerCase()

  /** 启用中的技能：搜索 + 来源 + 调用方式三个过滤条件。 */
  const filtered = useMemo(() => (catalog?.skills ?? []).filter((skill) => {
    if (invocationFilter === 'model' && !skill.invocation.modelInvocable) return false
    if (invocationFilter === 'user' && !skill.invocation.userInvocable) return false
    if (sourceFilter !== 'all' && skill.source !== sourceFilter) return false
    if (normalized.length === 0) return true
    return skill.name.toLocaleLowerCase().includes(normalized)
      || skill.description.toLocaleLowerCase().includes(normalized)
      || skill.displayName?.toLocaleLowerCase().includes(normalized)
      || skill.shortDescription?.toLocaleLowerCase().includes(normalized)
  }), [catalog, normalized, invocationFilter, sourceFilter])

  /** 已禁用行与启用行同规则过滤（搜索 + 来源），表格里按同一张表渲染。 */
  const filteredDisabled = useMemo(() => (catalog?.disabled ?? []).filter((record) => {
    if (sourceFilter !== 'all' && record.root !== sourceFilter) return false
    if (normalized.length === 0) return true
    return record.name.toLocaleLowerCase().includes(normalized) || record.description.toLocaleLowerCase().includes(normalized)
  }), [catalog, normalized, sourceFilter])

  /** Rows actually rendered with a shortened description (shortDescription in use). */
  const shortenedCount = useMemo(() => filtered.filter((skill) => skill.shortDescription !== undefined).length, [filtered])
  /** 排序后的技能列表（调用次数未知按 0 处理）；已禁用行固定按名称跟在后面。 */
  const sorted = useMemo(() => sortSkills(filtered, sortKey, (name) => uses.get(name)?.count), [filtered, sortKey, uses])
  const sortedDisabled = useMemo(() => [...filteredDisabled].sort((a, b) => a.name.localeCompare(b.name)), [filteredDisabled])

  /**
   * 来源筛选选项：目录里出现的 source 值（含已禁用行的可写根）去重排序。
   * 平铺表格下它只是一个等长选项列表——不再按分组或来源记录派生。
   */
  const sourceOptions = useMemo(() => {
    const values = new Set<string>()
    for (const skill of catalog?.skills ?? []) values.add(skill.source)
    for (const record of catalog?.disabled ?? []) values.add(record.root)
    return [...values].sort()
  }, [catalog])

  /** 表格总行数（启用 + 已禁用），用于「显示 N/M」提示与空状态判定。 */
  const totalCount = (catalog?.skills.length ?? 0) + (catalog?.disabled.length ?? 0)

  /** Clear the list filters (search + source + invocation) back to the full view. */
  const clearListFilters = useCallback((): void => {
    setSearch('')
    setSourceFilter('all')
    setInvocationFilter('all')
  }, [])

  return {
    catalog, loading, detail, detailLoading, busyNames, search, sourceFilter,
    invocationFilter, sortKey, showForm, formName, formDesc, formRoot, formBusy,
    formMessage, fixingPaths,
    filtered, sorted, sortedDisabled, shortenedCount, sourceOptions, totalCount,
    setDetail, setSearch, setSourceFilter, setInvocationFilter, setSortKey, setShowForm,
    setFormName, setFormDesc, setFormRoot, setFormMessage,
    load, openDetail, toggle, enableDisabled, deleteSkill, fixDiagnostic, create, clearListFilters,
  }
}