# Contributing

## 开发规范

- 不在业务需求之外修改作文 AI、飞书、Benchmark、WebDAV、教师后台或学生端逻辑。
- 开发前先确认当前分支、工作区状态和相关文档。
- 涉及密钥、账号、Token、Cookie、Authorization 的内容只写入本地环境变量，不写入源码、文档、日志或 Git。
- 新增功能必须配套测试、文档或 smoke 验证。
- 修改生产启动、Cloudflare Tunnel、WebDAV、飞书等链路时，必须执行对应 smoke 检查。

## Commit 规范

推荐使用 Conventional Commits：

```text
feat: add new user-facing feature
fix: repair broken behavior
chore: update tooling or infrastructure
docs: update documentation
test: add or update tests
refactor: improve structure without behavior changes
```

提交前至少执行：

```bash
npm run ci:check
npm run typecheck
npm run lint
npm test
npm run build
```

## 目录规范

- `client/`：前端页面、样式和 API 客户端。
- `server/`：后端 API、服务层、集成、测试。
- `ops/`：运维脚本、健康检查、smoke test。
- `docs/`：架构、部署、飞书、NAS、Benchmark 等文档。
- `benchmark/`：Benchmark 数据结构、配置和运行入口。
- `data/`、`logs/`、`benchmark/reports` 等运行产物不提交。

## 命名规范

- 服务端模块使用清晰的功能名，例如 `student-profile`、`teacher-management`、`benchmark`。
- npm script 使用 `domain:action` 格式，例如 `feishu:smoke`、`zspace:test`、`benchmark:check`。
- 文档文件使用大写主题名或清晰中文名，避免含糊命名。

## Branch 规范

- `main`：稳定主分支。
- `feature/<name>`：新增能力或工程化建设。
- `fix/<name>`：缺陷修复。
- `chore/<name>`：基础设施、CI、文档、版本管理。

首次推送到 GitHub 后，建议为 `main` 开启分支保护，要求 CI 通过后再合并。
