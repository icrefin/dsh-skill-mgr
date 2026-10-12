/**
 * Browser-side data access for the skill manager panel.
 *
 * The panel talks to exactly one place: the `skillMgr` Typert Remote. This
 * module mounts that Remote contribution (`ctx.remote.$mount(TYPERT_REMOTE)`),
 * unwraps its `RemoteResult` envelope, and presents the same call shapes the
 * panel's hooks were written against — so a view component never sees a
 * transport envelope or a namespace service.
 *
 * `snapshot()` is the single read: it is cached for the duration of one render
 * pass (the hooks load in parallel on mount and share one round trip) and
 * invalidated by every mutation.
 *
 * The surface mirrors `dsh-mcp-mgr`'s: one flat profile inventory, the
 * restorable trash, and nothing else — there is no market, no upstream source
 * tracking, no repo import and no per-workspace layer left to talk to.
 *
 * @module dsh-skill-mgr/client/api
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the client assembly's Context.remote augmentation.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls this package's remote-namespace augmentation.
import type { SkillMgrNamespace } from '../typert.remote-client.ts'
import type {} from '../typert.remote-client.ts'
import type {
  CatalogSkill,
  DiagnosticEntry,
  DisabledSkill,
  SkillApplyResult,
  SkillDetail,
  SkillManagerSnapshot,
  SkillStatsResult,
  TrashClearResult,
  TrashEntry,
  TrashRestoreResult,
} from '../wire.ts'
import { TYPERT_REMOTE } from '../typert.remote-client.ts'

/** A management call that failed, carrying the host's own message. */
export class SkillMgrApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillMgrApiError'
  }
}

/** The catalog view the panel renders (a projection of one snapshot). */
export interface CatalogView {
  ok: true
  pluginVersion: string
  complete: boolean
  /** The profile registry file the panel manages. */
  registryPath: string
  skills: CatalogSkill[]
  disabled: DisabledSkill[]
  diagnostics: DiagnosticEntry[]
  duplicateNames?: string[]
}

/** The batch answer the panel renders. */
/** The Remote client handle `apply()` builds once and passes to the panel. */
export interface SkillMgrClient {
  api: SkillMgrApi
  dispose: () => void
}

/**
 * Mount the Remote contribution in the caller's fiber.
 * @param ctx - client root context carrying the `remote` service.
 * @returns the panel's data client and the mount disposer.
 */
export async function createSkillMgrClient(ctx: ClientContext): Promise<SkillMgrClient> {
  const dispose = await ctx.remote.$mount(TYPERT_REMOTE)
  return { api: new SkillMgrApi(ctx), dispose }
}

