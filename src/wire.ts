/**
 * The `skillMgr` Remote wire contract.
 *
 * One source of truth for every value that crosses the Typert Remote: each
 * payload is a zod schema, and its TypeScript type is `z.infer` of that schema,
 * so the host implementation, the descriptors and the browser half cannot
 * drift. The host gateway parses every argument with these schemas at the
 * boundary (strict codecs) and the client descriptors are built from the same
 * objects.
 *
 * Conventions, matching the dsh Remote protocol:
 * - a **mutation** answers `SkillApplyResult` (`{ok:true}` /
 *   `{ok:false, error}`) and the caller refetches `snapshot()`;
 * - a **read** answers its own payload;
 * - optional fields are simply absent on the wire (JSON has no `undefined`),
 *   which is what `.optional()` accepts.
 *
 * The surface is deliberately the skill-shaped mirror of `dsh-mcp-mgr`: one
 * flat profile inventory and nothing else. There is no market, no upstream
 * source tracking, no grouping by root or by origin, and no per-workspace
 * layer — a skill is a skill, and the profile inventory is what every
 * workspace is offered.
 *
 * @module dsh-skill-mgr/wire
 */

import { z } from 'zod'

/* ------------------------------------------------------------------ core */

/** Invocation policy resolved by the skill registry, re-spelled for the wire. */
export const MgrInvocation = z.object({
  /** Whether model-facing catalogs may load this skill. */
  modelInvocable: z.boolean(),
  /** Whether human-facing command catalogs may load this skill. */
  userInvocable: z.boolean(),
})
export type MgrInvocation = z.infer<typeof MgrInvocation>

/** User-level roots the manager may write to (dsh-skill-filesystem ranks 400/500). */
export const WritableRoot = z.enum(['user-dsh', 'user-agents'])
export type WritableRoot = z.infer<typeof WritableRoot>

/** Every mutation's answer: the transport envelope carries the call, this carries the write. */
export const SkillApplyResult = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
])
export type SkillApplyResult = z.infer<typeof SkillApplyResult>

/* --------------------------------------------------------------- catalog */

/** One skill row. */
export const CatalogSkill = z.object({
  name: z.string(),
  description: z.string(),
  whenToUse: z.string().optional(),
  invocation: MgrInvocation,
  /** Winning provider's name (`skill-mgr` for this plugin's own provider). */
  provider: z.string(),
  /** Whether the manager may toggle this skill (writable user roots only). */
  writable: z.boolean(),
  /** `user-dsh` / `user-agents` / `project-dsh` / `project-agents` / a third-party value. */
  source: z.string(),
  /** SKILL.md creation time (epoch ms) when known. */
  addedAt: z.number().optional(),
  /** SKILL.md last-modified time (epoch ms) when known. */
  updatedAt: z.number().optional(),
  /** UI metadata from `agents/openai.yaml` (mirrors the codex SkillInterface). */
  displayName: z.string().optional(),
  shortDescription: z.string().optional(),
  brandColor: z.string().optional(),
  iconSmall: z.string().optional(),
  iconLarge: z.string().optional(),
  defaultPrompt: z.string().optional(),
})
export type CatalogSkill = z.infer<typeof CatalogSkill>

/** One disabled skill: its discovery file was renamed away. */
export const DisabledSkill = z.object({
  name: z.string(),
  description: z.string(),
  /** Absolute path of the renamed file (`SKILL.md.disabled` / `<name>.md.disabled`). */
  path: z.string(),
  root: WritableRoot,
  disabledAt: z.number(),
})
export type DisabledSkill = z.infer<typeof DisabledSkill>

/** One discovery diagnostic: a file the provider skips, with the reason. */
export const DiagnosticEntry = z.object({
  path: z.string(),
  root: z.string(),
  reason: z.string(),
  /** Whether this diagnostic can be auto-fixed (e.g. an unquoted colon). */
  fixable: z.boolean().optional(),
})
export type DiagnosticEntry = z.infer<typeof DiagnosticEntry>

