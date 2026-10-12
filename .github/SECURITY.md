# Security Policy

## Supported versions

Only the versions below receive security fixes. Older releases are provided "as-is" —
upgrade to a supported line before reporting.

| Version | Supported | Notes |
| --- | --- | --- |
| `main` (latest commit) | :white_check_mark: | Active development |
| Latest tagged release | :white_check_mark: | Fixes are backported when practical |
| Older tagged releases | :x: | Upgrade to the latest release |
| Forks and modified copies | :x: | Report to the maintainer of that fork |

## Reporting a vulnerability

**Do not open a public issue, discussion, or pull request for a security problem.**
A public report exposes every user before a fix exists.

Report privately through **GitHub Security Advisories**:
`https://github.com/icrefin/dsh-skill-mgr/security/advisories/new`
(repository → *Security* → *Advisories* → *Report a vulnerability*). This keeps the
report private and gives us a private fork in which to prepare the fix.

Include in your report:

- Affected version or commit, plus the dsh build and the deployment you ran it in.
- The skill name and its root (`~/.dsh/skills` or `~/.agents/skills`), its state
  (enabled, disabled, or in the trash), and which operation you were performing,
  with personal paths redacted.
- A minimal reproduction (proof of concept, code, or test case).
- Impact assessment: what an attacker gains, and under which preconditions.
- Any fix or mitigation you already know of.
- Whether you intend to publish, and the name you want used for credit.

## Our commitments

| Stage | Target |
| --- | --- |
| Acknowledge receipt | 3 business days |
| Initial assessment and severity triage | 10 business days |
| Fix or documented mitigation | 30 days for high/critical, best effort otherwise |
| Public disclosure | Coordinated with you, after a fix is available |

We credit you in the advisory unless you ask us not to. We will not pursue legal action
against researchers who act in good faith, avoid privacy violations, avoid service
disruption, and give us reasonable time to fix the issue before disclosure.

## Scope

In scope:

- The code in this repository (`icrefin/dsh-skill-mgr`), including the browser
  bundle, the host-side gateway, the Loader patch row (`cordis.patch.yml`), and
  the CI workflows.
- The write boundary. Enable/disable renames one discovery file
  (`SKILL.md` ↔ `SKILL.md.disabled`) and `Delete` moves a skill into the root's
  `.trash`. A way to make either operation write outside `~/.dsh/skills` and
  `~/.agents/skills`, follow a symlink out of a writable root, or overwrite an
  existing skill without the panel saying so, is a vulnerability.
- A refusal must name the source that owns the skill. A path that reports success
  while doing nothing, or that silently widens which roots are writable, is a
  vulnerability.
- The registry file (`<profile>/.dsh/dshsk/skills.json`), which is written through
  an atomic same-directory temp file. A way to make an unparsable registry be
  overwritten instead of reported, or to make the temporary file land anywhere but
  beside the registry, is a vulnerability.
- The `skillMgr` Remote surface: a way to make a method serve another profile's
  inventory, or act on a path the caller did not name, is a vulnerability.
- The discovery repair and the Add-skill scaffolder: a way to make them write a
  file with contents, a mode, or a path the user did not ask for, is a
  vulnerability.
- The plugin's failure faces: a way to make a failure look like a successful
  toggle, or to hide the reason from the user, is a vulnerability.

Out of scope:

- Vulnerabilities in third-party dependencies — report those upstream; tell us only
  if this project becomes exploitable as a result.
- The behaviour of `@deepseek-ai/dsh-skill`, the filesystem provider it ships, and
  DeepSeek Harness itself. This plugin drives discovery through those packages; a
  defect in the discovery rules or the live catalog belongs to those projects.
- The content of a skill. This plugin lists, scaffolds, renames and moves skills;
  it does not execute them, and it does not vet the instructions they carry.
- Anything that requires a skill's own secrets to be exposed in the first place, or
  a modification to the host configuration.
- Social engineering, physical access, and volume-based denial of service.
- Issues that require an already-compromised machine or a modified local build.
- Anything on a host you do not own or have written permission to test.

Note that this plugin opens no port and serves no route of its own: it reads and
writes the two writable roots and the profile registry, and makes no network
request at all.

## Safe harbor

If you follow this policy, we consider your research authorized, will work with you to
understand and fix the issue, and will not recommend or support legal action against you.

## Handling secrets in reports

Redact tokens, keys, and personal data. Use placeholders such as `192.0.2.10`,
`<YOUR_EMAIL>`, and `<YOUR_API_KEY>` when an example is needed, and replace home
directories with a placeholder such as `/home/user`: a screenshot of the panel can
show real skill names, root paths and session text. If a live credential must be
shown, tell us first and rotate it immediately afterwards.

---

# 安全策略

## 支持的版本

只有下表中的版本会收到安全修复。更早的版本按“现状”提供 —— 报告前请先升级到受支持的分支。

