/**
 * The profile skill registry: an in-memory view over
 * `<profile>/.dsh/dshsk/skills.json`, with atomic, serialized persistence.
 *
 * Disabling renames a skill's discovery file out of the shapes the filesystem
 * provider accepts, so the provider catalog alone cannot see a disabled skill;
 * this store keeps name/path/root so the manager can list and re-enable it. It
 * also persists the restorable trash and the usage-statistics checkpoint. The
 * file model is flat: there is no source, market or origin bookkeeping here.
 *
 * @module dsh-skill-mgr/store
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DisabledSkill, TrashEntry } from '../wire.ts'
import { StoreError } from './errors.ts'
import { hydrateMigratedState, migrateStore, type HydratedState } from './migrate.ts'
import { STORE_VERSION, type StoreFile } from './paths.ts'
import type { SkillStatsCheckpoint } from './types.ts'

/** Registry owner. */
export class SkillMgrStore {
  private entries = new Map<string, DisabledSkill>()
  private trashByName = new Map<string, TrashEntry>()
  private skillStats: SkillStatsCheckpoint | undefined = undefined
  private loaded = false
  /** Serializes persist runs: concurrent mutators must not let an earlier snapshot overwrite a later one (rename is atomic, ordering is not). */
  private writeChain: Promise<void> = Promise.resolve()

  /**
   * @param file - the registry file this instance owns.
   * @param legacyFiles - files from an earlier install to adopt on first load, in priority order.
   */
  constructor(
    private readonly file: string,
    private readonly legacyFiles: readonly string[] = [],
  ) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const source = this.resolveSource()
    if (source === undefined) return
    try {
      const raw = await readFile(source, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      const migrated = migrateStore(parsed)
      if (migrated === null) {
        console.warn('[dsh-skill-mgr] registry uses a newer schema than this plugin supports; starting empty')
        return
      }
      const state: HydratedState = hydrateMigratedState(migrated)
      this.entries = state.entries
      this.trashByName = state.trashByName
      this.skillStats = state.skillStats
      // An adopted legacy file is promoted to the registry path immediately, so
      // the migration happens exactly once and the old file is left untouched.
      if (source !== this.file) await this.persist()
    } catch (error) {
      // Missing or unreadable state starts empty; never crash the plugin.
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        console.warn('[dsh-skill-mgr] registry unreadable, starting empty:', error instanceof Error ? error.message : error)
      }
    }
  }

  /**
   * The file to read: the registry itself when it exists, otherwise the first
   * legacy file an earlier install left behind.
   * @returns an absolute path, or undefined when there is nothing to load.
   */
  private resolveSource(): string | undefined {
    if (existsSync(this.file)) return this.file
    for (const candidate of this.legacyFiles) {
      if (existsSync(candidate)) return candidate
    }
    return undefined
  }

  /** The registry file this instance owns. */
  get path(): string {
    return this.file
  }

  // -------------------------------------------------------- disabled skills

  /** Every disabled skill, sorted by name. */
  async listDisabled(): Promise<DisabledSkill[]> {
    await this.ensureLoaded()
    return [...this.entries.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** One disabled record by skill name (undefined when the skill is enabled). */
  async getDisabled(name: string): Promise<DisabledSkill | undefined> {
    await this.ensureLoaded()
    return this.entries.get(name)
  }

  /** Record a disabled skill (upsert by name). */
  async addDisabled(entry: DisabledSkill): Promise<void> {
    await this.ensureLoaded()
    this.entries.set(entry.name, entry)
    await this.persist()
  }

  /** Drop a disabled record (no-op when absent). */
  async removeDisabled(name: string): Promise<void> {
    await this.ensureLoaded()
    if (!this.entries.delete(name)) return
    await this.persist()
  }

  /**
   * Drop every disabled record the predicate rejects. Used by the startup
   * reconcile pass when the renamed file disappeared behind the manager's back.
   * @param keep - predicate deciding which records survive.
   * @returns the dropped records.
   */
  async pruneDisabled(keep: (entry: DisabledSkill) => boolean): Promise<DisabledSkill[]> {
    await this.ensureLoaded()
    const dropped: DisabledSkill[] = []
    for (const [name, entry] of [...this.entries]) {
      if (keep(entry)) continue
      this.entries.delete(name)
      dropped.push(entry)
    }
    if (dropped.length > 0) await this.persist()
    return dropped
  }

  // ---------------------------------------------------------------- trash

  /** All trashed skills, newest first. */
  async listTrash(): Promise<TrashEntry[]> {
    await this.ensureLoaded()
    return [...this.trashByName.values()].sort((a, b) => b.movedAt - a.movedAt)
  }

  /** One trash entry by skill name (undefined when absent). */
  async getTrash(name: string): Promise<TrashEntry | undefined> {
    await this.ensureLoaded()
    return this.trashByName.get(name)
  }

  /** Record a trashed skill. */
  async addTrash(entry: TrashEntry): Promise<void> {
    await this.ensureLoaded()
    this.trashByName.set(entry.name, entry)
    await this.persist()
  }

  /** Remove a trash record (after a restore or a permanent delete). */
  async removeTrash(name: string): Promise<void> {
    await this.ensureLoaded()
    if (!this.trashByName.delete(name)) return
    await this.persist()
  }

  // ----------------------------------------------------------- statistics

  /** The persisted usage-statistics checkpoint (undefined until first saved). */
  async getSkillStatsState(): Promise<SkillStatsCheckpoint | undefined> {
    await this.ensureLoaded()
    return this.skillStats !== undefined
      ? {
          ...this.skillStats,
          frozenSessions: { ...this.skillStats.frozenSessions },
          ...(this.skillStats.lastTotals !== undefined ? { lastTotals: [...this.skillStats.lastTotals] } : {}),
          ...(this.skillStats.coldRevisions !== undefined ? { coldRevisions: { ...this.skillStats.coldRevisions } } : {}),
        }
      : undefined
  }

  /** Persist a usage-statistics checkpoint (after every completed scan). */
  async saveSkillStatsState(state: SkillStatsCheckpoint): Promise<void> {
    await this.ensureLoaded()
    this.skillStats = {
      windowDays: state.windowDays,
      frozenBefore: state.frozenBefore,
      frozenSessions: { ...state.frozenSessions },
      lastFullReconcile: state.lastFullReconcile,
      ...(state.lastTotals !== undefined ? { lastTotals: [...state.lastTotals] } : {}),
      ...(state.coldRevisions !== undefined ? { coldRevisions: { ...state.coldRevisions } } : {}),
    }
    await this.persist()
  }

  private persist(): Promise<void> {
    // The payload is built inside the queued step (not here), so every
    // concurrent mutation made before a write actually lands is included in
    // the final file instead of being rolled back by an older snapshot.
    const run = this.writeChain.then(async () => {
      const payload: StoreFile = {
        version: STORE_VERSION,
        skills: [...this.entries.values()],
        ...(this.trashByName.size > 0 ? { trash: [...this.trashByName.values()] } : {}),
        ...(this.skillStats !== undefined ? { skillStats: this.skillStats } : {}),
      }
      const tmp = this.file + '.tmp'
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8')
      await rename(tmp, this.file)
    })
    // Keep the chain alive on failure; callers still observe the rejection.
    this.writeChain = run.catch(() => {})
    return run
  }
}

export { StoreError }