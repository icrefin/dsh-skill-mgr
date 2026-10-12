/**
 * Profile inventory mutations and reads: skill detail, enable/disable (single
 * and batch), create, delete into the restorable trash, project-skill import,
 * diagnostic repair and the invocation statistics.
 *
 * The old HTTP handlers moved here verbatim; only the plumbing changed. Each
 * function takes the dependency view plus its inputs and returns the wire
 * payload, and a refusal the routes answered with `writeError` is now the
 * `SkillApplyResult` error the panel renders inline — or a
 * thrown `StoreError` where the result type has no room for a failure. A
 * mutation never returns a fresh catalog: the caller refetches `snapshot()`.
 *
 * @module dsh-skill-mgr/operations/inventory
 */

import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { isSkillName, type SkillDefinition } from '@deepseek-ai/dsh-skill'
import type {
  DiagnosticFixResult,
  SkillApplyResult,
  SkillDetail,
  SkillDetailResult,
  SkillDraft,
  SkillStatsResult,
} from '../wire.ts'
import {
  createSkill,
  disableSkill,
  enableSkill,
  fixDiagnosticFile,
  parseFrontmatter,
  readSkillInterface,
  rootOfPath,
  rootPath,
  trashSkill,
} from '../skillfs.ts'
import { errorText } from '../error-text.ts'
import { StoreError } from '../store.ts'
import { configOf, homeOf, isWritableSource, resolveWritableSkill, type SkillMgrDeps } from '../deps.ts'
import { applyInterface, toDetail } from './catalog.ts'

/** Async existence check (create/import use it before writing). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * 文件创建/修改时间 → 详情行的 addedAt/updatedAt（读取失败时省略字段，
 * 详情页不显示这两行）。禁用态与启用态详情共用。
 */
async function applyFileTimes(row: { addedAt?: number; updatedAt?: number }, path: string): Promise<void> {
  try {
    const times = await stat(path)
    row.addedAt = times.birthtimeMs
    row.updatedAt = times.mtimeMs
  } catch {
    // 文件不可读时省略时间字段。
  }
}

/* --------------------------------------------------------------- detail */

/**
 * Serve one skill's full body plus its metadata.
 *
 * The lookup is the profile inventory and nothing else: with no per-workspace
 * layer there is no second scope to fall back to. A mgr-disabled skill is not
 * discovered at all, so its body is served straight from the registry record
 * and the renamed file.
 * @param deps - operation dependencies.
 * @param name - kebab-case skill name.
 * @returns found + the detail, or `{found:false}`.
 */
export async function skillDetail(deps: SkillMgrDeps, name: string): Promise<SkillDetailResult> {
  if (name === '') throw new StoreError('validation', 'name is required')
  const skill = await deps.skills.get(name)
  if (skill === undefined) {
    // Mgr-disabled skills live outside registry discovery (renamed to
    // .disabled); serve their detail straight from the sidecar record + file.
    const record = await deps.store.getDisabled(name)
    if (record !== undefined) {
      try {
        const text = await readFile(record.path, 'utf8')
        const parsed = parseFrontmatter(text)
        if (!('error' in parsed)) {
          const disabledDetail: SkillDetail = {
            name: record.name,
            description: parsed.value.description,
            ...(parsed.value.whenToUse !== undefined ? { whenToUse: parsed.value.whenToUse } : {}),
            invocation: { ...parsed.value.invocation },
            provider: 'skill-mgr (disabled)',
            path: record.path,
            content: parsed.value.content,
          }
          await applyFileTimes(disabledDetail, record.path)
          return { found: true, skill: disabledDetail }
        }
      } catch {
        // fall through to not-found below
      }
    }
    return { found: false }
  }
  const detail = toDetail(skill)
  if (skill.path !== undefined) {
    await applyFileTimes(detail, skill.path)
    // UI metadata from agents/openai.yaml beside the skill directory (codex).
    try {
      const rb = skill.resourceBase as { kind?: string; path?: string } | undefined
      const dir = rb?.kind === 'directory' && typeof rb.path === 'string' ? rb.path : (skill.path.endsWith('SKILL.md') ? dirname(skill.path) : undefined)
      if (dir !== undefined) {
        const iface = await readSkillInterface(dir)
        if (iface !== undefined) applyInterface(detail, iface)
      }
    } catch {
      // best-effort
    }
  }
  return { found: true, skill: detail }
}

