# Feishu Commands

## 已实现命令

- `帮助`
- `/help`
- `状态`
- `/status`
- `日报`
- `/daily`
- `备份`
- `/backup`
- `日志`
- `/logs`

## 预留命令

- `作文`
- `试卷`
- `PPT`
- `晨报`
- `重启`
- `/restart`

## 行为说明

### 帮助

返回按钮式菜单卡片，标题统一为 `Chinese Teacher AI Studio`。

### 状态

返回系统状态卡片，包含：

- 版本
- 后端状态
- Cloudflare Tunnel 状态
- Watchdog 状态
- 本地健康
- 公网健康

### 日报

返回最近日报路径或摘要。

### 备份

触发 `ops/scripts/backup-production.sh`。

### 日志

返回最近错误摘要。

### 重启

只返回确认提示，不会直接执行重启。

## 预留入口

`作文`、`试卷`、`PPT`、`晨报` 会返回：

```text
功能入口已预留，将在 V11.1 接入
```
