# 项目开发日志

格式：日期时间｜版本｜修改内容｜修改原因｜涉及文件。

## 2026-07-13 16:55（Asia/Shanghai）｜11.0.0

- **修改内容：** 完成 P1.5.1 Benchmark 收尾版：Benchmark Runner 增加 `run-history.json` 历史运行记录，`/api/benchmark/status` 返回 `latestRun/recentRuns`；教师后台 Benchmark 页面增加最近运行时间、历史运行记录、重新运行 Benchmark、Word/PDF/Excel/Markdown 一键下载；新增 `npm run benchmark:check`，检查 Benchmark 目录、Provider Adapter、导出、图表、飞书通知开关、Word/PDF 和 WebDAV 写读删；补充测试锁定本机 4000 CORS 与 `fileURLToPath()` 路径处理规则。
- **修改原因：** 按用户 P1.5.1 要求完成 Benchmark 收尾，不进入 P2，并确保中文目录、本地生产访问和 Benchmark 健康检查可稳定运行。
- **验证结果：** `node --test server/test/benchmark-center.test.js` 通过 8/8；`npm run benchmark:test` 输出 `PASS`；提升权限后 `npm run benchmark:check` 输出 `PASS`；`npm run lint` 通过；提升权限后 `npm test` 通过 180/180；`npm run build` 通过；`npm run ai:check`、`zspace:test`、`archive:smoke`、`profiles:smoke`、`teacher:smoke`、`public-files:check`、`feishu:file-smoke`、`feishu:smoke`、`prod:status` 均通过；Playwright 验证 `http://127.0.0.1:4000/teacher/benchmark` 页面正常加载。
- **涉及文件：** `server/src/services/benchmark/benchmark-runner.js`、`server/test/benchmark-center.test.js`、`ops/scripts/benchmark-check.mjs`、`package.json`、`client/src/main.jsx`、`docs/BENCHMARK_CENTER.md`、`docs/CHANGELOG.md`。

## 2026-07-13 16:25（Asia/Shanghai）｜11.0.0

- **修改内容：** 新增 P1.5 AI 批改质量 Benchmark Center：建立独立 `benchmark/` 数据区、统一 `BenchmarkDataset` Schema、历史作文导入、Provider Adapter、批量 Benchmark Runner、旧/新报告对比、0-10 评分、教师复核、图表产物、Markdown/Word/PDF/CSV/Excel/ZIP 导出、Benchmark API、教师后台 `/teacher/benchmark` 页面、`npm run benchmark` 与 `npm run benchmark:test`。同时修复本机生产端口 `4000` 同源 CORS，避免本地生产页面静态资源被误拦截。
- **修改原因：** 按 P1.5 要求先建立作文 AI 质量验证体系，为 DeepSeek、GPT、Gemini 和未来模型提供统一 Benchmark 平台，且不影响生产作文批改、飞书、NAS、学生档案和教师后台。
- **验证结果：** `npm run benchmark:test` 输出 `PASS`；`npm run benchmark -- --mock` 成功，样本 1、成功 1、失败 0、平均分 7.96、提升率 440%；`npm run lint` 通过；提升权限后 `npm test` 通过 178/178；`npm run build` 通过；`npm run zspace:test`、`archive:smoke`、`profiles:smoke`、`teacher:smoke`、`public-files:check`、`feishu:file-smoke`、`feishu:smoke`、`ai:check`、`prod:status` 均通过。
- **涉及文件：** `benchmark/**`、`server/src/services/benchmark/**`、`server/src/routes/benchmark.js`、`server/src/app.js`、`client/src/main.jsx`、`ops/scripts/benchmark.mjs`、`ops/scripts/benchmark-test.mjs`、`server/test/benchmark-center.test.js`、`docs/BENCHMARK_CENTER.md`、`docs/superpowers/plans/2026-07-13-benchmark-center.md`、`docs/CHANGELOG.md`、`package.json`。

## 2026-07-10 15:20（Asia/Shanghai）｜11.0.0

