# dsh-skill-mgr

**所有技能，一张清单** —— 在侧边栏面板里看到整个 profile 的技能清单：有哪些已安装、读一读技能正文、启用或禁用它、修复发现诊断，以及把它删进一个可恢复的回收站。

[English](README.md) | **简体中文**

[![License](https://img.shields.io/github/license/icrefin/dsh-skill-mgr?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/icrefin/dsh-skill-mgr?style=flat-square)](https://github.com/icrefin/dsh-skill-mgr/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/icrefin/dsh-skill-mgr/ci.yml?branch=main&style=flat-square)](https://github.com/icrefin/dsh-skill-mgr/actions/workflows/ci.yml)
[![Last commit](https://img.shields.io/github/last-commit/icrefin/dsh-skill-mgr?style=flat-square)](https://github.com/icrefin/dsh-skill-mgr/commits/main)
[![Stars](https://img.shields.io/github/stars/icrefin/dsh-skill-mgr?style=flat-square)](https://github.com/icrefin/dsh-skill-mgr/stargazers)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/icrefin/dsh-skill-mgr/pulls)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![dsh](https://img.shields.io/badge/dsh-0.2.0--rc.2-4B5563?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)

> 如果这个插件让你不必再去 `~/.dsh/skills` 里翻找，欢迎点一个 ⭐ Star，让更多人看到它。

## 它解决的问题

一个技能就是一个装着发现文件的文件夹 —— 创建很容易，理清楚很难：到底有哪些、哪些当前是关着的（文件改名后是“看不见”而不是“不存在”）、哪一个的 frontmatter 坏了、两个可写根目录之间有哪些重名。本插件就是回答这些问题的唯一去处：不用打开编辑器，也不用手工改文件名。

**默认即启用，而禁用首先是文件系统层面的事实。** 发现文件被重命名（`SKILL.md` → `SKILL.md.disabled`，或 `<name>.md` → `<name>.md.disabled`），文件系统 provider 直接看不到它；而注册表记录让面板仍能把它列出来并重新打开。

## 截图

![Skills 面板：扁平的 profile 清单](docs/images/skills-panel.png)

*Skills —— 一张覆盖整个 profile 清单（启用与禁用一视同仁）的扁平表格，带搜索、来源筛选、调用次数与最近使用徽标、发现诊断，以及可恢复的回收站。*

![单个技能的详情视图](docs/images/skill-detail.png)

*Inspect —— 技能正文与元数据，禁用中的技能还会带上启用/禁用操作。*

## 注册表文件

```
<profile>/.dsh/dshsk/skills.json      the profile's skill management state
```

这一份注册表保存管理器持久化的全部内容：已禁用技能记录、回收站，以及统计检查点。它在启动时对账 —— 没有记录的 `.disabled` 文件会被收编（升级过或手工编辑过的安装），而文件已消失的记录会被丢弃。写入一律经过同目录的原子临时文件（`wx`、权限 `0600`，然后 `rename`）；读取时若遇到无法解析的 JSON，则拒绝覆盖它并报告原因。

## 功能

| 界面 | 作用 |
|---|---|
| 侧边栏条目 | 紧挨 **Plugins** 下方（`order: 1`），点开即在中栏打开 **Skills** 页面 |
| Skills 表格 | 一张扁平表格列出 profile 清单 —— Name / Source / Description / Status / Actions —— 带搜索、排序与来源筛选 |
| 启用 / 禁用 | 重命名发现文件并保留记录，因此该行仍然可见（变暗）且可以随时重新打开 |
| Inspect | 不离开 GUI 就能读取技能的正文与元数据 |
| 新增技能 | 在可写根目录里脚手架式地创建一个新技能 |
| 发现诊断 | 列出 provider 看不到的技能，并对可修复项就地自动修复 |
| 可恢复回收站 | `Delete` 把技能移到该根目录的 `.trash`；面板把它列出来并提供 Restore，清空回收站则是显式操作 |
| 聊天 `/` 菜单圆点 | 为每个候选行标出“模型可调”或“仅用户可调”，颜色取自面板读取的同一份设置 |
| 设置卡片 | 插件自己的配置，位于 Plugins 管理页 |
| 署名 | 标题徽标带已安装版本与作者署名 |

## 环境要求

- Node.js `^22.19.0 || >=24.0.0`
- 一套 DeepSeek Harness `0.2.0-rc.2` 安装（插件组合进某个 profile）
- `pnpm` 11.8.0（由清单里的 `packageManager` 固定）

## 安装

```sh
pnpm install
pnpm check                        # typecheck → build → tests → verifiers
pnpm pack                         # dist/dsh-skill-mgr-<version>.tgz
sh tools/install-into-profile.sh desktop
```

之后重启 DeepSeek Harness，侧边栏条目会出现在 **Plugins** 正下方。

这个包没有发布到 npm：profile 直接从本仓库安装。脚本用的是 `dsh plugin`（等价于 pnpm 直通写入 profile 目录），Plugins 页面做的是同一件事。desktop profile 归 Electron 应用所有，所以 `dsh --profile desktop` 本身拒绝组合它，而 `dsh plugin` 仍然可用。

从 `dsh-skill-hub` 升级？两个包不能同时安装 —— 它们会同时抢占插件配置卡。请先移除旧 bundle；新插件会在首次加载时收编旧状态文件，并保持原文件不动。

## 快速开始

1. 在侧边栏打开 **Skills**。表格会列出 `~/.dsh/skills` 与 `~/.agents/skills` 里的每一个技能。
2. 搜索某个技能；选 **Inspect** 阅读它，或选 **Disable** 在整个 profile 内关掉它。
3. 选 **Add skill** 在可写根目录里创建一个新技能。
4. 有东西没被发现时，读一读诊断横幅，并对可修复项使用它的修复操作。

## 配置

Loader 条目的 config 就是设置卡片；host 通过对应的 volatile ref 读取同一批值。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 提供技能 provider 与公告；无论如何管理面板都照常工作，因为它正是把插件重新打开的那个界面 |
| `announceToAgent` | `true` | 注册告诉 agent 存在这个管理器的 system-prompt 段落 |
| `showUseCount` | `true` | 每个技能的调用次数徽标 |
| `showUseTime` | `true` | 每个技能的最近使用相对时间 |
| `dotModelColor` | 未设置 | 表格与聊天 `/` 菜单里“模型可调”圆点的 `#rrggbb` |
| `dotUserColor` | 未设置 | “仅用户可调”圆点的 `#rrggbb` |
| `statsWindowDays` | `14` | 统计的滚动窗口天数；`0` = 全部历史 |
| `statsScanMinutes` | `5` | 后台扫描会话日志的间隔（分钟） |

## Remote 接口

浏览器半通过唯一的 Typert Remote 命名空间 `skillMgr` 读写。两条约定覆盖整个接口：`snapshot()` 是唯一的读（面板在一次渲染内共享一次往返，并从这一次调用加载所有切片），而每个写操作都返回 `SkillApplyResult`（`{ok:true}` / `{ok:false, error}`），之后调用方重新拉取。

| 区域 | 方法 |
|---|---|
| 核心 | `snapshot` |
| profile 清单 | `saveGlobalSkill`, `removeGlobalSkill`, `setGlobalSkillEnabled`, `skillDetail`, `fixDiagnostic`, `skillStats` |
| 回收站 | `restoreTrashedSkill`, `clearTrash` |

共 9 个方法。它们的入参与返回类型以 zod schema 的形式写在 `src/wire.ts`，每个类型都是对应 schema 的 `z.infer`，因此 host 实现、descriptor 表与浏览器半不可能彼此漂移。

## 注意事项

- **启用/禁用是按 profile 全局生效的，不是按工作区。** 因为开关就是重命名一个发现文件，所以无法做到某个技能在一个工作区开启、在另一个工作区关闭；每个工作区都会被提供 profile 清单中的每一个技能。需要按工作区开关的读者在这里是得不到的。
- **项目技能只被发现，不被管理。** provider 会列出工作区自己的根目录，因此 agent 仍能看到就在它旁边的技能，但它们从来不属于面板管理的 profile 清单：无法被开关、删除或收编。只有 `~/.dsh/skills` 与 `~/.agents/skills` 可写。
- **可写根目录仅限用户级**，拒绝时会指明该技能归属的来源。
- **删除可恢复，但没有自动过期。** `Delete` 把技能移进该根目录的 `.trash`，面板把它列出来并提供 Restore；清空回收站则是永久操作。
- **本地安装会固定 tarball 路径。** 删掉 `dist/dsh-skill-mgr-<version>.tgz` 后，下一次安装会以 `ENOENT` 失败。
- **没有更新检查。** 本包相对 `dsh-skill-hub` 改动很大，跟踪上游 release 只会误导；而且本包也没有可轮询的发布渠道。

## 许可证与来源

MIT —— 见 [LICENSE](LICENSE)。本包由 `dsh-skill-hub` 0.3.18 重构而来（MIT，“dsh-skill-hub contributors”）；该版权行保留在 LICENSE 文件中，与上游的差异记录在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

> 点 Star 不花钱，但能让这个项目被更多人发现。如果它帮到了你，欢迎点一下 ⭐。
