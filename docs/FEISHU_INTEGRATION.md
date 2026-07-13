# 飞书双向互动与文件访问说明

## 当前流程

飞书收到作文后，服务端识别文本或附件，调用 DeepSeek 批改，随后尝试把结果归档到极空间 NAS。归档成功并验证文件可读后，机器人发送交互卡片，卡片按钮使用公网签名链接打开完整报告、下载 Word 和下载 PDF。

## 文件下载架构

飞书不能直接访问 NAS WebDAV、内网 IP、Mac 本地路径或 `file://`。所有文件都通过公网域名：

```text
https://pi.zhenwanyue.icu
```

受控接口：

```text
GET /api/files/:archiveId/:fileType?token=...
GET /report/:archiveId?token=...
POST /api/files/:archiveId/regenerate-link
POST /api/teacher/essays/:archiveId/send-to-feishu
```

`fileType` 白名单：

```text
report
markdown
json
docx
pdf
original
```

后端根据 `archiveId` 查询 P1.1 归档索引，从 NAS 读取对应文件，再设置正确 MIME 与 `Content-Disposition`。前端和飞书永远不会拿到 WebDAV URL、WebDAV 用户名、密码或 NAS 内部路径。

## 签名链接

飞书内置浏览器没有网页登录 Cookie，因此报告和文件下载使用短期签名链接。

必需环境变量：

```text
PUBLIC_APP_ORIGIN=https://pi.zhenwanyue.icu
FEISHU_FILE_LINK_SECRET=
FEISHU_FILE_LINK_TTL_SECONDS=86400
FEISHU_FILE_UPLOAD_ENABLED=false
```

`FEISHU_FILE_LINK_SECRET` 只允许写在服务端 `.env.production`，不得提交到 Git、README 或聊天记录。默认有效期 24 小时。过期链接返回 `410`，签名错误返回 `403`。

## PDF 与 DOCX

MIME：

```text
PDF  application/pdf
DOCX application/vnd.openxmlformats-officedocument.wordprocessingml.document
Markdown text/markdown; charset=utf-8
JSON application/json; charset=utf-8
TXT text/plain; charset=utf-8
```

中文文件名使用 `filename*` RFC 5987 编码。PDF 支持飞书内置浏览器预览；DOCX 通常表现为下载。

## 飞书文件上传

当前生产默认：

```text
FEISHU_FILE_UPLOAD_ENABLED=false
```

也就是优先使用公网签名链接。后续如果飞书应用具备文件上传权限，可以开启上传策略；上传失败时必须自动回退到签名链接，不允许伪造 file_key 成功。

## 身份绑定

P1.4 复用 P1.3 预留字段：

- `feishuUserId` 到 `studentKey`
- `feishuUserId` 到 `teacherId`
- `chatId` 到 `classKey`

未绑定用户提交作文时，系统仍可完成批改与文件归档，但成长档案和班级统计只能按现有可识别信息增量关联。正式班级权限绑定在 P1.4 后续迭代继续完善。

## 作文作业发布闭环

教师网页端仍从 `/teacher` 创建作文作业，不需要在飞书里重复录入题目。作业详情/发布任务管理中可完成：

- 绑定平台班级到飞书班级群。
- 预览飞书作业卡片。
- 一键发送作业到飞书群。
- 标记撤回或重新发布。
- 提醒未提交学生。

作业卡片按钮统一使用公网域名：

```text
https://pi.zhenwanyue.icu/submit/:assignmentId
```

卡片包含作文题目、材料摘要、写作要求、最低/最高字数、截止时间、班级、当前已交和未交人数。按钮包括：

- 查看作业
- 立即提交
- 查看提交状态

新增或完善的服务端接口：

```text
GET  /api/classes/:id/feishu-binding
POST /api/classes/:id/feishu-binding
POST /api/classes/:id/students/:studentId/feishu-binding
GET  /api/assignments/:assignmentId/share/feishu/preview
POST /api/assignments/:assignmentId/share/feishu
POST /api/assignments/:assignmentId/share/feishu/revoke
POST /api/assignments/:assignmentId/remind-missing
GET  /api/assignments/:assignmentId/my-status
POST /api/essays/:id/publish-report
GET  /api/reports/essay/:essayId/:format/download
```

