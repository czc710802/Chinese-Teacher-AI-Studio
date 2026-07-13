# NAS 自动接入部署报告

生成时间：2026-07-11T01:29:30+08:00

## 当前发现

- NAS：极空间 Z2 Pro
- Hostname：Z2Pro-1HKK
- IP：192.168.100.164
- SMB：445 可达
- WebDAV：5005/5006 可达
- SFTP：未发现可用端口
- macOS 挂载：已挂载 SMB 共享到 `/Volumes/共享文件`

## WebDAV 结果

- `PROPFIND /`：207，WebDAV 服务在线。
- 根目录返回的共享：`/public/`
- `OPTIONS /public/` 允许：`OPTIONS, PROPFIND, COPY, MOVE, DELETE, LOCK, UNLOCK`
- 当前 WebDAV 不允许 `PUT` / `MKCOL`，无法通过 WebDAV 上传文件或创建目录。
- 因此 WebDAV 暂时只能作为只读发现通道，不能作为本阶段自动同步通道。

## SMB 结果

- SMB 共享枚举成功。
- 可见共享：`共享文件`
- 挂载点：`/Volumes/共享文件`
- 挂载成功，但当前账号对该共享没有写权限。
- 写入测试失败：`mkdir /Volumes/共享文件/.codex_write_probe_*` 返回 `Permission denied`。
- 因此当前不能创建 `/Volumes/共享文件/作文AI`，也不能创建 `uploads/students/teachers/reports/backup`。

## 目录初始化

目标目录树：

```text
/Volumes/共享文件/作文AI/
  uploads/
  students/
  teachers/
  reports/
  backup/
```

当前状态：未创建。阻塞原因不是代码缺失，而是 NAS 共享权限不足。

## 推荐连接方式

优先推荐 SMB 本地挂载：

- 原因：极空间当前 WebDAV 暴露为只读，不支持上传和建目录。
- SMB 已能发现和挂载真实共享。
- 只要给当前 NAS 账号授予 `共享文件` 的读写权限，现有 bootstrap 和同步服务即可继续执行。

## .env.production 建议

不要直接提交真实密码。启用前建议只把以下配置写入生产环境的受保护 env：

```bash
NAS_ENABLED=true
NAS_PROTOCOL=local_mount
NAS_HOST=192.168.100.164
NAS_PORT=445
NAS_SMB_SHARE=共享文件
NAS_USERNAME=
NAS_PASSWORD=
NAS_REMOTE_PATH=/作文AI
NAS_MOUNT_PATH=/Volumes/共享文件
NAS_SYNC_INTERVAL_SECONDS=60
NAS_RETRY_COUNT=5
NAS_TIMEOUT_MS=15000
NAS_VERIFY_TLS=true
```

如果稍后在极空间中启用可写 WebDAV，可改用：

```bash
NAS_ENABLED=true
NAS_PROTOCOL=webdav
NAS_HOST=192.168.100.164
NAS_PORT=5006
NAS_WEBDAV_SCHEME=https
NAS_VERIFY_TLS=false
NAS_USERNAME=
NAS_PASSWORD=
NAS_REMOTE_PATH=/public/作文AI
NAS_SYNC_INTERVAL_SECONDS=60
NAS_RETRY_COUNT=5
NAS_TIMEOUT_MS=15000
```

## 已完成的应用侧能力

- 统一存储层、离线同步队列和 NAS 健康接口已接入。
- 上传作文、OCR、AI 批改、导出文件、学生成长档案均会先落本地，再按队列同步 NAS。
- 批改完成后会自动生成 Markdown、Word、PDF 并加入 NAS 同步队列。
- 飞书支持 `NAS 文件` / `极空间文件` 命令，可查询最近同步文件；带关键词时可读取本地镜像中的文本类文件预览。
- NAS 故障或权限不足不会阻塞作文批改，也不会删除本地数据。

## 当前阻塞

需要在极空间管理端完成至少一项：

1. 给当前 NAS 账号授予 SMB 共享 `共享文件` 的读写权限。
2. 或新建一个可写 SMB 共享 `作文AI`，并授权当前 NAS 账号读写。
3. 或启用可写 WebDAV，使目标共享允许 `PUT` 和 `MKCOL`。

完成权限调整后，重新运行：

```bash
NAS_PROTOCOL=local_mount npm run nas:bootstrap
```

或使用 WebDAV：

```bash
NAS_PROTOCOL=webdav NAS_WEBDAV_SCHEME=https NAS_VERIFY_TLS=false npm run nas:bootstrap
```

## 本次未做

- 未修改 `.env.production`。
- 未把 NAS 密码写入项目文件。
- 未重启生产服务。
- 未迁移数据库。
