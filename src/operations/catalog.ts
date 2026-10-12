/**
 * Profile-scoped inventory: the catalog rows, the per-row timestamps and
 * `agents/openai.yaml` metadata, duplicate-identity detection and the
 * discovery diagnostics.
 *
 * This module renders what the registry reports for the profile-level roots —
 * a `snapshot()` without a `cwd` — and never unions a project root in, because
 * the panel manages the profile inventory and nothing else. The row primitives
 * (`buildCatalogRows`, `applyInterface`, `toDetail`) are shared with the
 * skill-detail view so both render a skill the same way.
 *
 * @module dsh-skill-mgr/operations/catalog
 */

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillDefinition, SkillSummary } from '@deepseek-ai/dsh-skill'
import type { CatalogSkill, DiagnosticEntry, DisabledSkill, SkillDetail } from '../wire.ts'
import { readSkillInterface, rootPath, scanDiagnostics, type SkillInterface } from '../skillfs.ts'
import { homeOf, isWritableSource, type SkillMgrDeps } from '../deps.ts'

/**
 * The profile-scoped inventory the management snapshot carries: the enabled
 * rows, the mgr-disabled records, the discovery diagnostics and the ambiguous
 * names. There is no `pluginVersion`/`ok` here — the snapshot owns those, and
 * mutations answer `SkillApplyResult` and let the caller refetch.
 */
export interface CatalogView {
  /** Whether discovery completed within a stable catalog revision. */
  complete: boolean
  skills: CatalogSkill[]
  disabled: DisabledSkill[]
  diagnostics: DiagnosticEntry[]
  /** Skill names claimed by more than one root (first wins); absent when clean. */
  duplicateNames?: string[]
}

/** One skill to render as a catalog row. */
export interface CatalogRowInput {
  skill: SkillSummary
}

/**
 * Build the profile-scoped inventory.
 * @param deps - operation dependencies.
 * @returns the enabled rows, disabled records, diagnostics and duplicate names.
 */
export async function buildProfileCatalog(deps: SkillMgrDeps): Promise<CatalogView> {
  const home = homeOf(deps)
  const snapshot = await deps.skills.snapshot()
  // Same-name entries stay distinct per (source, provider): the same skill
  // reappearing across snapshots is one skill, not a duplicate, while two
  // providers (or two roots) claiming a name are genuinely ambiguous.
  const byName = new Map<string, SkillSummary>()
  const identitiesByName = new Map<string, Set<string>>()
  for (const skill of snapshot.skills) {
    let identities = identitiesByName.get(skill.name)
    if (identities === undefined) {
      identities = new Set()
      identitiesByName.set(skill.name, identities)
    }
    identities.add(skill.source + '\0' + skill.provider)
    if (!byName.has(skill.name)) byName.set(skill.name, skill)
  }
  const disabled = await deps.store.listDisabled()
  // A mgr-disabled record whose name is also enabled elsewhere hides one
  // identity behind the toggle; flag it as well.
  for (const entry of disabled) {
    let identities = identitiesByName.get(entry.name)
    if (identities === undefined) {
      identities = new Set()
      identitiesByName.set(entry.name, identities)
    }
    identities.add('mgr-disabled\0' + entry.root)
  }
  const duplicateNames = [...identitiesByName.entries()]
    .filter(([, identities]) => identities.size > 1)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b))
  const skills = await buildCatalogRows(deps, [...byName.values()].map((skill) => ({ skill })))
  const diagnostics = [
    ...(await scanDiagnostics('user-dsh', home)),
    ...(await scanDiagnostics('user-agents', home)),
  ]
  return {
    complete: snapshot.complete,
    skills,
    disabled,
    diagnostics,
    ...(duplicateNames.length > 0 ? { duplicateNames } : {}),
  }
}

