/**
 * Client-face Typert artifact.
 *
 * The browser half mounts this with `ctx.remote.$mount(TYPERT_REMOTE)`; the
 * client API gateway validates that every parameter carries a strict codec and
 * then installs the namespace service under `remote.skillMgr`.
 *
 * The `declare module` block below is this package's contribution to the
 * Remote type tables, so consumers read the namespace without a cast:
 * `ctx.get('remote.skillMgr')` is typed from `TypertRemoteNamespaceMap`.
 *
 * @module dsh-skill-mgr/typert.remote-client
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
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
import { REMOTE_CONTRIBUTION } from './typert.descriptors.ts'

/** Methods of the `skillMgr` namespace, as the browser half sees them. */
export interface SkillMgrNamespace {
  snapshot: () => Promise<RemoteResult<SkillManagerSnapshot>>
  saveGlobalSkill: (draft: SkillDraft) => Promise<RemoteResult<SkillApplyResult>>
  removeGlobalSkill: (name: string) => Promise<RemoteResult<SkillApplyResult>>
  setGlobalSkillEnabled: (name: string, enabled: boolean) => Promise<RemoteResult<SkillApplyResult>>
  skillDetail: (name: string) => Promise<RemoteResult<SkillDetailResult>>
  fixDiagnostic: (path: string) => Promise<RemoteResult<DiagnosticFixResult>>
  skillStats: () => Promise<RemoteResult<SkillStatsResult>>
  restoreTrashedSkill: (name: string) => Promise<RemoteResult<TrashRestoreResult>>
  clearTrash: () => Promise<RemoteResult<TrashClearResult>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  /** Concrete methods of the `skillMgr` namespace. */
  interface TypertRemoteNamespace$skillMgr extends SkillMgrNamespace {}
  interface TypertRemoteMap {
    'skillMgr/snapshot': SkillMgrNamespace['snapshot']
    'skillMgr/saveGlobalSkill': SkillMgrNamespace['saveGlobalSkill']
    'skillMgr/removeGlobalSkill': SkillMgrNamespace['removeGlobalSkill']
    'skillMgr/setGlobalSkillEnabled': SkillMgrNamespace['setGlobalSkillEnabled']
    'skillMgr/skillDetail': SkillMgrNamespace['skillDetail']
    'skillMgr/fixDiagnostic': SkillMgrNamespace['fixDiagnostic']
    'skillMgr/skillStats': SkillMgrNamespace['skillStats']
    'skillMgr/restoreTrashedSkill': SkillMgrNamespace['restoreTrashedSkill']
    'skillMgr/clearTrash': SkillMgrNamespace['clearTrash']
  }
  interface TypertRemoteNamespaceMap {
    skillMgr: TypertRemoteNamespace$skillMgr
  }
}

/** The contribution the browser half hands to `ctx.remote.$mount`. */
export const TYPERT_REMOTE = REMOTE_CONTRIBUTION

export default TYPERT_REMOTE