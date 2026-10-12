/**
 * Registry schema migration and hydration.
 *
 * `migrateStore` normalizes every older on-disk shape; `hydrateMigratedState`
 * then validates bucket by bucket. The property that matters most is the one
 * tested throughout: **a corrupt entry degrades alone** — it never discards the
 * rest of the registry, and never lets a bad count through.
 *
 * The manager is flat now (no sources, no market, no origin/collection
 * grouping), so an older document's removed buckets are read and deliberately
 * ignored: they have no representation on the wire, and the next persist must
 * not resurrect them.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hydrateMigratedState, migrateStore, type MigratedStore } from '../src/store/migrate.ts'
import { STORE_VERSION } from '../src/store/paths.ts'
import { SkillMgrStore } from '../src/store/store.ts'

/** A minimal valid disabled-skill record, v4 spelling. */
const disabledV4 = { name: 'demo-skill', description: 'demo', path: '/tmp/demo/SKILL.md.disabled', root: 'user-dsh', disabledAt: 1 }

/** Every bucket the flat surface removed, in one legacy document. */
const REMOVED_BUCKETS = {
  sources: [{ repo: 'anthropics/skills', root: 'skills', commitSha: 'sha', skills: ['docx'] }],
  marketSources: ['anthropics/skills', { repo: 'pinned/repo', ref: 'v1.0.0' }],
  marketStats: { fetchedAt: 3, stats: { 'a/b': { stars: 1500, downloads: 50 } } },
  origins: { docx: 'anthropics/skills', pdf: 'anthropics/skills' },
  tags: [{ id: 't1', name: 'web', skillNames: ['a'], default: true }],
  collectionOrder: ['a'],
  sourceGroupOrder: { 'repo/a': 0 },
} as const

