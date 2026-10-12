/**
 * The `skillMgr` Remote service: every management operation the panel can ask
 * for, exposed on the wire.
 *
 * The shape mirrors `dsh-mcp-mgr`: one `TypertRemoteService` bound to a single
 * namespace, an `@Remote` marker on each public method, `snapshot` as the one
 * read that renders the whole panel, and every write answering
 * `SkillApplyResult` so the browser can show the host's own reason inline
 * instead of guessing from a transport failure.
 *
 * The surface is flat and skill-shaped: the profile inventory,
 * selection and the restorable trash — no market, no upstream source tracking
 * and no grouping by root or by origin.
 *
 * Two conventions matter and are easy to get wrong:
 * - the Cordis service key **is** the wire namespace, so the browser reads the
 *   same object back as `ctx.get('remote.skillMgr')`;
 * - the browser half must never inject this namespace (it mounts it itself);
 *   injecting a self-provided service deadlocks the fiber.
 *
 * @module dsh-skill-mgr/gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { REMOTE_NAMESPACE } from './typert.descriptors.ts'
import { errorText } from './error-text.ts'
import { StoreError } from './store.ts'
import type { SkillMgrDeps } from './deps.ts'
import type {
  DiagnosticFixResult,
  SkillApplyResult,
  SkillDetailResult,
  SkillDraft,
  SkillManagerSnapshot,
  SkillStatsResult,
  TrashClearResult,
  TrashRestoreResult,
} from './wire.ts'
import { buildSnapshot } from './operations/snapshot.ts'
import {
  fixDiagnostic,
  removeGlobalSkill,
  saveGlobalSkill,
  setGlobalSkillEnabled,
  skillDetail,
  skillStats,
} from './operations/inventory.ts'
import { clearTrash, restoreTrashedSkill } from './operations/trash.ts'

/** Turn any thrown value into the message a write reports to the panel. */
function messageOf(error: unknown): string {
  if (error instanceof StoreError) return error.message
  if (error instanceof Error) return error.message
  return errorText(error)
}

/**
 * The management gateway.
 *
 * The configured `enabled` flag is *not* consulted here: the panel is the
 * surface that turns the plugin back on, so it must keep answering while the
 * provider is switched off.
 */
export class SkillMgrGateway extends TypertRemoteService {
  /**
   * @param ctx - owning Cordis context.
   * @param deps - the operation dependency view.
   * @param policy - the shared mount policy this gateway reads and writes.
   */
  constructor(ctx: Context, private readonly deps: SkillMgrDeps) {
    super(ctx, REMOTE_NAMESPACE)
  }

  /** Run a write and fold its outcome into the wire result. */
  private async write(run: () => Promise<void>): Promise<SkillApplyResult> {
    try {
      await run()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: messageOf(error) }
    }
  }

  // --------------------------------------------------------------- core

  /** The whole management view, in one read. */
  @Remote('snapshot')
  async snapshot(): Promise<SkillManagerSnapshot> {
    return buildSnapshot(this.deps)
  }



  // ----------------------------------------------------- profile inventory

  /** Scaffold a new skill in a writable root. */
  @Remote('saveGlobalSkill')
  async saveGlobalSkill(draft: SkillDraft): Promise<SkillApplyResult> {
    return saveGlobalSkill(this.deps, draft)
  }

  /** Move a profile skill into the trash (restorable). */
  @Remote('removeGlobalSkill')
  async removeGlobalSkill(name: string): Promise<SkillApplyResult> {
    return removeGlobalSkill(this.deps, name)
  }

  /** Enable or disable one profile skill. */
  @Remote('setGlobalSkillEnabled')
  async setGlobalSkillEnabled(name: string, enabled: boolean): Promise<SkillApplyResult> {
    return setGlobalSkillEnabled(this.deps, name, enabled)
  }



  /** The full body and metadata of one skill. */
  @Remote('skillDetail')
  async skillDetail(name: string): Promise<SkillDetailResult> {
    return skillDetail(this.deps, name)
  }

  /** Rewrite one auto-fixable diagnostic in place. */
  @Remote('fixDiagnostic')
  async fixDiagnostic(path: string): Promise<DiagnosticFixResult> {
    return fixDiagnostic(this.deps, path)
  }

  /** Invocation counts and last-used times across the local session logs. */
  @Remote('skillStats')
  async skillStats(): Promise<SkillStatsResult> {
    return skillStats(this.deps)
  }

  // ---------------------------------------------------------------- trash

  /** Restore a trashed skill to its original path. */
  @Remote('restoreTrashedSkill')
  async restoreTrashedSkill(name: string): Promise<TrashRestoreResult> {
    return restoreTrashedSkill(this.deps, name)
  }

  /** Permanently delete everything in the trash. */
  @Remote('clearTrash')
  async clearTrash(): Promise<TrashClearResult> {
    return clearTrash(this.deps)
  }
}

export { REMOTE_NAMESPACE }