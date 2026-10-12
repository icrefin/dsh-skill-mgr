/**
 * The profile registry and per-workspace selection files.
 *
 * Everything here drives the real filesystem under a temp dir — no mocks and
 * no fixtures: `readJsonObject` / `atomicWriteJson` are the two primitives every
 * other module in this plugin persists through, so their failure modes
 * (missing file, unparsable file, non-object JSON, temp-file leftovers, file
 * mode) are the ones worth pinning down.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  atomicWriteJson,
  dshHome,
  readJsonObject,
  registryFilePath,
  resolveProfileRoot,
} from '../src/registry.ts'

describe('registry file layout', () => {
  it('puts the registry under `<root>/.dsh/dshsk/skills.json`', () => {
    expect(registryFilePath('/profile')).toBe(join('/profile', '.dsh', 'dshsk', 'skills.json'))
  })

  it('resolves the profile root to the dsh home when the context has no baseUrl', () => {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = '/tmp/dsh-home-for-test'
    try {
      expect(dshHome()).toBe('/tmp/dsh-home-for-test')
      expect(resolveProfileRoot({})).toBe('/tmp/dsh-home-for-test')
      // A non-file baseUrl is not fatal: it falls back to the dsh home too.
      expect(resolveProfileRoot({ baseUrl: 'data:text/javascript,export{}' })).toBe('/tmp/dsh-home-for-test')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})

describe('readJsonObject', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-skill-mgr-registry-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads a missing file as an empty document', () => {
    expect(readJsonObject(join(dir, 'missing.json'))).toEqual({ ok: true, document: {} })
  })

  it('reads a valid object', () => {
    const path = join(dir, 'ok.json')
    const document = { use: ['a'], nested: { n: 1 } }
    writeFileSync(path, JSON.stringify(document))
    expect(readJsonObject(path)).toEqual({ ok: true, document })
  })

  it('refuses invalid JSON instead of throwing', () => {
    const path = join(dir, 'broken.json')
    writeFileSync(path, 'not json at all')
    const read = readJsonObject(path)
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error('unreachable')
    expect(read.error).toContain('invalid JSON')
    expect(read.error).toContain(path)
  })

  it('refuses a JSON array', () => {
    const path = join(dir, 'array.json')
    writeFileSync(path, '["a"]')
    const read = readJsonObject(path)
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error('unreachable')
    expect(read.error).toContain('must contain a JSON object')
  })

  it('refuses JSON null and scalars', () => {
    for (const [name, body] of [['null.json', 'null'], ['string.json', '"x"'], ['number.json', '7']] as const) {
      const path = join(dir, name)
      writeFileSync(path, body)
      expect(readJsonObject(path).ok, `${name} must be refused`).toBe(false)
    }
  })

  it('reports a non-ENOENT read failure without throwing', () => {
    const read = readJsonObject(dir) // a directory, not a file
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error('unreachable')
    expect(read.error).toContain('cannot read')
  })
})

describe('atomicWriteJson', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-skill-mgr-atomic-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates parent directories and writes an owner-only file', async () => {
    const path = join(dir, 'deep', 'er', 'skills.json')
    atomicWriteJson(path, { version: 5, skills: [] })

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 5, skills: [] })
    // Trailing newline so the file stays diff-friendly.
    expect(await readFile(path, 'utf8')).toBe(`${JSON.stringify({ version: 5, skills: [] }, null, 2)}\n`)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('leaves no temp file behind', async () => {
    const path = join(dir, 'skills.json')
    atomicWriteJson(path, { a: 1 })
    atomicWriteJson(path, { a: 2 })

    expect(await readdir(dir)).toEqual(['skills.json'])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ a: 2 })
  })

  it('overwrites an existing file atomically', async () => {
    const path = join(dir, 'skills.json')
    await writeFile(path, '{"old":true}\n', 'utf8')
    atomicWriteJson(path, { replaced: true })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ replaced: true })
    expect(await readdir(dir)).toEqual(['skills.json'])
  })
})
