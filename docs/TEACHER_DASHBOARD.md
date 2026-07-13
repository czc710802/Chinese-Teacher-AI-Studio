# Teacher Dashboard

Chinese Teacher AI Studio P1.3 教师班级管理中心基于现有 P1.1 作文归档和 P1.2 学生成长档案构建，不复制第二套作文或成长档案正文数据。

## 功能

- `/teacher` 教师工作台首页：班级、学生、作文、队列、DeepSeek、NAS、生产状态概览。
- `/teacher/classes` 班级管理：筛选、查看、归档、进入班级详情。
- `/teacher/classes/:classKey` 班级详情：学生、作文、提交趋势、完成率。
- `/teacher/students` 学生管理：复用 P1.2 studentKey，跳转成长档案。
- `/teacher/essays` 作文管理：筛选归档作文、查看 NAS 相对路径、添加教师点评。
- `/teacher/tasks` 批改任务中心：查看任务状态、重试管理队列。

## 数据来源

- 作文归档：`data/archive-records.json`
- 学生成长档案：`data/student-profiles/**`
- 教师管理索引：`data/teacher-management/*.json`
- 审计日志：`logs/audit.log`

教师管理索引可通过 `npm run classes:rebuild` 从 P1.1/P1.2 历史数据重建。

## classKey

`classKey = schoolYear + grade + className`

示例：`2026_高二_3班`

中文会保留，路径字符会清理。班级归档只修改状态，不删除学生或历史作文。

## API

聚合后台接口：

- `GET /api/teacher/dashboard`
- `GET /api/teacher/classes`
- `POST /api/teacher/classes`
- `GET /api/teacher/classes/:classKey`
- `PATCH /api/teacher/classes/:classKey`
- `POST /api/teacher/classes/:classKey/archive`
- `POST /api/teacher/classes/:classKey/restore`
- `GET /api/teacher/classes/:classKey/statistics`
- `GET /api/teacher/classes/:classKey/students`
- `GET /api/teacher/classes/:classKey/essays`
- `POST /api/teacher/classes/:classKey/import-students`
- `GET /api/teacher/classes/import-template`
- `GET /api/teacher/students`
- `POST /api/teacher/students`
- `GET /api/teacher/students/:studentKey`
- `POST /api/teacher/students/:studentKey/transfer`
- `POST /api/teacher/students/:studentKey/archive`
- `POST /api/teacher/students/:studentKey/restore`
- `GET /api/teacher/students/:studentKey/profile`
- `GET /api/teacher/essays`
- `GET /api/teacher/tasks`
- `POST /api/teacher/tasks/retry-pending`
- `POST /api/teacher/essays/:archiveId/comments`
- `PATCH /api/teacher/essays/:archiveId/comments/:commentId`
- `GET /api/teacher/essays/:archiveId/comments`
- `GET /api/teacher/export`

兼容接口：

- `GET /api/classes/import-template`
- `GET /api/classes/:classKey/statistics`
- `GET /api/classes/:classKey/students`
- `GET /api/classes/:classKey/essays`
- `POST /api/classes/:classKey/import-students`
- `POST /api/classes/:classKey/archive`
- `POST /api/classes/:classKey/restore`

`GET /api/classes` 保持原有返回结构，避免破坏旧教师端页面。

## 学生导入

支持 `.csv` 和 `.xlsx` 文件名。当前实现使用安全的 CSV 内容解析，`.xlsx` 可由后续 P1.4/P1.5 替换为真实表格解析库。

导入字段：

- `studentId`
- `studentName`
- `gender`
- `className`
- `grade`
- `schoolYear`

支持 dry-run、重复学号校验、必填校验、公式注入防护和部分成功。导入不调用 AI。

## 数据导出

`GET /api/teacher/export` 支持：

- `format=csv`
- `format=xlsx`
- `format=markdown`
- `format=docx`
- `format=pdf`

导出文件保存在 `exports/teacher-management/`，返回受控下载 URL，不包含 NAS 认证信息。

## 教师点评

教师点评保存在 `data/teacher-management/teacher-comments.json`，与 AI 原始报告分离：

- 总评
- 分数修订
- 等级修订
- 重点批注
- 训练建议
- 是否公开给学生
- 版本记录

点评不会覆盖 P1.1 的 `report.json` 或 P1.2 的成长档案。

## 权限

当前项目已有 `admin`、`teacher`、`student` 角色基础。P1.3 使用现有 `requireUser` 与角色检查：

- teacher/admin 可访问教师后台；
- student 不进入教师后台；
- P1.2 成长档案仍沿用已有访问控制。

若后续建立完整 teacherId 与班级绑定，可在 P1.4 扩展精细班级权限。

## NAS 文件关联

教师页面只展示 NAS 相对路径、归档状态、队列状态和 `archiveId`。文件下载仍通过后端受控接口，不向前端暴露 WebDAV 用户名、密码、认证头或局域网认证 URL。

## 审计日志

审计日志写入 `logs/audit.log`，记录：

- 创建/修改/归档班级
- 创建/修改/转班/归档学生
- 学生导入
- 教师点评
- 数据导出
- 队列重试
- 历史重建

日志会过滤 Authorization、Cookie、API Key、WebDAV 密码等敏感信息。

## 历史数据重建

```bash
npm run classes:rebuild
```

输出示例：

```text
Classes rebuilt=3
Students linked=126
Essays linked=852
Records skipped=2
Failures=0
```

## Smoke Test

```bash
npm run teacher:smoke
```

期望输出：

```text
Dashboard=true
Classes=true
Students=true
Essays=true
Tasks=true
Statistics=true
ImportDryRun=true
Export=true
NASLink=true
Audit=true
Queue=false
```

## 常见错误

- `班级不存在`：先运行 `npm run classes:rebuild`，或在教师后台创建班级。
- `重复学号`：导入文件中或现有学生索引已有相同 `studentId`。
- `导入文件超过大小限制`：当前限制为 2MB。
- `没有访问教师后台的权限`：当前登录用户不是 teacher/admin。
- `NASLink=false`：历史归档缺少 `nasPath` 或 P1.1 尚未完成归档。

## P1.4 飞书预留字段

P1.3 已在数据模型中预留：

- `student.feishuUserId`
- `class.feishuChatId`
- `essay.feishuSource`
- `teacherComment.feishuSendStatus`

本阶段不会主动发送真实飞书消息。
