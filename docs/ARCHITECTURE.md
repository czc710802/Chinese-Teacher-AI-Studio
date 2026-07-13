# 技术架构设计

## 架构概览

```text
React + Vite 客户端  →  Express API 服务  →  SQLite
                         ├→ AI 批改 / OCR 服务
                         ├→ Word / PDF 导出服务
                         └→ 上传与导出文件存储
```

## 组件

- `client/`：React 单页应用，Vite 构建。
- `server/`：Express 服务，提供认证、班级、任务、作文、分析、报告和 AI 辅导接口。
- `data/essay-review.sqlite`：SQLite 业务数据。
- `server/uploads/`：上传作文图片。
- `server/exports/`：生成的 Word/PDF 文件。
- `server/src/services/openai.js`：模型供应商与批改调用；可配置 OpenAI 或 DeepSeek。
- `ops/launchd/`：macOS `launchd` 守护配置，负责后端、Cloudflare Tunnel 和健康 watchdog。
- `ops/scripts/`：安装、重启、诊断、日志收集、自恢复脚本。

## 关键配置

配置文件为项目根目录 `.env.local`（不得提交真实密钥）：

```dotenv
PORT=4000
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.5
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com/chat/completions
PUBLIC_APP_ORIGIN=
```

公网演示入口由 `/api/public-access` 读取 `PUBLIC_APP_URL`、`PUBLIC_APP_ORIGIN` 或 `tools/cloudflared-production.yml` 中的 hostname 生成。当前生产演示入口为 `https://pi.zhenwanyue.icu`，由 Cloudflare Tunnel 转发到本机 `4000` 端口。登录页和教师首页会显示该入口，方便手机端访问、课堂展示和线上演示。

生产链路要求后端监听 `0.0.0.0:4000`，并由 `launchd` 直接托管 Node 服务与 Cloudflare Tunnel。健康检查脚本每 60 秒轮询本地与公网 `/api/health`，在本地失败时重启后端，在公网失败且本地成功时重启 Tunnel。

## 安全现状与后续工作

当前最小版本使用演示账号，密码尚未升级为加密存储和令牌认证。正式部署前应实施密码哈希、JWT/会话、权限校验审计、上传文件校验与密钥管理。
