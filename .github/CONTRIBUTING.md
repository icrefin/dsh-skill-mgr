# Contributing to icrefin/dsh-skill-mgr

Thanks for taking the time to contribute. This document covers the repository
**dsh-skill-mgr** owned by `icrefin`.

## Ways to contribute

- Report a bug using the *Bug report* issue form.
- Request a feature using the *Feature request* issue form.
- Improve documentation, examples, or translations.
- Send a pull request that fixes or implements something on the issue tracker.

If you plan a large change, open an issue first so we can agree on the design
before you write the implementation.

## Before you start

1. Search existing issues and pull requests to avoid duplicates.
2. Read the [Code of Conduct](CODE_OF_CONDUCT.md).
3. Check the README for supported versions and prerequisites.

## Development setup

This is a TypeScript package built with pnpm. It needs
**Node `^22.19.0 || >=24.0.0`** and **pnpm 11.8.0**, the version pinned in the
manifest through `packageManager` (`corepack enable` picks it up). The
`@deepseek-ai/dsh-*` peer dependencies are published on npm, so a clean checkout
really does install.

```bash
git clone https://github.com/icrefin/dsh-skill-mgr.git
cd dsh-skill-mgr
git switch main

corepack enable
pnpm install
pnpm check          # typecheck → build → vitest → the three verifiers
```

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | `tsc -p tsconfig.json` for the host half, then `tsc -p tsconfig.client.json` for the browser half |
| `pnpm test` | `vitest run` — the four `test/*.spec.ts` files plus the colocated `src/*.test.ts` suites |
| `pnpm check` | `pnpm typecheck && pnpm build && pnpm test && pnpm verify` — run this before opening a pull request |
| `pnpm build` | `tsc -p tsconfig.build.json` then `tsdown` (`lib/types/`, `lib/client.js`) |
| `pnpm verify` | `verify-typert.mjs`, `verify-gateway.mjs` and `verify-client.mjs`, in that order |
| `pnpm pack` | `pnpm build`, then `pnpm pack --pack-destination dist/` |

`lib/`, `dist/` and the packed tarball are build products and are not committed.
`pnpm check` builds before it tests and verifies, which is why the bundle spec and
each verifier has something to load.

### What each suite covers

| File | Covers |
| --- | --- |
| `test/typert.spec.ts` | the declared wire contract: descriptor ids, unique wire names, and every codec against a representative payload |
| `test/registry.spec.ts` | the registry file: its layout, tolerant reads, and the atomic same-directory write that refuses to clobber unparsable JSON |
| `test/trash.spec.ts` | `Delete` into the root's `.trash`, and the restore path including name collisions |
| `test/migrate.spec.ts` | reading the old `dsh-skill-hub` state file and dropping the buckets that no longer exist |
| `src/store.test.ts` | the state store: buckets, persistence, and the scrub of removed buckets |
| `src/skillfs.test.ts` | the filesystem provider: frontmatter parsing and repair, create/disable/enable, trash/restore, the diagnostics scan, and the writable-root rules |
| `src/stats.test.ts` | the invocation statistics scan: counting, the frozen-bucket incremental rescan, the rolling window, and read concurrency |
| `src/provider.test.ts`, `src/reconcile.test.ts`, `src/concurrency.test.ts`, `src/error-text.test.ts` | the provider's catalog, the startup reconciliation between `.disabled` files and registry records, the concurrency helper, and error rendering |

### Preview harness

`tools/preview.mjs` renders the built browser bundle outside the GUI and
screenshots it: it stubs `window.__ModuleLoader__` to capture the definition the
bundle registers, evaluates the factory with React 18's UMD builds inlined into
one self-contained HTML file, and mounts the recorded `main` slot with a fake
`api` over an invented catalog. The detail shot is not faked — it dispatches a
real click on a row's **Inspect** button and waits for the detail header.

```bash
node tools/preview.mjs --out /tmp/sk-preview    # writes the harness HTML + both PNGs
node tools/preview.mjs --png docs/images/skills-panel.png
node tools/preview.mjs --open                   # ...and opens both PNGs
```

It needs Google Chrome (or Chromium/Edge) on the host. It never reads a DSH
profile (`~/.dsh`, `~/.agents`, the desktop profile) and never touches the
network: every skill, root, path and timestamp it shows is invented, and it
refuses to shoot a DOM that still contains a home path, an e-mail or a user name.

### Installing into a profile

`tools/install-into-profile.sh` builds, packs and adds the package to a profile
with `dsh plugin` (the plain pnpm passthrough the Plugins page also uses):

```bash
pnpm pack                                    # dist/dsh-skill-mgr-<version>.tgz
sh tools/install-into-profile.sh desktop     # build, pack and install
```

