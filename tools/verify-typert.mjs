#!/usr/bin/env node
/**
 * Verify the published Typert artifacts of dsh-skill-mgr.
 *
 * The Host Gateway and the Client API gateway validate these artifacts at
 * runtime, and both fail *late*: an undeclared argument is a loud
 * `gateway/arguments-invalid`, but a codec that predates a field silently
 * strips it and the method body sees `undefined` with no error anywhere. This
 * script is the cheap gate that catches both before an install:
 *
 * 1. the host manifest satisfies everything `dsh-typert-loader` checks
 *    (`package`/`face`/`schemas`/`invocations`/`model`);
 * 2. every descriptor satisfies everything `dsh-typert-registry` checks
 *    (`validateInvocation`: ids, segments, unique wire names, strict codecs);
 * 3. every codec's `create()` returns a schema that parses a representative
 *    payload — i.e. the schema shown to the boundary is the one the methods
 *    actually take;
 * 4. the two faces describe the same method set, so a browser bundle can never
 *    mount an older descriptor set than the host serves;
 * 5. the client bundle inlines that same method set (it is bundled from
 *    `typert.remote-client.ts`, and a stale bundle would otherwise ship a UI
 *    that calls a method the host does not have).
 *
 * Usage: node tools/verify-typert.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const notes = []

/** Record one failed assertion. */
function fail(message) {
  failures.push(message)
}

/** Assert one condition. */
function check(condition, message) {
  if (!condition) fail(message)
}

/** Load one built ESM artifact. */
async function load(relative) {
  const url = new URL(relative, import.meta.url)
  return import(url.href)
}

const { TYPERT } = await load('../lib/types/typert.host.js')
const remote = await load('../lib/types/typert.remote-client.js')
const TYPERT_REMOTE = remote.TYPERT_REMOTE ?? remote.default
const clientBundle = readFileSync(join(packageRoot, 'lib', 'client.js'), 'utf8')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

/* --------------------------------------------------- 1. host manifest ---- */

check(TYPERT?.package === manifest.name, `TYPERT.package must be ${manifest.name}`)
check(TYPERT?.face === 'host', 'TYPERT.face must be "host"')
check(Array.isArray(TYPERT?.schemas), 'TYPERT.schemas must be an array')
check(Array.isArray(TYPERT?.invocations), 'TYPERT.invocations must be an array')
for (const key of ['services', 'events', 'objects']) {
  check(Array.isArray(TYPERT?.model?.[key]), `TYPERT.model.${key} must be an array`)
}

/* -------------------------------------------------- 2. registry rules ---- */

const SEGMENT = /^[A-Za-z0-9_$.-]+$/
const endpoints = new Set()
const ids = new Set()

for (const descriptor of TYPERT.invocations) {
  const where = descriptor.id ?? '<missing id>'
  check(typeof descriptor.id === 'string' && descriptor.id.length > 0, 'every invocation needs a nonempty id')
  check(typeof descriptor.service === 'string' && descriptor.service.length > 0, `${where}: service must be nonempty`)
  check(SEGMENT.test(descriptor.namespace ?? ''), `${where}: namespace "${descriptor.namespace}" is not a wire segment`)
  check(SEGMENT.test(descriptor.method ?? ''), `${where}: method "${descriptor.method}" is not a wire segment`)
  check(descriptor.namespace === descriptor.service, `${where}: namespace and service key must match so the client reads it back as remote.<namespace>`)
  check(descriptor.id === `${TYPERT.package}#${descriptor.service}/${descriptor.method}`, `${where}: id must be <package>#<service>/<method>`)
  const endpoint = `${descriptor.namespace}/${descriptor.method}`
  check(!endpoints.has(endpoint), `${where}: duplicate endpoint ${endpoint}`)
  endpoints.add(endpoint)
  check(!ids.has(descriptor.id), `${where}: duplicate invocation id`)
  ids.add(descriptor.id)

  // codec(descriptor.result) — result codecs are strict too; the loader insists.
  verifyCodec(descriptor.result, `${where} result`)

  const wires = new Set()
  for (const parameter of descriptor.parameters ?? []) {
    check(typeof parameter.name === 'string' && parameter.name.length > 0, `${where}: parameter name must be nonempty`)
    check(SEGMENT.test(parameter.wire ?? ''), `${where}: parameter wire "${parameter.wire}" is not a wire segment`)
    check(!wires.has(parameter.wire), `${where}: repeated wire field "${parameter.wire}"`)
    wires.add(parameter.wire)
    check(parameter.source === 'json', `${where}: only json parameters are used by this plugin`)
    check(parameter.lookup === undefined, `${where}: a json parameter must not declare a lookup`)
    verifyCodec(parameter.codec, `${where} parameter ${parameter.name}`)
  }
}

