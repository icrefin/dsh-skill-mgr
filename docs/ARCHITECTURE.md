# dsh-skill-mgr — architecture and engineering record

> The entry point for users is the [README](../README.md). This document is the
> engineering record: the management model, the Remote surface, the panel, and
> every structural difference from `dsh-skill-hub` 0.3.18.
>
> [中文版（精简）](ARCHITECTURE.zh-CN.md) — the Chinese document tells the same
> story in condensed form; this English document is the reference.

A profile-level skill manager for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(dsh) — the skill-shaped mirror of [`dsh-mcp-mgr`](https://github.com/icrefin/dsh-mcp-mgr).

It keeps one **profile-scoped registry** of skills and manages the whole thing
from a **left-sidebar panel**: one flat table of the profile inventory with
per-skill enable/disable, the discovery diagnostics, and a restorable trash.
There is no per-workspace layer — every workspace is offered every skill in the
profile inventory.

It was refactored from `dsh-skill-hub@0.3.18`; [What changed](#what-changed-vs-dsh-skill-hub-0318)
lists every structural difference.

```
dsh-skill-mgr/
├── src/                              host and browser halves (TypeScript)
│   ├── index.ts                      cordis entry: config, provider, announcement, stats
│   ├── gateway.ts                    the `skillMgr` Typert Remote service
│   ├── wire.ts                       every wire payload, as zod schemas
│   ├── typert.descriptors.ts         the one descriptor table both faces share
│   ├── registry.ts                   the profile registry file path + atomic JSON I/O
│   ├── operations/                   plain async operations: catalog, inventory, trash, snapshot
│   └── client/                       the sidebar panel
├── tools/
│   ├── verify-typert.mjs             codec/descriptor gate
│   ├── verify-gateway.mjs            the host service on a real Cordis context
│   ├── verify-client.mjs             the built bundle behind a stub module loader
│   └── install-into-profile.sh       build, pack, install
├── tsdown.config.ts                  the browser bundle (incl. the CSS-modules compiler)
└── cordis.patch.yml                  the Loader row
```

## The management model

The file model mirrors `dsh-mcp-mgr`, which is what makes the two managers feel
like one product:

```
<profile>/.dsh/dshsk/skills.json      the profile's skill management state
```

One registry holds everything the manager persists: the disabled-skill records,
the trash, and the statistics checkpoint.

- **Enabled is the default.** A skill is absent from the registry's `skills` list
  when it is enabled; the list holds the *disabled* ones. Disabling is a
  filesystem fact first — the discovery file is renamed (`SKILL.md` →
  `SKILL.md.disabled`, or `<name>.md` → `<name>.md.disabled`) so the filesystem
  provider simply stops seeing it — and the registry record
  (`{name, description, path, root, disabledAt}`) is what lets the panel list and
  re-enable it.
- **Enable/disable is profile-wide, not per workspace.** Because toggling is the
  rename of one discovery file, the effect is global to the profile: there is no
  way to have a skill on in one workspace and off in another. A reader who needs
  per-workspace on/off cannot have it here — every workspace is offered every
  skill in the profile inventory. The panel's table is the profile inventory, and
  the toggle acts on that inventory rather than on any one workspace.
- **Project skills are discovered, not managed.** The provider lists a
  workspace's own project roots when the caller names a `cwd`, so an agent still
  sees the skills that live beside it, but project skills are never part of the
  profile inventory the panel manages: they cannot be toggled, deleted or
  adopted. Only the user-level roots `~/.dsh/skills` and `~/.agents/skills` are
  writable, and they are the whole inventory the table shows.
- **The registry is reconciled at startup.** A `.disabled` file with no record is
  adopted (an upgraded or hand-edited install), and a record whose file is gone is
  dropped.

Writes go through `atomicWriteJson` — a same-directory temp file with `wx`,
mode `0600`, then `rename`. A read that hits unparsable JSON refuses to overwrite
it and reports the reason.

### What an agent sees

`src/provider.ts` registers a skill provider into the **global layer** of the
official `ctx.skills` registry. The dsh web app deliberately leaves that layer
empty (agent presets own per-scope discovery), so a session-independent
management view needs its own provider.

The provider does **not** filter. It lists the user roots always, and adds a
workspace's project roots when the caller names a `cwd`, so an agent still sees
the skills that live beside it — but there is no visibility resolver and no
per-workspace selection left to apply:

| Situation | What an agent sees |
|---|---|
| `list({cwd})` | every profile skill + that workspace's project skills |
| no `cwd` (a profile-wide question) | every profile skill |

Because preset layers sit nearer than the global layer, a preset's own filesystem
provider still wins every duplicate name; this provider only surfaces skills for
presets that mount no filesystem row at all.

## The Remote surface

The browser half reads and writes through one Typert Remote namespace, `skillMgr`.
The Cordis service key **is** the wire namespace, so the client reads the same
object back as `ctx.get('remote.skillMgr')` — and the client must never *inject*
that namespace, because injecting a service the plugin provides itself deadlocks
the fiber (`src/client/api.ts` reads it through `ctx.get` on purpose).

Two conventions cover the whole surface:

- **`snapshot()` is the one read.** It returns the flat profile inventory, the
  disabled records, the diagnostics and the trash. The panel loads all of its
  slices from that single call, so a mutation followed by a reload can never
  leave two views disagreeing.
- **Every write answers `SkillApplyResult`** (`{ok:true}` / `{ok:false, error}`),
  and the caller refetches. The host's own message reaches the panel as text
  instead of being flattened into a transport failure.

| Area | Methods |
|---|---|
| Core | `snapshot` |
| Profile inventory | `saveGlobalSkill`, `removeGlobalSkill`, `setGlobalSkillEnabled`, `skillDetail`, `fixDiagnostic`, `skillStats` |
| Trash | `restoreTrashedSkill`, `clearTrash` |

9 methods in total. `skillDetail(name)` looks a skill up in the profile
inventory and nowhere else. Their parameter and result types live in
`src/wire.ts` as zod schemas, and each type is `z.infer` of its schema, so the
host implementation, the descriptors and the browser half cannot drift apart.

## The Typert artifacts

`package.json` publishes two artifacts:

| Export | File | Consumer |
|---|---|---|
| `./typert` | `lib/types/typert.host.js` | `dsh-typert-loader` imports it for the Loader row, validates it, and hands it to `ctx.typert.register` |
| `./remote` | `lib/types/typert.remote-client.js` | the browser half mounts it with `ctx.remote.$mount(TYPERT_REMOTE)` |

Both are built from **one descriptor table** (`src/typert.descriptors.ts`) rather
than from a pipeline-generated host/client pair. The runtime contract is
identical and the failure modes are the ones the runtime enforces:

- every parameter and result carries a `mode: 'strict'` codec with a `typeSymbol`
  and a `create()` factory — `dsh-typert-loader` rejects anything else, and the
  client API gateway refuses to mount a descriptor whose *inputs* are not strict;
- invocation ids are `<package>#<namespace>/<method>`, wire names are unique per
  method, and every parameter is `source: 'json'`;
- a codec that predates a field would silently strip it at the host boundary, so
  the descriptor table is the only place a wire shape is declared.

The host face also declares an empty `model` (`services`/`events`/`objects`):
this package contributes Remote methods, not a Cordis catalog.

`tools/verify-typert.mjs` is the gate. It replicates everything
`dsh-typert-registry` and `dsh-typert-loader` assert, then round-trips a
representative argument list through every parameter codec (including a
deliberately wrong-typed value it must reject), asserts both faces describe the
same method set, and checks the browser bundle was rebuilt after the last
descriptor change.

## The panel

The panel is registered into two slots, both keyed by the same id (`skillMgr`):

| Slot | Registration | Effect |
|---|---|---|
| `sidebar.panellist` | `id: 'skillMgr'`, `order: 1` | the icon row under **Plugins** (`order: 0`) |
| `main` | `key: 'skillMgr'` | the page the row opens in the centre column |

Selecting the row goes through `ctx.layout.selectPanel('skillMgr')`, a lookup in
the live `main` registry, so the two registrations must share the id and a missing
`main` entry throws instead of switching panels. Nothing registers into
`settings.section` any more — the plugin's settings *card* lives in the Plugins
manager, which is a different surface.

The page takes the geometry the built-in Plugins page uses: full height, its own
scroll container, a centred 960px column, a `20px`/`500` title (the size every
built-in page and both sibling panels use — a heavier header reads as a
different level of the hierarchy), and a header that clears the macOS window
chrome through `--dsh-frame-top-clearance`. The detail (inspect) view
renders into the same page container and shares that header offset, so opening a
skill does not move its header up against the app's top boundary; the two headers
share one CSS rule rather than each carrying the value.

### One view, no tabs

The page renders one view: the flat profile inventory — a table over every
profile skill (enabled and disabled alike), an **Add skill** dialog, the
discovery diagnostics, and the restorable trash.

| View | Content |
|---|---|
| **Skills** | one flat table of the profile inventory, an **Add skill** dialog, the discovery diagnostics, and the restorable trash |

There is no tab strip and no `SegmentedTabs`: the plugin no longer depends on
`@deepseek-ai/dsh-client-ui-primitives` at all, so the page is a single
unsegmented view rather than one panel of a set.

The Skills table is `table-layout: fixed` with columns
**Name / Source / Description / Status / Actions**:

| Column | Content |
|---|---|
| Name | the skill name, its distinct display name, the invocation dot, a duplicate badge, and the use-count / last-used chips when the config enables them |
| Source | a compact badge for `skill.source` (`user-dsh`, `user-agents`, a third-party value) |
| Description | `shortDescription ?? description`, ellipsised with the full text in `title` |
| Status | `enabled` / `disabled` |
| Actions | **Inspect** (opens the body), **Enable**/**Disable**, **Delete**; a read-only row shows a muted label instead |

Disabled rows stay in the table, dimmed (`tr[data-enabled=false] td { opacity: .6 }`),
rather than moving to a separate list. Search, sort and a flat source filter sit
above the table; there are no group headers anywhere.

The page is component state and the view survives a reload: a mutation re-reads
the snapshot without remounting the page, so the scroll position holds. The panel
reloads on mount, after every write, on the refresh button, and on a **60-second**
background interval — the Remote client caches one snapshot per render pass, so
the slices share a single round trip.

## What changed vs `dsh-skill-hub` 0.3.18

### Identity

| | `dsh-skill-hub` 0.3.18 | here |
|---|---|---|
| package | `dsh-skill-hub` | `dsh-skill-mgr` |
| Loader row | `{id: skill-hub}` | `{id: skill-mgr}` |
| locale namespace | `dsh-skill-hub` | `dsh-skill-mgr` |
| registry file | `~/.dsh/dsh-skill-hub.json` | `<profile>/.dsh/dshsk/skills.json` |
| state schema | v4, one sidecar | v5, one profile registry |

An upgraded install migrates itself: the store adopts
`~/.dsh/dsh-skill-hub.json` (or this package's earlier `~/.dsh/dsh-skill-mgr.json`)
on the first load that finds no registry, promotes it to the new path, and leaves
the old file untouched. The migrator still *reads* every bucket the older shapes
carried — v4's `disabled`, v2's bare market-source slugs, v1's `origins` map, and
the `sources`/`marketSources`/`marketStats`/`tags`/`collectionOrder`/
`sourceGroupOrder` keys this plugin used to write — and ignores the ones the
manager no longer has. Disabled skills, the trash and the statistics checkpoint
come across.

### Transport

The `/api/skill-hub/*` HTTP family (36 routes, with its own loopback/method/body
fences) is gone. What it carried now crosses a Typert Remote, which is also what
removed the need for the loopback fence, the 64 KB body cap and the 404
catch-all. The route handlers became plain operations under `src/operations/`,
taking `(deps, ...inputs)` and returning wire payloads; the refusal vocabulary
became thrown `StoreError`s (`validation` / `not-found` / `conflict`), which the
gateway folds into `SkillApplyResult`.

### Surface

`settings.section` (Settings → Skills) and the DOM patch that swapped the Settings
nav icon are gone, replaced by the `sidebar.panellist` + `main` pair described
above. `src/client/settings-nav-icon.ts` was deleted with them.

### Removed outright

Everything that made the panel a browser rather than a manager:

| Removed | Why |
|---|---|
| the **market** (built-in curated catalog, custom repo sources, stars/downloads stats, check-all / update-all) | the manager defines skills, it does not shop for them |
| **upstream source tracking** (repo/commit snapshots, manifest diffs, per-source update checks and syncs) | it existed to serve the market |
| **GitHub repo scan / import** (tree discovery, branch picking, background import jobs, progress polling, cancel) | skills are added by scaffolding one, or by dropping a folder into a writable root |
| **origin collections** and the **root grouping** (`user-dsh` vs `user-agents` group headers, collection drag-order, `sourceGroupOrder`, `collectionOrder`) | the inventory is flat; a skill is a skill |
| **custom groups / scenes** (tags, group switches, the cross-group conflict dialog, `trash.origin`/`tagIds`) | the same |
| the `githubToken` and `showGroupSummary` config fields | no GitHub market calls are left to authenticate, and there are no group headers to summarise |
| `src/repo/` (the whole GitHub client, tree discovery, installer) | nothing calls it |

The panel is correspondingly smaller: `MarketView`, `MarketSourceRow`,
`RepoScanCard`, `CollectionCard`, `SourceStatusBadge`, `GroupSummary`,
`DisabledRow`, `SkillRow`, `SourcesView`, the market/source/repo hooks and the
market/source locale files are all gone.

The **per-workspace layer** is gone in the same spirit, and this is the one
difference from `dsh-skill-hub` that is not about the market: the Workspaces tab,
its view and flow hooks, its locale dictionary, the per-workspace selection file
(`<workspace>/.dsh/dshsk/skills.json` with its `use` list) and the methods that
wrote it (`setWorkspaceSelection`, `importLocalSkill`, `setStrictMode`,
`setActiveWorkspace`) have all been removed. `dsh-skill-hub` let a workspace pick
a subset of the profile inventory; this plugin offers every workspace every skill
in the profile inventory, so enable/disable is a profile-wide fact. The wire type
`SkillWorkspace` and the `usedBy`/`workspace`/`workspaceTitle` fields of
`CatalogSkill` went with it, as did the "Used by" table column.

### Kept

The skill subsystem itself is unchanged: discovery through `ctx.skills`, the
frontmatter parser and its auto-repair, the diagnostics scan, the writable-root
rules, the new-skill wizard, the trash/restore flow, and the invocation
statistics reader.

### The theme fix

Upstream's action controls were painted with `--hub-accent`, which resolves to
`--dsw-alias-state-business-primary` — a *state* colour the platform reserves for
focus rings, never a button fill — and every status tint used light-tuned literal
hex. That was previously fixed by a script that edited the **built**
`lib/client.js` in place, so any `pnpm install` reverted it silently.

The fix is now in the source CSS (`src/client/panel/panel.module.css`,
`src/client/settings-card.module.css`): filled primary controls use the button
tokens (`--dsw-alias-button-primary-fill` / `-hover` +
`--dsw-alias-label-primary-foreground`), toggles use
`--dsw-alias-brand-primary`, and every literal status tint became a same-alpha
`color-mix()` over the matching `--dsw-alias-state-*` token, so the light theme
looks unchanged while dark mode stops using light-tuned colour. The custom nav
artwork is gone with the Settings entry; the sidebar row draws the platform's own
skill outline glyph.

## Configuration

The Loader entry's config is the settings card. The host reads the same values
through their volatile refs.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | contribute the skill provider and the announcement; the management panel keeps working either way, because it is the surface that turns the plugin back on |
| `announceToAgent` | `true` | register the system-prompt section that tells an agent this manager exists |
| `showUseCount` | `true` | per-skill invocation-count chip |
| `showUseTime` | `true` | per-skill last-used relative time |
| `dotModelColor` | unset | `#rrggbb` for the "model-invocable" dot, in the table and the chat `/` menu |
| `dotUserColor` | unset | `#rrggbb` for the "user-invocable only" dot |
| `statsWindowDays` | `14` | rolling window for the counts; `0` = all history |
| `statsScanMinutes` | `5` | background session-log scan interval, in minutes |

## Build, verify, install

```sh
pnpm install
pnpm check        # typecheck both halves → build → vitest → the verifiers
pnpm pack         # dist/dsh-skill-mgr-<version>.tgz
sh tools/install-into-profile.sh desktop
```

`pnpm check` runs, in order:

| Step | What it proves |
|---|---|
| `tsc -p tsconfig.json` | the host half typechecks (including every test) |
| `tsc -p tsconfig.client.json` | the browser half typechecks against the real slot and Remote typings |
| `tsc -p tsconfig.build.json` | the host half emits to `lib/types/` |
| `tsdown` | the browser bundle builds, with the in-repo CSS-modules compiler |
| `vitest run` | the test suite |
| `tools/verify-typert.mjs` | the codec/descriptor contract described above |
| `tools/verify-gateway.mjs` | the compiled host service constructs on a real Cordis `Context` and publishes all 9 methods under the namespace `skillMgr` |
| `tools/verify-client.mjs` | the built bundle loads behind a stub module loader and registers `sidebar.panellist` `skillMgr` + `main` `skillMgr` + the config card, and *nothing* into Settings |

The last three are the ones that catch what a typecheck cannot: a decorator that
standard-mode lowering dropped, a service key that no longer matches the wire
namespace, a row id that no longer matches the package name (the loader rejects
the bundle), a registration that throws inside `apply` (which would blank the
GUI), and a `sidebar.panellist` id that does not match the `main` key it opens
(the layout throws instead of switching).

### The build itself

Upstream shipped no build configuration — the published tarball carries `src/`
but not the `tsconfig`/`tsdown` files that produced `lib/`. Both had to be
restored:

- `tsconfig.build.json` emits plain ESM per module into `lib/types/`
  (`main` is `lib/types/index.js`), which is the `dsh-mcp-mgr` layout rather than
  a bundled host entry.
- `tsdown.config.ts` builds the browser half in the module loader's factory form,
  with the banner `id` equal to the package name. Its externals are exactly the
  React seeds — `react` and `react/jsx-runtime` — which the shell's module table
  resolves; `tools/verify-client.mjs` asserts that set, so a stray runtime import
  fails the build check rather than the browser. The platform UI primitives are
  no longer external because they are no longer used at all.
- CSS modules are compiled by a small rolldown plugin inside `tsdown.config.ts`.
  It resolves each `*.module.css` import to a **virtual id** carrying a `.mjs`
  suffix: tsdown installs a `tsdown:css-guard` transform that throws for any
  module id still ending in `.css` when `@tsdown/css` is absent, and a transform
  hook cannot be ordered behind another plugin's `load`. The emitted body injects
  the scoped stylesheet once, keyed by `data-plugin-css`, and exports the
  original→scoped class map.

## Caveats

- **The desktop profile is owned by the Electron application.** `dsh --profile
  desktop` refuses to compose or dump it; `dsh plugin --profile desktop …` is a
  plain pnpm passthrough into the profile directory and does work, which is also
  what the Plugins page uses. Install with that, then **restart** — a bundle added
  to a running profile is not in the module resolution the host computed at boot.
- **A local install pins the tarball's path.** Delete
  `dist/dsh-skill-mgr-<version>.tgz` and the next install fails with `ENOENT`.
- **Built output only in the tarball.** `lib/` is gitignored in this repository;
  it is produced by `pnpm build`, and `pnpm pack` runs the build first.
- **There is no update check.** This fork is heavily refactored from
  `dsh-skill-hub`, so tracking the upstream project's releases would be
  misleading and there is no release channel of this package to poll. The panel
  shows the installed version and the author credit beside its title (both read
  from the package manifest by `src/version.ts`, and `STYLES.md` fixes the
  wording) and nothing else. The settings card shows the bare version.
- **Writable roots are user-level only.** Toggling, deleting and adopting reach
  `~/.dsh/skills` and `~/.agents/skills`; project, bundled and runtime skills are
  read-only, and a refusal names the source that owns the skill.
- **Deletion is recoverable but has no automatic expiry.** `Delete` moves the
  skill into the root's `.trash` directory and the panel lists it under the table
  with a Restore action; clearing the trash is permanent.
- Upstream is MIT; its `LICENSE` is carried along.

## Licences

MIT. Derived from [`dsh-skill-hub`](https://github.com/cheshireez/dsh-skill-hub)
0.3.18 (MIT).