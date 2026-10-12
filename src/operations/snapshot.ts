/**
 * Assemble the one read the panel renders.
 *
 * Everything the panel shows comes from here, so a mutation followed by a
 * `snapshot()` can never leave one view remembering an older registry than
 * another.
 *
 * @module dsh-skill-mgr/operations/snapshot
 */

import type { SkillMgrDeps } from '../deps.ts'
import type { SkillManagerSnapshot } from '../wire.ts'
import { CURRENT_VERSION } from '../version.ts'
import { buildProfileCatalog } from './catalog.ts'
import { listTrash } from './trash.ts'

/**
 * Build the whole management view.
 * @param deps - operation dependencies.
 * @returns the snapshot the browser renders.
 */
export async function buildSnapshot(deps: SkillMgrDeps): Promise<SkillManagerSnapshot> {
  const [catalog, trash] = await Promise.all([
    buildProfileCatalog(deps),
    listTrash(deps),
  ])

  return {
    pluginVersion: CURRENT_VERSION,
    registryPath: deps.registryPath,
    profileRoot: deps.profileRoot,
    complete: catalog.complete,
    skills: catalog.skills,
    disabled: catalog.disabled,
    diagnostics: catalog.diagnostics,
    ...(catalog.duplicateNames !== undefined ? { duplicateNames: catalog.duplicateNames } : {}),
    trash,
  }
}