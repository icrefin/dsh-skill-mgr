/**
 * Profile skill registry: which skills the manager toggled off, the restorable
 * trash and the usage-statistics checkpoint.
 *
 * Registry file: `<profile>/.dsh/dshsk/skills.json` — a small JSON document
 * written atomically (temp file + rename). An install upgraded from the
 * plugin this package was refactored from adopts its sidecar on first load;
 * see `store/paths.ts`.
 *
 * 按职责拆分后的重导出入口：老 `from './store.ts'` 写法保持可用，
 * 新代码可按需直引 `from './store/<module>.ts'`。
 */

export { LEGACY_STATE_FILES, STORE_VERSION, type StoreFile } from './store/paths.ts'
export { StoreError } from './store/errors.ts'
export { migrateStore, hydrateMigratedState, type MigratedStore, type HydratedState } from './store/migrate.ts'
export { SkillMgrStore } from './store/store.ts'
export type { ColdRevisionEntry, SkillStatsCheckpoint } from './store/types.ts'
