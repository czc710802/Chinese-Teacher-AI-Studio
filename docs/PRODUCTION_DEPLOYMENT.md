# V10.1 Production 守护部署版

本文说明 `pi.zhenwanyue.icu` 的 macOS 生产部署方式。当前目标是让后端、Cloudflare Tunnel 和健康检查都由 `launchd` 托管，机器重启后自动恢复，网络波动后可自动修复。

## 目录

- 后端：`ops/launchd/com.zhenwanyue.ai-server.plist`
- Tunnel：`ops/launchd/com.zhenwanyue.cloudflared.plist`
- Watchdog：`ops/launchd/com.zhenwanyue.health-watchdog.plist`
- 安装：`ops/scripts/install-launchd.sh`
- 重启：`ops/scripts/restart-production.sh`
- 状态：`ops/scripts/status-production.sh`
- 诊断：`ops/scripts/diagnose.sh`
- 日志：`logs/server.out.log`、`logs/server.err.log`、`logs/cloudflared.out.log`、`logs/cloudflared.err.log`、`logs/watchdog.log`

## 先决条件

1. macOS 用户会话可以执行 `launchctl bootstrap gui/$UID ...`。
2. 机器已经安装 Node 和 npm。
3. 仓库位于 `高中作文AI批改App` 根目录。
4. 先执行 `npm install`，再执行 `npm run install:all`，让根包与 client/server 依赖都落地。
5. `server/src/index.js` 监听 `0.0.0.0:4000`，`/api/health` 返回 JSON。
6. Cloudflare Tunnel 证书或 token 已在本机单独配置，不写入仓库。

## 安装 launchd 守护

```bash
npm run prod:install
```

这会同时安装并启动：

- Node 后端
- Cloudflare Tunnel
- health watchdog

## 停止、重启、查看状态

停止：

```bash
bash ops/scripts/uninstall-launchd.sh
```

重启：

```bash
npm run prod:restart
```

状态：

```bash
npm run prod:status
```

## 查看日志

实时查看：

```bash
npm run prod:logs
```

诊断包：

```bash
npm run prod:collect-logs
```

## 手机端和外网排查顺序

1. 先看 `npm run prod:status`，确认后端、Tunnel 和 Watchdog 是否都在运行。
2. 再检查本地健康接口 `http://127.0.0.1:4000/api/health`。
3. 如果本地正常，再检查公网接口 `https://pi.zhenwanyue.icu/api/health`。
4. 如果本地失败，优先重启后端。
5. 如果本地成功但公网失败，优先重启 Cloudflare Tunnel。
6. 如果 Mac 刚睡眠、刚重启、网络刚切换，先运行 `npm run prod:restart`，再重复健康检查。
7. 仍失败时执行 `npm run prod:diagnose` 和 `npm run prod:collect-logs`，把日志包带走排查。

## 安全配置

不要把以下内容写入仓库：

- `.env.local`
- `.env.production`
- Cloudflare credentials JSON
- Cloudflare token
- `cert.pem`

示例文件：

- `.env.production.example`
- `ops/cloudflared/config.example.yml`

生产环境中，真实 credentials 文件建议放在用户家目录的 `.cloudflared/` 下，并只在本机使用。
