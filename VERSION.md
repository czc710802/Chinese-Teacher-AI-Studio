# VERSION

## Chinese Teacher AI Studio 阶段记录

### P1.1 作文自动归档中心

- 作文批改完成后自动生成并归档原文、OCR 文本、批改 JSON、Markdown、Word、PDF 和 metadata。
- 归档路径使用极空间 NAS WebDAV，并支持 NAS 离线时进入本地队列。
- 新增归档 API、归档 smoke test 和 `logs/archive.log`。

### P1.2 学生成长档案中心

- 基于 P1.1 归档数据生成学生长期成长档案。
- 建立 `studentKey`、分数趋势、能力趋势、高频问题、训练计划和成长报告。
- 支持历史数据重建、增量更新、NAS 同步和队列重试。

### P1.3 教师班级管理中心

- 建立教师后台、班级管理、学生管理、作文管理、批改任务中心和教师点评。
- 复用 P1.1 归档与 P1.2 学生成长档案，不复制第二套核心数据。
- 增加班级统计、导入导出、审计日志和 `teacher:smoke` 验收。

### P1.4 飞书双向互动与文件可访问性

- 修复飞书中完整报告、Word、PDF 无法打开的问题。
- 建立公网签名下载链接和受控文件访问接口。
- 飞书结果卡片使用 `https://pi.zhenwanyue.icu`，不暴露内网 IP、WebDAV 地址、账号或密码。
- 手机飞书和电脑飞书人工验收均通过。

### P1.5 作文 AI 批改引擎升级

- 暂停 P2，优先提升作文批改质量。
- 升级 Prompt、报告结构、教师点评风格、逻辑分析、素材分析、逐段精修、训练任务和成长分析。
- 保持 DeepSeek、飞书、NAS、成长档案、教师后台、HTML/Markdown/Word/PDF 报告兼容。

### P1.5 Benchmark Center

- 建立独立 Benchmark 模块，支持历史作文导入、批量重批、旧新报告对比、评分、导出和教师后台入口。
- 新增 Provider Adapter、配置中心、统计报告、图表、断点恢复、测试和 smoke 流程。
- Benchmark 数据统一存放于 `benchmark/`。

### P1.5.1 Benchmark 收尾

- 修复 Benchmark 页面本地/生产静态资源 CORS 问题。
- 将文件 URL 路径处理统一为 `fileURLToPath()`，兼容中文目录与跨平台运行。
- Benchmark 页面增加统计卡片、历史运行记录、一键下载报告和重新运行按钮。
- 新增 `npm run benchmark:check`，检查 Benchmark 目录、Provider Adapter、导出、图表、飞书通知、Word/PDF 和 WebDAV 写入。

### P1.5.2 Git 仓库恢复与版本管理

- 当前目标：确认项目没有 `.git` 后恢复 Git 基础设施。
- 初始化仓库，补齐 `.gitignore`、README 和阶段版本记录。
- 首次提交信息：`chore: initialize Chinese Teacher AI Studio repository`。
