#!/usr/bin/env node
/**
 * Verify the built host half against a real Cordis context.
 *
 * `tools/verify-typert.mjs` checks the *declared* wire contract and
 * `tools/verify-client.mjs` checks the browser bundle; neither proves that the
 * host service actually mounts and publishes its methods. This script does:
 * it constructs the compiled gateway on a `@deepseek-ai/cordis` `Context` and
 * reads the markers back with the protocol's own `remoteMethods()` — the exact
 * call the Host Gateway makes when it discovers what a service exposes.
 *
 * It catches the failures a typecheck cannot: a decorator that standard-mode
 * lowering dropped, a service key that no longer matches the wire namespace
 * (the client would then look for `remote.<namespace>` and find nothing), a
 * method marked with a name that is not a legal wire segment, and a manifest
 * loaded at a module depth where the plugin can no longer read its own version.
 *
 * Usage: node tools/verify-gateway.mjs
 */

import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { SkillMgrGateway } from '../lib/types/gateway.js'
import { CURRENT_VERSION } from '../lib/types/version.js'
import { TYPERT } from '../lib/types/typert.host.js'
import { REMOTE_NAMESPACE } from '../lib/types/typert.descriptors.js'

const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

/* A context with no composition at all: the gateway reaches everything through
   the dependency view, so this is the minimum a real mount also provides. */
const ctx = new Context()
const deps = {
  skills: { snapshot: async () => ({ skills: [], complete: true }), get: async () => undefined },
  store: {},
  registryPath: '/tmp/dsh-skill-mgr-verify/registry.json',
  profileRoot: '/tmp/dsh-skill-mgr-verify',
}

let gateway
try {
  gateway = new SkillMgrGateway(ctx, deps, { strictMode: false, activeWorkspace: '' })
} catch (error) {
  failures.push(`constructing the gateway threw: ${String(error)}`)
}

if (gateway !== undefined) {
  check(gateway.name === REMOTE_NAMESPACE, `the Cordis service key must be "${REMOTE_NAMESPACE}" (got "${String(gateway.name)}")`)
  check(gateway.typertRemote?.namespace === REMOTE_NAMESPACE, `the Typert namespace must be "${REMOTE_NAMESPACE}" (got "${String(gateway.typertRemote?.namespace)}")`)

  const marked = remoteMethods(gateway)
  // The protocol stores `method` and, only when it differs, `exportName`;
  // the wire name is the export name when present.
  const names = marked.map((marker) => marker.exportName ?? marker.method).sort()
  const declared = TYPERT.invocations.map((descriptor) => descriptor.method).sort()

  check(names.every((name) => typeof name === 'string' && /^[A-Za-z0-9_$.-]+$/.test(name)), 'every Remote method needs a legal wire segment name')
  check(names.length === declared.length, `the live service exposes ${names.length} methods but the manifest declares ${declared.length}`)
  check(names.join('|') === declared.join('|'), `the live methods and the manifest disagree: live-only ${names.filter((n) => !declared.includes(n)).join(', ') || 'none'}; manifest-only ${declared.filter((n) => !names.includes(n)).join(', ') || 'none'}`)
  check(marked.every((marker) => marker.invocation?.kind === 'direct'), 'every method must be a direct (unscoped) invocation')
}

/* The version reader must work from the built layout, not just from src/. */
check(/^\d+\.\d+\.\d+/.test(CURRENT_VERSION), `CURRENT_VERSION must resolve from the built layout, got "${String(CURRENT_VERSION)}"`)

if (failures.length > 0) {
  console.error(`verify-gateway: ${failures.length} problem(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`verify-gateway: OK — service "${REMOTE_NAMESPACE}" mounts with ${remoteMethods(gateway).length} methods, version ${CURRENT_VERSION}`)
process.exit(0)