# Feishu App Studio

## 1. 进入飞书开放平台

打开飞书开放平台，进入“开发者后台”，使用企业管理员账号登录。

## 2. 创建企业自建应用

1. 选择“创建企业自建应用”。
2. 填写应用名称，例如 `Chinese Teacher AI Studio`。
3. 选择所属企业与应用图标。
4. 创建完成后，进入应用详情页。

## 3. 获取 App ID 和 App Secret

1. 在应用详情页找到 `App ID` 和 `App Secret`。
2. 把它们写入项目根目录的 `.env.production`。
3. 不要把真实值提交到 Git。

## 4. 开启机器人能力

1. 在应用能力里开启机器人。
2. 如需群聊通知，继续配置自定义机器人 webhook。
3. 保存后再进行事件订阅。

## 5. 配置事件订阅

1. 在事件订阅里启用回调。
2. 请求地址填写：

```text
https://pi.zhenwanyue.icu/api/feishu/events
```

3. 按平台要求配置 `Verification Token` 和 `Encrypt Key`。

## 6. 配置 `.env.production`

把下面字段写入 `.env.production`：

```text
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_VERIFICATION_TOKEN=
FEISHU_ENCRYPT_KEY=
FEISHU_WEBHOOK_URL=
FEISHU_SECRET=
FEISHU_BOT_NAME=Chinese Teacher AI Studio
```

可以使用：

```bash
npm run feishu:setup
```

## 7. 测试通知

先确认本地服务启动，再执行：

```bash
npm run feishu:test
```

如果配置了 webhook，脚本会发送测试通知到飞书群。

## 8. 在飞书里发送命令

在群里发送：

- `状态`
- `帮助`
- `日报`

更多命令见 `docs/FEISHU_COMMANDS.md`。
