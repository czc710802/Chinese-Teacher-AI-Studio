# 极空间 NAS WebDAV 接入说明

## 地址与端口

开发阶段使用局域网 HTTP WebDAV：

```bash
ZSPACE_WEBDAV_URL=http://192.168.100.164:5005
```

后续切换 HTTPS WebDAV：

```bash
ZSPACE_WEBDAV_URL=https://192.168.100.164:5006
```

目标根目录：

```bash
ZSPACE_ROOT_DIR="Chinese Teacher AI Studio"
```

## 环境变量

复制 `.env.example` 中的 ZSpace 配置到本机真实环境文件，例如 `.env.local` 或 `.env.production`，再填写极空间 WebDAV 账号：

```bash
ZSPACE_WEBDAV_URL=http://192.168.100.164:5005
ZSPACE_WEBDAV_USERNAME=你的WebDAV用户名
ZSPACE_WEBDAV_PASSWORD=你的WebDAV密码
ZSPACE_ROOT_DIR="Chinese Teacher AI Studio"
ZSPACE_ENABLED=true
ZSPACE_ALLOW_SELF_SIGNED=false
ZSPACE_TIMEOUT_MS=15000
ZSPACE_AUTO_SYNC=true
ZSPACE_SYNC_INTERVAL_MS=60000
```

不要把真实密码写入 README、Git 提交、日志或截图。`.env`、`.env.local`、`.env.production` 已在 `.gitignore` 中忽略。

## Mac 局域网测试

先确认 Mac 能访问 NAS：

```bash
nc -vz 192.168.100.164 5005
```

再运行项目内读写测试：

```bash
npm run zspace:test
```

测试会在 `11_系统日志/connection-tests` 中创建临时文本文件，随后读取核对内容并删除。只有创建、读取、删除全部成功，才会返回 `writable=true`。

## 初始化目录

运行：

```bash
npm run zspace:init
```

脚本会在 `Chinese Teacher AI Studio` 下幂等创建以下目录：

```text
01_作文中心
01_作文中心/原文
01_作文中心/OCR文本
01_作文中心/批改报告
01_作文中心/PDF
01_作文中心/Word
02_学生档案
03_教师备课
04_PPT中心
05_试卷中心
06_作文素材库
07_AI知识库
08_OCR识别
09_AI批改报告
10_模板中心
11_系统日志
11_系统日志/connection-tests
99_Backup
```

已存在目录不会报错。

## 状态接口

本机或教师账号可访问：

```text
GET /api/admin/storage/zspace/status
```

返回示例：

```json
{
  "enabled": true,
  "connected": true,
  "baseUrl": "http://192.168.100.164:5005",
  "rootDirectory": "Chinese Teacher AI Studio",
  "writable": true,
  "latencyMs": 123,
  "checkedAt": "2026-07-11T00:00:00.000Z",
  "error": null
}
```

接口不会返回密码、认证头、Cookie 或 Token。

## 作文归档位置

作文批改成功后，系统会后台归档到正式数据中心目录：

```text
01_作文中心/
  原文/
  OCR文本/
  批改报告/
  PDF/
  Word/
```

每位学生会自动建立：

```text
02_学生档案/
  学号_姓名/
    历次作文/
    AI批改记录/
    分数变化/
    教师点评/
```

OCR 缓存额外保存到：

```text
08_OCR识别/
```

教师备课、PPT、试卷和系统日志使用固定目录：`03_教师备课/`、`04_PPT中心/`、`05_试卷中心/`、`11_系统日志/`。

目录名会移除斜杠、反斜杠和非法路径字符，并保留正常中文。空字段使用 `未填写`。

## NAS 不可用时

NAS 不可用不会导致作文批改失败。批改结果仍按原流程返回，待上传文件会写入：

```text
data/storage-queue/
```

服务启动后会按 `ZSPACE_SYNC_INTERVAL_MS` 周期自动调用 `retryPendingUploads()` 重试上传；也可以在维护脚本中手动调用该方法。

## 常见错误

`401`：用户名或密码错误。重新检查 `ZSPACE_WEBDAV_USERNAME` 和 `ZSPACE_WEBDAV_PASSWORD`。

`403`：账号没有共享目录或 WebDAV 写入权限。请在极空间后台确认该账号对目标目录有读写权限。

`404`：根目录路径错误。确认 `ZSPACE_ROOT_DIR="Chinese Teacher AI Studio"` 是否存在或是否允许自动创建。若真实目录位于某个磁盘根下，请使用自动探测得到的完整路径。

`ECONNREFUSED`：WebDAV 服务未开启、端口错误或 NAS 不在当前网络。

`ETIMEDOUT`：网络不可达或防火墙阻断。先用 `nc -vz 192.168.100.164 5005` 验证端口。

自签名 HTTPS 证书错误：切换到 5006 时，如极空间使用自签名证书，可仅针对 ZSpace 客户端设置：

```bash
ZSPACE_WEBDAV_URL=https://192.168.100.164:5006
ZSPACE_ALLOW_SELF_SIGNED=true
```

不要设置全局 `NODE_TLS_REJECT_UNAUTHORIZED=0`。
