# dsh-skill-mgr —— 架构与工程记录

[English（完整版，以此为准）](ARCHITECTURE.md) ｜ 用户请从 [README](../README.zh-CN.md) 读起

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的 profile 级技能管理器 —— 相当于 [`dsh-mcp-mgr`](https://github.com/icrefin/dsh-mcp-mgr) 的技能版。

它维护一份**按 profile 划分的注册表**，并通过**左侧边栏面板**管理这一切：一张 profile 清单的扁平表格（带单技能启用/禁用）、发现诊断，以及一个可恢复的回收站。这里没有按工作区的分层 —— 每个工作区都会被提供 profile 清单中的每一个技能。

它由 `dsh-skill-hub@0.3.18` 重构而来；[与 dsh-skill-hub 0.3.18 相比的变化](#与-dsh-skill-hub-0318-相比的变化)列出了每一处结构性差异。

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

## 管理模型

文件模型与 `dsh-mcp-mgr` 一致，这正是两个管理器用起来像同一个产品的原因：

```
<profile>/.dsh/dshsk/skills.json      the profile's skill management state
```

这一份注册表保存管理器持久化的全部内容：已禁用技能记录、回收站，以及统计检查点。

- **默认即启用。** 技能启用时不出现在注册表的 `skills` 列表中；该列表保存的是*已禁用*的技能。禁用首先是文件系统层面的事实 —— 发现文件被重命名（`SKILL.md` → `SKILL.md.disabled`，或 `<name>.md` → `<name>.md.disabled`），让文件系统 provider 直接看不到它 —— 而注册表记录（`{name, description, path, root, disabledAt}`）则让面板能够列出并重新启用它。
- **启用/禁用是按 profile 全局生效的，而不是按工作区的。** 因为开关操作就是重命名一个发现文件，其效果对整个 profile 都是全局的：无法做到某个技能在一个工作区开启、在另一个工作区关闭。需要按工作区开关的读者在这里是得不到的 —— 每个工作区都会被提供 profile 清单中的每一个技能。面板的表格就是 profile 清单，开关作用于该清单，而不是作用于某个工作区。
- **项目技能只被发现，不被管理。** 当调用方指定 `cwd` 时，provider 会列出该工作区自己的项目根目录，因此 agent 仍然能看到就在它旁边的技能；但项目技能从来不属于面板所管理的 profile 清单：它们无法被开关、删除或收编。只有用户级根目录 `~/.dsh/skills` 与 `~/.agents/skills` 是可写的，它们也正是表格展示的完整清单。
- **注册表在启动时对账。** 没有记录的 `.disabled` 文件会被收编（升级过或手工编辑过的安装），而文件已消失的记录会被丢弃。

写入一律经过 `atomicWriteJson` —— 在同目录下用 `wx` 创建临时文件，权限 `0600`，然后 `rename`。读取时若遇到无法解析的 JSON，则拒绝覆盖它并报告原因。

### agent 会看到什么

`src/provider.ts` 把一个技能 provider 注册进官方 `ctx.skills` 注册表的**全局层**。dsh Web 应用刻意让该层保持为空（各作用域的发现由 agent preset 负责），因此一个与会话无关的管理视图需要自己的 provider。

该 provider **不做过滤**。它总是列出用户级根目录，并在调用方指定 `cwd` 时追加该工作区的项目根目录，因此 agent 仍然能看到就在它旁边的技能 —— 但已经不存在可见性解析器，也没有任何按工作区的选择需要应用：

| 情形 | agent 看到的内容 |
|---|---|
| `list({cwd})` | 所有 profile 技能 + 该工作区的项目技能 |
| 无 `cwd`（profile 范围的问题） | 所有 profile 技能 |

由于 preset 层比全局层更近，preset 自己的文件系统 provider 仍然会在每个重名上胜出；本 provider 只为完全没有挂载文件系统行的 preset 提供技能。

## Remote 接口

浏览器半边通过唯一的 Typert Remote 命名空间 `skillMgr` 进行读写。Cordis 服务键**就是**该 wire 命名空间，因此客户端用 `ctx.get('remote.skillMgr')` 读回同一个对象 —— 客户端绝不能*注入*这个命名空间，因为注入插件自身提供的服务会让 fiber 死锁（`src/client/api.ts` 是故意用 `ctx.get` 读取它的）。

两条约定覆盖整个接口：

- **`snapshot()` 是唯一的读操作。** 它返回扁平的 profile 清单、已禁用记录、诊断和回收站。面板的所有切片都来自这一次调用，因此"一次变更 + 一次重新加载"绝不会让两个视图互相矛盾。
- **每个写操作都返回 `SkillApplyResult`**（`{ok:true}` / `{ok:false, error}`），由调用方重新拉取。宿主的原始消息会以文本形式到达面板，而不会被扁平化成传输失败。

| 区域 | 方法 |
|---|---|
| 核心 | `snapshot` |
| Profile 清单 | `saveGlobalSkill`、`removeGlobalSkill`、`setGlobalSkillEnabled`、`skillDetail`、`fixDiagnostic`、`skillStats` |
| 回收站 | `restoreTrashedSkill`、`clearTrash` |

共 9 个方法。`skillDetail(name)` 只在 profile 清单中查找技能，别无其他。它们的参数与结果类型以 zod schema 的形式放在 `src/wire.ts` 中，每个类型都是其 schema 的 `z.infer`，因此宿主实现、descriptor 和浏览器半边不会彼此漂移。

## Typert 产物

`package.json` 发布两个产物：

| 导出 | 文件 | 使用者 |
|---|---|---|
| `./typert` | `lib/types/typert.host.js` | `dsh-typert-loader` 为 Loader 行导入它、校验它，并交给 `ctx.typert.register` |
| `./remote` | `lib/types/typert.remote-client.js` | 浏览器半边用 `ctx.remote.$mount(TYPERT_REMOTE)` 挂载它 |

两者都由**同一张 descriptor 表**（`src/typert.descriptors.ts`）构建，而不是由流水线生成的 host/client 对构建。运行时契约完全相同，失败模式也正是运行时强制的那几种：

- 每个参数与结果都带一个 `mode: 'strict'` 的 codec，包含 `typeSymbol` 和 `create()` 工厂 —— `dsh-typert-loader` 拒绝其他任何形式，客户端 API 网关也拒绝挂载*输入*不是严格模式的 descriptor；
- 调用 id 为 `<package>#<namespace>/<method>`，wire 名称按方法唯一，每个参数都是 `source: 'json'`；
- 早于某个字段的 codec 会在宿主边界悄悄把它剥掉，因此 descriptor 表是声明 wire 形状的唯一位置。

宿主面还声明了一个空的 `model`（`services`/`events`/`objects`）：本包贡献的是 Remote 方法，而不是 Cordis 目录。

`tools/verify-typert.mjs` 就是这道关卡。它复现 `dsh-typert-registry` 与 `dsh-typert-loader` 断言的全部内容，然后把一份有代表性的参数列表在所有参数 codec 上往返一遍（包括一个它必须拒绝的、故意类型错误的值），断言两个面描述的方法集合一致，并检查浏览器 bundle 在最后一次 descriptor 变更之后已重新构建。

## 面板

面板注册进两个槽位，两者使用同一个 id（`skillMgr`）：

| 槽位 | 注册 | 效果 |
|---|---|---|
| `sidebar.panellist` | `id: 'skillMgr'`、`order: 1` | **插件**（`order: 0`）下方的图标行 |
| `main` | `key: 'skillMgr'` | 该图标行在中间栏打开的页面 |

选中该行会走 `ctx.layout.selectPanel('skillMgr')`，即在实际的 `main` 注册表中查找，因此这两处注册必须共用同一个 id，缺少 `main` 条目会抛错而不是切换面板。现在已经没有任何东西注册进 `settings.section` —— 插件的设置*卡片*位于插件管理器，那是另一个界面。

该页面采用内置插件页的几何布局：占满高度、自带滚动容器、居中 960px 栏宽、`20px`/`500` 的标题（内置页面与两个同类面板都用这个字号——更重的标题会读成另一个层级），并通过 `--dsh-frame-top-clearance` 让页头避开 macOS 窗口边框。详情（inspect）视图渲染进同一个页面容器并共用该页头偏移，因此打开技能时它的页头不会顶到应用顶部边界；两个页头共用同一条 CSS 规则，而不是各自携带该数值。

### 单一视图，没有标签页

页面只渲染一个视图：扁平的 profile 清单 —— 一张覆盖每个 profile 技能（启用与禁用一并）的表格、一个**新增技能**对话框、发现诊断，以及可恢复的回收站。

| 视图 | 内容 |
|---|---|
| **技能** | 一张 profile 清单的扁平表格、一个**新增技能**对话框、发现诊断，以及可恢复的回收站 |

这里没有标签栏，也没有 `SegmentedTabs`：插件已经完全不再依赖 `@deepseek-ai/dsh-client-ui-primitives`，因此页面是一个单一的整体视图，而不是某组面板中的一个。

技能表格为 `table-layout: fixed`，列为**名称 / 来源 / 描述 / 状态 / 操作**：

| 列 | 内容 |
|---|---|
| 名称 | 技能名、它独有的显示名、调用圆点、重复徽标，以及配置启用时的使用次数 / 最近使用标签 |
| 来源 | `skill.source` 的紧凑徽标（`user-dsh`、`user-agents`、第三方值） |
| 描述 | `shortDescription ?? description`，截断省略，完整文本放在 `title` 中 |
| 状态 | `enabled` / `disabled` |
| 操作 | **查看**（打开正文）、**启用**/**禁用**、**删除**；只读行则显示一个弱化的标签 |

已禁用的行仍留在表格中并被调暗显示（`tr[data-enabled=false] td { opacity: .6 }`），而不是移到单独的列表里。搜索、排序和一个扁平来源筛选器位于表格上方；任何地方都没有分组表头。

页面是组件状态，且该视图能在重新加载后存活：一次变更会重新读取 snapshot 而不重新挂载页面，因此滚动位置保持不变。面板在挂载时、每次写入之后、点击刷新按钮时，以及 **60 秒**的后台定时器上重新加载 —— Remote 客户端每轮渲染只缓存一份 snapshot，因此各切片共用一次往返。

## 与 `dsh-skill-hub` 0.3.18 相比的变化

### 身份

| | `dsh-skill-hub` 0.3.18 | 本包 |
|---|---|---|
| 包 | `dsh-skill-hub` | `dsh-skill-mgr` |
| Loader 行 | `{id: skill-hub}` | `{id: skill-mgr}` |
| locale 命名空间 | `dsh-skill-hub` | `dsh-skill-mgr` |
| 注册表文件 | `~/.dsh/dsh-skill-hub.json` | `<profile>/.dsh/dshsk/skills.json` |
| 状态 schema | v4，单个 sidecar | v5，单个 profile 注册表 |

升级后的安装会自我迁移：当某次加载发现没有注册表时，存储会收编 `~/.dsh/dsh-skill-hub.json`（或本包更早的 `~/.dsh/dsh-skill-mgr.json`），把它提升到新路径，并保持旧文件不动。迁移器仍然会*读取*旧形态携带的每一个桶 —— v4 的 `disabled`、v2 的裸市场源 slug、v1 的 `origins` 映射，以及本插件过去写入的 `sources`/`marketSources`/`marketStats`/`tags`/`collectionOrder`/`sourceGroupOrder` 键 —— 并忽略管理器已不再拥有的那些。已禁用的技能、回收站和统计检查点都会被带过来。

### 传输

`/api/skill-hub/*` 这组 HTTP 接口（36 条路由，自带 loopback/方法/请求体围栏）已经消失。它承载的东西现在走 Typert Remote，这也正是 loopback 围栏、64 KB 请求体上限和 404 兜底不再需要的原因。路由处理器变成了 `src/operations/` 下的普通 operation，接收 `(deps, ...inputs)` 并返回 wire 载荷；拒绝语义变成了抛出的 `StoreError`（`validation` / `not-found` / `conflict`），由网关归并进 `SkillApplyResult`。

### 界面

`settings.section`（设置 → 技能）和那个替换设置导航图标的 DOM 补丁都已消失，取而代之的是上文描述的 `sidebar.panellist` + `main` 组合。`src/client/settings-nav-icon.ts` 也随之删除。

### 已彻底移除

一切让面板变成"浏览器"而不是"管理器"的东西：

| 已移除 | 原因 |
|---|---|
| **市场**（内置精选目录、自定义仓库源、star/下载统计、全部检查 / 全部更新） | 管理器负责定义技能，而不是去选购技能 |
| **上游源跟踪**（repo/commit 快照、manifest diff、按源的更新检查与同步） | 它存在的目的就是服务市场 |
| **GitHub 仓库扫描 / 导入**（树发现、分支选择、后台导入任务、进度轮询、取消） | 技能可以靠脚手架新建一个，也可以把文件夹丢进可写根目录 |
| **origin 集合**和**根分组**（`user-dsh` 与 `user-agents` 分组表头、集合拖拽排序、`sourceGroupOrder`、`collectionOrder`） | 清单是扁平的；技能就是技能 |
| **自定义分组 / 场景**（标签、分组开关、跨组冲突对话框、`trash.origin`/`tagIds`） | 同理 |
| `githubToken` 和 `showGroupSummary` 两个配置字段 | 已经没有需要认证的 GitHub 市场调用，也没有需要汇总的分组表头 |
| `src/repo/`（整个 GitHub 客户端、树发现、安装器） | 没有任何东西调用它 |

面板也相应变小了：`MarketView`、`MarketSourceRow`、`RepoScanCard`、`CollectionCard`、`SourceStatusBadge`、`GroupSummary`、`DisabledRow`、`SkillRow`、`SourcesView`，以及市场/源/repo 的各个 hook 和市场/源的 locale 文件都已消失。

**按工作区的分层**也出于同样的思路被移除，而这是与 `dsh-skill-hub` 之间唯一一处与市场无关的差异：工作区标签页、它的视图与流程 hook、它的 locale 字典、按工作区的选择文件（`<workspace>/.dsh/dshsk/skills.json` 及其 `use` 列表），以及写入它的那些方法（`setWorkspaceSelection`、`importLocalSkill`、`setStrictMode`、`setActiveWorkspace`）都已全部移除。`dsh-skill-hub` 允许工作区从 profile 清单中挑选一个子集；本插件则向每个工作区提供 profile 清单中的每一个技能，因此启用/禁用是一个按 profile 全局生效的事实。wire 类型 `SkillWorkspace` 以及 `CatalogSkill` 的 `usedBy`/`workspace`/`workspaceTitle` 字段也随之而去，表格的"被谁使用"列同样如此。

### 保留

技能子系统本身没有变化：通过 `ctx.skills` 的发现、frontmatter 解析器及其自动修复、诊断扫描、可写根目录规则、新建技能向导、回收站/恢复流程，以及调用统计读取器。

### 主题修复

上游的操作控件用 `--hub-accent` 上色，而它解析到 `--dsw-alias-state-business-primary` —— 这是平台保留给焦点环、绝不用于按钮填充的*状态*颜色 —— 并且每一种状态色调都用了按浅色主题调好的字面 hex。此前这是靠一个脚本就地编辑**构建产物** `lib/client.js` 来修复的，因此任何一次 `pnpm install` 都会悄悄把它还原。

现在修复位于源 CSS 中（`src/client/panel/panel.module.css`、`src/client/settings-card.module.css`）：实心主控件使用按钮 token（`--dsw-alias-button-primary-fill` / `-hover` + `--dsw-alias-label-primary-foreground`），开关使用 `--dsw-alias-brand-primary`，每一种字面状态色调都改成对相应 `--dsw-alias-state-*` token 做同 alpha 的 `color-mix()`，因此浅色主题看起来没有变化，而深色模式不再使用按浅色调整的颜色。自定义导航图随设置入口一起消失；侧边栏行绘制平台自带的技能轮廓图标。

## 配置

Loader 条目的配置就是设置卡片。宿主通过相应的 volatile ref 读取同一批值。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 贡献技能 provider 与公告；管理面板无论哪种情况都继续可用，因为正是它把插件重新打开 |
| `announceToAgent` | `true` | 注册告诉 agent 本管理器存在的系统提示词小节 |
| `showUseCount` | `true` | 每个技能的调用次数标签 |
| `showUseTime` | `true` | 每个技能的最近使用相对时间 |
| `dotModelColor` | 未设置 | "可被模型调用"圆点的 `#rrggbb`，用于表格和聊天 `/` 菜单 |
| `dotUserColor` | 未设置 | "仅可被用户调用"圆点的 `#rrggbb` |
| `statsWindowDays` | `14` | 计数的滚动窗口；`0` = 全部历史 |
| `statsScanMinutes` | `5` | 后台会话日志扫描间隔，单位分钟 |

## 构建、验证、安装

```sh
pnpm install
pnpm check        # typecheck both halves → build → vitest → the verifiers
pnpm pack         # dist/dsh-skill-mgr-<version>.tgz
sh tools/install-into-profile.sh desktop
```

`pnpm check` 按顺序运行：

| 步骤 | 它证明了什么 |
|---|---|
| `tsc -p tsconfig.json` | 宿主半边通过类型检查（包括每个测试） |
| `tsc -p tsconfig.client.json` | 浏览器半边按真实的槽位与 Remote 类型通过类型检查 |
| `tsc -p tsconfig.build.json` | 宿主半边输出到 `lib/types/` |
| `tsdown` | 浏览器 bundle 构建完成，使用仓库内的 CSS modules 编译器 |
| `vitest run` | 测试套件 |
| `tools/verify-typert.mjs` | 上文描述的 codec/descriptor 契约 |
| `tools/verify-gateway.mjs` | 编译出的宿主服务能在真实的 Cordis `Context` 上构造，并在命名空间 `skillMgr` 下发布全部 9 个方法 |
| `tools/verify-client.mjs` | 构建出的 bundle 能在桩模块加载器后面加载，并注册 `sidebar.panellist` `skillMgr` + `main` `skillMgr` + 配置卡片，且*没有*任何东西注册进设置 |

最后三项能抓住类型检查抓不到的问题：标准模式降级时被丢弃的装饰器、不再与 wire 命名空间匹配的服务键、不再与包名匹配的行 id（loader 会拒绝该 bundle）、在 `apply` 内抛错的注册（会让 GUI 白屏），以及与它打开的 `main` 键不匹配的 `sidebar.panellist` id（布局会抛错而不是切换）。

### 构建本身

上游没有提供构建配置 —— 发布的 tarball 里带了 `src/`，却没有生成 `lib/` 的 `tsconfig`/`tsdown` 文件。两者都必须补回来：

- `tsconfig.build.json` 按模块把普通 ESM 输出到 `lib/types/`（`main` 为 `lib/types/index.js`），这是 `dsh-mcp-mgr` 的布局，而不是打包过的宿主入口。
- `tsdown.config.ts` 以模块加载器的工厂形式构建浏览器半边，banner 的 `id` 等于包名。它的 external 恰好是 React 种子模块——`react` 与 `react/jsx-runtime`——由外壳的模块表解析；`tools/verify-client.mjs` 会断言这一集合，因此多出的运行时导入会在构建检查而不是浏览器里失败。平台 UI 原语已不再作为 external，因为它已经完全不被使用。
- CSS modules 由 `tsdown.config.ts` 内部一个小型 rolldown 插件编译。它把每个 `*.module.css` 导入解析为带 `.mjs` 后缀的**虚拟 id**：tsdown 会装上一个 `tsdown:css-guard` transform，在缺少 `@tsdown/css` 时对任何仍以 `.css` 结尾的模块 id 抛错，而 transform 钩子无法排在另一个插件的 `load` 之后。输出的函数体会按 `data-plugin-css` 为键把作用域化样式表注入一次，并导出原始类名→作用域化类名的映射。

## 注意事项

- **desktop profile 归 Electron 应用所有。** `dsh --profile desktop` 拒绝组合或转储它；`dsh plugin --profile desktop …` 只是把命令透传给 profile 目录里的 pnpm，确实能用，插件页用的也是这个方式。用它安装，然后**重启** —— 加到运行中 profile 里的 bundle 不在宿主启动时计算出的模块解析结果中。
- **本地安装会钉住 tarball 的路径。** 删除 `dist/dsh-skill-mgr-<version>.tgz` 后，下一次安装会以 `ENOENT` 失败。
- **构建产物只存在于 tarball 中。** 本仓库里 `lib/` 被 gitignore；它由 `pnpm build` 生成，而 `pnpm pack` 会先运行构建。
- **没有更新检查。** 本 fork 相对 `dsh-skill-hub` 已被大幅重构，跟踪上游项目的 release 会产生误导，而且本包本身也没有可轮询的发布渠道。面板会在标题旁显示已安装版本与作者署名（两者都由 `src/version.ts` 从包清单读取，措辞由 `STYLES.md` 规定），别无其他。设置卡片只显示裸版本号。
- **可写根目录仅限用户级。** 开关、删除和收编会触及 `~/.dsh/skills` 与 `~/.agents/skills`；项目、内置和运行时技能都是只读的，被拒绝时会指出拥有该技能的源。
- **删除可恢复，但没有自动过期。** `Delete` 会把技能移入该根目录的 `.trash` 目录，面板会在表格下方列出它并提供恢复操作；清空回收站则是永久性的。
- 上游为 MIT；其 `LICENSE` 一并携带。

## 许可证

MIT。派生自 [`dsh-skill-hub`](https://github.com/cheshireez/dsh-skill-hub) 0.3.18（MIT）。