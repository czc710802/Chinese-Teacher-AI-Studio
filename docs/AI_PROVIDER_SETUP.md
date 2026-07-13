# AI Provider 配置说明

Chinese Teacher AI Studio 当前生产默认模型是 DeepSeek。OpenAI 配置会保留在服务端环境变量中，但因为当前 OpenAI API 计费/额度不可用，生产环境暂时禁用 OpenAI，不把它计入 ready/degraded 状态。

所有 AI 请求必须经过服务端 AI Router。前端不得保存、传输或调用真实 API Key。

## 当前生产策略

- `AI_PRIMARY_PROVIDER=deepseek`
- `AI_DEFAULT_PROVIDER=deepseek`
- `AI_FALLBACK_ENABLED=false`
- 所有任务路由到 `deepseek`
- OpenAI 显示为 `enabled=false`、`status=DISABLED`
- Router 期望状态为 `ready=true`、`degraded=false`

## 环境文件加载规则

生产服务启动时只加载：

```text
.env.production
```

开发服务按顺序加载：

```text
.env.local
.env
```

测试环境默认不读取真实密钥，单元测试使用 mock fetch 或测试变量。

## 生产环境变量

在 `.env.production` 中保持：

```bash
AI_PROVIDER=deepseek
AI_ROUTER_ENABLED=true
AI_DEFAULT_PROVIDER=deepseek
AI_PRIMARY_PROVIDER=deepseek
AI_FALLBACK_PROVIDER=deepseek
AI_REQUEST_TIMEOUT_MS=60000
AI_MAX_RETRIES=1
AI_FALLBACK_ENABLED=false
AI_REVIEW_MODE=single

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_FAST_MODEL=
DEEPSEEK_REASONING_MODEL=
```

可以保留 OpenAI 变量，但生产不会启用：

```bash
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=
OPENAI_FAST_MODEL=
OPENAI_REASONING_MODEL=
```

## 任务路由

当前生产路由：

```bash
AI_ROUTE_ESSAY_GRADING=deepseek
AI_ROUTE_LOGIC_ANALYSIS=deepseek
AI_ROUTE_DEEP_REVISION=deepseek
AI_ROUTE_QUICK_FEEDBACK=deepseek
AI_ROUTE_OCR_CLEANUP=deepseek
AI_ROUTE_SUMMARY=deepseek
AI_ROUTE_FEISHU_REPLY=deepseek
AI_ROUTE_TEACHER_REPORT=deepseek
AI_ROUTE_GENERAL=deepseek
```

## 健康检查

检查 DeepSeek：

```bash
npm run ai:check:deepseek
```

检查整体 Router：

```bash
npm run ai:check
```

生产可用的判断标准：

```text
DeepSeek:
enabled=true
configured=true
connected=true

OpenAI:
enabled=false
status=DISABLED

Overall:
ready=true
degraded=false
primaryProvider=deepseek
fallbackEnabled=false
```

这些命令只输出 `SET`、`MISSING`、`EMPTY`、`INVALID_FORMAT`、错误分类、模型名和状态，不会显示 API Key。

## 真实作文验收

运行：

```bash
npm run ai:essay-smoke
```

该脚本会加载 `.env.production`，用一段最小测试作文调用真实 DeepSeek 批改，并只输出：

- provider
- model
- 是否调用 OpenAI
- 总分/等级是否存在
- 优点、问题、建议、训练任务是否存在
- 是否为 mock

不会输出完整批改报告或任何密钥。

## 重新启用 OpenAI

当 OpenAI Platform 计费和额度恢复后，可以重新启用双模型：

```bash
AI_PRIMARY_PROVIDER=openai
AI_FALLBACK_PROVIDER=deepseek
AI_FALLBACK_ENABLED=true
AI_ROUTE_ESSAY_GRADING=openai
AI_ROUTE_LOGIC_ANALYSIS=openai
AI_ROUTE_DEEP_REVISION=openai
AI_ROUTE_TEACHER_REPORT=openai
```

然后运行：

```bash
npm run ai:check:openai
npm run ai:check
npm run prod:restart
npm run prod:status
```

## API Key 安全规则

API Key 只允许写在本机环境文件或系统环境变量中，不得写入源代码、README、测试文件、日志或截图。

Key 不应包含：

- 首尾空格
- 首尾引号
- 换行符
- `Bearer ` 前缀
- 占位值，例如 `your-deepseek-key`

系统会对首尾空格和误加的首尾引号做安全规范化，但不会修改真实环境文件中的密钥内容。

## Git 安全

`.gitignore` 必须覆盖：

```text
.env
.env.*
!.env.example
```

不得提交真实 `.env.production` 或任何密钥文件。
