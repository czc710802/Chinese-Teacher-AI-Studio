# Feishu Event Callback

## 回调地址

```text
https://pi.zhenwanyue.icu/api/feishu/events
```

## 支持的回调类型

### 1. URL Verification

飞书首次配置事件订阅时会发送 `challenge`。

后端会返回：

```json
{ "challenge": "..." }
```

### 2. 普通文本消息

收到文本消息后，系统会解析命令并回复对应内容。

## 当前第一阶段行为

- `帮助` / `/help`：返回命令菜单卡片
- `状态` / `/status`：返回系统状态卡片
- `日报` / `/daily`：返回最近日报路径或摘要
- `备份` / `/backup`：触发备份脚本
- `日志` / `/logs`：返回最近错误摘要
- `重启` / `/restart`：只返回确认提示，不会直接执行
- `作文` / `试卷` / `PPT` / `晨报`：返回“功能入口已预留，将在 V11.1 接入”

## 服务端接口

- `GET /api/feishu/health`
- `POST /api/feishu/events`
- `GET /api/system/status`

## 测试方法

1. 先启动后端与 tunnel。
2. 访问：

```bash
curl http://127.0.0.1:4000/api/feishu/health
curl http://127.0.0.1:4000/api/system/status
```

3. 在飞书群里发送 `状态` 或 `帮助`。