/** A full skill body plus its metadata — the detail view. */
export const SkillDetail = z.object({
  name: z.string(),
  description: z.string(),
  whenToUse: z.string().optional(),
  invocation: MgrInvocation,
  provider: z.string(),
  /** Absolute file path when the skill came from disk. */
  path: z.string().optional(),
  addedAt: z.number().optional(),
  updatedAt: z.number().optional(),
  /** Markdown instruction body. */
  content: z.string(),
  displayName: z.string().optional(),
  shortDescription: z.string().optional(),
  brandColor: z.string().optional(),
  iconSmall: z.string().optional(),
  iconLarge: z.string().optional(),
  defaultPrompt: z.string().optional(),
})
export type SkillDetail = z.infer<typeof SkillDetail>

/** `skillDetail`: found/not-found is data, not a transport failure. */
export const SkillDetailResult = z.union([
  z.object({ found: z.literal(true), skill: SkillDetail }),
  z.object({ found: z.literal(false) }),
])
export type SkillDetailResult = z.infer<typeof SkillDetailResult>

/** `fixDiagnostic`. */
export const DiagnosticFixResult = z.object({ ok: z.literal(true), path: z.string() })
export type DiagnosticFixResult = z.infer<typeof DiagnosticFixResult>

/* ---------------------------------------------------------------- trash */

/** One trash entry: a skill moved out of discovery but kept restorable. */
export const TrashEntry = z.object({
  name: z.string(),
  /** Absolute path under the root's `.trash` directory. */
  path: z.string(),
  movedAt: z.number(),
  /** The original path before the move; older entries have none. */
  sourcePath: z.string().optional(),
})
export type TrashEntry = z.infer<typeof TrashEntry>

/** `restoreTrashedSkill`. */
export const TrashRestoreResult = z.object({
  ok: z.literal(true),
  name: z.string(),
  path: z.string(),
})
export type TrashRestoreResult = z.infer<typeof TrashRestoreResult>

/** `clearTrash`. */
export const TrashClearResult = z.object({
  ok: z.literal(true),
  deleted: z.array(z.string()),
  failed: z.array(z.object({ name: z.string(), error: z.string() })),
})
export type TrashClearResult = z.infer<typeof TrashClearResult>

/* ---------------------------------------------------------------- stats */

/** One skill's invocation statistics across the local session logs. */
export const SkillStat = z.object({
  name: z.string(),
  /** How many sessions recorded a user-explicit invocation of this skill. */
  count: z.number(),
  /** Count of the most recent invocation (epoch ms; absent when never called). */
  lastUsed: z.number().optional(),
})
export type SkillStat = z.infer<typeof SkillStat>

/** `skillStats`. */
export const SkillStatsResult = z.object({
  ok: z.literal(true),
  /** Whether a session-log source was available (false means counts are empty). */
  available: z.boolean(),
  stats: z.array(SkillStat),
  /** Which read path produced the counts (a debug aid). */
  source: z.enum(['cold', 'query']).optional(),
})
export type SkillStatsResult = z.infer<typeof SkillStatsResult>

/* -------------------------------------------------------------- snapshot */

/** The whole management view, in one read. */
export const SkillManagerSnapshot = z.object({
  /** This plugin's installed version (package.json). */
  pluginVersion: z.string(),
  /** The profile registry file the panel manages. */
  registryPath: z.string(),
  profileRoot: z.string(),
  /** Whether discovery completed within a stable catalog revision. */
  complete: z.boolean(),
  /** The flat profile inventory: every skill, from every profile-level root. */
  skills: z.array(CatalogSkill),
  /** Skills the manager has toggled off. */
  disabled: z.array(DisabledSkill),
  /** Files in the writable roots the provider ignores, with reasons. */
  diagnostics: z.array(DiagnosticEntry),
  /** Skill names claimed by more than one root (first wins). */
  duplicateNames: z.array(z.string()).optional(),
  /** Restorable trash. */
  trash: z.array(TrashEntry),
})
export type SkillManagerSnapshot = z.infer<typeof SkillManagerSnapshot>

/* -------------------------------------------------- method input schemas */

/** A new skill to scaffold in a writable root. */
export const SkillDraft = z.object({
  /** Kebab-case skill name (validated with the official isSkillName grammar). */
  name: z.string(),
  /** Optional one-line routing description for the frontmatter. */
  description: z.string().optional(),
  /** Target user root; absent means `user-dsh` (`~/.dsh/skills`). */
  root: WritableRoot.optional(),
})
export type SkillDraft = z.infer<typeof SkillDraft>