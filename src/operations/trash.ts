/**
 * The restorable trash: the read the snapshot needs, plus restore and clear.
 *
 * Removing a skill never deletes it — the directory (or flat `.md`) is renamed
 * under the root's `.trash`, and the store keeps the record so the panel can
 * put it back. Now that the manager is flat there is no upstream source to
 * re-attach on restore: restoring moves the file back and drops the record.
 *
 * The old HTTP handlers moved here verbatim; only the plumbing changed — each
 * function takes the dependency view plus its inputs and returns the wire
 * payload, and a refusal the routes answered with `writeError` is now a thrown
 * `StoreError` carrying the same message.
 *
 * @module dsh-skill-mgr/operations/trash
 */

import { stat } from 'node:fs/promises'
import type { TrashClearResult, TrashEntry, TrashRestoreResult } from '../wire.ts'
import { clearTrash as clearTrashDir, restoreSkill, restoreTarget } from '../skillfs.ts'
import { errorText } from '../error-text.ts'
import { StoreError } from '../store.ts'
import { homeOf, type SkillMgrDeps } from '../deps.ts'

/** Async existence check (restore refuses to overwrite an existing skill). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * List the restorable trash, newest first.
 * @param deps - operation dependencies.
 * @returns the trash entries the panel renders.
 */
export async function listTrash(deps: SkillMgrDeps): Promise<TrashEntry[]> {
  return deps.store.listTrash()
}

/**
 * Restore one trashed skill directory.
 * @param deps - operation dependencies.
 * @param name - skill name of the trash entry.
 * @returns the restored skill's name and its new absolute path.
 */
export async function restoreTrashedSkill(deps: SkillMgrDeps, name: string): Promise<TrashRestoreResult> {
  if (name === '') throw new StoreError('validation', 'name is required')
  const entry = await deps.store.getTrash(name)
  if (entry === undefined) throw new StoreError('not-found', 'trash entry not found: ' + name)
  const home = homeOf(deps)
  // One shared resolver, so the pre-check cannot probe a different root than the
  // restore writes to (a legacy record with no `sourcePath` may belong to either
  // writable root, and its trash path is what says which).
  const target = restoreTarget(entry)
  if (await pathExists(target)) {
    throw new StoreError('conflict', 'skill already exists: ' + name)
  }
  const path = await restoreSkill(entry, home)
  await deps.store.removeTrash(name)
  deps.invalidate?.()
  return { ok: true, name, path }
}

/**
 * Empty the trash: permanently delete every trashed skill; failures stay
 * recorded so the caller can retry.
 * @param deps - operation dependencies.
 * @returns the permanently deleted names and the per-name failures.
 */
export async function clearTrash(deps: SkillMgrDeps): Promise<TrashClearResult> {
  const home = homeOf(deps)
  const entries = await deps.store.listTrash()
  const deleted: string[] = []
  const failed: Array<{ name: string; error: string }> = []
  for (const entry of entries) {
    try {
      await clearTrashDir(entry, home)
      deleted.push(entry.name)
    } catch (error) {
      failed.push({ name: entry.name, error: errorText(error) })
    }
  }
  for (const name of deleted) await deps.store.removeTrash(name)
  if (deleted.length > 0) deps.invalidate?.()
  return { ok: true, deleted, failed }
}