/**
 * Render the built client bundle outside the GUI and screenshot it.
 *
 * The seat registrations are verified against the live app by
 * `tools/verify-client.mjs`; this harness answers the other half — that the
 * panel actually paints, with its real styling, in the two states the docs
 * show: the flat profile inventory (`.page` + one table + diagnostics + trash)
 * and the Inspect page for one skill.
 *
 * Technique, mirroring `.publish/dsh-provider-model-picker/tools/preview.mjs`:
 *
 * 1. the harness writes ONE self-contained HTML file per state into a temp
 *    directory. React 18's UMD development builds are inlined as `<script>`
 *    blocks (the page runs from `file://`, so there is no network);
 * 2. `window.__ModuleLoader__` is stubbed to capture the definition that
 *    `lib/client.js` registers, and a `require` shim answers `react` and
 *    `react/jsx-runtime` on top of the inlined React;
 * 3. `window.__definition.factory(require).apply(ctx)` runs with a minimal
 *    fake client context: `effect` runs its callback, `locale.register`/`bind`
 *    are no-ops (the panel's copy comes from the bundle's own `tt()`, which
 *    picks its dictionary from `document.documentElement.lang` — hence
 *    `<html lang="en">`), `remote.$mount` resolves a disposer, `configForms.get`
 *    returns a ready settings scope, `slots.inject`/`register` record the
 *    registrations, and `get('inputTriggers')` is undefined so the slash-dot
 *    wiring gives up quietly;
 * 4. the recorded `main` slot is mounted with `React.createElement(component,
 *    { api })`, where `api` is a fake implementing the same duck-typed
 *    `SkillMgrApi` surface (`catalog()`, `trash()`, `stats()`, `skill(name)`,
 *    `refresh()`, `toggle()`, …) over an invented `CatalogView` / `SkillDetail`;
 * 5. the detail shot is not faked: the harness dispatches a real `click` on the
 *    `pdf-toolkit` row's **Inspect** button and waits for the detail header to
 *    appear, so the shot shows the panel's own navigation.
 *
 * The bundle embeds its compiled CSS as a `const css = "…"` string literal
 * (and installs it itself at evaluation time). The harness extracts every such
 * literal with a regex, `JSON.parse`s it, injects the concatenated text into a
 * `<style>` block, and defines every `var(--dsw-…)` / `var(--dsh-…)` token the
 * CSS actually reads, so the page looks like the real light-theme dsh UI
 * (inset grouped cards, hairlines, chips) rather than unstyled HTML.
 *
 * Privacy: the harness never reads a DSH profile (`~/.dsh`, `~/.agents`, the
 * desktop profile) and never touches the network. Every skill, root, path and
 * timestamp below is invented and generic; nothing from this machine appears in
 * the page. The panel's own author credit ships an e-mail address in its
 * source, so the harness redacts e-mail addresses from the rendered text before
 * asserting and shooting, and the assertion refuses to shoot a DOM that still
 * contains an absolute home path, an e-mail or this machine's user name.
 *
 * Usage (needs Google Chrome on the host):
 *
 *     node tools/preview.mjs [--out <dir>] [--png <file>] [--detail-png <file>] [--open]
 *
 * `--out` is where the harness HTML is written (a temp directory by default);
 * `--png` / `--detail-png` are the two screenshots to produce, resolved against
 * the current directory and defaulting to `docs/images/skills-panel.png` and
 * `docs/images/skill-detail.png`.
 *
 * @module dsh-skill-mgr/tools/preview
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const bundle = join(packageRoot, 'lib', 'client.js')

/** Chrome binaries to try, in order. */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

/** The row whose Inspect button the detail shot drives. */
const INSPECT_SKILL = 'pdf-toolkit'

/**
 * Light-theme values for every design token the panel CSS reads. The token CSS
 * the built bundle ships does not define these — the host theme does — so the
 * harness stands in for `dsh-client-ui-theme` with the light values the real GUI
 * resolves to. `tokenBlock` reads the tokens out of the extracted CSS, warns
 * about one this table has not learned yet and falls back to a neutral value,
 * so a token added to the panel CSS can never render as an unstyled hole.
 */