The desktop profile belongs to the Electron application, so `dsh --profile
desktop` refuses to compose it, while `dsh plugin --profile desktop` works.
Restart the app afterwards; the sidebar entry appears directly under **Plugins**.
A local install pins the tarball's path, so the tarball has to outlive the
install.

## Branch and commit conventions

- Branch from `main`; keep one topic per branch (`fix/...`, `feat/...`, `docs/...`).
- Keep commits small and focused.
- Write imperative, scoped commit messages, e.g. `fix(trash): restore a skill whose name a disabled record already takes`.
- Rebase onto the latest `main` before requesting review; avoid merge commits inside the PR branch.

## Pull requests

Every pull request must:

- Explain **what** changed and **why**.
- Link the issue it closes (`Closes #123`).
- Pass CI.
- Update documentation whenever user-facing text or behavior changes — including
  both the English and the Chinese copy in `src/client/locales.ts`, because the
  panel renders whichever locale the host has active.
- Contain no secrets, tokens, private keys, internal hostnames, or personal data.
- State the license of any newly added dependency and confirm it is compatible with
  this project's `MIT` license.

Use the repository's pull request template. Do not delete checklist items without
explaining why.

## Reporting bugs

A useful bug report contains:

- The version, commit SHA, or release tag of the plugin you tested.
- The DeepSeek Harness build you ran it against, and how the plugin was installed.
- Operating system and runtime version.
- **The skill name and its root** — `~/.dsh/skills` or `~/.agents/skills`. A
  project skill discovered beside a workspace is listed but never managed here, so
  say which kind it is.
- **Its state** — enabled, disabled (`SKILL.md.disabled`), or sitting in the
  root's `.trash`.
- **The discovery-diagnostics entry** if the panel listed one — its own wording,
  and whether the fix action changed anything.
- **Which file is in play** — the discovery file inside the skill's folder, or the
  registry at `<profile>/.dsh/dshsk/skills.json`.
- **The panel's own error text**, copied rather than paraphrased.
- A screenshot of the panel with personal paths redacted.
- Exact reproduction steps, expected result, and actual result.
- Logs with secrets and personal data removed.

Report security vulnerabilities privately — see [SECURITY.md](SECURITY.md). Never open
a public issue for a vulnerability.

## Coding style

- Match the style of the surrounding code; do not reformat unrelated files.
- Add or update tests for behavior changes.
- Keep public APIs documented.
- Prefer clear names over comments that restate the code.
- Do not add a dependency for something the standard library already does.
- Keep the two halves apart: `src/*` runs on the host (the registry, the
  filesystem provider, and the `skillMgr` gateway), `src/client/*` runs in the
  browser, and the browser half talks to the host only through the Remote — never
  by touching the filesystem itself.
- Declare the wire contract in `src/wire.ts` as zod schemas and derive every type
  with `z.infer`, so the host implementation, the descriptors and the browser half
  cannot drift apart.
- A rename, a move into `.trash`, or a frontmatter repair must stay inside the two
  writable roots (`~/.dsh/skills` and `~/.agents/skills`), and a refusal must name
  the source that owns the skill.
- Never overwrite an unparsable registry: report it and leave the file alone.
- Never let a registration throw out of `apply()`: a throw blanks the surface the
  row was mounted into. Degrade instead.
- The tests and the verifiers run against temp directories and doubles, never a
  real profile, real session logs, or a real skill root. Keep it that way.

## Sign-off