- **修改内容：** 在飞书长连接 `EventDispatcher.register` 的原始 WebSocket 事件入口新增 `Feishu raw event arrived` 日志，记录 `event_type`、`message_id`、`chat_id`、`sender_id`、`message_type`、原始 `content`，并显式标记 `real_event=true`、`mocked_event=false`；业务消息日志同步增加 `real_event/mocked_event` 字段，避免把测试桩 `msg-2`、`chat-3`、`oc-chat-1`、`bad-message-id`、`req-send-fallback` 等误判为真实飞书投递。
- **修改原因：** 按用户要求只做真实事件诊断，不运行自动化测试、不构造 message/chat/API 响应，确认手机消息是否真正进入最原始长连接回调。
- **验证结果：** 未运行 `node --test`、`npm test`、`feishu:test` 或任何 mock；`node --check server/src/integrations/feishu/service.js` 通过；提升权限执行 `npm run feishu:restart` 与 `npm run feishu:status` 后显示 `Long Connection connected`、`Robot Online true`、`SDK 1.70.0`；真实等待期间未收到 `Feishu raw event arrived`。
- **涉及文件：** `server/src/integrations/feishu/service.js`、`docs/CHANGELOG.md`。

## 2026-07-10 12:25（Asia/Shanghai）｜11.0.0

- **修改内容：** 强化飞书真实业务回复链路：`FeishuLongConnectionClient.sendRaw()` 现在使用飞书 SDK 生成鉴权 payload 后通过 `fetch` 直接调用开放平台接口，从而在 `Feishu send HTTP response` 日志中记录请求 URL、HTTP 状态码、`response.code`、`response.msg`、`response.request_id`、`response.data.message_id`、实际 `chat_id` 与原始 `message_id`。`code != 0` 或 HTTP 非 2xx 会进入错误日志并保留 `raw_response`，`replyMessage()` 继续自动回退为向真实收到消息的 `chat_id` 发送新消息。
- **修改原因：** 用户已确认真实消息接收、`command=essay` 与 AI 批改完成，问题集中在业务 reply/send 是否真正到达飞书开放平台；本次不再检查 `FEISHU_TEST_CHAT_ID`，不再使用 `npm run feishu:send-test`，只排查真实业务回复路径。
- **验证结果：** `node --test server/test/v11-essay-ai.test.js server/test/v12-feishu-service.test.js` 通过 16 项；`npm run lint` 通过。
- **涉及文件：** `server/src/integrations/feishu/service.js`、`server/test/v12-feishu-service.test.js`、`docs/CHANGELOG.md`。

## 2026-07-10 12:15（Asia/Shanghai）｜11.0.0

- **修改内容：** 修复飞书长连接回复链路的可观测性与回退逻辑：新增 `FEISHU_REPLY_MODE=reply|send`，默认 `reply` 回复原消息；当 reply 接口返回非 0 或 HTTP 异常时自动回退为向 `chat_id` 直接发送新消息。所有飞书发送都会记录开放平台真实响应字段 `code`、`msg`、`request_id`、`data.message_id`，并记录实际发送到的 `chat_id` 与原始 `message_id`。新增 `npm run feishu:send-test -- oc_xxx`，可按“普通文本 AI 已收到作文。→ Markdown 样式文本 → Card”顺序验证最小发送链路。
- **修改原因：** 解决“飞书消息能接收、AI 批改完成，但聊天窗口没有收到批改结果”时缺少真实飞书发送接口响应的问题，避免业务日志 `reply_type=card/markdown` 被误认为开放平台发送成功。
- **验证结果：** `node --test server/test/v12-feishu-service.test.js server/test/feishu.test.js server/test/v11-essay-ai.test.js` 通过 22 项；`npm run lint` 通过；提升权限后 `npm run feishu:restart` 和 `npm run feishu:status` 显示 `Long Connection connected`、`Robot Online true`、`SDK 1.70.0`。全量 `npm test` 在提升权限后仅剩既有生产数据断言 `510 班 59 !== 60`，与本次飞书回复逻辑无关。
- **涉及文件：** `server/src/integrations/feishu/service.js`、`server/src/integrations/feishu/config.js`、`ops/scripts/feishu-send-test.mjs`、`server/test/v12-feishu-service.test.js`、`server/test/feishu.test.js`、`.env.production.example`、`package.json`、`docs/CHANGELOG.md`。

