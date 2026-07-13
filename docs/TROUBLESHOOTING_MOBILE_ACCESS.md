# 手机端访问排查

当 `https://pi.zhenwanyue.icu` 在手机端或外网反复掉线时，按下面顺序检查。

## 1. 本地后端是否正常

```bash
curl http://127.0.0.1:4000/api/health
```

期望看到 JSON，且 `ok` 为 `true`。

如果这里失败，说明问题在 Node 后端，不是 Cloudflare。

## 2. launchd 后端服务是否运行

```bash
npm run prod:status
```

重点看：

- `com.zhenwanyue.ai-server`
- `port 4000`
- `local health`

如果后端没起来，先执行：

```bash
npm run prod:restart
```

## 3. Cloudflare Tunnel 是否运行

还是看：

```bash
npm run prod:status
```

如果本地 health 正常，但公网 health 失败，通常是 Tunnel 掉了。重启后再测：

```bash
npm run prod:restart
curl https://pi.zhenwanyue.icu/api/health
```

## 4. Mac 睡眠或网络变化后的恢复

Mac 一旦睡眠、重启、切换 Wi-Fi，Tunnel 最容易断。

恢复顺序：

```bash
npm run prod:restart
npm run prod:status
curl http://127.0.0.1:4000/api/health
curl https://pi.zhenwanyue.icu/api/health
```

## 5. 仍然失败时

执行：

```bash
npm run prod:diagnose
npm run prod:collect-logs
```

重点查看：

- `logs/server.err.log`
- `logs/cloudflared.err.log`
- `logs/watchdog.log`

## 6. Cloudflare 凭据如何安全放置

不要把 credentials 文件提交到仓库。推荐做法：

- credentials 放在 `~/.cloudflared/`
- `tools/cloudflared-production.yml` 只写路径，不写密钥内容
- `.env.local` 只放本机环境变量

示例模板见：

- `ops/cloudflared/config.example.yml`
- `.env.production.example`