/**
 * Render catalog rows for one set of skills.
 *
 * 添加/更新时间 = 用户级技能文件的创建/修改时间（排序与详情展示用）。
 * `snapshot` 只给 SkillSummary（无 path），所以按可写根推断路径；非用户级
 * 来源没有稳定路径，省略字段，客户端排序会把它放到末尾。全部技能并发收集
 * （面板每几秒轮询一次，逐个串行 stat 会让响应随技能数量线性变慢）。
 * @param deps - operation dependencies.
 * @param inputs - the skills to render, in output order.
 * @returns the wire rows, in input order.
 */
export async function buildCatalogRows(deps: SkillMgrDeps, inputs: readonly CatalogRowInput[]): Promise<CatalogSkill[]> {
  const home = homeOf(deps)
  const timesByName = new Map<string, { addedAt: number; updatedAt: number }>()
  await Promise.all(inputs.map(async ({ skill }) => {
    if (!isWritableSource(skill.source)) return
    if (timesByName.has(skill.name)) return
    const base = rootPath(skill.source, home)
    for (const candidate of [join(base, skill.name, 'SKILL.md'), join(base, skill.name), join(base, skill.name + '.md')]) {
      try {
        const times = await stat(candidate)
        timesByName.set(skill.name, { addedAt: times.birthtimeMs, updatedAt: times.mtimeMs })
        return
      } catch {
        // 目录/文件不存在则尝试下一个候选路径。
      }
    }
  }))
  // UI metadata from agents/openai.yaml (codex SkillInterface) — best-effort,
  // no error when missing. Keyed by input index rather than by name, so two
  // rows can never share the last interface read.
  const interfaces = await Promise.all(inputs.map(async ({ skill }) => {
    for (const dir of interfaceDirsFor(skill, home)) {
      try {
        const iface = await readSkillInterface(dir)
        if (iface !== undefined) return iface
      } catch {
        // best-effort
      }
    }
    return undefined
  }))
  return inputs.map(({ skill }, index) => {
    const row: CatalogSkill = {
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
      invocation: {
        modelInvocable: skill.invocation.modelInvocable,
        userInvocable: skill.invocation.userInvocable,
      },
      provider: skill.provider,
      writable: isWritableSource(skill.source),
      source: skill.source,
    }
    const times = timesByName.get(skill.name)
    if (times !== undefined) {
      row.addedAt = times.addedAt
      row.updatedAt = times.updatedAt
    }
    const iface = interfaces[index]
    if (iface !== undefined) applyInterface(row, iface)
    return row
  })
}

/**
 * Where a skill's `agents/openai.yaml` may live, in probe order. A writable
 * skill sits directly under its user root. A project skill's directory is not
 * derivable without the workspace that contributed it, and the profile
 * inventory never contains one, so it gets no interface metadata.
 */
function interfaceDirsFor(skill: SkillSummary, home: string): string[] {
  if (isWritableSource(skill.source)) return [join(rootPath(skill.source, home), skill.name)]
  return []
}

/** `agents/openai.yaml` interface metadata → a catalog/detail row (shared by both). */
export function applyInterface<T extends SkillInterface>(row: T, iface: SkillInterface): void {
  if (iface.displayName !== undefined) row.displayName = iface.displayName
  if (iface.shortDescription !== undefined) row.shortDescription = iface.shortDescription
  if (iface.brandColor !== undefined) row.brandColor = iface.brandColor
  if (iface.iconSmall !== undefined) row.iconSmall = iface.iconSmall
  if (iface.iconLarge !== undefined) row.iconLarge = iface.iconLarge
  if (iface.defaultPrompt !== undefined) row.defaultPrompt = iface.defaultPrompt
}

/** Map a loaded definition onto the wire detail shape. */
export function toDetail(skill: SkillDefinition): SkillDetail {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
    invocation: {
      modelInvocable: skill.invocation.modelInvocable,
      userInvocable: skill.invocation.userInvocable,
    },
    provider: skill.provider,
    ...(skill.path !== undefined ? { path: skill.path } : {}),
    content: skill.content,
  }
}