const TOKENS = {
  '--dsh-frame-top-clearance': '28px',
  '--dsw-alias-bg-layer-1': '#ffffff',
  '--dsw-alias-bg-layer-2': '#fafafb',
  '--dsw-alias-bg-layer-3': '#ffffff',
  '--dsw-alias-bg-module-platform': '#f1f2f4',
  '--dsw-alias-bg-skeleton': 'rgba(128,128,128,.10)',
  '--dsw-alias-border-l2': '#e6e7ea',
  '--dsw-alias-border-l3': '#d8dadd',
  '--dsw-alias-brand-primary': '#4d6bfe',
  '--dsw-alias-button-primary-fill': '#4d6bfe',
  '--dsw-alias-button-primary-hover': '#3d5bf0',
  '--dsw-alias-interactive-bg-active': 'rgba(26,27,30,.10)',
  '--dsw-alias-interactive-bg-hover': 'rgba(26,27,30,.06)',
  '--dsw-alias-label-caption': '#a2a5ab',
  '--dsw-alias-label-dimmed': '#c3c5ca',
  '--dsw-alias-label-primary': '#1a1b1e',
  '--dsw-alias-label-primary-foreground': '#ffffff',
  '--dsw-alias-label-secondary': '#52555c',
  '--dsw-alias-label-tertiary': '#85888f',
  '--dsw-alias-state-business-primary': '#3b6df5',
  '--dsw-alias-state-error-primary': '#d93b36',
  '--dsw-alias-state-success-primary': '#1f9d55',
  '--dsw-alias-state-warn-label': '#a9690a',
  '--dsw-alias-state-warn-primary': '#c47f0a',
}

/** Neutral fallback for a token the table above has not learned yet. */
const TOKEN_FALLBACK = 'rgba(128,128,128,.12)'

/* ------------------------------------------------------------------ data */

/**
 * The invented profile inventory the panel renders.
 *
 * Nothing here is read from disk or from a DSH profile: the names are generic
 * skills, the roots are the `~/.dsh/skills` / `~/.agents/skills` spellings the
 * UI itself shows, and every timestamp is relative to the run.
 *
 * @returns the `SkillManagerSnapshot` the fake client answers with.
 */
