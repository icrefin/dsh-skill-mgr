import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, relative, resolve } from 'node:path'
import type { UserConfig } from 'tsdown'

/**
 * The browser-half bundler.
 *
 * Emits `lib/client.js` in the module loader's factory form. The `id` in the
 * banner MUST equal the package name — it is the boot graph row id, and a
 * mismatch makes the module system reject the bundle with "loaded without
 * registering <id>".
 *
 * React is the only external: `react` and `react/jsx-runtime` are platform
 * seeds in the browser module table. Everything else the client imports is
 * bundled in, which is why the client needs no dependencies at install time.
 *
 * CSS modules are compiled here rather than by a framework plugin. Upstream
 * dsh builds them with a private rolldown plugin that emits a
 * `\0dsh-css:<path>.mjs` region; the observable behaviour is what this
 * reproduces — a scoped stylesheet injected once into `document.head` behind a
 * `data-plugin-css` key, plus the original→scoped class-name map as the module
 * default export. Keeping the compiler in-repo means the vendored package
 * builds with only the dependencies it declares.
 */

/** Files this package owns, used to key the injected stylesheets. */
const PACKAGE_NAME = 'dsh-skill-mgr'

/**
 * Rewrite every class selector in one CSS module to a scoped name.
 *
 * Only `.identifier` selectors are touched: a dot followed by a digit (`.4`,
 * `1.5rem`) never matches, and declaration values are left alone. The scope
 * prefix is a short hash of the module's repo-relative path, so two modules
 * cannot collide and a rebuild of unchanged source keeps the same names.
 * @param css - module source.
 * @param id - absolute path of the module.
 * @returns the scoped stylesheet and its class map.
 */
function compileCssModule(css: string, id: string): { css: string; classes: Record<string, string> } {
  const rel = relative(process.cwd(), id).split('\\').join('/')
  const prefix = 'sm' + createHash('sha256').update(rel).digest('hex').slice(0, 6) + '_'
  const classes: Record<string, string> = {}
  const scoped = css.replace(/\.([A-Za-z_][A-Za-z0-9_-]*)/g, (match, name: string) => {
    classes[name] ??= prefix + name
    return '.' + classes[name]
  })
  return { css: scoped, classes }
}

/** Emit the module body the browser bundle consumes. */
function cssModuleCode(css: string, classes: Record<string, string>, id: string): string {
  const rel = relative(process.cwd(), id).split('\\').join('/')
  const tagId = `${PACKAGE_NAME}/${rel.split('/').slice(1).join('/')}`
  const map = Object.keys(classes)
    .sort()
    .map((key) => `${JSON.stringify(key)}: ${JSON.stringify(classes[key])}`)
    .join(',\n\t')
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
    '\tconst tag = document.createElement("style");',
    `\ttag.dataset.plugin = ${JSON.stringify(PACKAGE_NAME)};`,
    '\ttag.dataset.pluginCss = tagId;',
    '\ttag.textContent = css;',
    '\tdocument.head.appendChild(tag);',
    '}',
    `const classes = {\n\t${map}\n};`,
    'export default classes;',
    '',
  ].join('\n')
}

/**
 * Resolved ids are virtual and carry a `.mjs` suffix: tsdown installs a
 * `tsdown:css-guard` transform that throws for any module id ending in `.css`
 * when `@tsdown/css` is absent, and a transform hook cannot be ordered behind
 * another plugin's `load`. The `\0dsh-css:<path>.mjs` form is the same shape
 * the framework's own bundler emits.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'

/** Rolldown plugin compiling `*.module.css` imports. */
const cssModules = {
  name: 'dsh-css-modules',
  resolveId(source: string, importer: string | undefined): string | null {
    if (!source.endsWith('.module.css')) return null
    if (importer === undefined) return null
    return CSS_VIRTUAL_PREFIX + resolve(dirname(importer), source) + '.mjs'
  },
  load(id: string): { code: string; moduleSideEffects: boolean } | null {
    if (!id.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const file = id.slice(CSS_VIRTUAL_PREFIX.length, -'.mjs'.length)
    const { css, classes } = compileCssModule(readFileSync(file, 'utf8'), file)
    return { code: cssModuleCode(css, classes, file), moduleSideEffects: true }
  },
}

export default {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2022',
  tsconfig: 'tsconfig.client.json',
  dts: false,
  sourcemap: true,
  clean: false,
  // react is the browser module table's only seed this bundle needs, so it is
  // the only external. `zod` is a package *dependency* (the host half parses
  // every Remote argument with it) and tsdown externalizes dependencies by
  // default — but the browser half reaches it too: the shared Typert
  // descriptors build their codecs from the same zod schemas, so leaving it
  // external would emit `require("zod")` against a module table that has no
  // zod row. Inline it instead (the dsh-mcp-mgr UI bundle does the same).
  deps: { neverBundle: ['react', 'react/jsx-runtime'], alwaysBundle: ['zod'] },
  // The browser has no `process`: the bundled store (immer, via
  // @deepseek-ai/dsh-client-store) reads `process.env.NODE_ENV` at module
  // top level, which would throw on load. Fold it to a literal, as the
  // framework's own client builds do.
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [cssModules],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-skill-mgr", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
} satisfies UserConfig