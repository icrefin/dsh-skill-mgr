/**
 * The skill mgr panel — the centre-column page (the `main` slot keyed
 * `skillMgr`) showing one view: the flat profile inventory — one table over
 * every profile skill (enabled and disabled alike), the discovery diagnostics
 * and the restorable trash.
 *
 * Thin shell: state and flows live in useSkillMgr, the body lives in
 * SkillsView, the dialog family lives in dialogs.tsx and their wiring in
 * PanelDialogs.tsx. This component owns only the shared chrome (page head,
 * banners) and holds no hooks after the early return for the detail view.
 *
 * Geometry follows the built-in Plugins page: a full-height page with its own
 * scroll container, not the old centred 720px settings column.
 */

import type { SkillMgrApi } from '../api.ts'
import { tt } from '../helpers.ts'
import { IconSkillOutline16 } from '../icons.tsx'
import { PanelDialogs } from './PanelDialogs.tsx'
import { SkillDetailView } from './SkillDetailView.tsx'
import { SkillsView } from './SkillsView.tsx'
import { useSkillMgr } from './useSkillMgr.ts'
import css from './panel.module.css'

/**
 * The author credit the style contract prints inside the version chip, to the
 * right of the version itself (`STYLES.md`: `"v" + version + " Author: …"`).
 */
const AUTHOR_CREDIT = 'Author: icrefin [icrefinai@gmail.com]'

export interface SkillMgrPanelProps {
  api: SkillMgrApi
}

export function SkillMgrPanel(props: SkillMgrPanelProps): React.JSX.Element {
  const mgr = useSkillMgr(props.api)
  const {
    catalog, loading, loadError, successBanner, detail, mgrConfig, opBusy,
    deleteSkillDialog, confirmClearTrash,
    setLoadError, setSuccessBanner, setDetail, setDeleteSkillDialog, setConfirmClearTrash,
    refresh, clearTrash, runDeleteSkill, enableDisabled,
  } = mgr

  const dialogs = (
    <PanelDialogs
      deleteSkillDialog={deleteSkillDialog}
      setDeleteSkillDialog={setDeleteSkillDialog}
      runDeleteSkill={runDeleteSkill}
      confirmClearTrash={confirmClearTrash}
      setConfirmClearTrash={setConfirmClearTrash}
      clearTrash={clearTrash}
    />
  )

  // -------------------------------------------------------------- detail
  if (detail !== null) {
    const disabledRecord = catalog?.disabled.find((record) => record.name === detail.name)
    return (
      <section className={css.page} aria-busy={opBusy}>
        <SkillDetailView
          detail={detail}
          mgrConfig={mgrConfig}
          uses={mgr.uses}
          disabled={disabledRecord !== undefined}
          onEnable={disabledRecord !== undefined ? () => { void enableDisabled(disabledRecord).then(() => { setDetail(null) }) } : undefined}
          onBack={() => { setDetail(null) }}
        />
        {dialogs}
      </section>
    )
  }

  return (
    <section className={css.page} aria-busy={opBusy}>
      <header className={css.pageHead}>
        <div>
          <h1 className={css.title}><IconSkillOutline16 size={16} className={css.titleIcon} /> {tt('entry.label')}{catalog !== null ? <span className={css.pluginVersion}>{`v${catalog.pluginVersion} ${AUTHOR_CREDIT}`}</span> : null}</h1>
          <p className={css.pageIntro}>
            {catalog !== null ? tt('panel.count', { count: catalog.skills.length + catalog.disabled.length }) : tt('panel.loading')}
            {catalog !== null && catalog.disabled.length > 0 ? ' · ' + tt('panel.disabledCount', { count: catalog.disabled.length }) : null}
            {catalog !== null && !catalog.complete ? ' · ' + tt('panel.incomplete') : null}
          </p>
        </div>
        <span className={css.actions}>
          {(catalog?.duplicateNames?.length ?? 0) > 0
            ? <button type='button' className={css.opBtn} title={tt('row.duplicateHint')} onClick={() => { mgr.clearListFilters() }}>⚠ {tt('row.duplicate')}×{(catalog?.duplicateNames ?? []).length}</button>
            : null}
          <button type='button' className={css.button} disabled={loading} onClick={() => { void refresh() }}>{tt('panel.refresh')}</button>
        </span>
      </header>

      {loadError !== null ? (
        <div className={css.errorBanner} role='alert'>
          <span>{loadError}</span>
          <button type='button' className={css.button} aria-label={tt('err.dismiss')} onClick={() => { setLoadError(null) }}>{tt('err.dismiss')}</button>
        </div>
      ) : null}

      {successBanner !== null ? (
        <div className={css.successBanner} role='status'>
          <span>{successBanner}</span>
          <button type='button' className={css.button} aria-label={tt('err.dismiss')} onClick={() => { setSuccessBanner(null) }}>{tt('err.dismiss')}</button>
        </div>
      ) : null}

      <div className={css.view}>
        <SkillsView mgr={mgr} />
      </div>

      {dialogs}
    </section>
  )
}