## 2026-07-09 22:32（Asia/Shanghai）｜11.0.0

- **修改内容：** 修复飞书机器人长连接初始化失败：服务层移除旧 `createLarkChannel` 高层封装，改为直接使用飞书 Node SDK 的 `Client`、`WSClient` 与 `EventDispatcher` 建立长连接；不再依赖旧版 bot identity 查询成功才允许机器人 channel 工作。`feishu:connect` 与 `feishu:status` 新增 `Long Connection connected`、`Robot Online true` 明确验收输出。
- **修改原因：** 解决生产日志中 `could not resolve bot identity via /open-apis/bot/v3/info` 导致飞书机器人无法上线的问题，并避免继续依赖旧接口。
- **涉及文件：** `server/src/integrations/feishu/service.js`、`ops/scripts/feishu-connect.sh`、`ops/scripts/feishu-status.sh`、`server/test/v12-feishu-service.test.js`、`docs/CHANGELOG.md`。

## 2026-07-09 00:00（Asia/Shanghai）｜10.1.0

- **修改内容：** 升级为 V10.1 Production 守护部署版：新增 `ops/launchd` 三个 macOS `launchd` 守护配置，新增安装/卸载/重启/状态/诊断/日志采集/自恢复脚本，新增 GitHub Actions CI、Release 和手动生产部署工作流，新增生产部署与手机端排障文档，根脚本改为可移植的 npm/node 调用，`.gitignore` 补齐 logs 与敏感配置忽略。
- **修改原因：** 解决 `https://pi.zhenwanyue.icu` 手机端和外网反复掉线问题，改成可长期运行、可自恢复、可开机自启、可远程部署的生产架构。
- **涉及文件：** `package.json`、`.npmrc`、`.gitignore`、`monitor.sh`、`ops/launchd/*`、`ops/scripts/*`、`ops/cloudflared/config.example.yml`、`.github/workflows/*`、`docs/PRODUCTION_DEPLOYMENT.md`、`docs/TROUBLESHOOTING_MOBILE_ACCESS.md`、`docs/README.md`、`docs/DEPLOYMENT.md`、`docs/ARCHITECTURE.md`、`docs/CHANGELOG.md`。

## 2026-07-09 00:00（Asia/Shanghai）｜0.1.0

- **修改内容：** 学生端“作文批改结果”页删除“自然段旁批”“查看原图”和“高考阅卷模拟”三个入口，同时移除相关残留组件与状态；AI 批改提示词同步去掉逐自然段旁批的强制要求，避免后端继续生成前端已不再展示的内容。
- **修改原因：** 按用户要求收窄学生端结果页，只保留保留核心批改、升格、思维教练和对比模块，不再展示旁批图和阅卷模拟。
- **涉及文件：** `client/src/main.jsx`、`server/src/services/prompt.js`、`server/test/ui-flow.test.js`、`docs/CHANGELOG.md`。

## 2026-07-04 00:00（Asia/Shanghai）｜0.1.0

- **修改内容：** 学生端个人档案的“思维成长档案”增加基于已批改作文的逐篇详细分析；作文结果页将旁批调整为自然段详细旁批，教师总评改为结合文本的深度指导，斟酌改写增加所有逻辑薄弱段落改写示范，删除五项“多维分析”展示，并取消“练习一/练习二”等巩固练习标签。
- **修改原因：** 按用户要求让学生端不仅看分数，还能看到结合已批改作文的思维成长分析；让作文结果页的点评、改写、亮点和练习更贴合文本与教学目标。
- **涉及文件：** `client/src/main.jsx`、`server/src/services/prompt.js`、`server/src/services/openai.js`、`server/src/services/profile.js`、`server/test/ui-flow.test.js`、`docs/AI批改规则.md`、`docs/学生端功能说明.md`、`docs/CHANGELOG.md`。

