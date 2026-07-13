# Feishu Security

## 不要提交真实密钥

以下内容都属于敏感信息，不能提交到 Git：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_VERIFICATION_TOKEN`
- `FEISHU_ENCRYPT_KEY`
- `FEISHU_WEBHOOK_URL`
- `FEISHU_SECRET`

## 推荐写入方式

把值写入项目根目录的 `.env.production`，不要写到代码里。

可以用：

```bash
npm run feishu:setup
```

## Git 忽略

仓库已经忽略：

- `.env`
- `.env.*`
- `logs/`
- `backups/`
- `reports/`
- `credentials.json`
- `cert.pem`
- `cloudflared*.json`
- `cloudflared*.pem`
- `*.secret`
- `*.key`

## 额外建议

1. 只在本机或受信任的管理终端填写密钥。
2. 轮换飞书 Secret 后，立即更新 `.env.production`。
3. 如果 webhook 泄露，立刻在飞书开放平台重置。
