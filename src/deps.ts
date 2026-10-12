/**
 * The shared dependency view every management operation is written against.
 *
 * Deliberately structural: the gateway passes `ctx.skills`, the store and a few
 * closures, so tests can drive the operations with narrow fakes and no Cordis
 * runtime. There is no HTTP here any more — the Remote is the only surface.
 *
 * @module dsh-skill-mgr/deps
 */

import type { SkillDefinition, SkillSummary } from '@deepseek-ai/dsh-skill'
import type { WritableRoot } from './wire.ts'
import { resolveMgrConfig, type MgrConfig } from './config.ts'
import { rootOfPath } from './skillfs.ts'
import { dshHome } from './registry.ts'
import type { SkillMgrStore } from './store.ts'

/** Sources the manager may toggle (the user-level filesystem roots). */
export function isWritableSource(source: string): source is WritableRoot {
  return source === 'user-dsh' || source === 'user-agents'
}

/** Lookup options forwarded to the registry. */
export interface SkillLookupLike {
  cwd?: string
}

/** Structural view of `ctx.skills` the operations need. */
export interface SkillRegistryLike {
  snapshot(options?: SkillLookupLike): Promise<{ skills: SkillSummary[]; complete: boolean }>
  get(name: string, options?: SkillLookupLike): Promise<SkillDefinition | undefined>
}

/** Everything an operation may reach. */
export interface SkillMgrDeps {
  skills: SkillRegistryLike
  store: SkillMgrStore
  /** The registry file this profile owns (reported in the snapshot). */
  registryPath: string
  /** The profile root the registry lives under. */
  profileRoot: string
  /** DSH home override (tests isolate the writable roots; defaults to ~/.dsh). */
  home?: string
  /** Invalidate the registry catalog cache after manager-driven mutations. */
  invalidate?: () => void
  /** Optional invocation-count reader; absent means `skillStats` reports unavailable. */
  stats?: import('./stats.ts').SkillStatsReader
  /** Resolves the current plugin config. */
  config?: () => MgrConfig
}

/** The resolved config an operation sees (the shared resolver fills defaults). */
export function configOf(deps: SkillMgrDeps): MgrConfig {
  return resolveMgrConfig({}, deps.config?.() ?? {})
}

/** Resolve the home used for writable-root operations. */
export function homeOf(deps: SkillMgrDeps): string {
  return deps.home ?? dshHome()
}

/** A skill resolved as a manager-writable user-level file. */
export interface WritableSkill {
  skill: SkillDefinition
  /** Absolute discovery-file path (guaranteed present by the resolver). */
  path: string
  /** The writable root containing the file. */
  root: WritableRoot
}

/** A refusal carrying the message the caller answers with. */
export type WritableSkillResult = ({ ok: true } & WritableSkill) | { ok: false; error: string }

/**
 * Resolve a skill by name as something the manager may write, or a refusal.
 * Owns the guard sequence shared by every toggle, the batch toggle and delete:
 * registry lookup, writable source, writable file, and path containment inside
 * a user root.
 *
 * The registry resolves the *rank-winning* candidate, so a project skill
 * shadowing a user skill of the same name makes the user skill unmanageable
 * here; the refusal names the source so the panel can explain it.
 * @param deps - operation dependencies.
 * @param name - kebab-case skill name.
 * @returns the writable skill, or the reason it cannot be written.
 */
export async function resolveWritableSkill(deps: SkillMgrDeps, name: string): Promise<WritableSkillResult> {
  const skill = await deps.skills.get(name)
  if (skill === undefined) return { ok: false, error: 'skill not found: ' + name }
  if (!isWritableSource(skill.source)) {
    return { ok: false, error: 'source "' + skill.source + '" is managed outside the manager (read-only)' }
  }
  if (skill.path === undefined) return { ok: false, error: 'provider-managed skill has no writable file' }
  const root = rootOfPath(skill.path, homeOf(deps))
  if (root === undefined) return { ok: false, error: 'skill path is outside the manager writable roots' }
  return { ok: true, skill, path: skill.path, root }
}