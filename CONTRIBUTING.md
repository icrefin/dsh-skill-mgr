# Contributing

Thanks for considering a contribution to **dsh-skill-mgr**. This project is a
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugin with two halves:

- the **host half** (`src/index.ts`) runs in the dsh process and speaks only official dsh SDKs, and
- the **browser half** (`src/client/`) renders inside the web GUI through official slots.

Please keep both halves on official APIs — no dsh source patches.

## Layout

```
src/index.ts              cordis plugin entry (config schema, skill provider, announcement, stats)
src/gateway.ts            the `skillMgr` Typert Remote service (one @Remote per method)
src/wire.ts               every wire payload as a zod schema (types are z.infer of these)
src/typert.descriptors.ts the single descriptor table both published faces are built from
src/typert.host.ts        `exports["./typert"]`  — what dsh-typert-loader registers
src/typert.remote-client.ts `exports["./remote"]` — what the browser mounts
src/registry.ts           the profile registry file path + atomic JSON reads/writes
src/deps.ts               the shared dependency view every operation is written against
src/store.ts              store barrel (store/paths.ts, migrate.ts, store.ts, types.ts, errors.ts)
src/operations/           plain async operations: catalog, inventory, trash, snapshot
src/skillfs.ts            writable-root file ops + barrel (skillfs/paths.ts, frontmatter.ts, scan.ts)
src/stats.ts              session-log statistics reader + barrel (stats/persistence.ts, stats/scan.ts)
src/provider.ts           the manager's own ctx.skills provider (global layer)
src/concurrency.ts        bounded-concurrency map
src/error-text.ts         unknown → one-line error text
src/client/index.tsx      browser-half entry (sidebar.panellist + main + config card + slash dots)
src/client/api.ts         mounts the Remote and is the panel's only data access path
src/client/panel/         page shell, views, dialogs, hooks/ (one hook per domain + aggregator)
src/client/locales/       dictionaries by view (common/skills/trash/detail/settings)
tools/                    build/verify/install helpers (see the README)
```

## Development setup

```sh
pnpm install
pnpm typecheck   # both tsconfig projects
pnpm test        # vitest
pnpm build       # tsc → lib/types/*, tsdown → lib/client.js
pnpm check       # typecheck → build → test → both verifiers
```

## Before opening a pull request

1. **Typecheck** — `pnpm typecheck` must pass for both halves.
2. **Tests** — `pnpm test` must pass; add or adjust tests for any behaviour change. Suites sit next
   to the code they cover (`src/*.test.ts`) plus the contract suites under `test/`
   (`typert.spec.ts`, `registry.spec.ts`, `migrate.spec.ts`). The browser half has no
   component-test harness (vitest runs in the node environment); keep browser changes mechanical and
   let `tools/verify-client.mjs` plus a live-GUI check cover them.
3. **Verify** — `pnpm verify` must pass. `tools/verify-typert.mjs` and `tools/verify-gateway.mjs`
   will fail if a Remote method's descriptor, its codecs and the live `@Remote` markers disagree,
   and `test/typert.spec.ts` will fail if you add a method without adding it to the expected list —
   that is deliberate.
4. **Keep the diff focused** — one logical change per PR, with a clear title and description.
5. **Documentation** — update `README.md` **and** `README.zh.md` (both ship with the package and are
   kept in sync) when behaviour or the API surface changes.

## Code style

- TypeScript, strict mode. ESM (`"type": "module"`).
- **One descriptor table.** A wire shape is declared once, in `src/wire.ts`, and the descriptors are
  built from it — never hand-written twice.
- **A write answers `SkillApplyResult`** (`{ok:true}` / `{ok:false, error}`) and the caller
  refetches `snapshot()`. A read answers its own payload and may throw.
- Comments explain *why* (routing decisions, dsh host behaviours, hazards) more than *what*.
- The browser half uses CSS Modules compiled by `tsdown.config.ts`; keep the existing class-name
  scheme, and style with `--dsw-alias-*` tokens — a literal colour breaks dark mode.
- **The inventory is flat.** One table, no grouping by root or by origin, no
  per-workspace layer, and no market/source-tracking features: the plugin is
  deliberately the skill-shaped mirror of `dsh-mcp-mgr`. Enable/disable is
  profile-wide, so do not reintroduce a per-workspace selection file.
- Route every user-visible string through the locale dictionary; `en` must have a key for every `zh`
  key (the type makes a missing one a compile error).

## Testing the plugin in a live dsh web GUI

```sh
pnpm build
sh tools/install-into-profile.sh desktop
# restart DeepSeek Harness, then verify both surfaces:
#   left sidebar → 技能            — the management panel (one flat inventory view)
#   left sidebar → 插件 → dsh-skill-mgr — the plugin's configuration card
```

A bundle added to a running profile is not in the module resolution the host computed at boot, so a
restart is required; the client half then loads with the page.

## Issues

- **Bugs**: include the dsh version, Node version, the plugin version, and the exact steps.
- **Feature requests**: describe the workflow you are trying to accomplish; a short motivation helps
  scope the change.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).