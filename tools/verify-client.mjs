#!/usr/bin/env node
/**
 * Verify the built browser bundle the way the page loads it.
 *
 * `lib/client.js` is only meaningful behind the module loader: it calls
 * `window.__ModuleLoader__.load({ id, factory })` and the shell hands the
 * factory a `require` limited to the platform seeds. This script reproduces
 * exactly that — stub the loader, evaluate the bundle, run the factory with a
 * real `react` — and then drives `apply()` against a recording slot registry.
 *
 * It is the check that catches the failures a typecheck cannot: a bundle whose
 * row id no longer matches the package name (the loader rejects it with
 * "loaded without registering <id>"), a registration that throws inside
 * `apply` (which would blank the GUI), a `sidebar.panellist` row whose id does
 * not match the `main` key it opens (the layout throws instead of switching),
 * or a bundle that still registers into a surface it was moved off.
 *
 * Usage: node tools/verify-client.mjs
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = join(root, 'lib', 'client.js')
const clientBundle = readFileSync(bundlePath, 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

/* ---- 1. the bundle registers under the package name ------------------- */

let captured
globalThis.window = { __ModuleLoader__: { load: (mod) => { captured = mod } } }
await import(pathToFileURL(bundlePath).href)
check(captured !== undefined, 'lib/client.js did not call window.__ModuleLoader__.load')
check(captured?.id === manifest.name, `the loader row id must be the package name (got ${String(captured?.id)})`)
check(typeof captured?.factory === 'function', 'the loader entry must carry a factory')

const require = createRequire(join(root, 'package.json'))
/**
 * Platform seeds are provided by the shell's module table at runtime, never
 * installed: the bundle may only `require` them. A stub answers every export
 * with an inert component so the factory can be evaluated in Node without
 * pulling a package (and its own peer graph) in.
 */
const platformSeed = new Proxy({}, { get: () => () => null })
const shim = (id) => (id.startsWith('@deepseek-ai/') ? platformSeed : require(id))
const exports = captured.factory(shim)
check(typeof exports.apply === 'function', 'the factory must export apply()')
check(Array.isArray(exports.inject), 'the factory must export an inject list')
check(typeof exports.PANEL_ID === 'string', 'the factory must export the panel id')

/* ---- 2. apply() registers the sidebar seat and nothing else ----------- */

const registrations = []
const disposers = []
const ctx = {
  effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return () => {} },
  get: () => undefined,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
  },
  remote: { $mount: async () => () => {} },
  configForms: {
    get: () => ({
      subscribe: () => () => {},
      getSnapshot: () => ({}),
      set: () => {},
      unset: () => {},
    }),
  },
  slots: {
    inject: (key, callback) => { callback(); return () => {} },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

try {
  await exports.apply(ctx)
} catch (error) {
  failures.push(`apply() threw, which blanks the GUI: ${String(error)}`)
}

const bySlot = (name) => registrations.filter((entry) => entry.options.name === name)
const panelId = exports.PANEL_ID

check(bySlot('sidebar.panellist').length === 1, `expected exactly one sidebar.panellist row, got ${bySlot('sidebar.panellist').length}`)
check(bySlot('main').length === 1, `expected exactly one main panel, got ${bySlot('main').length}`)
check(bySlot('settings.section').length === 0, 'the plugin must not register into Settings any more')

const row = bySlot('sidebar.panellist')[0]?.options
const panel = bySlot('main')[0]?.options
check(row?.id === panelId, `the sidebar row id must equal PANEL_ID (got ${String(row?.id)})`)
check(panel?.key === panelId, `the main key must equal PANEL_ID (got ${String(panel?.key)})`)
check(row?.id === panel?.key, 'the sidebar row and the main panel must share one id, or selectPanel throws')
check(typeof row?.order === 'number', 'the sidebar row needs a numeric order')
check(row?.label === undefined || typeof row.label === 'function', 'the sidebar label must be a function')
check(typeof panel?.inject === 'function', 'the main panel must inject its face through a factory')

// The `plugins.bundle.config` card is the Plugins-manager surface and stays.
check(bySlot('plugins.bundle.config').length === 1, 'the plugin config card must stay registered')
check(bySlot('plugins.bundle.config')[0]?.options?.key === manifest.name, 'the config card is keyed by the bundle package name')

/* ---- 3. the bundle's externals are exactly the platform seeds ---------- */

const externals = [...new Set([...clientBundle.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]))].sort()
// The bundle must require exactly the platform seeds it uses. With no tab strip
// left there is no primitive to import, so the set is down to React — keeping
// the list explicit means a new runtime import has to be a deliberate edit here
// rather than a silent dependency on a module the shell may not seed.
const allowed = ['react', 'react/jsx-runtime'].sort()
check(
  externals.join('|') === allowed.join('|'),
  `lib/client.js must require only the platform seeds; it requires ${externals.join(', ')}`,
)

/* ---- 4. both page headers clear the window chrome ---------------------- */

// `.page` carries no top padding, so whichever header renders first owns the
// macOS frame clearance. The detail (inspect) view once rendered flush against
// the app's top boundary because only `.pageHead` had the offset.
const darwinRule = /\[data-platform=darwin\][^{}]*_pageHead[^{}]*_detailHead[^{}]*\{[^}]*dsh-frame-top-clearance/.test(clientBundle)
  || /\[data-platform=darwin\][^{}]*_detailHead[^{}]*_pageHead[^{}]*\{[^}]*dsh-frame-top-clearance/.test(clientBundle)
check(darwinRule, 'the darwin frame clearance must be shared by .pageHead and .detailHead, or the inspect view sits against the top boundary')
check(/_detailHead\s*[,{]/.test(clientBundle), 'lib/client.js carries no .detailHead rule at all')

/* ---- 5. the page header matches the shell's own pages ------------------ */

// The panel is a peer of the built-in pages and of dsh-mcp-mgr, whose headers
// are all 20px/500. A 24px/700 header reads as a different level of the
// hierarchy, and nothing but a look at the GUI would catch the drift.
const titleRule = clientBundle.match(/\.sm[a-z0-9]+_title\s*\{[^}]*\}/)?.[0] ?? ''
check(/font-size:\s*20px/.test(titleRule), `the page title must be 20px like the shell's pages (rule: ${titleRule || 'missing'})`)
check(/font-weight:\s*500/.test(titleRule), `the page title must be weight 500 like the shell's pages (rule: ${titleRule || 'missing'})`)

/* ---- 6. dispose everything without throwing --------------------------- */

for (const dispose of disposers) {
  try {
    dispose()
  } catch (error) {
    failures.push(`a disposer threw during teardown: ${String(error)}`)
  }
}

/* ---- report ----------------------------------------------------------- */

if (failures.length > 0) {
  console.error(`verify-client: ${failures.length} problem(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`verify-client: OK — row "${panelId}" (order ${row.order}) opens main "${panel.key}"; config card keyed by ${manifest.name}`)
// The slash-dots retry loop schedules timers; nothing is left to await.
process.exit(0)