/* ------------------------------------------------------------- toggling */

/**
 * Enable or disable one profile skill.
 *
 * Disabling renames the discovery file out of the provider's shapes and
 * records the sidecar entry; enabling reverses exactly that. A file that
 * vanished behind the manager's back is reported precisely instead of as a
 * generic failure.
 * @param deps - operation dependencies.
 * @param name - kebab-case skill name.
 * @param enabled - target state.
 * @returns the write outcome the panel renders inline.
 */
export async function setGlobalSkillEnabled(deps: SkillMgrDeps, name: string, enabled: boolean): Promise<SkillApplyResult> {
  if (name === '') return { ok: false, error: 'name is required' }
  if (enabled) {
    const record = await deps.store.getDisabled(name)
    if (record === undefined) return { ok: false, error: 'skill is not mgr-disabled: ' + name }
    try {
      await enableSkill(record.path)
    } catch (error) {
      // The renamed file may have vanished (external cleanup); report
      // precisely instead of a generic failure, like the batch toggle does.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, error: 'disabled skill file is missing on disk: ' + record.path }
      }
      throw error
    }
    await deps.store.removeDisabled(name)
  } else {
    const resolved = await resolveWritableSkill(deps, name)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const disabledPath = await disableSkill(resolved.path)
    await deps.store.addDisabled({
      name,
      description: resolved.skill.description,
      path: disabledPath,
      root: resolved.root,
      disabledAt: Date.now(),
    })
  }
  deps.invalidate?.()
  return { ok: true }
}

/* -------------------------------------------------------------- create */

/**
 * Scaffold a new skill in a writable user root.
 *
 * A directory may exist without producing a registry entry (invalid
 * frontmatter — exactly what the diagnostics section reports), so an on-disk
 * name collision is refused instead of silently truncating its SKILL.md.
 * @param deps - operation dependencies.
 * @param draft - the skill to create (name, optional description and root).
 * @returns the write outcome the panel renders inline.
 */
export async function saveGlobalSkill(deps: SkillMgrDeps, draft: SkillDraft): Promise<SkillApplyResult> {
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!isSkillName(name)) return { ok: false, error: 'skill name must be kebab-case (lowercase letters, digits, dashes)' }
  // 缺省根 = user-dsh；给了但取值不合法时拒绝。
  const root = draft.root ?? 'user-dsh'
  if (!isWritableSource(root)) return { ok: false, error: 'root must be user-dsh or user-agents' }
  const existing = await deps.skills.get(name)
  if (existing !== undefined) return { ok: false, error: 'skill name already exists: ' + name }
  if (await deps.store.getDisabled(name) !== undefined) {
    return { ok: false, error: 'skill name is disabled: re-enable it from the disabled list first' }
  }
  const home = homeOf(deps)
  const target = join(rootPath(root, home), name)
  if (await pathExists(target)) {
    return { ok: false, error: 'skill directory already exists on disk: ' + name + ' (check the discovery diagnostics)' }
  }
  await createSkill(root, name, typeof draft.description === 'string' ? draft.description : '', home)
  deps.invalidate?.()
  return { ok: true }
}

/* -------------------------------------------------------------- delete */