/** Unwrap one Remote result, raising the transport-level failure. */
function unwrap<T>(result: RemoteResult<T>, label: string): T {
  if (!result.ok) throw new SkillMgrApiError(`skillMgr.${label} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

/**
 * Turn one write's `{ok:false,error}` into a thrown error.
 *
 * Reads answer their payload, so only writes carry this envelope; the panel's
 * mutation funnel catches the throw and renders the message it already
 * knows how to show.
 * @param result - the write result.
 * @param label - method name for the fallback message.
 * @returns nothing; throws when the write did not land.
 */
function expectOk(result: SkillApplyResult, label: string): void {
  if (!result.ok) throw new SkillMgrApiError(result.error || `skillMgr.${label} failed`)
}

/** The panel's data client, backed by the `skillMgr` Remote namespace. */
export class SkillMgrApi {
  /** Snapshot cache: one round trip per render pass, invalidated by every write. */
  private cached: Promise<SkillManagerSnapshot> | undefined

  /** @param ctx - client root context (the namespace is read lazily, never injected). */
  constructor(private readonly ctx: ClientContext) {}

  /**
   * The namespace service. Read through `ctx.get` on purpose: this plugin
   * mounts the namespace itself, and injecting a self-provided service
   * deadlocks the fiber.
   */
  private namespace(): SkillMgrNamespace {
    const service = this.ctx.get('remote.skillMgr') as SkillMgrNamespace | undefined
    if (service === undefined) throw new SkillMgrApiError('the skillMgr Remote namespace is not mounted')
    return service
  }

  /** Fetch a fresh snapshot and install it as the cache. */
  private fetchSnapshot(): Promise<SkillManagerSnapshot> {
    return this.namespace().snapshot().then((result) => unwrap(result, 'snapshot'))
  }

  /** The current snapshot, fetching it once per cache generation. */
  snapshot(): Promise<SkillManagerSnapshot> {
    this.cached ??= this.fetchSnapshot()
    return this.cached
  }

  /** Drop the cache and fetch again; every write ends with this. */
  refresh(): Promise<SkillManagerSnapshot> {
    this.cached = this.fetchSnapshot()
    return this.cached
  }

  // ------------------------------------------------------------- catalog

  /** The profile inventory, projected from one snapshot. */
  async catalog(): Promise<CatalogView> {
    return projectCatalog(await this.snapshot())
  }

  /** One skill's body and metadata. */
  async skill(name: string): Promise<SkillDetail> {
    const result = unwrap(await this.namespace().skillDetail(name), 'skillDetail')
    if (!result.found) throw new SkillMgrApiError('skill not found: ' + name)
    return result.skill
  }

  /** Enable or disable one skill; resolves with the fresh catalog. */
  async toggle(name: string, enabled: boolean): Promise<CatalogView> {
    expectOk(unwrap(await this.namespace().setGlobalSkillEnabled(name, enabled), 'setGlobalSkillEnabled'), 'setGlobalSkillEnabled')
    return projectCatalog(await this.refresh())
  }

  /** Scaffold a new skill in a writable root. */
  async create(payload: { name: string; description?: string; root?: 'user-dsh' | 'user-agents' }): Promise<{ ok: true; path: string; root: string }> {
    expectOk(unwrap(await this.namespace().saveGlobalSkill(payload), 'saveGlobalSkill'), 'saveGlobalSkill')
    await this.refresh()
    const root = payload.root ?? 'user-dsh'
    return { ok: true, path: `${root}/${payload.name}`, root }
  }

  /** Move one writable skill into the restorable trash. */
  async deleteSkill(name: string): Promise<{ ok: true; name: string }> {
    expectOk(unwrap(await this.namespace().removeGlobalSkill(name), 'removeGlobalSkill'), 'removeGlobalSkill')
    await this.refresh()
    return { ok: true, name }
  }

  /** Invocation counts + last-used times. */
  async stats(): Promise<SkillStatsResult> {
    return unwrap(await this.namespace().skillStats(), 'skillStats')
  }

  /** Auto-fix one fixable diagnostic in place. */
  async fixDiagnostic(path: string): Promise<void> {
    unwrap(await this.namespace().fixDiagnostic(path), 'fixDiagnostic')
    await this.refresh()
  }

  // --------------------------------------------------------------- trash

  /** The restorable trash, projected from one snapshot. */
  async trash(): Promise<TrashEntry[]> {
    return (await this.snapshot()).trash
  }

  /** Restore one skill from the trash. */
  async restoreTrash(name: string): Promise<TrashRestoreResult> {
    const result = unwrap(await this.namespace().restoreTrashedSkill(name), 'restoreTrashedSkill')
    await this.refresh()
    return result
  }

  /** Permanently delete everything in the trash. */
  async clearTrash(): Promise<TrashClearResult> {
    const result = unwrap(await this.namespace().clearTrash(), 'clearTrash')
    await this.refresh()
    return result
  }
}

/** Project one snapshot onto the flat catalog view the Skills tab renders. */
function projectCatalog(snapshot: SkillManagerSnapshot): CatalogView {
  return {
    ok: true,
    pluginVersion: snapshot.pluginVersion,
    complete: snapshot.complete,
    registryPath: snapshot.registryPath,
    skills: snapshot.skills,
    disabled: snapshot.disabled,
    diagnostics: snapshot.diagnostics,
    ...(snapshot.duplicateNames !== undefined ? { duplicateNames: snapshot.duplicateNames } : {}),
  }
}