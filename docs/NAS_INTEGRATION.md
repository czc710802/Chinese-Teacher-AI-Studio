# 极空间 Z2 Pro NAS 存储与自动备份

## 当前存储审计

- 数据库：`data/essay-review.sqlite`，使用 Node `node:sqlite` 的 SQLite 文件库；本阶段不迁移数据库。
- 主作文上传：`server/src/routes/essays.js` 使用 `multer` 写入 `server/uploads`，图片路径记录在 `essay_images.file_path`。
- OCR 与批改结果：OCR 文本记录在 `essay_images.ocr_text`；AI 批改记录写入 `ai_reviews.raw_json` 等字段；学生成长档案写入 `student_profiles`。
- 导出文件：`server/src/services/exporter.js` 写入 `server/exports`，并在 `export_records.file_path` 记录本地路径。
- 独立 Essay AI 入口：`apps/essay-ai` 使用 `server/uploads/essay-ai` 与 `data/essay-ai/records.json`。
- 生产启动：`start-production.sh` 启动 4000 端口 Express 和 Cloudflare Tunnel，公网入口为 `https://pi.zhenwanyue.icu`。本次没有自动重启生产服务。

## 本次新增文件

- `server/src/storage/storage-service.js`
- `server/src/storage/local-storage.js`
- `server/src/storage/nas-storage.js`
- `server/src/storage/sync-queue.js`
- `server/src/routes/storage.js`
- `server/src/services/storage-artifacts.js`
- `ops/scripts/test-nas-connection.mjs`
- `ops/scripts/sync-nas-now.mjs`
- `ops/scripts/backup-to-nas.sh`
- `.env.nas.example`

## NAS 目录结构

程序会在 NAS 根目录下使用以下结构：

```text
作文AI/
  classes/
    班级ID-安全班级名/
      students/
        学生ID-安全学生名/
          年份/
            作文ID/
              original/
              ocr/
              review/
              export/
              revisions/
  resources/
  backups/
    database/
    uploads/
    config/
  failed-sync/
  logs/
```

班级名、学生名和文件名会转换为 ASCII 安全片段，原始中文名称保存在同名 `.metadata.json` 中。

## 启用步骤

1. 在极空间创建共享目录，例如 `作文AI`。
2. 优先在 Mac 上用 SMB 挂载到 `/Volumes/作文AI`。
3. 复制 `.env.nas.example` 为 `.env.nas` 或把变量合入 `.env.production`，只填真实参数，不提交凭证。
4. 设置 `NAS_ENABLED=true`。
5. 运行 `npm run nas:test` 做写入、下载、SHA-256 校验和删除测试。
6. 运行 `npm run nas:sync` 手动补传队列。

## 管理接口

接口均需要登录用户且当前系统用 `teacher` 角色作为存储管理员操作员：

- `GET /api/storage/health`
- `GET /api/storage/status`
- `GET /api/storage/sync-queue`
- `POST /api/storage/test`
- `POST /api/storage/sync-now`
- `POST /api/storage/retry-failed`

接口不会返回 `NAS_PASSWORD`、Token 或完整凭证。

## 回滚步骤

1. 设置 `NAS_ENABLED=false`。
2. 重启后端服务或下次启动生效。
3. 若要移除代码改动，可从 `backups/nas-phase1-20260710-prechange/` 恢复本次修改前的源码副本。
4. 不需要回滚数据库；本阶段未迁移数据库，只新增本地 JSON 同步队列 `data/nas-sync-queue.json`。

## 极空间端权限清单

- 创建共享目录：`作文AI`。
- 给专用 NAS 用户授予该共享目录读写权限。
- 不要把 NAS WebDAV/SFTP/SMB 服务开放到公网。
- 如果用 SMB，本机挂载目录需与 `NAS_MOUNT_PATH` 一致。
- 如果用 WebDAV/SFTP，需要提供局域网地址、端口、用户名和密码；当前代码不会猜测地址或凭证。

## 仍需提供的真实参数

- 极空间局域网 IP。
- 连接方式：SMB 本地挂载、WebDAV 或 SFTP。
- 共享文件夹名称。
- NAS 用户名。
- Mac 上是否已挂载。
- 挂载目录。
