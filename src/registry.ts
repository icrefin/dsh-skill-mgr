/**
 * The profile-scoped skill registry.
 *
 * The file model mirrors `dsh-mcp-mgr`'s registry:
 *
 * ```text
 * <profile>/.dsh/dshsk/skills.json      the profile's skill management state
 * ```
 *
 * The document itself is owned by `store/` (`StoreFile`); this module resolves
 * its location and provides the read/write primitives.
 *
 * All writes go through `atomicWriteJson`: a same-directory temp file with a
 * `wx` flag, `0o600`, then `rename`, which is atomic on one filesystem and
 * cannot leave a half-written registry behind. Reads that hit unparsable JSON
 * refuse to overwrite it and report the reason instead.
 *
 * @module dsh-skill-mgr/registry
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'

/** Relative path of the profile registry under a profile root. */
const REGISTRY_RELATIVE = join('.dsh', 'dshsk', 'skills.json')

/** A read that may refuse: an unparsable file is reported, never replaced. */
export type JsonRead = { ok: true; document: Record<string, unknown> } | { ok: false; error: string }

/** Resolve the dsh home directory (the `user-dsh` root's base). */
export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** Whether a directory looks like a dsh profile root. */
function looksLikeProfileRoot(dir: string): boolean {
  return existsSync(join(dir, 'package.json'))
    && (existsSync(join(dir, 'cordis.yml')) || existsSync(join(dir, 'cordis.patch.yml')))
}

/** Walk upwards for the nearest profile root. */
function findProfileRootUpwards(start: string): string | undefined {
  let current = start
  for (let depth = 0; depth < 8; depth += 1) {
    if (looksLikeProfileRoot(current)) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

/**
 * Resolve the profile root this plugin is mounted under.
 *
 * The loader gives every plugin a `baseUrl`, which points into the profile's
 * own module tree, so the nearest ancestor carrying `package.json` plus a
 * cordis config file is this profile. A deployment that hands us no `baseUrl`
 * (tests, headless embeds) falls back to the dsh home.
 * @param ctx - context carrying the loader anchor.
 * @returns absolute profile root.
 */
export function resolveProfileRoot(ctx: { baseUrl?: string }): string {
  const baseUrl = ctx.baseUrl
  if (typeof baseUrl === 'string' && baseUrl.length > 0) {
    try {
      const found = findProfileRootUpwards(dirname(fileURLToPath(baseUrl)))
      if (found !== undefined) return found
    } catch {
      /* a non-file baseUrl (a data: or virtual URL) is not fatal */
    }
  }
  return dshHome()
}

/** The registry file for one profile root. */
export function registryFilePath(profileRoot: string): string {
  return join(profileRoot, REGISTRY_RELATIVE)
}

/**
 * Read a JSON object without ever throwing.
 * @param path - file to read.
 * @returns the parsed object, or the reason it could not be used.
 */
export function readJsonObject(path: string): JsonRead {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, document: {} }
    return { ok: false, error: `cannot read ${path}: ${String(error)}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ok: false, error: `invalid JSON in ${path}: ${String(error)}` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: `${path} must contain a JSON object` }
  }
  return { ok: true, document: parsed as Record<string, unknown> }
}

/**
 * Write a JSON document atomically, owner-readable only.
 * @param path - destination file.
 * @param document - JSON-serializable payload.
 */
export function atomicWriteJson(path: string, document: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`)
  try {
    writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    chmodSync(tmp, 0o600)
    renameSync(tmp, path)
  } finally {
    rmSync(tmp, { force: true })
  }
}