## 2026-07-02 12:55（Asia/Shanghai）｜0.1.0

- **修改内容：** 教师端“发布任务管理”去重：后端列表按班级、题目、材料、类型、满分和截止时间识别完全相同任务，展示时只保留一条，并优先保留已有学生提交的任务；重复发布完全相同任务时复用已有任务，不再插入新行；前端发布按钮增加“发布中”禁用状态，防止重复点击。
- **修改原因：** 按用户要求删除重复任务，让每次发布在“发布任务管理”中按时间顺序只展示一个任务。
- **数据处理：** 已备份正式库到 `data/backups/essay-review-before-assignment-dedupe-2026-07-02T12-55.sqlite`；删除空重复任务 `assignment_id=20`，保留已有 1 篇作文的 `assignment_id=19`。
- **涉及文件：** `server/src/services/assignment-access.js`、`server/test/assignment-access.test.js`、`server/test/ui-flow.test.js`、`client/src/main.jsx`、`docs/教师端功能说明.md`、`docs/CHANGELOG.md`。

## 2026-07-02 12:36（Asia/Shanghai）｜0.1.0

- **修改内容：** 在登录页新增“公网演示入口”，显示可复制和可直接打开的公网地址；教师首页恢复并挂载同一公网演示入口，用于手机端访问、课堂展示和线上演示；公网入口继续由 `/api/public-access` 读取 Cloudflare Tunnel 与 `PUBLIC_APP_ORIGIN` 配置。
- **修改原因：** 按用户要求让 `https://pi.zhenwanyue.icu` 更容易在外网展示和演示，避免只知道域名但页面内没有可见入口。
- **涉及文件：** `client/src/main.jsx`、`client/src/styles/app.css`、`server/test/ui-flow.test.js`、`docs/教师端功能说明.md`、`docs/学生端功能说明.md`、`docs/ARCHITECTURE.md`、`docs/CHANGELOG.md`。

## 2026-06-30 23:10（Asia/Shanghai）｜0.1.0

- **修改内容：** 新增“思维教练（Thinking Coach）”增强：AI 批改提示词和离线兜底样例增加逻辑思维能力 30 分、思维深度星级、思维提升建议、苏格拉底式追问和深度修改闭环；学生端批改结果页新增思维教练模块；学生档案新增思维成长档案；教师端首页恢复并升级班级思维分析，统计最薄弱能力、能力均值和教学建议。
- **修改原因：** 按用户要求将 APP 定位从传统作文批改工具升级为高中作文思维训练系统，让学生不仅知道哪里错，还能理解为什么错、如何追问、如何深度修改到一类文水平。
- **涉及文件：** `client/src/main.jsx`、`client/src/styles/app.css`、`server/src/services/prompt.js`、`server/src/services/openai.js`、`server/src/services/profile.js`、`server/src/routes/analytics.js`、`server/test/ui-flow.test.js`、`server/test/thinking-analytics.test.js`、`docs/superpowers/specs/2026-06-30-thinking-coach-design.md`、`docs/superpowers/plans/2026-06-30-thinking-coach.md`、`docs/AI批改规则.md`、`docs/作文评分标准.md`、`docs/学生端功能说明.md`、`docs/教师端功能说明.md`、`docs/CHANGELOG.md`。

## 2026-06-30 22:35（Asia/Shanghai）｜0.1.0

- **修改内容：** 删除教师端和学生端的邀请码入口与展示：学生首页不再显示“班级邀请码/加入”，教师端创建班级和班级卡片不再显示邀请码；后端移除 `/api/classes/join`，创建班级不再生成或依赖邀请码；数据库初始化增加旧库兼容迁移，将历史必填邀请码列放宽为可空。
- **修改原因：** 按用户要求去掉师生端邀请码选项及相关联项目，改为由教师在班级管理中直接添加或批量导入学生名单。
- **涉及文件：** `client/src/main.jsx`、`server/src/routes/classes.js`、`server/src/db/schema.js`、`server/src/db/init.js`、`server/test/ui-flow.test.js`、`server/test/student-access.test.js`、`server/test/assignment-access.test.js`、`docs/API.md`、`docs/学生端功能说明.md`、`docs/项目方案.md`、`docs/CHANGELOG.md`。