describe('migrateStore', () => {
  it('renames the v4 `disabled` bucket to v5 `skills`', () => {
    const migrated = migrateStore({ version: 4, disabled: [disabledV4] })
    expect(migrated).not.toBeNull()
    expect(migrated).toEqual({ version: STORE_VERSION, skills: [disabledV4] })
    expect(migrated as MigratedStore).not.toHaveProperty('disabled')
  })

  it('prefers an existing v5 `skills` bucket over a leftover `disabled` one', () => {
    const kept = { ...disabledV4, name: 'kept' }
    const stale = { ...disabledV4, name: 'stale' }
    const migrated = migrateStore({ version: 4, skills: [kept], disabled: [stale] })
    expect(migrated?.skills).toEqual([kept])
  })

  it('accepts the current version unchanged', () => {
    const migrated = migrateStore({ version: STORE_VERSION, skills: [disabledV4] })
    expect(migrated?.version).toBe(STORE_VERSION)
    expect(migrated?.skills).toEqual([disabledV4])
  })

  it('returns null for a document from a newer schema', () => {
    expect(migrateStore({ version: STORE_VERSION + 1, skills: [] })).toBeNull()
    expect(migrateStore({ version: 99, disabled: [disabledV4] })).toBeNull()
  })

  it('returns null for a non-object document', () => {
    for (const parsed of [null, undefined, 42, 'text', true, [1, 2, 3]]) {
      expect(migrateStore(parsed), `${String(parsed)} must be refused`).toBeNull()
    }
  })

  it('treats a missing version as the oldest schema', () => {
    const migrated = migrateStore({ disabled: [disabledV4] })
    expect(migrated?.version).toBe(STORE_VERSION)
    expect(migrated?.skills).toEqual([disabledV4])
  })

  it('degrades a corrupt skills bucket to empty without discarding the rest', () => {
    const migrated = migrateStore({
      version: 5,
      skills: 'not-an-array',
      ...REMOVED_BUCKETS,
      trash: [{ name: 'gone', path: '/tmp/trash/gone', movedAt: 1 }],
    })
    expect(migrated?.skills).toEqual([])
    expect(migrated?.trash).toHaveLength(1)
    // The removed source/market buckets leave no trace in the normalized shape.
    expect(Object.keys(migrated as MigratedStore).sort()).toEqual(['skills', 'trash', 'version'])
  })

  it('ignores every bucket the flat surface removed', () => {
    const migrated = migrateStore({ version: 4, disabled: [disabledV4], ...REMOVED_BUCKETS })
    expect(migrated).toEqual({ version: STORE_VERSION, skills: [disabledV4] })
    for (const gone of Object.keys(REMOVED_BUCKETS)) {
      expect(migrated, `${gone} must not survive migration`).not.toHaveProperty(gone)
    }
  })

  it('passes the statistics bucket through for hydration to validate', () => {
    const skillStats = { windowDays: 14, frozenBefore: 1, frozenSessions: {}, lastFullReconcile: 2 }
    const migrated = migrateStore({ version: 4, disabled: [], skillStats, marketStats: { fetchedAt: 3, stats: {} } })
    expect(migrated?.skillStats).toEqual(skillStats)
    // The market snapshot has no flat representation and is dropped.
    expect(migrated).not.toHaveProperty('marketStats')
  })

  it('migrates a legacy document with the removed buckets and persists only the flat shape', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-skill-mgr-migrate-'))
    try {
      const legacy = join(dir, 'dsh-skill-hub.json')
      const registry = join(dir, 'registry.json')
      const trash = {
        name: 'gone',
        path: '/tmp/trash/gone',
        movedAt: 5,
        sourcePath: '/tmp/skills/gone',
        origin: { repo: 'repo/x', root: '' },
      }
      const skillStats = {
        windowDays: 14,
        frozenBefore: 1000,
        frozenSessions: { s1: { createdAt: 900, counts: { tdd: { count: 3, lastUsed: 900 } } } },
        lastFullReconcile: 1234,
      }
      await writeFile(legacy, JSON.stringify({
        version: 4,
        disabled: [disabledV4],
        ...REMOVED_BUCKETS,
        trash: [trash],
        skillStats,
      }), 'utf8')

      const store = new SkillMgrStore(registry, [legacy])
      // The surviving buckets are adopted…
      expect((await store.listDisabled()).map((entry) => entry.name)).toEqual(['demo-skill'])
      const entries = await store.listTrash()
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ name: 'gone', movedAt: 5, sourcePath: '/tmp/skills/gone' })
      // …a legacy `origin` snapshot has no representation any more…
      expect(entries[0]).not.toHaveProperty('origin')
      expect(await store.getSkillStatsState()).toEqual(skillStats)

      // …and promoting the file writes only the flat document, in full.
      const persisted = JSON.parse(await readFile(registry, 'utf8')) as Record<string, unknown>
      expect(Object.keys(persisted).sort()).toEqual(['skillStats', 'skills', 'trash', 'version'])
      expect(persisted.version).toBe(STORE_VERSION)
      expect(persisted.skills).toEqual([disabledV4])
      expect(persisted.trash).toEqual([{ name: 'gone', path: '/tmp/trash/gone', movedAt: 5, sourcePath: '/tmp/skills/gone' }])
      expect(persisted.skillStats).toEqual(skillStats)

      // The legacy file itself is left untouched, so the migration is one-way
      // only from the plugin's point of view.
      const left = JSON.parse(await readFile(legacy, 'utf8')) as Record<string, unknown>
      expect(left.sources).toHaveLength(1)
      expect(left.marketSources).toEqual(['anthropics/skills', { repo: 'pinned/repo', ref: 'v1.0.0' }])
      expect(left.origins).toEqual({ docx: 'anthropics/skills', pdf: 'anthropics/skills' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('hydrateMigratedState', () => {
  /** Migrate then hydrate, the way the store loads a file. */
  function hydrate(parsed: unknown) {
    const migrated = migrateStore(parsed)
    if (migrated === null) throw new Error('document was refused by migrateStore')
    return hydrateMigratedState(migrated)
  }

  it('keeps a valid disabled entry and drops a malformed one', () => {
    const state = hydrate({
      version: 5,
      skills: [
        disabledV4,
        { name: 'no-path', description: '', root: 'user-dsh', disabledAt: 2 },
        { path: '/tmp/only-path.md.disabled', root: 'user-dsh' },
        null,
      ],
    })
    expect([...state.entries.keys()]).toEqual(['demo-skill'])
    expect(state.entries.get('demo-skill')).toEqual(disabledV4)
  })

  it('degrades a corrupt skills bucket to empty while other buckets survive', () => {
    const state = hydrate({
      version: 5,
      skills: ['nope', 42, null],
      trash: [{ name: 'gone', path: '/tmp/trash/gone', movedAt: 1 }],
    })
    expect(state.entries.size).toBe(0)
    expect([...state.trashByName.keys()]).toEqual(['gone'])
  })

  it('validates trash entries and drops a legacy origin snapshot', () => {
    const state = hydrate({
      version: 5,
      skills: [],
      trash: [
        { name: 'good', path: '/tmp/trash/good', movedAt: 5, sourcePath: '/tmp/skills/good', origin: { repo: 'repo/x', root: '', commitSha: 'sha' } },
        { name: 'defaults', path: '/tmp/trash/defaults' },
        { name: 'no-path' },
        { path: '/tmp/trash/only-path' },
      ],
    })
    expect(state.trashByName.get('good')).toEqual({
      name: 'good',
      path: '/tmp/trash/good',
      movedAt: 5,
      sourcePath: '/tmp/skills/good',
    })
    // movedAt degrades to 0 rather than dropping the entry; a legacy `origin`
    // (upstream source snapshot) is dropped, since restoring no longer
    // re-attaches a source record.
    expect(state.trashByName.get('defaults')).toMatchObject({ movedAt: 0 })
    expect(state.trashByName.get('defaults')).not.toHaveProperty('origin')
    expect([...state.trashByName.keys()].sort()).toEqual(['defaults', 'good'])
  })

  it('ignores the buckets the flat surface removed', () => {
    const state = hydrate({ version: 5, skills: [], ...REMOVED_BUCKETS })
    expect(state.entries.size).toBe(0)
    expect(state.trashByName.size).toBe(0)
    expect(state.skillStats).toBeUndefined()
  })

  it('degrades a corrupt skillStats bucket to no checkpoint', () => {
    expect(hydrate({ version: 5, skills: [], skillStats: { windowDays: 'x', frozenBefore: true } }).skillStats).toBeUndefined()
    expect(hydrate({ version: 5, skills: [], skillStats: { windowDays: 1, frozenBefore: 2, lastFullReconcile: 3, frozenSessions: null } }).skillStats).toBeUndefined()
    expect(hydrate({ version: 5, skills: [], skillStats: 'nope' }).skillStats).toBeUndefined()
  })

  it('cleans the entries inside a valid skillStats checkpoint', () => {
    const state = hydrate({
      version: 5,
      skills: [],
      skillStats: {
        windowDays: 14,
        frozenBefore: 1000,
        lastFullReconcile: 1234,
        frozenSessions: {
          good: { createdAt: 900, counts: { tdd: { count: 7, lastUsed: 900 }, bad: { count: 'x', lastUsed: 1 } } },
          'no-createdAt': { counts: {} },
          'not-an-object': 42,
        },
        lastTotals: [
          { name: 'tdd', count: 7, lastUsed: 900 },
          { name: 'no-count' },
          { count: 1 },
          null,
        ],
        coldRevisions: {
          good: { rev: 'r1', createdAt: 900, counts: { tdd: { count: 3, lastUsed: 900 } } },
          'bad-rev': { rev: 42, createdAt: 900, counts: {} },
          'no-createdAt': { rev: 'r1', counts: {} },
        },
      },
    })
    expect(state.skillStats).toEqual({
      windowDays: 14,
      frozenBefore: 1000,
      frozenSessions: { good: { createdAt: 900, counts: { tdd: { count: 7, lastUsed: 900 } } } },
      lastFullReconcile: 1234,
      lastTotals: [{ name: 'tdd', count: 7, lastUsed: 900 }],
      coldRevisions: { good: { rev: 'r1', createdAt: 900, counts: { tdd: { count: 3, lastUsed: 900 } } } },
    })
  })

  it('starts with empty buckets when the document carries none', () => {
    const state = hydrate({ version: 5, skills: [] })
    expect(state.entries.size).toBe(0)
    expect(state.trashByName.size).toBe(0)
    expect(state.skillStats).toBeUndefined()
  })
})