Every commit must carry a `Signed-off-by:` line, added by `git commit -s`. It is
your certification of the [Developer Certificate of Origin 1.1](https://developercertificate.org):
that you wrote the contribution or otherwise have the right to submit it under
this repository's license.

## Review process

Maintainers review pull requests as time allows. Expect at least one round of
feedback. Address comments with follow-up commits or a rebase, then re-request review.
A pull request inactive for 60 days without response may be closed.

## License

By contributing, you agree that your contributions are licensed under the `MIT`
license of this repository — inbound contributions are licensed outbound under
the same terms. Do not paste code you cannot license under these terms.

## Questions

Open an issue, or start a discussion in the repository's *Discussions* tab.

---

# 为 icrefin/dsh-skill-mgr 贡献

感谢你抽出时间参与贡献。本文适用于 `icrefin` 名下的仓库 **dsh-skill-mgr**。

## 贡献方式

- 用 *Bug report* 表单报告问题。
- 用 *Feature request* 表单提出需求。
- 改进文档、示例或翻译。
- 提交 pull request，修复或实现 issue 中的事项。

如果改动较大，请先开 issue 讨论设计，以免实现在错误的方向上白费功夫。

## 开始之前

1. 先搜索已有的 issue 和 pull request，避免重复。
2. 阅读[行为准则](CODE_OF_CONDUCT.md)。
3. 查看 README 中说明的支持版本与前置条件。

## 开发环境

本项目是用 pnpm 构建的 TypeScript 包，需要 **Node `^22.19.0 || >=24.0.0`** 与
**pnpm 11.8.0**（manifest 的 `packageManager` 字段已固定该版本，`corepack enable`
会自动采用）。`@deepseek-ai/dsh-*` 这些 peer 依赖已发布到 npm，
因此在干净的检出上可以直接安装。

```bash
git clone https://github.com/icrefin/dsh-skill-mgr.git
cd dsh-skill-mgr
git switch main

corepack enable
pnpm install
pnpm check          # 先 typecheck，再 build，再 vitest，最后三个校验脚本
```

| 命令 | 作用 |
| --- | --- |
| `pnpm typecheck` | 宿主侧 `tsc -p tsconfig.json`，浏览器侧 `tsc -p tsconfig.client.json` |
| `pnpm test` | `vitest run` —— 四个 `test/*.spec.ts` 文件，外加与源码同目录的 `src/*.test.ts` |
| `pnpm check` | `pnpm typecheck && pnpm build && pnpm test && pnpm verify` —— 提 PR 前请跑这个 |
| `pnpm build` | 先 `tsc -p tsconfig.build.json`，再 `tsdown`（产物为 `lib/types/`、`lib/client.js`） |
| `pnpm verify` | 依次跑 `verify-typert.mjs`、`verify-gateway.mjs`、`verify-client.mjs` |
| `pnpm pack` | 先 `pnpm build`，再 `pnpm pack --pack-destination dist/` |

`lib/`、`dist/` 与打出的 tarball 都是构建产物，不纳入版本库。`pnpm check` 会先构建，
再测试与校验，所以 bundle 测试和每个校验脚本才有东西可加载。

### 各测试文件覆盖什么

| 文件 | 覆盖内容 |
| --- | --- |
| `test/typert.spec.ts` | 声明的线上契约：描述符 id、唯一的 wire 名，以及每个 codec 对代表性载荷的解析 |
| `test/registry.spec.ts` | 注册表文件：文件布局、容错读取，以及拒绝覆盖不可解析 JSON 的同目录原子写 |
| `test/trash.spec.ts` | `Delete` 移入根目录下的 `.trash`，以及包含重名冲突在内的恢复路径 |
| `test/migrate.spec.ts` | 读取旧的 `dsh-skill-hub` 状态文件，并丢弃已不存在的分桶 |
| `src/store.test.ts` | 状态存储：分桶、持久化，以及已移除分桶的清理 |
| `src/skillfs.test.ts` | 文件系统 provider：frontmatter 解析与修复、新建/禁用/启用、移入回收站与恢复、诊断扫描，以及可写根目录规则 |
| `src/stats.test.ts` | 调用统计扫描：计数、冻结分桶的增量重扫、滚动窗口，以及读取并发 |
| `src/provider.test.ts`、`src/reconcile.test.ts`、`src/concurrency.test.ts`、`src/error-text.test.ts` | provider 的清单、启动时 `.disabled` 文件与注册表记录之间的对账、并发辅助函数，以及错误文本渲染 |

### 预览工具

`tools/preview.mjs` 在 GUI 之外渲染构建好的浏览器 bundle 并截图：它桩掉
`window.__ModuleLoader__` 以捕获 bundle 注册的定义，把 React 18 的 UMD 构建内联进一个
自包含 HTML 文件里再求值 factory，最后用一份假 `api` 挂载记录到的 `main` slot，
数据来自一份凭空编造的清单。详情页截图不是假的——它会真的对某一行的 **Inspect**
按钮派发一次点击，并等待详情页头出现。

```bash
node tools/preview.mjs --out /tmp/sk-preview    # 写出预览页 HTML 与两张 PNG
node tools/preview.mjs --png docs/images/skills-panel.png
node tools/preview.mjs --open                   # ...并打开两张 PNG
```

它需要宿主机上有 Google Chrome（或 Chromium/Edge）。它不读取任何 DSH profile
（`~/.dsh`、`~/.agents`、桌面 profile），也完全不联网：页面上的每个技能、根目录、路径
与时间戳都是编造的，而且只要 DOM 里还残留 home 路径、邮箱或用户名，它就拒绝截图。

### 安装到 profile

`tools/install-into-profile.sh` 会构建、打包，并用 `dsh plugin`（Plugins 页面同样使用的
pnpm 透传）把包装进 profile：

```bash
pnpm pack                                    # dist/dsh-skill-mgr-<version>.tgz
sh tools/install-into-profile.sh desktop     # 构建、打包、安装
```

桌面 profile 属于 Electron 应用，因此 `dsh --profile desktop` 拒绝组合它，
而 `dsh plugin --profile desktop` 可以正常工作。之后重启应用，侧边栏条目会出现在
**Plugins** 正下方。本地安装会固定 tarball 的路径，所以 tarball 必须一直留在原处。

## 分支与提交规范

- 从 `main` 拉分支，一个分支只做一件事（`fix/...`、`feat/...`、`docs/...`）。
- 提交粒度尽量小。
- 提交信息用祈使句并带范围，例如 `fix(trash): restore a skill whose name a disabled record already takes`。
- 请求评审前先 rebase 到最新的 `main`；PR 分支内避免合并提交。

## Pull request 要求

每个 pull request 必须：

- 说明改了**什么**、**为什么**改。
- 关联对应 issue（`Closes #123`）。
- 通过 CI。
- 当用户可见文案或行为变化时更新文档，包括 `src/client/locales.ts` 里的中英文文案——
  面板渲染的是宿主当前启用的语言。
- 不含任何密钥、令牌、私钥、内网主机名或个人数据。
- 说明新增依赖的许可证，并确认与本项目的 `MIT` 许可证兼容。

请使用仓库的 pull request 模板；不要在没有说明理由的情况下删除检查项。

## 报告 bug

一份有效的 bug 报告应包含：

- 你测试的插件版本号、commit SHA 或发布标签。
- 你运行它所用的 DeepSeek Harness 版本，以及插件的安装方式。
- 操作系统与运行时版本。
- **技能名称与它所在的根目录** —— `~/.dsh/skills` 还是 `~/.agents/skills`。工作区旁边的
  项目技能只会被列出、不归本插件管理，所以请说明是哪一类。
- **它的状态** —— 已启用、已禁用（`SKILL.md.disabled`），还是躺在根目录的 `.trash` 里。
- **发现诊断里的那一条**（如果面板列出来了）—— 面板自己的措辞，以及修复动作有没有改变什么。
- **涉及哪个文件** —— 技能目录里的发现文件，还是 `<profile>/.dsh/dshsk/skills.json` 这个注册表。
- **面板自己给出的错误文本**，请原样复制而不是转述。
- 一张已脱敏的面板截图（请隐去个人路径）。
- 精确的复现步骤、期望结果与实际结果。
- 去除密钥与个人信息后的日志。

安全漏洞请私下报告，见 [SECURITY.md](SECURITY.md)。切勿为漏洞开公开 issue。

## 代码风格

- 与周边代码风格保持一致；不要顺手重排无关文件。
- 行为变更需要新增或更新测试。
- 公开 API 必须有文档。
- 命名要清晰，避免复述代码的注释。
- 标准库已能实现的功能，不要新增依赖。
- 保持两侧分离：`src/*` 跑在宿主侧（注册表、文件系统 provider 与 `skillMgr` 网关），
  `src/client/*` 跑在浏览器侧；浏览器侧只能通过 Remote 与宿主通信，不要自己去碰文件系统。
- 线上契约声明在 `src/wire.ts` 里（zod schema），每个类型都用 `z.infer` 派生，
  这样宿主实现、描述符与浏览器侧不会各自漂移。
- 重命名、移入 `.trash`、以及 frontmatter 修复都必须留在两个可写根目录
  （`~/.dsh/skills` 与 `~/.agents/skills`）之内，并且拒绝时必须指明该技能所属的来源。
- 绝不要覆盖不可解析的注册表：报告它，并把文件原样留下。
- 不要让注册把异常抛出 `apply()`：一次抛出会让该行挂载的界面变成空白。请退化成错误状态。
- 测试与校验脚本跑在临时目录和替身上，绝不接触真实 profile、真实会话日志或真实技能根目录。
  请保持这一点。

## Sign-off

每个提交都必须带 `Signed-off-by:` 行，由 `git commit -s` 添加。它是对
[开发者原创声明 1.1（DCO）](https://developercertificate.org) 的确认：你撰写或拥有该贡献的提交权，
并同意按本仓库的许可证授权。

## 评审流程

维护者会在时间允许时评审 pull request，通常至少有一轮反馈。请通过后续提交响应意见，
或推送 rebase 后重新请求评审。超过 60 天无回应的 pull request 可能被关闭。

## 许可证

参与贡献即表示你同意自己的贡献按本仓库的 `MIT` 许可证授权——进来的贡献以同样的条款出去。
请勿粘贴你无权按此条款授权的代码。

## 疑问

请开 issue，或在仓库的 *Discussions* 标签页发起讨论。
