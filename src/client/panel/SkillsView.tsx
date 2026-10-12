/**
 * Skills tab body: one flat table over the whole profile inventory.
 *
 * The grouped card list (one card per upstream collection and per registry
 * root) is gone with the market and the source tracking: every profile skill —
 * enabled or disabled — is one row of the same table, and a skill's `source`
 * is a badge in its own column rather than a grouping key. The tab keeps three
 * sections, in order: the table, the discovery diagnostics, and the restorable
 * trash. Project skills are not listed here: they belong to their workspace and
 * render in this view.
 *
 * Geometry follows the MCP manager's global-server table: a panel head with
 * the stored-location hint and the primary Add button, the filter bar, then a
 * `table-layout: fixed` table whose disabled rows are dimmed in place.
 */

import { useMemo, useState, type JSX } from 'react'
import type { CatalogSkill, DisabledSkill } from '../../wire.ts'
import type { PanelConfig } from '../panel-config.ts'
import { isDisplayNameDistinct, sourceLabel, tt } from '../helpers.ts'
import { dotStyle, relativeTimeText } from './format.ts'
import { NewSkillDialog } from './dialogs.tsx'
import type { SkillMgrState } from './useSkillMgr.ts'
import css from './panel.module.css'

/** One table row: an enabled skill or its disabled `.disabled` record. */
interface SkillTableRow {
  name: string
  enabled: boolean
  writable: boolean
  source: string
  /** Short description when the metadata carries one, else the full one. */
  description: string
  skill: CatalogSkill | undefined
  record: DisabledSkill | undefined
  duplicate: boolean
}

/** Invocation dot for one enabled row (model-invocable wins over user-only). */
function InvocationDot(props: { skill: CatalogSkill; mgrConfig: PanelConfig }): JSX.Element | null {
  const { skill, mgrConfig } = props
  if (skill.invocation.modelInvocable) return <span className={css.dot + ' ' + css.dotModel} style={dotStyle(mgrConfig?.dotModelColor)} title={tt('legend.model')} />
  if (skill.invocation.userInvocable) return <span className={css.dot + ' ' + css.dotUser} style={dotStyle(mgrConfig?.dotUserColor)} title={tt('legend.user')} />
  return null
}