function fakeSnapshot() {
  const now = Date.now()
  const minutes = 60_000
  const hours = 60 * minutes
  const days = 24 * hours
  const call = (name, count, ago) => ({
    name,
    count,
    ...(ago !== undefined ? { lastUsed: now - ago } : {}),
  })
  return {
    pluginVersion: '0.1.0',
    registryPath: '~/.dsh/dshsk/skills.json',
    profileRoot: '~/.dsh',
    complete: true,
    skills: [
      {
        name: 'a-stock-analysis',
        description: 'A-share quotes, intraday volume distribution and position P/L.',
        whenToUse: 'When asked about a mainland-listed ticker, its order book or an open position.',
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'skill-mgr',
        writable: true,
        source: 'user-dsh',
        addedAt: now - 31 * days,
        updatedAt: now - 4 * days,
        shortDescription: 'A-share quotes, intraday volume and position P/L.',
      },
      {
        name: 'code-review',
        description: 'Review a diff for correctness, regressions and missing tests before it lands.',
        whenToUse: 'When a patch needs a second pair of eyes.',
        invocation: { modelInvocable: true, userInvocable: false },
        provider: 'skill-mgr',
        writable: true,
        source: 'user-agents',
        addedAt: now - 96 * days,
        updatedAt: now - 12 * days,
      },
      {
        name: 'docx-writer',
        description: 'Create and edit Word documents from a template, with a checked layout.',
        invocation: { modelInvocable: true, userInvocable: false },
        provider: 'skill-filesystem',
        writable: false,
        source: 'bundled',
        addedAt: now - 210 * days,
        updatedAt: now - 60 * days,
      },
      {
        name: 'git-commit-helper',
        description: 'Stage, split and word a commit from the working tree diff.',
        whenToUse: 'When the user asks to commit the current changes.',
        invocation: { modelInvocable: false, userInvocable: true },
        provider: 'skill-mgr',
        writable: true,
        source: 'user-agents',
        addedAt: now - 74 * days,
        updatedAt: now - 9 * days,
      },
      {
        name: 'pdf-toolkit',
        description: 'Read, merge, split, watermark and OCR PDF files, with layout-faithful extraction.',
        whenToUse: 'When a PDF must be read, split, stamped or converted.',
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'skill-mgr',
        writable: true,
        source: 'user-dsh',
        addedAt: now - 58 * days,
        updatedAt: now - 2 * days,
        shortDescription: 'Read, merge, split, watermark and OCR PDF files.',
        brandColor: '#4d6bfe',
        defaultPrompt: 'Split this PDF and extract the text of page 3.',
      },
      {
        name: 'release-notes',
        description: 'Turn merged pull requests into a grouped, user-facing changelog.',
        invocation: { modelInvocable: true, userInvocable: false },
        provider: 'skill-mgr',
        writable: true,
        source: 'user-dsh',
        addedAt: now - 22 * days,
        updatedAt: now - 22 * days,
      },
      {
        name: 'sql-migration-guard',
        description: 'Check a migration for destructive DDL before it reaches the database.',
        invocation: { modelInvocable: true, userInvocable: false },
        provider: 'skill-mgr',
        writable: true,
        source: 'user-agents',
        addedAt: now - 120 * days,
        updatedAt: now - 63 * days,
      },
      {
        name: 'brand-voice',
        displayName: 'House Voice',
        description: 'Style long-form copy to the house voice and flag off-brand phrasing.',
        invocation: { modelInvocable: false, userInvocable: false },
        provider: 'skill-mgr',
        writable: true,
        source: 'user-dsh',
        addedAt: now - 6 * days,
        updatedAt: now - 6 * days,
      },
    ],
    disabled: [
      {
        name: 'legacy-deploy',
        description: 'The old rsync deploy runbook — superseded by the release pipeline.',
        path: '~/.dsh/skills/legacy-deploy/SKILL.md.disabled',
        root: 'user-dsh',
        disabledAt: now - 12 * days,
      },
      {
        name: 'screenshot-diff',
        description: 'Pixel diff two screenshots and report the changed regions.',
        path: '~/.agents/skills/screenshot-diff/SKILL.md.disabled',
        root: 'user-agents',
        disabledAt: now - 35 * days,
      },
    ],
    diagnostics: [
      {
        path: '~/.dsh/skills/image-batch/SKILL.md',
        root: 'user-dsh',
        reason: 'frontmatter: description holds an unquoted ":" (line 3); the file was skipped',
        fixable: true,
      },
      {
        path: '~/.agents/skills/todo-list/TODO_LIST.md',
        root: 'user-agents',
        reason: 'name "Todo_List" is not kebab-case; expected a directory with SKILL.md',
        fixable: false,
      },
    ],
    duplicateNames: ['code-review'],
    trash: [
      {
        name: 'old-style-guide',
        path: '~/.dsh/skills/.trash/old-style-guide',
        movedAt: now - 6 * days,
      },
      {
        name: 'tmp-benchmark',
        path: '~/.agents/skills/.trash/tmp-benchmark',
        movedAt: now - 2 * days,
      },
    ],
    stats: [
      call('a-stock-analysis', 128, 8 * minutes),
      call('pdf-toolkit', 61, 3 * hours),
      call('code-review', 42, 27 * hours),
      call('sql-migration-guard', 15, 63 * days),
      call('git-commit-helper', 7, 2 * days),
      call('release-notes', 0),
    ],
    details: {
      // The row the detail shot inspects: a full frontmatter-plus-body file.
      // The line count is deliberate: `.detailContent` caps at 62vh, so this
      // body ends inside the box instead of looking accidentally cut off.
      'pdf-toolkit': [
        '---',
        'name: pdf-toolkit',
        'description: Read, merge, split, watermark and OCR PDF files, with layout-faithful extraction.',
        'when_to_use: When a PDF must be read, split, stamped or converted.',
        'metadata:',
        '  display_name: PDF Toolkit Pro',
        '  short_description: Read, merge, split, watermark and OCR PDF files.',
        '  brand_color: "#4d6bfe"',
        '---',
        '',
        '# PDF Toolkit',
        '',
        'Work on PDFs with the bundled `pdf` CLI. Prefer extraction over re-rendering:',
        're-rendered pages lose the text layer and break downstream search.',
        '',
        '## Read',
        '',
        '- `pdf text <file> --pages 1-5` prints the text layer, one page per block.',
        '- `pdf info <file>` reports page count and whether the file is scanned.',
        '',
        '## Split and merge',
        '',
        '- `pdf split <file> --every 1 -o parts/` writes one file per page.',
        '- `pdf merge parts/*.pdf -o merged.pdf` keeps the input order.',
        '',
        '## Watermark',
        '',
        '- `pdf stamp <file> --text "DRAFT" --opacity 0.12 --diagonal`.',
        '',
        '## Rules',
        '',
        '1. Never overwrite the input file; report the page count before and after.',
      ].join('\n'),
    },
  }
}