新增数据表：

- `feishu_class_bindings`：班级到飞书群的绑定。
- `feishu_student_bindings`：学生到飞书 openId/unionId 的绑定。
- `feishu_assignment_messages`：作业发布、未交提醒等飞书消息幂等记录。

学生提交页 `/submit/:assignmentId` 支持文本、草稿、图片/HEIC 拍照入口、Word/PDF/文本文件入口和提交状态展示。PDF 文本提取依赖服务器存在 `pdftotext`；如果不可用，页面会提示改用 `.docx` 或拍照 OCR。

教师审核后可通过 `POST /api/essays/:id/publish-report` 将报告状态标记为已发布。若学生已绑定飞书身份，系统会发送摘要卡片；完整报告和 PDF 下载使用公网链接，不把长报告正文直接塞进飞书消息。

## Cloudflare 检查

`tools/cloudflared-production.yml` 应把：

```text
pi.zhenwanyue.icu -> http://127.0.0.1:4000
```

转发到生产服务。检查命令：

```bash
npm run prod:status
npm run public-files:check
```

`public-files:check` 应看到：

```text
Public origin reachable=true
Report page=true
PDF download=true
DOCX download=true
Range support=true
Signed URL=true
Expired URL=410
Invalid signature=403
```

## 飞书文件 Smoke

```bash
npm run feishu:file-smoke
```

期望：

```text
Report URL HTTP=200
DOCX URL HTTP=200
PDF URL HTTP=200
PDF Content-Type=true
DOCX Content-Type=true
Signed URL=true
Expired URL=410
Invalid URL=403
No Internal IP=true
No WebDAV Credential=true
```

本地飞书链路 smoke：

```bash
npm run feishu:smoke
```

该命令不会发送真实飞书消息，只验证归档、签名链接和卡片结构。

## 常见错误

`401`：访问了旧的网页登录下载接口，例如 `/api/archive/detail/:id?file=...`，飞书浏览器没有登录头。

`403`：签名错误、token 被篡改、archiveId 或 fileType 不匹配。

`404`：归档记录不存在，或文件尚未生成/尚未上传 NAS。

`410`：签名链接已过期，需要重新生成。

`5xx`：生产服务、NAS 或 Cloudflare 转发异常。

链接过期：重新生成签名链接，不要复用旧卡片。

文件未生成：不要显示对应按钮；先确认 P1.1 归档完成。

飞书权限不足：文件上传禁用或无权限时，使用签名链接回退。

Cloudflare 路由错误：检查 `npm run prod:status` 中 public health 与 tunnel service。

中文文件名问题：确认响应头包含 `filename*=UTF-8''...`。

## 真实验收

1. 重启生产服务：`npm run prod:restart`
2. 检查状态：`npm run prod:status`
3. 运行：`npm run public-files:check`
4. 运行：`npm run feishu:file-smoke`
5. 运行：`npm run feishu:smoke`
6. 学生在飞书发送一篇测试作文。
7. 确认收到“已收到/正在处理”或最终卡片。
8. 点击“查看完整报告”，应打开 `https://pi.zhenwanyue.icu/report/...`。
9. 点击 Word，能下载 DOCX。
10. 点击 PDF，能预览或下载 PDF。
11. 手机飞书与桌面飞书各测一次。
12. 链接不得包含内网 IP、WebDAV 地址、用户名、密码、Cookie 或 Authorization。

## 2026-07-13 P1.4 人工验收记录

已在真实飞书环境完成手机端与电脑端验收：

- 手机飞书“查看完整报告”成功。
- 手机飞书 Word 下载成功。
- 手机飞书 PDF 打开或下载成功。
- 电脑飞书“查看完整报告”成功。
- 电脑飞书 Word 下载成功。
- 电脑飞书 PDF 打开或下载成功。
- 所有链接均使用 `https://pi.zhenwanyue.icu`。
- 链接未暴露内网 IP、WebDAV 地址、WebDAV 用户名或密码。
- NAS 归档、学生成长档案、班级统计均保持正常。

结论：P1.4 文件可访问性人工验收通过。
