# 极空间 Z2 Pro 自动发现与接入建议

生成时间：2026-07-11T00:57:59.943Z

## 当前发现的极空间

发现 1 台疑似极空间设备。

| # | IP | Hostname | 极空间 | 型号 | 协议探测 | 共享目录 |
|---|---|---|---|---|---|---|
| 1 | 192.168.100.164 | Z2Pro-1HKK.local | 是 | Z2 Pro | SMB=开启/可达，WebDAV=开启/可达，SFTP=未确认，HTTP=可达，HTTPS=未确认 |  |
| 2 | 192.168.100.1 | iStoreOS.local | 未确认 |  | SMB=开启/可达，WebDAV=未确认，SFTP=开启/可达，HTTP=可达，HTTPS=可达 |  |
| 3 | 192.168.100.190 |  | 未确认 |  | SMB=未确认，WebDAV=未确认，SFTP=未确认，HTTP=可达，HTTPS=可达 |  |

## /Volumes 挂载检查

| 路径 | 来源 | 状态 | 识别 |
|---|---|---|---|
| /Volumes/Macintosh HD |  | 未确认/不可写 |  |
| /Volumes/Recovery | /dev/disk1s3 | 未确认/不可写 |  |
| /Volumes/com.apple.TimeMachine.localsnapshots |  | 未确认/不可写 |  |

## 推荐连接方式

- 推荐协议：local_mount
- 推荐主机：192.168.100.164
- 推荐端口：445
- 推荐挂载目录：/Volumes/作文AI
- 推荐远端目录：/作文AI
- 原因：发现 SMB 服务。推荐先用 macOS 挂载 SMB 后让应用写本地挂载目录，稳定且不需要在应用进程中处理 NAS 密码。

## .env.production 建议追加块

只建议追加，不要由脚本自动写入生产配置。

```bash
NAS_ENABLED=true
NAS_PROTOCOL=local_mount
NAS_HOST=192.168.100.164
NAS_PORT=445
NAS_USERNAME=
NAS_PASSWORD=
NAS_REMOTE_PATH=/作文AI
NAS_MOUNT_PATH=/Volumes/作文AI
NAS_SYNC_INTERVAL_SECONDS=60
NAS_RETRY_COUNT=5
NAS_TIMEOUT_MS=15000
NAS_VERIFY_TLS=true
```

## 自动扫描说明

- Bonjour _smb._tcp: 发现 2 个服务
- Bonjour _http._tcp: 发现 0 个服务
- Bonjour _https._tcp: 发现 0 个服务
- Bonjour _webdav._tcp: 发现 0 个服务
- Bonjour _sftp-ssh._tcp: 发现 0 个服务
- SSDP: 收到 7 个响应
- TCP: 扫描 253 个地址
- /Volumes: 发现 3 个挂载项
- 共享目录列为空表示当前无凭证扫描无法枚举 SMB/WebDAV 目录；这通常需要 NAS 用户名和密码，并不代表共享目录不存在。

## 下一步还需要哪些信息

- NAS 用户名和密码仍需由你确认后写入本机受保护配置，脚本不会猜测或生成凭证。
- 如果推荐 SMB 本地挂载，需要确认 Mac 是否要长期自动挂载该共享目录。
- 如果只发现 WebDAV/SFTP，需要确认极空间端是否已经开启对应服务以及端口。
- 确认共享目录中是否已有或需要新建 `作文AI`。