/* ------------------------------------------------------------------- css */

/**
 * Pull every compiled-CSS string literal out of the bundle.
 *
 * The build emits `const css = "…"` (and `const css$1 = "…"` for the second
 * sheet) inside a `//#region \0dsh-css:…` section; the value is a JSON string
 * literal, so `JSON.parse` round-trips the escapes.
 *
 * @param source - the built `lib/client.js` source.
 * @returns the decoded CSS texts, in bundle order.
 */
function extractCss(source) {
  const literal = /const (css[\w$]*) = ("(?:[^"\\]|\\.)*")/g
  const sheets = []
  let match
  while ((match = literal.exec(source)) !== null) {
    try {
      sheets.push({ name: match[1], css: JSON.parse(match[2]) })
    } catch (error) {
      throw new Error(`could not decode the CSS literal ${match[1]}: ${String(error)}`)
    }
  }
  if (sheets.length === 0) throw new Error('the bundle carries no compiled CSS literal — is lib/client.js stale?')
  return sheets
}

/**
 * Every design token the extracted CSS reads, with a value from {@link TOKENS}.
 * @param css - the concatenated extracted CSS.
 * @returns the `:root` declarations to inject.
 */
function tokenBlock(css) {
  const used = new Set()
  const read = /var\((--ds[wh]-[a-z0-9-]+)/g
  let match
  while ((match = read.exec(css)) !== null) used.add(match[1])
  const missing = [...used].filter((name) => TOKENS[name] === undefined).sort()
  if (missing.length > 0) {
    console.warn(
      'preview: the panel CSS reads tokens this harness does not define — using a neutral fallback:\n  ' +
        missing.join('\n  '),
    )
  }
  return [...used].sort().map((name) => `  ${name}: ${TOKENS[name] ?? TOKEN_FALLBACK};`).join('\n')
}

/* ------------------------------------------------------------------ page */

/**
 * The harness page for one state.
 *
 * @param options - the page inputs.
 * @param options.react - the React UMD development source.
 * @param options.reactDom - the ReactDOM UMD development source.
 * @param options.bundleSource - the built `lib/client.js` source.
 * @param options.css - the CSS extracted from the bundle.
 * @param options.tokens - the `:root` token declarations.
 * @param options.mode - `'list'` or `'detail'`; the detail page drives the
 *   Inspect button itself instead of rendering a faked state.
 * @param options.title - the document title (also the shot's caption).
 * @returns the self-contained HTML document.
 */
function page(options) {
  const { react, reactDom, bundleSource, css, tokens, mode, title } = options
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
:root{
  color-scheme:light;
  --dsw-radius-sm:6px;--dsw-radius-md:8px;--dsw-radius-lg:12px;
  --dsw-elevation-prominent:0 10px 30px rgba(16,18,22,.16),0 2px 8px rgba(16,18,22,.08);
  --dsw-focus-ring-color:rgba(77,107,254,.45);
${tokens}
}
html,body{margin:0;height:100%;background:#ffffff;color:#1a1b1e;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,"PingFang SC",sans-serif;
  -webkit-font-smoothing:antialiased;font-size:13px}
/* A plausible app frame: the sidebar the Skills row lives in (under Plugins,
   which is where this panel is registered) beside the light main column. */
.app{display:flex;height:100%;background:#ffffff}
.rail{box-sizing:border-box;flex:none;width:224px;height:100%;padding:52px 12px 0;
  background:#f4f4f6;border-right:1px solid #e6e7ea}
.railTitle{font-size:12px;font-weight:600;letter-spacing:.02em;color:#85888f;padding:0 10px 14px}
.railItem{display:flex;align-items:center;gap:8px;height:32px;padding:0 10px;border-radius:8px;
  font-size:13px;color:#52555c;margin-bottom:2px}
.railItem.active{background:#e7e8ec;color:#1a1b1e;font-weight:500}
.railSep{height:1px;background:#e6e7ea;margin:10px 4px}
.main{flex:1;min-width:0;height:100%;overflow:hidden;background:#ffffff}
#panel{height:100%}
</style>
<style id="harness-plugin-css">${css}</style>
</head>
<body>
<div class="app">
  <aside class="rail">
    <div class="railTitle">DeepSeek Harness</div>
    <div class="railItem">Chat</div>
    <div class="railItem">Plugins</div>
    <div class="railItem active">Skills</div>
    <div class="railSep"></div>
    <div class="railItem">MCP servers</div>
    <div class="railItem">Settings</div>
  </aside>
  <main class="main" data-platform="darwin"><div id="panel"></div></main>
</div>
<script>${react}</script>
<script>${reactDom}</script>
<script>
window.__ModuleLoader__ = { load: (definition) => { window.__definition = definition } }
const jsxRuntime = {
  Fragment: React.Fragment,
  jsx: (type, props) => React.createElement(type, props || {}),
  jsxs: (type, props) => React.createElement(type, props || {}),
}
window.__harnessRequire = (name) => {
  if (name === 'react') return React
  if (name === 'react/jsx-runtime') return jsxRuntime
  if (name === 'react-dom') return ReactDOM
  throw new Error('unexpected require: ' + name)
}
</script>
<script>${bundleSource}</script>
<script>
const SNAPSHOT = ${JSON.stringify(fakeSnapshot())}
const MODE = ${JSON.stringify(mode)}
const INSPECT = ${JSON.stringify(INSPECT_SKILL)}

/* --------------------------------------------------------------- fake api */
/* The same duck-typed surface src/client/api.ts exposes, over the invented
   snapshot above: no Remote, no host, no profile. */
const project = (snapshot) => ({
  ok: true,
  pluginVersion: snapshot.pluginVersion,
  complete: snapshot.complete,
  registryPath: snapshot.registryPath,
  skills: snapshot.skills,
  disabled: snapshot.disabled,
  diagnostics: snapshot.diagnostics,
  ...(snapshot.duplicateNames !== undefined ? { duplicateNames: snapshot.duplicateNames } : {}),
})
const state = { snapshot: SNAPSHOT }
const fallbackBody = (entry) => [
  '---',
  'name: ' + entry.name,
  'description: ' + entry.description,
  '---',
  '',
  '# ' + entry.name,
  '',
  entry.description,
  '',
  '## When to use',
  '',
  entry.whenToUse || 'When the task matches the description above.',
  '',
  '## Steps',
  '',
  '1. Confirm the input the skill needs is present.',
  '2. Run the skill and report what changed.',
  '3. Stop and ask when the request is ambiguous.',
].join('\\n')
const api = {
  catalog: async () => project(state.snapshot),
  trash: async () => state.snapshot.trash,
  stats: async () => ({ ok: true, available: true, stats: state.snapshot.stats }),
  skill: async (name) => {
    const entry = state.snapshot.skills.find((skill) => skill.name === name)
      || state.snapshot.disabled.find((record) => record.name === name)
    if (entry === undefined) throw new Error('skill not found: ' + name)
    return {
      name: entry.name,
      description: entry.description,
      ...(entry.whenToUse !== undefined ? { whenToUse: entry.whenToUse } : {}),
      invocation: entry.invocation || { modelInvocable: true, userInvocable: true },
      provider: entry.provider || 'skill-mgr',
      path: '~/.dsh/skills/' + entry.name + '/SKILL.md',
      addedAt: entry.addedAt,
      updatedAt: entry.updatedAt,
      content: state.snapshot.details[entry.name] || fallbackBody(entry),
      ...(entry.displayName !== undefined ? { displayName: entry.displayName } : {}),
      ...(entry.shortDescription !== undefined ? { shortDescription: entry.shortDescription } : {}),
      ...(entry.brandColor !== undefined ? { brandColor: entry.brandColor } : {}),
      ...(entry.defaultPrompt !== undefined ? { defaultPrompt: entry.defaultPrompt } : {}),
    }
  },
  refresh: async () => state.snapshot,
  toggle: async () => project(state.snapshot),
  create: async (payload) => ({ ok: true, path: 'user-dsh/' + payload.name, root: 'user-dsh' }),
  deleteSkill: async (name) => ({ ok: true, name }),
  fixDiagnostic: async () => undefined,
  restoreTrash: async (name) => ({ ok: true, name, path: '~/.dsh/skills/' + name }),
  clearTrash: async () => ({ ok: true, deleted: [], failed: [] }),
}
window.__api = api

/* ------------------------------------------------------- fake client ctx */
const registered = []
const slots = {
  register: (options, component) => { registered.push({ options, component }); return () => {} },
  inject: (_key, callback) => callback(),
}
const settingsScope = {
  subscribe: () => () => {},
  getSnapshot: () => ({ status: 'ready', writable: true, value: { showUseCount: true, showUseTime: true } }),
  set: async () => true,
  unset: async () => true,
}
const disposers = []
const ctx = {
  logger: { error: (...args) => console.error(...args) },
  effect: (callback) => { disposers.push(callback()) },
  on: () => () => {},
  get: () => undefined,
  locale: { register: () => () => {}, bind: () => (key) => key },
  configForms: { get: () => settingsScope },
  slots,
  remote: { $mount: async () => () => {} },
}

/* ------------------------------------------------------------- mounting */
const wait = (ms) => new Promise((done) => setTimeout(done, ms))

/** Poll a predicate a bounded number of times (virtual time safe). */
async function waitFor(label, predicate, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    const value = predicate()
    if (value !== undefined && value !== null && value !== false) return value
    await wait(16)
  }
  throw new Error('timed out waiting for ' + label)
}

/** Press a button the way a user does, through React's listener. */
function press(element) {
  if (element === null || element === undefined) throw new Error('nothing to press')
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

/** The table row whose name cell starts with the given skill name. */
function rowFor(name) {
  return [...document.querySelectorAll('table tbody tr')].find((row) => {
    const cell = row.querySelector('td')
    return cell !== null && (cell.textContent || '').trim().indexOf(name) === 0
  }) || null
}

/** The button inside a row carrying the given label. */
function buttonIn(row, label) {
  return [...row.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === label) || null
}

/**
 * The panel's author credit ships an e-mail address inside the version chip.
 * The rendered page must not carry an address, so the harness drops e-mail
 * shapes from the text nodes the panel produced (the shot keeps the credit
 * itself).
 */
function redactEmails(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let redacted = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (/[^\\s@]+@[^\\s@]+\\.[^\\s@]+/.test(node.nodeValue || '')) {
      node.nodeValue = (node.nodeValue || '').replace(/\\s*\\[[^\\]]*@[^\\]]*\\]/g, '').replace(/[^\\s@]+@[^\\s@]+\\.[^\\s@]+/g, '')
      redacted += 1
    }
  }
  return redacted
}

;(async () => {
  try {
    await window.__definition.factory(window.__harnessRequire).apply(ctx)
    const seat = registered.find((entry) => entry.options.name === 'main')
    if (seat === undefined) throw new Error("the bundle did not register the 'main' panel seat")
    const container = document.getElementById('panel')
    ReactDOM.createRoot(container).render(React.createElement(seat.component, { api }))
    await waitFor('the Skills page title', () => document.body.textContent.includes('Skills'))
    await waitFor('the inventory table', () => rowFor(INSPECT))

    if (MODE === 'detail') {
      const row = rowFor(INSPECT)
      const inspect = buttonIn(row, 'Inspect')
      if (inspect === null) throw new Error('the row for ' + INSPECT + ' has no Inspect button')
      press(inspect)
      await waitFor('the skill detail header', () => {
        const back = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === 'Back to list')
        return back !== undefined && document.body.textContent.includes('Copy $mention')
      })
    }

    const redacted = redactEmails(container)
    if (typeof document.activeElement !== 'undefined' && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    // The count travels on the DOM (the dump's script text is not readable as
    // a value), so the harness can report how many text nodes it had to clean.
    container.setAttribute('data-harness-redacted', String(redacted))
    window.__ready = { mode: MODE, redactedEmails: redacted }
  } catch (error) {
    // The harness reads the failure out of the dumped DOM, not out of a title.
    window.__ready = { mode: MODE, error: String((error && error.stack) || error) }
    const banner = document.createElement('pre')
    banner.id = 'harness-error'
    banner.textContent = 'HARNESS ERROR: ' + window.__ready.error
    document.getElementById('panel').appendChild(banner)
  }
})()
</script>
</body></html>`
}

/* -------------------------------------------------------------- browser */

/**
 * Run one headless Chrome invocation.
 *
 * The browser gets its own scratch profile under the output directory: it never
 * opens the user's profile, and a read-only or sandboxed home directory cannot
 * stop the render. The browser's own sandbox is off for the same reason — a
 * shell that refuses its crashpad and GPU writes kills the process before it
 * paints — and the only page it ever loads is the file written above.
 *
 * @param chromePath - the browser binary.
 * @param args - the flags after the shared ones.
 * @returns the browser's stdout.
 */
function chrome(chromePath, args) {
  return execFileSync(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-crash-reporter',
      '--hide-scrollbars',
      `--user-data-dir=${scratchProfile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--virtual-time-budget=8000',
      ...args,
    ],
    { stdio: 'pipe', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
}

/**
 * The rendered text of one page, with the harness's own script/style payload
 * stripped: the inlined React and bundle sources carry this machine's build
 * paths, which say nothing about what the panel painted.
 * @param dom - the `--dump-dom` output.
 * @returns the visible text.
 */
function visibleText(dom) {
  return dom
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Assert the painted DOM is the state the shot promises — and carries no data
 * from this machine. Throws (nonzero exit) instead of writing a bad PNG.
 * @param label - the state name, for the message.
 * @param dom - the `--dump-dom` output.
 * @param text - the stripped visible text.
 */
function assertShot(label, dom, text) {
  const fail = (why) => {
    console.error(`preview: ${label}: ${why}`)
    console.error(`preview: ${label}: rendered text was:\n${text.slice(0, 1200)}`)
    process.exit(1)
  }
  if (dom.includes('id="harness-error"')) fail('the page threw while rendering the panel')
  if (!text.includes('Skills')) fail('the page title never painted')
  const wanted = label === 'list'
    ? ['code-review', 'pdf-toolkit', 'a-stock-analysis']
    : ['pdf-toolkit']
  const missing = wanted.filter((name) => !text.includes(name))
  if (missing.length > 0) fail(`the invented skills never painted: ${missing.join(', ')}`)
  if (label === 'list') {
    for (const expected of ['Name', 'Source', 'Description', 'Status', 'Actions', 'Discovery diagnostics', 'enabled', 'disabled']) {
      if (!text.includes(expected)) fail(`the table is missing "${expected}"`)
    }
  } else {
    for (const expected of ['Back to list', 'Copy $mention', 'Provider', 'When to use', 'Work on PDFs']) {
      if (!text.includes(expected)) fail(`the detail view is missing "${expected}"`)
    }
    if (text.includes('Discovery diagnostics')) fail('the detail state still shows the list')
  }
  // The guards below are what keeps a future edit from publishing a screenshot
  // of somebody's machine: host paths, e-mail addresses and the local account
  // name must never reach the image. The account name is read from the
  // environment rather than written here — a literal would put the very string
  // this is looking for into a public repository.
  if (/\/Users\/|\/home\/|\/Applications\//.test(text)) fail('an absolute host path leaked into the image')
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) fail('an e-mail address leaked into the image')
  if (process.env.USER !== undefined && process.env.USER !== '' && text.includes(process.env.USER)) {
    fail('the local user name leaked into the image')
  }
  if (/\b[A-Za-z]:\\Users\\/.test(text)) fail('a Windows host path leaked into the image')
}

/* ------------------------------------------------------------------ main */

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}

// The browser half only exists after a build, and the bundle is gitignored, so
// a fresh checkout has to build it before this harness can render anything.
if (!existsSync(bundle)) {
  console.log('lib/client.js is missing — running `pnpm build` …')
  execFileSync('pnpm', ['build'], { cwd: packageRoot, stdio: 'inherit' })
}
if (!existsSync(bundle)) {
  console.error('lib/client.js is still missing after `pnpm build`.')
  process.exit(1)
}

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
if (chromePath === undefined) {
  console.error('No Chrome-family browser found; looked at:\n  ' + CHROME_CANDIDATES.join('\n  '))
  process.exit(1)
}

const defaultOut = join(tmpdir(), 'dsh-skill-mgr-preview')
const outDir = resolve(flag('--out', defaultOut))
const docsImages = join(packageRoot, 'docs', 'images')
const panelPng = resolve(flag('--png', join(docsImages, 'skills-panel.png')))
const detailPng = resolve(flag('--detail-png', join(dirname(panelPng), 'skill-detail.png')))
// Only the harness's own scratch directory is cleared: `--out` may name a
// directory the caller keeps other files in.
const scratchProfile = join(outDir, 'chrome-profile')
if (outDir === resolve(defaultOut)) rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
mkdirSync(dirname(panelPng), { recursive: true })
mkdirSync(dirname(detailPng), { recursive: true })

const source = readFileSync(bundle, 'utf8')
const sheets = extractCss(source)
const allCss = sheets.map((sheet) => sheet.css).join('\n')
const tokens = tokenBlock(allCss)
console.log(`preview: extracted ${String(sheets.length)} CSS sheet(s) (${sheets.map((sheet) => sheet.name).join(', ')}) and ${String(tokens.split('\n').length)} token(s)`)

const modules = join(packageRoot, 'node_modules')
const reactDir = join(modules, 'react')
const reactDomDir = join(modules, 'react-dom')
const react = readFileSync(join(reactDir, 'umd', 'react.development.js'), 'utf8')
const reactDom = readFileSync(join(reactDomDir, 'umd', 'react-dom.development.js'), 'utf8')

/** Write one harness page and produce its shot, asserting the DOM first. */
function shoot(mode, png, width, height, title) {
  const file = join(outDir, `${mode}.html`)
  writeFileSync(file, page({ react, reactDom, bundleSource: source, css: allCss, tokens, mode, title }))
  const dom = chrome(chromePath, ['--dump-dom', `file://${file}`])
  assertShot(mode, dom, visibleText(dom))
  chrome(chromePath, [`--window-size=${String(width)},${String(height)}`, `--screenshot=${png}`, `file://${file}`])
  const ready = /data-harness-redacted="(\d+)"/.exec(dom)
  console.log(`preview: ${mode}: ok (email redactions: ${ready === null ? '?' : ready[1]})`)
  console.log(`  html:       ${file}`)
  console.log(`  screenshot: ${png}`)
  return png
}

// The list shot is tall enough for the whole page (table + diagnostics +
// trash); the detail shot is sized so `.detailContent`'s 62vh cap sits below
// the end of the invented body.
shoot('list', panelPng, 1440, 1200, 'dsh-skill-mgr — Skills panel preview')
shoot('detail', detailPng, 1440, 1080, 'dsh-skill-mgr — skill detail preview')

for (const png of [panelPng, detailPng]) {
  if (!existsSync(png)) {
    console.error(`preview: the browser wrote no screenshot at ${png}`)
    process.exit(1)
  }
}
if (argv.includes('--open')) execFileSync('open', [panelPng, detailPng])
