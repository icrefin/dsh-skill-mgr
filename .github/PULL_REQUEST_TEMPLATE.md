## Summary / 概述

<!-- What changed and why. Link the issue: Closes #123 -->
<!-- 改了什么、为什么改。关联 issue：Closes #123 -->

## Type of change / 变更类型

- [ ] Bug fix / 缺陷修复
- [ ] New feature / 新功能
- [ ] Breaking change / 破坏性变更
- [ ] Refactor or performance / 重构或性能
- [ ] Documentation or examples / 文档或示例
- [ ] CI, build, or dependencies / CI、构建或依赖

## How it was verified / 验证方式

<!-- Exact commands, test names, or steps a reviewer can repeat. -->
<!-- 评审者可复现的确切命令、测试名称或步骤。 -->

```bash
# pnpm check                 # typecheck, build, vitest, then the three verifiers
# pnpm test                  # vitest alone
# node tools/preview.mjs --out /tmp/preview   # optional: render both panel PNGs
```

## Checklist / 检查清单

- [ ] Tested locally, and the commands above pass / 已在本地测试，且上述命令通过
- [ ] Tests added or updated for behavior changes / 行为变更已新增或更新测试
- [ ] Docs updated (README, TSDoc comments, `docs/`) / 文档已更新（README、TSDoc 注释、`docs/`）
- [ ] English and Chinese copy updated together when user-facing text changed (`src/client/locales.ts`) / 用户可见文案变化时已同步更新中英文文案（`src/client/locales.ts`）
- [ ] Toggling, deleting and restoring still go through the rename plus the registry record — no path removes a skill without a recoverable trash entry / 启用/禁用、删除与恢复仍然通过重命名加注册表记录完成 —— 没有任何路径会在没有可恢复回收站记录的情况下删除技能
- [ ] No secrets committed — no API keys, tokens, passwords, private keys, `.env` files, or personal data / 未提交任何密钥 —— 无 API key、令牌、密码、私钥、`.env` 文件或个人数据
- [ ] License of new dependencies checked and compatible with `MIT` / 已核查新增依赖的许可证，且与本项目的 `MIT` 兼容
- [ ] Pull request targets `main` and is rebased on its latest commit / PR 目标分支为 `main`，且已 rebase 到其最新提交
- [ ] Commits are focused, messages follow the project convention, and each one is signed off (`git commit -s`) / 提交粒度合理，提交信息符合项目规范，且每个提交都已 sign-off（`git commit -s`）

## Screenshots or logs (optional) / 截图或日志（可选）

<!-- Remove anything sensitive before pasting — a screenshot of the panel can show real
     skill names, home paths, a session title, or session text. Use placeholders such as
     /home/user and <YOUR_EMAIL> instead of real values. -->
<!-- 粘贴前请先删除敏感内容 —— 面板截图可能带着真实的技能名称、home 路径、会话标题或会话文本。
     请使用 /home/user、<YOUR_EMAIL> 这类占位符，不要用真实值。 -->

## Notes for reviewers / 给评审者的说明

<!-- Tradeoffs, follow-up work, or parts you are unsure about. -->
<!-- 取舍、后续工作，或你不确定的部分。 -->
