/**
 * The profile registry store.
 *
 * Every case drives the real filesystem under a temp dir — no fixtures and no
 * mocks. The store now owns three buckets only (`skills`, `trash?`,
 * `skillStats?`): the disabled-skill records, the restorable trash and the
 * usage-statistics checkpoint. Legacy adoption, corrupt-file degradation and
 * the on-disk shape are the properties worth pinning down, because a wrong
 * `persist()` here either loses a user's disabled skills or resurrects the
 * removed source/market buckets.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_STATE_FILES, SkillMgrStore, STORE_VERSION, type StoreFile } from './store.ts'

/** Parse one persisted registry file with its on-disk shape. */
async function readStore(file: string): Promise<StoreFile> {
  return JSON.parse(await readFile(file, 'utf8')) as StoreFile
}

describe('SkillMgrStore', () => {
  let dir: string
  let file: string
  let store: SkillMgrStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-skill-mgr-store-'))
    file = join(dir, 'registry.json')
    store = new SkillMgrStore(file)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('starts empty when no state file exists', async () => {
    expect(await store.listDisabled()).toEqual([])
    expect(await store.listTrash()).toEqual([])
    expect(await store.getSkillStatsState()).toBeUndefined()
  })

  // -------------------------------------------------------- disabled skills

  it('persists disabled entries and reloads them', async () => {
    await store.addDisabled({ name: 'demo-skill', description: 'demo', path: '/tmp/demo/SKILL.md.disabled', root: 'user-dsh', disabledAt: 1234 })
    const reloaded = new SkillMgrStore(file)
    const entries = await reloaded.listDisabled()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'demo-skill', path: '/tmp/demo/SKILL.md.disabled', root: 'user-dsh', disabledAt: 1234 })

    const raw = await readStore(file)
    expect(raw.version).toBe(STORE_VERSION)
    expect(raw.skills).toHaveLength(1)
    // The v4 name for this bucket is gone from the on-disk shape.
    expect((raw as unknown as Record<string, unknown>).disabled).toBeUndefined()
  })

  it('reads one disabled record by name and nothing for an unknown one', async () => {
    await store.addDisabled({ name: 'a', description: 'A', path: '/tmp/a.md.disabled', root: 'user-dsh', disabledAt: 1 })
    expect(await store.getDisabled('a')).toMatchObject({ name: 'a', path: '/tmp/a.md.disabled' })
    expect(await store.getDisabled('missing')).toBeUndefined()
  })

  it('replaces a disabled record with the same name instead of duplicating it', async () => {
    await store.addDisabled({ name: 'a', description: 'old', path: '/tmp/a.md.disabled', root: 'user-dsh', disabledAt: 1 })
    await store.addDisabled({ name: 'a', description: 'new', path: '/tmp/a.md.disabled', root: 'user-agents', disabledAt: 2 })
    expect(await store.listDisabled()).toEqual([
      { name: 'a', description: 'new', path: '/tmp/a.md.disabled', root: 'user-agents', disabledAt: 2 },
    ])
    expect((await readStore(file)).skills).toHaveLength(1)
  })

  it('removes entries on removeDisabled', async () => {
    await store.addDisabled({ name: 'a', description: '', path: '/tmp/a.md.disabled', root: 'user-dsh', disabledAt: 1 })
    await store.removeDisabled('a')
    expect(await store.listDisabled()).toEqual([])
    expect(await new SkillMgrStore(file).listDisabled()).toEqual([])
    expect((await readStore(file)).skills).toEqual([])
  })

  it('ignores removal of an unknown entry without rewriting the file', async () => {
    await store.addDisabled({ name: 'a', description: '', path: '/tmp/a.md.disabled', root: 'user-dsh', disabledAt: 1 })
    const before = await readFile(file, 'utf8')
    await store.removeDisabled('missing')
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('pruneDisabled drops the rejected records, persists the survivors, and returns the dropped', async () => {
    await store.addDisabled({ name: 'a', description: 'A', path: '/tmp/a.md.disabled', root: 'user-dsh', disabledAt: 1 })
    await store.addDisabled({ name: 'b', description: 'B', path: '/tmp/b.md.disabled', root: 'user-agents', disabledAt: 2 })

    const dropped = await store.pruneDisabled((entry) => entry.name !== 'a')
    expect(dropped.map((entry) => entry.name)).toEqual(['a'])
    expect(await store.listDisabled()).toEqual([expect.objectContaining({ name: 'b' })])
    expect((await new SkillMgrStore(file).listDisabled()).map((entry) => entry.name)).toEqual(['b'])

    // A predicate that keeps everything drops nothing and leaves the file as it was.
    const before = await readFile(file, 'utf8')
    expect(await store.pruneDisabled(() => true)).toEqual([])
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('pruneDisabled can empty the disabled bucket', async () => {
    await store.addDisabled({ name: 'a', description: '', path: '/tmp/a.md.disabled', root: 'user-dsh', disabledAt: 1 })
    await store.addDisabled({ name: 'b', description: '', path: '/tmp/b.md.disabled', root: 'user-dsh', disabledAt: 2 })
    const dropped = await store.pruneDisabled(() => false)
    expect(dropped.map((entry) => entry.name).sort()).toEqual(['a', 'b'])
    expect(await store.listDisabled()).toEqual([])
    expect((await readStore(file)).skills).toEqual([])
  })

  it('survives a corrupt state file', async () => {
    await writeFile(file, 'not json at all', 'utf8')
    expect(await store.listDisabled()).toEqual([])
    await store.addDisabled({ name: 'x', description: '', path: '/tmp/x.md.disabled', root: 'user-agents', disabledAt: 2 })
    const raw = await readStore(file)
    expect(raw.skills).toHaveLength(1)
  })

  // --------------------------------------------------------------- trash

  it('records, lists newest-first, and removes trash entries', async () => {
    await store.addTrash({ name: 'gone-skill', path: '/tmp/.trash/gone-skill-123', movedAt: 42, sourcePath: '/tmp/skills/gone-skill' })
    await store.addTrash({ name: 'older', path: '/tmp/.trash/older-1', movedAt: 10 })
    const trash = await store.listTrash()
    expect(trash.map((entry) => entry.name)).toEqual(['gone-skill', 'older']) // newest first
    await store.removeTrash('gone-skill')
    const reloaded = new SkillMgrStore(file)
    expect(await reloaded.listTrash()).toHaveLength(1)
    expect(await reloaded.getTrash('older')).toMatchObject({ name: 'older' })
  })

  it('replaces a trash record with the same name and reports an unknown one as absent', async () => {
    await store.addTrash({ name: 'gone', path: '/tmp/.trash/gone-1', movedAt: 1 })
    await store.addTrash({ name: 'gone', path: '/tmp/.trash/gone-2', movedAt: 2 })
    expect(await store.getTrash('gone')).toEqual({ name: 'gone', path: '/tmp/.trash/gone-2', movedAt: 2 })
    expect(await store.getTrash('missing')).toBeUndefined()
    expect((await readStore(file)).trash).toHaveLength(1)
  })

  it('ignores removal of an unknown trash entry without rewriting the file', async () => {
    await store.addTrash({ name: 'gone', path: '/tmp/.trash/gone-1', movedAt: 1 })
    const before = await readFile(file, 'utf8')
    await store.removeTrash('missing')
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('persists the trash source path', async () => {
    await store.addTrash({ name: 'flat-gone', path: '/tmp/.trash/flat-gone.md-1', movedAt: 7, sourcePath: '/tmp/skills/flat-gone.md' })
    const reloaded = new SkillMgrStore(file)
    expect(await reloaded.getTrash('flat-gone')).toMatchObject({ name: 'flat-gone', sourcePath: '/tmp/skills/flat-gone.md' })
  })

  it('drops a legacy trash `origin` while keeping the rest of the entry', async () => {
    await writeFile(file, JSON.stringify({
      version: 4,
      trash: [{ name: 'old', path: '/tmp/trash/old', movedAt: 1, origin: { repo: 'repo/x', root: '', commitSha: 'sha' } }],
    }), 'utf8')
    expect(await store.getTrash('old')).toEqual({ name: 'old', path: '/tmp/trash/old', movedAt: 1 })
  })

  // ---------------------------------------------------- legacy adoption

  it('adopts the first existing legacy file on first load and promotes it to the registry path', async () => {
    const registry = join(dir, 'nested', 'skills.json')
    const legacyA = join(dir, LEGACY_STATE_FILES[0])
    const legacyB = join(dir, LEGACY_STATE_FILES[1])
    await writeFile(legacyA, JSON.stringify({
      version: 4,
      disabled: [{ name: 'from-mgr', description: 'mgr', path: '/tmp/mgr.md.disabled', root: 'user-dsh', disabledAt: 3 }],
    }), 'utf8')
    await writeFile(legacyB, JSON.stringify({
      version: 4,
      disabled: [{ name: 'from-hub', description: 'hub', path: '/tmp/hub.md.disabled', root: 'user-dsh', disabledAt: 4 }],
    }), 'utf8')

    const adopted = new SkillMgrStore(registry, [legacyA, legacyB])
    expect((await adopted.listDisabled()).map((entry) => entry.name)).toEqual(['from-mgr'])

    // Promoted immediately: the registry now holds the migrated v5 document…
    const promoted = await readStore(registry)
    expect(promoted.version).toBe(STORE_VERSION)
    expect(promoted.skills.map((entry) => entry.name)).toEqual(['from-mgr'])
    // …while both legacy sidecars are left exactly as they were.
    expect((await readStore(legacyA)).skills).toBeUndefined()
    expect((await readStore(legacyB)).skills).toBeUndefined()
  })

  it('prefers the registry file over any legacy file once it exists', async () => {
    const legacy = join(dir, LEGACY_STATE_FILES[0])
    await writeFile(legacy, JSON.stringify({
      version: 4,
      disabled: [{ name: 'legacy-only', description: '', path: '/tmp/legacy.md.disabled', root: 'user-dsh', disabledAt: 1 }],
    }), 'utf8')
    await writeFile(file, JSON.stringify({
      version: STORE_VERSION,
      skills: [{ name: 'registry-only', description: '', path: '/tmp/registry.md.disabled', root: 'user-dsh', disabledAt: 2 }],
    }), 'utf8')

    const store = new SkillMgrStore(file, [legacy])
    expect((await store.listDisabled()).map((entry) => entry.name)).toEqual(['registry-only'])
  })

  it('stays empty when no registry and no legacy file exist', async () => {
    const store = new SkillMgrStore(join(dir, 'nowhere.json'), [join(dir, LEGACY_STATE_FILES[0])])
    expect(await store.listDisabled()).toEqual([])
  })

  it('adopts a legacy file carrying the removed buckets and persists only the flat document', async () => {
    await writeFile(file, JSON.stringify({
      version: 4,
      disabled: [{ name: 'a', path: '/tmp/a.md.disabled', root: 'user-dsh', disabledAt: 1 }],
      sources: [{ repo: 'anthropics/skills', root: 'skills', commitSha: 'sha', skills: ['docx'] }],
      marketSources: ['anthropics/skills'],
      marketStats: { fetchedAt: 1, stats: { 'a/b': { stars: 1, downloads: 2 } } },
      origins: { docx: 'anthropics/skills' },
      scenes: [{ id: 's1', name: '场景', skillNames: ['docx'] }],
      tags: [{ id: 't1', name: '通用', skillNames: [], default: true }],
      trash: [{ name: 'gone', path: '/tmp/trash/gone', movedAt: 5, origin: { repo: 'repo/x', root: '' } }],
    }), 'utf8')

    // Reading adopts the surviving buckets and drops the removed ones.
    expect((await store.listDisabled()).map((entry) => entry.name)).toEqual(['a'])
    expect(await store.getTrash('gone')).toEqual({ name: 'gone', path: '/tmp/trash/gone', movedAt: 5 })

    // A subsequent persist writes only {version, skills, trash?} — never the
    // source, market, origin, scene or tag bookkeeping.
    await store.addTrash({ name: 'newer', path: '/tmp/trash/newer', movedAt: 6 })
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(Object.keys(raw).sort()).toEqual(['skills', 'trash', 'version'])
    expect(raw.version).toBe(STORE_VERSION)
    expect(raw.skills).toEqual([{ name: 'a', path: '/tmp/a.md.disabled', root: 'user-dsh', disabledAt: 1 }])
    expect(raw.trash).toEqual([
      { name: 'gone', path: '/tmp/trash/gone', movedAt: 5 },
      { name: 'newer', path: '/tmp/trash/newer', movedAt: 6 },
    ])
    for (const removed of ['sources', 'marketSources', 'marketStats', 'origins', 'scenes', 'tags']) {
      expect(raw, `${removed} must not be re-persisted`).not.toHaveProperty(removed)
    }
  })

  it('rejects a newer schema by starting empty', async () => {
    await writeFile(file, JSON.stringify({ version: 99, disabled: [{ name: 'a', path: '/tmp/a.md.disabled', root: 'user-dsh', disabledAt: 1 }] }), 'utf8')
    const fresh = new SkillMgrStore(file)
    expect(await fresh.listDisabled()).toEqual([])
  })

  // ------------------------------------------------------------ statistics

  it('migrates a v3 file (no skillStats) and persists a checkpoint round-trip at the current version', async () => {
    // v3 旧文件：无 skillStats 字段 → 装载后检查点为空，写盘时版本升到当前。
    await writeFile(file, JSON.stringify({
      version: 3,
      disabled: [],
      tags: [{ id: 't1', name: '通用', skillNames: [], default: true }],
    }), 'utf8')
    expect(await store.getSkillStatsState()).toBeUndefined()
    const checkpoint = {
      windowDays: 0,
      frozenBefore: 1000,
      frozenSessions: { 'session-a': { createdAt: 900, counts: { tdd: { count: 7, lastUsed: 900 }, 'code-review': { count: 2, lastUsed: 800 } } } },
      lastFullReconcile: 1234,
    }
    await store.saveSkillStatsState(checkpoint)
    // 新实例读回一致（含深拷贝的 frozenTotals）。
    const reloaded = new SkillMgrStore(file)
    expect(await reloaded.getSkillStatsState()).toEqual(checkpoint)
    const raw = await readStore(file)
    expect(raw.version).toBe(STORE_VERSION)
    expect(raw.skillStats).toEqual(checkpoint)
  })

  it('drops a corrupt skillStats bucket instead of trusting bad counts', async () => {
    await writeFile(file, JSON.stringify({
      version: 4,
      disabled: [],
      skillStats: { windowDays: 'x', frozenBefore: true, lastFullReconcile: false, frozenSessions: { bad: { createdAt: 'y', counts: [] } } },
    }), 'utf8')
    expect(await store.getSkillStatsState()).toBeUndefined()
  })

  it('persists coldRevisions round-trip and drops corrupt revision entries', async () => {
    await writeFile(file, JSON.stringify({
      version: 4,
      disabled: [],
      skillStats: {
        windowDays: 14,
        frozenBefore: 1000,
        frozenSessions: {},
        lastFullReconcile: 1234,
        coldRevisions: {
          good: { rev: 'r1', createdAt: 900, counts: { tdd: { count: 3, lastUsed: 900 } } },
          'bad-rev': { rev: 42, createdAt: 900, counts: {} },
          'bad-counts': { rev: 'r1', createdAt: 900, counts: { tdd: { count: 'many', lastUsed: 1 } } },
        },
      },
    }), 'utf8')
    // 好条目保留并写盘回读一致；坏条目被清洗（重读一次即可恢复）。
    expect(await store.getSkillStatsState()).toEqual({
      windowDays: 14,
      frozenBefore: 1000,
      frozenSessions: {},
      lastFullReconcile: 1234,
      coldRevisions: {
        good: { rev: 'r1', createdAt: 900, counts: { tdd: { count: 3, lastUsed: 900 } } },
        'bad-counts': { rev: 'r1', createdAt: 900, counts: {} },
      },
    })
  })

  it('hands out a defensive copy of the stored checkpoint', async () => {
    await store.saveSkillStatsState({
      windowDays: 7,
      frozenBefore: 100,
      frozenSessions: { s: { createdAt: 1, counts: { a: { count: 1, lastUsed: 2 } } } },
      lastFullReconcile: 3,
      lastTotals: [{ name: 'a', count: 1, lastUsed: 2 }],
      coldRevisions: { s: { rev: 'r', createdAt: 1, counts: { a: { count: 1, lastUsed: 2 } } } },
    })
    const first = await store.getSkillStatsState()
    const second = await store.getSkillStatsState()
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first?.frozenSessions).not.toBe(second?.frozenSessions)
    expect(first?.lastTotals).not.toBe(second?.lastTotals)
    expect(first?.coldRevisions).not.toBe(second?.coldRevisions)
  })
})