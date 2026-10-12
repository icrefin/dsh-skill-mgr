/**
 * Trash operations + the restore destination rule.
 *
 * The regression these tests exist for: a trash record written by this plugin
 * carries `sourcePath`, but a *legacy* record does not — its original location
 * has to be recovered from the trash path itself, which encodes the writable
 * root it came from. The restore and the caller's conflict pre-check must agree
 * on that destination, or a record from `user-agents` is probed against
 * `user-dsh` and a valid restore is refused (or an existing file is clobbered).
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { restoreTarget, restoreSkill, rootPath, trashSkill } from '../src/skillfs.ts'
import { restoreTrashedSkill } from '../src/operations/trash.ts'
import { SkillMgrStore } from '../src/store.ts'
import type { SkillMgrDeps } from '../src/deps.ts'
import type { TrashEntry } from '../src/wire.ts'

describe('restoreTarget', () => {
  it('uses sourcePath when the record carries one', () => {
    const entry: TrashEntry = {
      name: 'demo',
      path: '/roots/user-agents/skills/.trash/demo-1700000000000',
      movedAt: 1700000000000,
      sourcePath: '/roots/user-agents/skills/demo',
    }
    expect(restoreTarget(entry)).toBe('/roots/user-agents/skills/demo')
  })

  it('recovers the root from the trash path when sourcePath is absent', () => {
    // A legacy record from the user-agents root. Deriving the fallback from the
    // dsh home instead of the entry's own path is the bug this pins down.
    const entry: TrashEntry = {
      name: 'legacy-flat',
      path: '/roots/.agents/skills/.trash/legacy-flat-1700000000000',
      movedAt: 1700000000000,
    }
    expect(restoreTarget(entry)).toBe('/roots/.agents/skills/legacy-flat')
  })
})

describe('restoreTrashedSkill', () => {
  let dir: string
  let home: string
  let store: SkillMgrStore
  let deps: SkillMgrDeps

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-skill-mgr-trash-'))
    home = join(dir, 'home')
    store = new SkillMgrStore(join(dir, 'registry.json'))
    deps = {
      skills: { snapshot: async () => ({ skills: [], complete: true }), get: async () => undefined },
      store,
      registryPath: join(dir, 'registry.json'),
      profileRoot: dir,
      home,
    }
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('restores a trashed skill into the root its trash path belongs to', async () => {
    // A flat skill under the agents root, trashed by the real helper so the
    // entry shape is the one production writes.
    const agentsSkills = rootPath('user-agents', home)
    await mkdir(agentsSkills, { recursive: true })
    const source = join(agentsSkills, 'legacy-flat.md')
    await writeFile(source, '# legacy-flat\n', 'utf8')
    const { path, source: original } = await trashSkill(source)
    expect(existsSync(source)).toBe(false)

    // A legacy record: no sourcePath.
    const entry: TrashEntry = { name: 'legacy-flat', path, movedAt: Date.now() }
    await store.addTrash(entry)

    const result = await restoreTrashedSkill(deps, 'legacy-flat')
    expect(result.path).toBe(original)
    expect(result.path).toBe(join(agentsSkills, 'legacy-flat.md'))
    expect(existsSync(result.path)).toBe(true)
    expect(await store.getTrash('legacy-flat')).toBeUndefined()
  })

  it('refuses to restore over an existing skill, using the same destination', async () => {
    const agentsSkills = rootPath('user-agents', home)
    await mkdir(agentsSkills, { recursive: true })
    const source = join(agentsSkills, 'taken.md')
    await writeFile(source, '# first\n', 'utf8')
    const { path } = await trashSkill(source)
    // Something reoccupies the original name while the skill sits in the trash.
    await writeFile(source, '# second\n', 'utf8')
    await store.addTrash({ name: 'taken', path, movedAt: Date.now() })

    await expect(restoreTrashedSkill(deps, 'taken')).rejects.toThrow(/skill already exists/)
    // The occupant is untouched and the record survives for a retry.
    expect(await readFile(source, 'utf8')).toBe('# second\n')
    expect(await store.getTrash('taken')).toBeDefined()
  })

  it('refuses an unknown name', async () => {
    await expect(restoreTrashedSkill(deps, 'nope')).rejects.toThrow(/trash entry not found/)
    await expect(restoreTrashedSkill(deps, '')).rejects.toThrow(/name is required/)
  })
})

describe('restoreSkill', () => {
  it('refuses a path that is not under a .trash directory', async () => {
    const entry: TrashEntry = { name: 'x', path: '/tmp/not-a-trash/x', movedAt: 0 }
    await expect(restoreSkill(entry)).rejects.toThrow(/not a trashed skill path/)
  })
})