/** Replicate `validateCodec` from @deepseek-ai/dsh-typert-registry. */
function verifyCodec(codec, subject) {
  if (codec === undefined || codec === null) {
    fail(`${subject}: codec is missing`)
    return
  }
  if (codec.mode !== 'strict') {
    fail(`${subject}: codec mode must be "strict" (got ${String(codec.mode)})`)
    return
  }
  check(typeof codec.typeSymbol === 'string' && codec.typeSymbol.length > 0, `${subject}: strict codec needs a typeSymbol`)
  check(typeof codec.create === 'function', `${subject}: strict codec needs a create() factory`)
}

/* ------------------------------------------------ 3. codecs round-trip --- */

/** One representative argument per method that takes arguments. */
const SAMPLES = {
  saveGlobalSkill: [{ name: 'demo-skill', description: 'a demo', root: 'user-dsh' }],
  removeGlobalSkill: ['demo-skill'],
  setGlobalSkillEnabled: ['demo-skill', false],
  setGlobalSkillsEnabled: [['a', 'b'], true],
  skillDetail: ['demo-skill'],
  fixDiagnostic: ['/tmp/workspace/.dsh/skills/demo/SKILL.md'],
  restoreTrashedSkill: ['demo-skill'],
}
for (const descriptor of TYPERT.invocations) {
  const params = descriptor.parameters ?? []
  if (params.length === 0) continue
  const sample = SAMPLES[descriptor.method]
  if (sample === undefined) {
    notes.push(`no sample payload for ${descriptor.method}; its parameter codecs were only structurally checked`)
    continue
  }
  for (const [index, parameter] of params.entries()) {
    const value = sample[index]
    if (value === undefined) {
      fail(`${descriptor.method}: sample payload is missing an argument for parameter "${parameter.name}"`)
      continue
    }
    try {
      parameter.codec.create().parse(value)
    } catch (error) {
      fail(`${descriptor.method}.${parameter.name}: codec rejected the sample payload (${String(error)})`)
    }
  }
  if (sample.length !== params.length) {
    fail(`${descriptor.method}: sample payload has ${sample.length} argument(s) but the descriptor declares ${params.length}`)
  }
}

/* -------------------------------------------- 4. the two faces agree ----- */

const host = TYPERT.invocations.map((descriptor) => `${descriptor.namespace}/${descriptor.method}`).sort()
const client = (TYPERT_REMOTE?.descriptors ?? []).map((descriptor) => `${descriptor.namespace}/${descriptor.method}`).sort()
check(TYPERT_REMOTE?.package === TYPERT.package, 'the client contribution must name the same package')
check(host.join('|') === client.join('|'), 'the host manifest and the client contribution must describe the same methods')

/* ------------------------------------------- 5. the bundle carries it ---- */

for (const descriptor of TYPERT_REMOTE.descriptors ?? []) {
  const needle = `'${descriptor.method}'`
  if (!clientBundle.includes(needle) && !clientBundle.includes(`"${descriptor.method}"`)) {
    fail(`lib/client.js does not mention the Remote method "${descriptor.method}" — the panel bundle is stale`)
  }
}
const strictCodecs = TYPERT.invocations.length
  + TYPERT.invocations.reduce((sum, descriptor) => sum + (descriptor.parameters?.length ?? 0), 0)
// Unlike a pipeline-generated pair, this package's artifacts share one
// descriptor table, so the bundle carries the codec *helper* and not one
// factory per codec. Assert the helper is there (i.e. the bundle was rebuilt
// after the descriptor change) rather than counting factories.
const bundleHasHelper = /mode:\s*["']strict["']/.test(clientBundle) && /create:\s*\(\)\s*=>/.test(clientBundle)
check(bundleHasHelper, 'lib/client.js carries no strict-codec factory — the panel bundle is stale')

/* ----------------------------------------------------------- report ----- */

for (const note of notes) console.log(`note: ${note}`)
if (failures.length > 0) {
  console.error(`verify-typert: ${failures.length} problem(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`verify-typert: OK — ${TYPERT.invocations.length} invocations, ${strictCodecs} strict codecs, host and client in step`)