export function SkillsView(props: { mgr: SkillMgrState }): JSX.Element {
  const { mgr } = props
  const { catalog, sorted, sortedDisabled, sourceOptions, totalCount, shortenedCount } = mgr
  /** 「筛选」面板开合（来源 + 调用方式收进这里；搜索/排序/图例始终可见）。 */
  const [filtersOpen, setFiltersOpen] = useState(false)

  /** 重复技能名集合：整表只建一次，行内用 has 取代逐行线性 includes。 */
  const duplicateNames = useMemo(() => new Set(catalog?.duplicateNames ?? []), [catalog])

  /** 启用行 + 已禁用行合成一张表：启用在前（按当前排序），禁用按名称跟随。 */
  const rows: SkillTableRow[] = [
    ...sorted.map((skill): SkillTableRow => ({
      name: skill.name,
      enabled: true,
      writable: skill.writable,
      source: skill.source,
      description: skill.shortDescription ?? skill.description,
      skill,
      record: undefined,
      duplicate: duplicateNames.has(skill.name),
    })),
    ...sortedDisabled.map((record): SkillTableRow => ({
      name: record.name,
      enabled: false,
      writable: true,
      source: record.root,
      description: record.description,
      skill: undefined,
      record,
      duplicate: duplicateNames.has(record.name),
    })),
  ]

  const listFiltered = mgr.sourceFilter !== 'all' || mgr.invocationFilter !== 'all'
  const activeFilterCount = (mgr.sourceFilter !== 'all' ? 1 : 0) + (mgr.invocationFilter !== 'all' ? 1 : 0)

  return (
    <>
      <div className={css.panelHead}>
        <span className={css.hint + ' ' + css.panelHint} title={catalog?.registryPath}>
          {catalog !== null && catalog.registryPath !== '' ? tt('table.registry', { path: catalog.registryPath }) : ''}
        </span>
        <button type='button' className={css.button + ' ' + css.primary} onClick={() => { mgr.setShowForm(true) }}>{tt('panel.new')}</button>
      </div>

      <div className={css.filterBar}>
        <select className={css.select} value={mgr.sortKey} onChange={(event) => { mgr.setSortKey(event.target.value as 'name' | 'added' | 'uses') }}>
          <option value='name'>{tt('sort.name')}</option>
          <option value='added'>{tt('sort.added')}</option>
          <option value='uses'>{tt('sort.uses')}</option>
        </select>
        <input className={css.search} value={mgr.search} onChange={(event) => { mgr.setSearch(event.target.value) }} placeholder={tt('panel.search')} />
        <button
          type='button'
          className={css.legendToggle + (mgr.showLegend ? ' ' + css.legendToggleActive : '')}
          aria-pressed={mgr.showLegend}
          onClick={() => { mgr.setShowLegend((value) => !value) }}
          title={tt('legend.hint')}
        >?</button>
        <button
          type='button'
          className={css.button + (filtersOpen || activeFilterCount > 0 ? ' ' + css.primary : '')}
          aria-expanded={filtersOpen}
          aria-controls='skill-mgr-filter-panel'
          onClick={() => { setFiltersOpen((value) => !value) }}
        >{tt('filter.title')}{activeFilterCount > 0 ? ' (' + activeFilterCount + ')' : ''}</button>
      </div>

      {filtersOpen ? (
        <div className={css.filterPanel} id='skill-mgr-filter-panel'>
          <label className={css.filterField}>
            <span className={css.formLabel}>{tt('filter.source')}</span>
            <select className={css.select} value={mgr.sourceFilter} onChange={(event) => { mgr.setSourceFilter(event.target.value) }}>
              <option value='all'>{tt('filter.allSources')}</option>
              {sourceOptions.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
            </select>
          </label>
          <label className={css.filterField}>
            <span className={css.formLabel}>{tt('filter.invocation')}</span>
            <select className={css.select} value={mgr.invocationFilter} onChange={(event) => { mgr.setInvocationFilter(event.target.value as 'all' | 'model' | 'user') }}>
              <option value='all'>{tt('filter.invocationAll')}</option>
              <option value='model'>{tt('filter.modelOnly')}</option>
              <option value='user'>{tt('filter.userOnly')}</option>
            </select>
          </label>
          {activeFilterCount > 0 ? (
            <button type='button' className={css.opBtn} onClick={() => { mgr.setSourceFilter('all'); mgr.setInvocationFilter('all') }}>{tt('filter.clear')}</button>
          ) : null}
        </div>
      ) : null}

      {mgr.showLegend ? (
        <div className={css.legend}>
          <span className={css.legendItem}><span className={css.dot + ' ' + css.dotModel} style={dotStyle(mgr.mgrConfig.dotModelColor)} />{tt('legend.model')}</span>
          <span className={css.legendItem}><span className={css.dot + ' ' + css.dotUser} style={dotStyle(mgr.mgrConfig.dotUserColor)} />{tt('legend.user')}</span>
          <span className={css.legendHint}>{tt('legend.hint')}</span>
        </div>
      ) : null}

      {mgr.loading && catalog === null ? (
        <div className={css.skeleton} role='status' aria-label={tt('panel.loading')}>
          <div className={css.skeletonRow} />
          <div className={css.skeletonRow} />
          <div className={css.skeletonRow} />
        </div>
      ) : null}

      {catalog !== null ? (
        <>
          {rows.length !== totalCount ? (
            <div className={css.hintLine + ' ' + css.hintInline}>
              <span>{tt('filter.showing', { shown: rows.length, total: totalCount, filtered: listFiltered || mgr.search.trim() !== '' ? tt('filter.filteredSuffix') : '' })}</span>
              {shortenedCount > 0 ? <span title={tt('filter.shortened', { count: shortenedCount })}>{tt('filter.shortened', { count: shortenedCount })}</span> : null}
            </div>
          ) : null}

          {rows.length === 0 ? (
            <div className={css.empty}>{listFiltered || mgr.search.trim() !== '' ? tt('panel.empty') : tt('panel.emptyAll')}</div>
          ) : null}

          {rows.length > 0 ? (
            <table className={css.table}>
              <thead>
                <tr>
                  <th>{tt('table.name')}</th>
                  <th>{tt('table.source')}</th>
                  <th>{tt('table.description')}</th>
                  <th>{tt('table.status')}</th>
                  <th>{tt('table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const stat = mgr.uses.get(row.name)
                  const count = stat?.count ?? 0
                  const lastUsed = stat?.lastUsed
                  const busy = mgr.busyNames.has(row.name)
                  return (
                    <tr key={row.name} data-enabled={row.enabled}>
                      <td className={css.nowrapCell} title={row.name}>
                        <span className={css.rowName}>
                          <span className={css.rowNameText}>{row.name}</span>
                          {isDisplayNameDistinct(row.name, row.skill?.displayName) ? <span className={css.displayName} title={row.skill?.displayName}>{row.skill?.displayName}</span> : null}
                          {row.skill !== undefined ? <InvocationDot skill={row.skill} mgrConfig={mgr.mgrConfig} /> : null}
                          {row.duplicate ? <span className={css.badge + ' ' + css.badgeDanger} title={tt('row.duplicateHint')}>{tt('row.duplicate')}</span> : null}
                          {count > 0 && mgr.mgrConfig?.showUseCount !== false ? <span className={css.useCount}>{count}</span> : null}
                          {lastUsed !== undefined && mgr.mgrConfig?.showUseTime !== false ? <span className={css.useTime}>{relativeTimeText(lastUsed)}</span> : null}
                        </span>
                      </td>
                      <td className={css.nowrapCell}><span className={css.badge + ' ' + css.badgeSource}>{sourceLabel(row.source)}</span></td>
                      <td className={css.detailCell} title={row.description}>{row.description}</td>
                      <td className={css.nowrapCell}>
                        <span className={css.statusBadge} data-status={row.enabled ? 'enabled' : 'disabled'}>{tt(row.enabled ? 'status.enabled' : 'status.disabled')}</span>
                      </td>
                      <td className={css.rowActions}>
                        <button
                          type='button'
                          className={css.opBtn}
                          title={tt('row.open', { name: row.name })}
                          onClick={() => { void mgr.openDetail(row.name) }}
                        >{tt('row.inspect')}</button>
                        {row.writable ? (
                          row.enabled
                            ? <button type='button' className={css.opBtn} disabled={busy} onClick={() => { if (row.skill !== undefined) void mgr.toggle(row.skill, false) }}>{tt('row.disable')}</button>
                            : <button type='button' className={css.opBtn} disabled={busy} onClick={() => { if (row.record !== undefined) void mgr.enableDisabled(row.record) }}>{tt('row.enable')}</button>
                        ) : <span className={css.muted}>{tt('row.readonly')}</span>}
                        {row.writable ? (
                          <button
                            type='button'
                            className={css.opBtn + ' ' + css.opDanger}
                            disabled={busy || mgr.opBusy}
                            onClick={() => { mgr.requestDeleteSkill(row.name) }}
                          >{tt('row.delete')}</button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : null}

          {catalog.diagnostics.length > 0 ? (
            <section className={css.section}>
              <div className={css.sectionTitle}>{tt('panel.diagnostics')}</div>
              {catalog.diagnostics.map((entry) => (
                <div key={entry.path} className={css.diagRow}>
                  <div className={css.diagRowMain}>
                    <div className={css.diagPath}>{entry.path}</div>
                    <div className={css.diagReason}>{entry.reason}</div>
                  </div>
                  {entry.fixable === true ? (
                    <button
                      type='button'
                      className={css.opBtn + ' ' + css.diagAction}
                      disabled={mgr.fixingPaths.has(entry.path)}
                      onClick={() => { void mgr.fixDiagnostic(entry.path) }}
                    >{mgr.fixingPaths.has(entry.path) ? tt('diag.fixing') : tt('diag.fix')}</button>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          {mgr.trash.length > 0 ? (
            <section className={css.section}>
              <div className={css.sectionTitle + ' ' + css.sectionHeadRow}>
                <span className={css.sectionTitleFill}>{tt('trash.heading')}</span>
                <button type='button' className={css.opBtn + ' ' + css.opDanger} disabled={mgr.opBusy} onClick={() => { mgr.setConfirmClearTrash(true) }}>{tt('trash.clear')}</button>
              </div>
              {mgr.trash.map((entry) => (
                <div key={entry.name} className={css.row + ' ' + css.rowStatic}>
                  <div className={css.rowMain}>
                    <div className={css.rowName}>{entry.name}</div>
                    <div className={css.rowDesc}>{relativeTimeText(entry.movedAt)}</div>
                  </div>
                  <button type='button' className={css.opBtn} disabled={mgr.opBusy} onClick={() => { void mgr.restoreTrash(entry.name) }}>{tt('trash.restore')}</button>
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : null}

      {mgr.detailLoading ? <div className={css.empty}>{tt('detail.loading')}</div> : null}

      {mgr.showForm ? (
        <NewSkillDialog
          name={mgr.formName}
          desc={mgr.formDesc}
          root={mgr.formRoot}
          busy={mgr.formBusy}
          message={mgr.formMessage}
          onName={mgr.setFormName}
          onDesc={mgr.setFormDesc}
          onRoot={mgr.setFormRoot}
          onSubmit={(event) => { void mgr.create(event) }}
          onCancel={() => { mgr.setShowForm(false); mgr.setFormMessage(null) }}
        />
      ) : null}
    </>
  )
}