| 版本 | 是否支持 | 说明 |
| --- | --- | --- |
| `main`（最新提交） | :white_check_mark: | 活跃开发 |
| 最新的发布标签 | :white_check_mark: | 可行时会回合修复 |
| 更早的发布标签 | :x: | 请升级到最新发布版 |
| 分支（fork）与改动过的副本 | :x: | 请向该分支的维护者报告 |

## 报告漏洞

**请勿为安全问题开公开 issue、discussion 或 pull request。**
公开报告会在修复发布之前就暴露给所有用户。

请通过 **GitHub Security Advisories** 私下报告：
`https://github.com/icrefin/dsh-skill-mgr/security/advisories/new`
（仓库 → *Security* → *Advisories* → *Report a vulnerability*）。报告保持私密，
同时给我们一个私有分支用于准备修复。

报告中请包含：

- 受影响的版本或 commit，以及你运行的 dsh 版本与所属部署。
- 技能名称与它所在的根目录（`~/.dsh/skills` 或 `~/.agents/skills`）、它的状态
  （已启用、已禁用，还是在回收站里），以及你当时在执行哪个操作；个人路径请隐去。
- 最小可复现样例（PoC、代码或测试用例）。
- 影响评估：攻击者能获得什么，前置条件是什么。
- 你已知的修复或缓解方式。
- 是否打算公开，以及你希望使用的署名。

## 我们的承诺

| 阶段 | 目标 |
| --- | --- |
| 确认收到 | 3 个工作日 |
| 初步评估与严重性定级 | 10 个工作日 |
| 修复或书面缓解方案 | 高危/严重 30 天内，其余尽力而为 |
| 公开披露 | 与你协商，且在修复可用之后 |

除你要求匿名外，我们会在公告中署名致谢。对于善意研究 —— 不侵犯隐私、不中断服务、
并在披露前给我们合理的修复时间 —— 我们不会采取法律行动。

## 范围

在范围内：

- 本仓库（`icrefin/dsh-skill-mgr`）的代码，包括浏览器 bundle、宿主侧网关、
  Loader 补丁行（`cordis.patch.yml`）与 CI 工作流。
- 写入边界。启用/禁用只是重命名一个发现文件（`SKILL.md` ↔ `SKILL.md.disabled`），
  `Delete` 则把技能移入根目录下的 `.trash`。若能让这两种操作写到
  `~/.dsh/skills` 与 `~/.agents/skills` 之外、跟随符号链接跑出可写根目录，
  或在面板没有说明的情况下覆盖已有技能，都算漏洞。
- 拒绝时必须指明该技能所属的来源。若某条路径报告成功却什么都没做，或悄悄扩大可写根目录的范围，
  都算漏洞。
- 注册表文件（`<profile>/.dsh/dshsk/skills.json`）通过同目录原子临时文件写入。
  若能让不可解析的注册表被覆盖而不是被报告，或让临时文件落在注册表旁边以外的地方，都算漏洞。
- `skillMgr` Remote 接口：若能让某个方法返回别的 profile 的清单，或作用于调用方没有指定的路径，
  都算漏洞。
- 发现修复与「新建技能」脚手架：若能让它们写出用户没有要求的内容、权限位或路径，都算漏洞。
- 插件的失败界面：若能让失败看起来像切换成功，或让用户看不到失败原因，都算漏洞。

不在范围内：

- 第三方依赖自身的漏洞 —— 请报告给上游；仅当本项目因此变得可被利用时再告知我们。
- `@deepseek-ai/dsh-skill`、它附带的文件系统 provider，以及 DeepSeek Harness 自身的行为。
  本插件通过那些包驱动发现；发现规则或实时清单的缺陷属于那些项目。
- 技能本身的内容。本插件只负责列出、脚手架、重命名与移动技能，不执行它们，
  也不审查它们携带的指令。
- 任何以技能自身的密钥本就已泄露为前提的问题，或需要改动宿主配置的问题。
- 社会工程、物理访问，以及靠流量压垮服务的拒绝服务。
- 需要已失陷主机或被改动的本地构建才能成立的问题。
- 任何你并不拥有、也没有书面授权测试的主机。

请注意：本插件不开端口，也不提供任何路由 —— 它只读写那两个可写根目录与 profile 注册表，
完全不发起网络请求。

## 安全港

只要你遵循本策略，我们视你的研究为已授权，会与你一起理解并修复问题，
并且不会建议或支持对你采取法律行动。

## 报告中的密钥处理

请隐去令牌、密钥与个人信息。需要示例时请使用 `192.0.2.10`、`<YOUR_EMAIL>`、
`<YOUR_API_KEY>` 这类占位符，并把 home 目录替换成 `/home/user` 这样的占位路径 ——
面板截图可能带着真实的技能名称、根目录路径与会话文本。
若必须展示有效凭据，请先告知我们，并在其后立即轮换。