## 2026-06-28 17:49（Asia/Shanghai）｜0.1.0

- **修改内容：** 修复教师端和学生端单篇作文导出只显示学生原文、缺少 AI 批改后整篇升格文章的问题；单篇作文导出现在读取最新 `ai_upgrade_records.upgraded_text`，没有升格记录时使用 AI 批改结果中的 `polished_full_text` 作为兜底；批量导出也增加同样兜底。
- **修改原因：** 按用户要求，让教师端和学生端作文批改后的导出文本都包含 AI 批改后的升格文章全文。
- **涉及文件：** `server/src/services/exporter.js`、`server/test/ui-flow.test.js`、`docs/教师端功能说明.md`、`docs/学生端功能说明.md`、`docs/CHANGELOG.md`。

## 2026-06-28 00:40（Asia/Shanghai）｜0.1.0

- **修改内容：** 教师端“班级作业”的导出内容新增学生端“批改结果”中生成的整篇升格文；后端导出查询会读取每篇作文最新一条 `ai_upgrade_records.upgraded_text`，无生成记录时显示暂无升格文。
- **修改原因：** 按用户要求，让教师导出的班级作业材料包含学生端可复制查看的升格文章，便于统一查看和留档。
- **涉及文件：** `server/src/services/exporter.js`、`server/test/ui-flow.test.js`、`docs/教师端功能说明.md`、`docs/CHANGELOG.md`。

## 2026-06-28 00:20（Asia/Shanghai）｜0.1.0

- **修改内容：** 作文批改结果页的“建议”升级为问题诊断、逻辑分析、修改步骤、示例方向四段式指导；“多维分析”升级为现状判断、深层原因、提升路径三段式分析；AI 批改提示词和本地兜底批改示例同步改为结构化深度输出。
- **修改原因：** 按用户要求让批改结果更详细、更有深度，并能提供逻辑分析和可执行修改指导。
- **涉及文件：** `client/src/main.jsx`、`client/src/styles/app.css`、`server/src/services/prompt.js`、`server/src/services/openai.js`、`server/test/ui-flow.test.js`、`docs/AI批改规则.md`、`docs/学生端功能说明.md`、`docs/CHANGELOG.md`。

## 2026-06-28 00:00（Asia/Shanghai）｜0.1.0

- **修改内容：** 教师首页新增修改密码入口；学生端“原文润色提升对比”改为在原文中内联展示差异，原文黑色、新增蓝色、删除红色；AI 批改和整篇升格提示词改为要求深度润色、多处实质改写和重构薄弱段落。
- **修改原因：** 按用户要求补齐教师端账号维护能力，并让学生端润色对比不再拆成额外新增/删改段落，同时提高升格文章修改深度。
- **涉及文件：** `client/src/main.jsx`、`client/src/styles/app.css`、`server/src/services/prompt.js`、`server/src/services/ai-tutor.js`、`server/src/services/openai.js`、`server/test/ui-flow.test.js`、`docs/教师端功能说明.md`、`docs/学生端功能说明.md`、`docs/CHANGELOG.md`。

## 2026-06-27 21:12（Asia/Shanghai）｜0.1.0

- **修改内容：** 将学生端“拍照上传”改为图片直传批改流程；学生选择拍照或图片后直接提交到后端，后端自动识别图片文字、创建作文、保存图片记录并触发 AI 批改；移除“识别文字后确认再提交”的前端路径。
- **修改原因：** 按用户要求取消手动 OCR 确认流程，让照片/图片上传后由 AI 自动完成识别和批改。
- **涉及文件：** `client/src/main.jsx`、`client/src/styles/app.css`、`server/src/routes/essays.js`、`server/src/services/essay-access.js`、`server/test/ui-flow.test.js`、`docs/学生端功能说明.md`、`docs/CHANGELOG.md`。

