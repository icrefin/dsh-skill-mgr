/**
 * Runtime contract of the `skillMgr` Remote descriptors.
 *
 * `tools/verify-typert.mjs` checks the *built* artifacts; this spec checks the
 * same invariants against the source table vitest imports directly, so a
 * violation fails `pnpm test` without a build. Everything asserted here is what
 * `dsh-typert-loader` / `dsh-typert-registry` enforce at install time, so the
 * test is the cheap gate in front of a late runtime failure.
 */

import { describe, expect, it } from 'vitest'
import type { InvocationDescriptor, TypertCodec } from '@deepseek-ai/dsh-typert-protocol'
import { DESCRIPTORS, PACKAGE_NAME, REMOTE_NAMESPACE } from '../src/typert.descriptors.ts'
import { TYPERT } from '../src/typert.host.ts'
import { TYPERT_REMOTE } from '../src/typert.remote-client.ts'

/**
 * The complete method set, in declaration order. Kept explicit so adding,
 * removing or renaming a Remote method forces this test to change with it.
 */
const EXPECTED_METHODS = [
  'snapshot',
  'saveGlobalSkill',
  'removeGlobalSkill',
  'setGlobalSkillEnabled',
  'skillDetail',
  'fixDiagnostic',
  'skillStats',
  'restoreTrashedSkill',
  'clearTrash',
] as const

/** Every wire segment the registry accepts. */
const SEGMENT = /^[A-Za-z0-9_$.-]+$/

type StrictCodec = Extract<TypertCodec, { mode: 'strict' }>

/** A representative payload pair for one codec's type symbol. */
interface Sample {
  /** A payload the schema must accept. */
  readonly valid: unknown
  /** A payload whose top-level JSON type is wrong, so the schema must reject it. */
  readonly invalid: unknown
}

/**
 * Representative payloads keyed by `codec.typeSymbol`.
 *
 * The `invalid` side is deliberately a wrong *top-level* type: that is the
 * failure a stale codec causes on the wire (`undefined` reaching the method),
 * and it cannot be accepted by an object/array/primitive schema by accident.
 */
const SAMPLES: Record<string, Sample> = {
  /* ------------------------------------------------------ parameters ---- */
  [`${PACKAGE_NAME}#${REMOTE_NAMESPACE}/enabled`]: { valid: true, invalid: 'yes' },
  [`${PACKAGE_NAME}#${REMOTE_NAMESPACE}/path`]: { valid: '/tmp/workspace/SKILL.md', invalid: 42 },
  [`${PACKAGE_NAME}#${REMOTE_NAMESPACE}/name`]: { valid: 'demo-skill', invalid: 42 },
  [`${PACKAGE_NAME}/types#SkillDraft`]: {
    valid: { name: 'demo-skill', description: 'a demo', root: 'user-dsh' },
    invalid: { name: 42 },
  },

  /* ---------------------------------------------------------- results -- */
  [`${PACKAGE_NAME}/types#SkillManagerSnapshot`]: {
    valid: {
      pluginVersion: '0.1.0',
      registryPath: '/profile/.dsh/dshsk/skills.json',
      profileRoot: '/profile',
      complete: true,
      skills: [],
      disabled: [],
      diagnostics: [],
      trash: [],
    },
    invalid: 42,
  },
  [`${PACKAGE_NAME}/types#SkillApplyResult`]: { valid: { ok: true }, invalid: 42 },
  [`${PACKAGE_NAME}/types#SkillDetailResult`]: { valid: { found: false }, invalid: 42 },
  [`${PACKAGE_NAME}/types#DiagnosticFixResult`]: { valid: { ok: true, path: '/tmp/x/SKILL.md' }, invalid: 42 },
  [`${PACKAGE_NAME}/types#SkillStatsResult`]: { valid: { ok: true, available: false, stats: [] }, invalid: 42 },
  [`${PACKAGE_NAME}/types#TrashRestoreResult`]: { valid: { ok: true, name: 'a', path: '/tmp/a' }, invalid: 42 },
  [`${PACKAGE_NAME}/types#TrashClearResult`]: { valid: { ok: true, deleted: [], failed: [] }, invalid: 42 },
}

/** Assert a codec is the strict, materializable shape the runtime requires. */
function strict(codec: TypertCodec | undefined, subject: string): StrictCodec {
  expect(codec, `${subject}: codec must exist`).toBeDefined()
  const value = codec as StrictCodec
  expect(value.mode, `${subject}: codec mode`).toBe('strict')
  expect(typeof value.typeSymbol, `${subject}: typeSymbol must be a string`).toBe('string')
  expect(value.typeSymbol.length, `${subject}: typeSymbol must be non-empty`).toBeGreaterThan(0)
  expect(typeof value.create, `${subject}: create must be a factory`).toBe('function')
  return value
}

/** Every codec in the table, paired with the subject used in failure messages. */
function allCodecs(descriptor: InvocationDescriptor): Array<{ subject: string; codec: StrictCodec }> {
  const list = [{ subject: `${descriptor.id} result`, codec: strict(descriptor.result, `${descriptor.id} result`) }]
  for (const parameter of descriptor.parameters) {
    list.push({
      subject: `${descriptor.id} parameter ${parameter.name}`,
      codec: strict(parameter.codec, `${descriptor.id} parameter ${parameter.name}`),
    })
  }
  return list
}