/**
 * Move one skill (directory bundle or flat file) into the restorable trash and
 * clean up its sidecar metadata.
 *
 * A mgr-disabled skill is not in the registry, so the resolver refuses it; that
 * case is handled from its sidecar record instead, which also allows deleting a
 * group of never-enabled skills. The sidecar path came from disk originally, so
 * it is containment-checked before anything is moved — a corrupted record must
 * not be able to relocate an arbitrary directory.
 * @param deps - operation dependencies.
 * @param name - kebab-case skill name.
 * @returns the write outcome the panel renders inline.
 */
export async function removeGlobalSkill(deps: SkillMgrDeps, name: string): Promise<SkillApplyResult> {
  if (name === '') return { ok: false, error: 'name is required' }
  const home = homeOf(deps)
  const resolved = await resolveWritableSkill(deps, name)
  let moved: { path: string; source: string }
  if (!resolved.ok) {
    const disabled = await deps.store.getDisabled(name)
    if (disabled === undefined) return { ok: false, error: resolved.error }
    // sidecar 里的路径可能是外部写入/损坏的：移动前必须确认它落在可写根内
    // （正常路径由 disableSkill 保证，这里只拦异常数据）。
    if (rootOfPath(disabled.path, home) === undefined) {
      return { ok: false, error: 'disabled skill path is outside the mgr writable roots' }
    }
    // 禁用态：SKILL.md.disabled 或 *.md.disabled，直接将其所在技能整体移入回收站
    const isBundleDisabled = disabled.path.endsWith('SKILL.md.disabled')
    const source = isBundleDisabled ? dirname(disabled.path) : disabled.path
    const trashDir = join(dirname(source), '.trash')
    await mkdir(trashDir, { recursive: true })
    const target = join(trashDir, basename(source) + '-' + Date.now())
    await rename(source, target)
    moved = { path: target, source }
  } else {
    moved = await trashSkill(resolved.path)
  }
  await deps.store.addTrash({
    name,
    path: moved.path,
    movedAt: Date.now(),
    sourcePath: moved.source,
  })
  await deps.store.removeDisabled(name)
  deps.invalidate?.()
  return { ok: true }
}

/* -------------------------------------------------------------- import */

/**
 * Rewrite one auto-fixable diagnostic file in place.
 *
 * A path outside the writable roots, or a file whose frontmatter cannot be
 * repaired, is the user's error (the old route answered 400); anything else is
 * an unexpected write failure.
 * @param deps - operation dependencies.
 * @param path - the diagnostic file to repair.
 * @returns the repaired path.
 */
export async function fixDiagnostic(deps: SkillMgrDeps, path: string): Promise<DiagnosticFixResult> {
  const rawPath = path.trim()
  if (rawPath === '') throw new StoreError('validation', 'path is required')
  try {
    await fixDiagnosticFile(rawPath, homeOf(deps))
  } catch (error) {
    // skillfs 的 TypeError = 路径不在可写根内 / 文件不可自动修复：用户错误。
    if (error instanceof TypeError) throw new StoreError('validation', errorText(error))
    throw new Error(errorText(error))
  }
  deps.invalidate?.()
  return { ok: true, path: rawPath }
}

/* ---------------------------------------------------------------- stats */

/**
 * Invocation counts and last-used times.
 *
 * No reader means this deployment never wired the session-log seam; all three
 * usage displays turned off means nobody reads statistics, so the scan is not
 * even triggered (the reader is a stale-while-revalidate cache that kicks a
 * full log scan in the background).
 * @param deps - operation dependencies.
 * @returns the stats payload, available or not.
 */
export async function skillStats(deps: SkillMgrDeps): Promise<SkillStatsResult> {
  if (deps.stats === undefined) return { ok: true, available: false, stats: [] }
  const display = configOf(deps)
  if (display.showUseCount === false && display.showUseTime === false) {
    return { ok: true, available: false, stats: [] }
  }
  const stats = await deps.stats()
  return {
    ok: true,
    available: true,
    ...(deps.stats.source !== undefined ? { source: deps.stats.source } : {}),
    stats,
  }
}