## 2026-06-27 20:58（Asia/Shanghai）｜0.1.0

- **修改内容：** 修复学生端“提交并批改”失败时无提示的问题；提交页增加空正文校验、提交中状态、失败提示和防重复点击；后端提交接口在写入前校验作文任务是否存在、学生是否属于该任务班级、正文是否为空，避免无效任务直接触发数据库外键错误。
- **修改原因：** 用户反馈学生端粘贴文字无法上传并批改，需要让有效粘贴提交可用，并让错误路径给出可见原因。
- **涉及文件：** `client/src/main.jsx`、`server/src/routes/essays.js`、`server/src/services/essay-access.js`、`server/test/student-access.test.js`、`server/test/ui-flow.test.js`、`docs/CHANGELOG.md`。

## 2026-06-27 20:35（Asia/Shanghai）｜0.1.0

- **修改内容：** 将教师端批改中心改为“班级作业 / 批改记录”双入口；“班级作业”按班级和时间汇总任务完成情况，显示已提交、未提交、已批改篇数，支持前往批改和任务作文导出；“批改记录”只展示已批改作文，支持点击查看和批量导出。
- **修改原因：** 按用户手机截图调整教师端批改工作流，让任务完成情况和已批改记录分开管理。
- **涉及文件：** `client/src/main.jsx`、`client/src/styles/app.css`、`server/src/services/exporter.js`、`server/src/routes/reports.js`、`server/test/ui-flow.test.js`、`docs/教师端功能说明.md`、`docs/CHANGELOG.md`。

## 2026-06-22 00:00（Asia/Shanghai）｜0.1.0

- **修改内容：** 将服务端端口配置由 `5173` 修正为 `4000`，并完成 390×844 手机视口的教师、学生登录复测。
- **修改原因：** 消除前后端开发端口冲突，恢复登录 API 连通性。
- **涉及文件：** `.env.local`、`docs/TESTING.md`、`docs/TASKS.md`、`docs/CHANGELOG.md`。

## 2026-06-22 00:00（Asia/Shanghai）｜0.1.0

- **修改内容：** 完成 390×844 手机视口登录测试，记录登录失败及端口配置冲突。
- **修改原因：** 验证移动端登录可用性，并为后续修复和复测保留可恢复的测试证据。
- **涉及文件：** `docs/TESTING.md`、`docs/TASKS.md`、`docs/CHANGELOG.md`。

## 2026-06-22 00:00（Asia/Shanghai）｜0.1.0

- **修改内容：** 新增作文评分标准、题库、素材库、学生档案、教师端、学生端与 AI 批改规则文档，并更新文档索引和任务清单。
- **修改原因：** 将教学业务规则和师生端功能说明持久化为项目可信来源。
- **涉及文件：** `docs/作文评分标准.md`、`docs/高考作文题库.md`、`docs/作文素材库.md`、`docs/学生档案设计.md`、`docs/教师端功能说明.md`、`docs/学生端功能说明.md`、`docs/AI批改规则.md`、`docs/README.md`、`docs/TASKS.md`、`docs/CHANGELOG.md`。

## 2026-06-22 00:00（Asia/Shanghai）｜0.1.0

- **修改内容：** 建立统一 Markdown 文档体系，并确认 `docs/` 为项目唯一可信来源。
- **修改原因：** 落实项目文档持久化、需求先文档后开发和重要操作留痕规则。
- **涉及文件：** `docs/README.md`、`docs/PRD.md`、`docs/ARCHITECTURE.md`、`docs/DATABASE.md`、`docs/API.md`、`docs/TASKS.md`、`docs/DEPLOYMENT.md`、`docs/TESTING.md`、`docs/MEETING_NOTES.md`、`docs/CHANGELOG.md`。
