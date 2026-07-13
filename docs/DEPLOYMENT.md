# 部署说明

## 本地运行

在项目根目录执行：

```bash
pnpm install
pnpm install:all
pnpm dev
```

如果使用 npm：

```bash
npm install
npm run install:all
npm run dev
```

客户端默认地址为 `http://localhost:5173`，服务端为 `http://localhost:4000`。生产预览可构建客户端后启动服务端，服务端会托管 `client/dist`。

## 配置与数据

- 真实模型密钥仅写入 `.env.local`，不得写入文档、日志或版本库。
- 确保运行账户可写入 `data/`、`server/uploads/` 与 `server/exports/`。
- 部署前设置 `PUBLIC_APP_ORIGIN` 为允许访问的前端域名。
- 生产部署请优先阅读 [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) 与 [TROUBLESHOOTING_MOBILE_ACCESS.md](TROUBLESHOOTING_MOBILE_ACCESS.md)。
- launchd、watchdog、日志采集与恢复脚本统一放在 `ops/` 目录。

## 上线前检查

- 修改演示账号并启用安全认证。
- 配置 HTTPS、反向代理、备份和日志轮转。
- 检查跨域白名单、文件上传限制与模型调用额度。
- 备份 SQLite 数据库和导出文件。
