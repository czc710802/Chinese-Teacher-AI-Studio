# P1.5 作文 AI 批改引擎对比文档

更新时间：2026-07-13

## 分析范围

本轮按用户要求检查了线上地址 `https://pi.zhenwanyue.icu`。公网 HEAD 与首页 HTML 返回 200，页面入口为当前 Vite 前端；公开 HTML 只包含前端资源引用，不直接暴露 Prompt、JSON 合约或报告模板。因此本对比采用两类证据：

- 公网可确认：域名、前端入口、生产资源、公开状态接口。
- 本地源码可确认：Prompt、JSON 字段、Markdown/HTML/Word/PDF 报告模板、归档字段和飞书签名文件访问。

## 逐项差异

| 项目 | 旧版/线上当前可见状态 | 新版升级前源码状态 | P1.5 升级后目标 |
| --- | --- | --- | --- |
| Prompt 身份 | 公网页面不可见 | “高考作文阅卷专家、高中语文特级教师、写作教学与测量学研究者” | 明确三重身份：高中重点中学语文教师、真实阅卷专家、真实作文指导老师 |
| 输出深度 | 线上可见报告入口存在，但 Prompt 不可从公网确认 | Prompt 有思维教练字段，但报告实际消费字段较少 | 强制输出 11 个深度章节，并保留旧字段兼容 |
| 总体评价 | 不可从公网确认 | 主要依赖 `teacher_overall`，报告中较短 | `overall_evaluation` 不少于 300 字，解释等级、问题、优点、短板 |
| 审题立意 | 不可从公网确认 | 归档报告用维度 comment 或短 `intentAnalysis` | `topic_intent_analysis` 不少于 500 字，覆盖关键词、偏题、价值判断、思想深度和思辨 |
| 结构分析 | 不可从公网确认 | 无独立结构长文分析，常并入维度得分 | `structure_analysis` 不少于 500 字，分析开头、主体、分论点、材料安排、过渡、照应、结尾 |
| 逻辑分析 | 可见前端有“逻辑论证”类展示文本 | Prompt 有逻辑思维能力，但归档/HTML 常只显示短段 | `logic_analysis` 不少于 600 字，分析观点、论据、论证链、因果、概念、漏洞和跳跃 |
| 语言分析 | 可见前端有语言表达类展示 | 归档报告支持短 `languageAnalysis` | `language_analysis` 不少于 500 字，覆盖风格、句式、节奏、修辞、病句、书面语和高级表达 |
| 素材分析 | 不可从公网确认 | 只有短 `materialAnalysis` | `material_analysis` 加 `recommended_materials`，推荐 3-5 个更好素材 |
| 高考评分 | 本地已有基础等级和发展等级 | JSON 有 `gaokao_dimensions`，但报告未充分展示 | 新增 `gaokao_scoring`：内容、表达、发展等级、最终得分、等级、扣分原因 |
| 逐段精修 | 学生端有升格/改写能力 | 有 `paragraph_rewrites` 和 `upgraded_paragraph`，但报告层展示不足 | 新增 `paragraph_refinements`，逐段逐句修改并解释原因 |
| 教师评语 | 可见学生端有教师评语展示 | `teacher_overall` 字段较短，报告层可能降级 | 新增 `teacher_comment` 不少于 600 字，要求重点高中教师真实口吻 |
| 训练任务 | 旧字段 `next_training` | 报告只显示短列表 | 新增 `training_tasks` 4-8 个，覆盖审题、论证、素材、语言、结构、思辨 |
| 成长分析 | P1.2 已有成长档案 | 单篇报告未输出可沉淀的成长分析结构 | 新增 `growth_analysis`，包含优点、短板、趋势、能力雷达和下一步重点 |
| JSON 兼容 | 旧字段由前端和归档使用 | 前端/API 依赖 `total_score`、`strengths`、`problems`、`suggestions` 等 | 不删除旧字段，新增 P1.5 字段，normalize 同时支持 snake_case/camelCase |
| Markdown | 当前短章节为主 | `apps/essay-ai/src/reportService.js` 只渲染少数字段 | 渲染 11 个深度章节 |
| HTML | P1.4 已修复签名报告页 | `server/src/services/file-access.js` 只渲染部分短字段 | 签名报告页展示 P1.5 深度章节，保留 Word/PDF 下载 |
| Word/PDF | P1.1 归档可生成 | 由短 section 生成 | 归档和导出 section 增加 P1.5 深度内容 |
| 飞书兼容 | P1.4 人工验收通过 | 飞书卡片依赖签名 URL 和归档文件 | 不改签名 URL 与卡片入口；只增强文件内容 |
| NAS 兼容 | P1.1 通过 | `report.json` 保留原始 raw | 继续保存完整 raw 和规范化字段，路径不变 |

## 根因判断

当前批改“偏短、模板化”的主要根因不是单一模型问题，而是：

1. Prompt 虽已有教师与思维教练定位，但没有强制 11 个长章节和可发给学生的完整教师报告标准。
2. 模型返回的深层字段即使存在，报告渲染层也只消费了少数字段，导致 HTML、Markdown、Word、PDF 仍显得短。
3. 本地 mock/fallback 和导出模块未同步新字段，开发/异常情况下会退回浅层报告。

## P1.5 实施结论

P1.5 不重写 AI Router、DeepSeek、飞书、NAS、学生成长档案或教师后台。升级集中在：

- `server/src/services/prompt.js`：扩展 Prompt 和 JSON 契约。
- `apps/essay-ai/src/gradingService.js`：规范化 P1.5 字段。
- `apps/essay-ai/src/reportService.js`：升级 Markdown 报告。
- `server/src/services/archive-pipeline.js`：升级 NAS 归档 JSON/Markdown/Word/PDF 内容。
- `server/src/services/file-access.js`：升级飞书签名 HTML 报告页。
- `server/src/services/exporter.js`：升级教师/学生导出的 Word/PDF 内容。

## 仍需人工质量验收

代码层已保证 P1.5 结构和报告链路，但“新平台批改质量是否大于等于旧版”必须使用真实作文样本人工比较。建议后续抽取 10 篇历史作文，分别记录：

- 批改深度
- 教师点评真实感
- 逻辑分析
- 语言分析
- 素材分析
- 训练建议
- 修改建议
- 成长分析

若任一维度弱于旧版，继续迭代 Prompt 的该章节。