describe('skillMgr Remote descriptors', () => {
  it('declares exactly the expected method set, in order', () => {
    expect(DESCRIPTORS.map((descriptor) => descriptor.method)).toEqual([...EXPECTED_METHODS])
  })

  it('describes the same method set on both faces', () => {
    const host = TYPERT.invocations.map((descriptor) => `${descriptor.namespace}/${descriptor.method}`)
    const client = TYPERT_REMOTE.descriptors.map((descriptor) => `${descriptor.namespace}/${descriptor.method}`)
    expect(host).toEqual(client)
    expect(host).toEqual(EXPECTED_METHODS.map((method) => `${REMOTE_NAMESPACE}/${method}`))
  })

  it('publishes the host manifest the loader validates', () => {
    expect(TYPERT.package).toBe(PACKAGE_NAME)
    expect(TYPERT.face).toBe('host')
    expect(TYPERT.schemas).toEqual([])
    expect(TYPERT.model).toEqual({ services: [], events: [], objects: [] })
    expect(TYPERT.invocations).toBe(DESCRIPTORS)
    expect(TYPERT_REMOTE.package).toBe(PACKAGE_NAME)
    expect(TYPERT_REMOTE.descriptors).toBe(DESCRIPTORS)
  })

  it('gives every descriptor a well-formed, unique endpoint', () => {
    const endpoints = new Set<string>()
    const ids = new Set<string>()
    for (const descriptor of DESCRIPTORS) {
      const subject = descriptor.id
      expect(descriptor.id, 'id is nonempty').toBe(`${PACKAGE_NAME}#${REMOTE_NAMESPACE}/${descriptor.method}`)
      expect(descriptor.service).toBe(REMOTE_NAMESPACE)
      expect(descriptor.namespace).toBe(REMOTE_NAMESPACE)
      expect(descriptor.invocation).toEqual({ kind: 'direct' })
      expect(descriptor.mode).toBeUndefined()
      expect(SEGMENT.test(descriptor.namespace), `${subject}: namespace is a wire segment`).toBe(true)
      expect(SEGMENT.test(descriptor.method), `${subject}: method is a wire segment`).toBe(true)

      const endpoint = `${descriptor.namespace}/${descriptor.method}`
      expect(endpoints.has(endpoint), `${subject}: duplicate endpoint ${endpoint}`).toBe(false)
      endpoints.add(endpoint)
      expect(ids.has(descriptor.id), `${subject}: duplicate id`).toBe(false)
      ids.add(descriptor.id)
    }
    expect(endpoints.size).toBe(EXPECTED_METHODS.length)
  })

  it('sources every parameter from a unique JSON wire field', () => {
    for (const descriptor of DESCRIPTORS) {
      const wires = new Set<string>()
      for (const parameter of descriptor.parameters) {
        const subject = `${descriptor.id} parameter ${parameter.name}`
        expect(parameter.name.length, `${subject}: name is nonempty`).toBeGreaterThan(0)
        expect(parameter.wire).toBe(parameter.name)
        expect(SEGMENT.test(parameter.wire), `${subject}: wire is a wire segment`).toBe(true)
        expect(wires.has(parameter.wire), `${subject}: repeated wire ${parameter.wire}`).toBe(false)
        wires.add(parameter.wire)
        expect(parameter.source, `${subject}: source`).toBe('json')
        expect(parameter.lookup, `${subject}: a json parameter declares no lookup`).toBeUndefined()
      }
    }
  })

  it('uses strict, materializable codecs for every parameter and result', () => {
    for (const descriptor of DESCRIPTORS) {
      for (const { subject, codec } of allCodecs(descriptor)) {
        const schema = codec.create()
        expect(schema, `${subject}: create() must return a schema`).toBeTruthy()
        expect(typeof schema.parse, `${subject}: schema must expose parse()`).toBe('function')
      }
    }
  })

  it('parse() accepts a representative payload and rejects a wrong-typed one', () => {
    const checked = new Set<string>()
    for (const descriptor of DESCRIPTORS) {
      for (const { subject, codec } of allCodecs(descriptor)) {
        const sample = SAMPLES[codec.typeSymbol]
        expect(sample, `${subject}: no sample for type symbol ${codec.typeSymbol}`).toBeDefined()
        const schema = codec.create()
        expect(() => schema.parse(sample.valid), `${subject}: rejected a valid payload`).not.toThrow()
        expect(() => schema.parse(sample.invalid), `${subject}: accepted a wrong-typed payload`).toThrow()
        checked.add(codec.typeSymbol)
      }
    }
    // Every sample is exercised, so a stale one cannot linger unnoticed.
    expect([...Object.keys(SAMPLES)].sort()).toEqual([...checked].sort())
  })

  it('materializes one canonical schema per published named type', () => {
    const schemas = new Map<string, unknown>()
    for (const descriptor of DESCRIPTORS) {
      for (const { codec } of allCodecs(descriptor)) {
        // Only the published `types#…` payloads are shared objects; an ad-hoc
        // primitive parameter is built per call site (same symbol, same shape).
        if (!codec.typeSymbol.includes('/types#')) continue
        const schema = codec.create()
        const seen = schemas.get(codec.typeSymbol)
        if (seen === undefined) schemas.set(codec.typeSymbol, schema)
        // A named payload is one schema object; a second, divergent schema
        // behind the same symbol is exactly the drift the runtime cannot see.
        else expect(schema, `${codec.typeSymbol}: two schemas share one type symbol`).toBe(seen)
      }
    }
    expect(schemas.size).toBeGreaterThan(0)
  })
})