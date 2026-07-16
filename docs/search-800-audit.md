# 800字限制全局审计报告

审计范围：仅搜索与“800字限制 / minimum length / word count”相关的前端、后端、数据库、配置与提示词代码，不做任何修复。

审计结论先行：

- 当前仓库中**没有找到**明确的 `if (wordCount < 800)`、`if (content.length < 800)` 或直接返回“作文字符不足，最低要求800字”的运行时代码。
- 现有源码里，`800` 主要出现在**UI 提示**、**任务元数据**、**测试 fixture** 和 **AI 批改提示词** 中。
- 真正负责作文提交拦截的核心路径是 `resolveEssaySubmitTarget()` / `resolveEssayAssignmentTarget()`，它们当前只检查：空正文、截止时间、重复提交、班级权限、任务是否发布，**没有看到 800 字硬拦截**。
- 因此，当前现象更像是：
  1. 旧构建 / 旧缓存 / 旧分支里还残留了 800 字校验；
  2. 或者某个未命中的前端/后端旧路径仍在运行；
  3. 或者提交失败时返回了某个上游错误，而前端把错误文案包装成了“上传批改失败：...”。

## 1. 搜索关键词

本次使用的关键词：

`800`
`800字`
`800 字`
`minimum`
`minLength`
`min_length`
`wordCount`
`word_count`
`charCount`
`content.length`
`length <`
`length <=`
`requiredLength`
`minWords`
`minWordsCount`
`essayLength`
`作文字符不足`
`作文长度不足`
`最低要求`

## 2. 命中路径总览

### Frontend

#### `client/src/main.jsx`

- `948-953`：根据 `text.replace(/\s+/g, '').length` 计算篇幅，并仅给出 800 / 300 的**文案提示**。
- `964-965`：提交失败时统一包装成 `上传批改失败：${err.message}`。
- `976-978`：页面展示“当前约 X 字”和“AI 会根据篇幅自动分档批改”。

判断：

- 这是**前端展示**，不是硬拦截。
- 这里没有看到 `wordCount < 800` 的提交阻断逻辑。
- 如果最终错误文案是“最低要求800字”，更像是 API 返回后被前端原样包了一层。

### Backend

#### `server/src/routes/essays.js`

- `67-73`：创建作文记录时写入 `word_count`，但没有按 800 字限制拒绝提交。
- `207-223`：文本提交入口先走 `resolveEssaySubmitTarget()`，再创建作文。
- `229-260`：图片/OCR 提交入口先 OCR，再走 `resolveEssaySubmitTarget()`，再创建作文。
- `266-289`：文件提交入口同样没有看到 800 字拦截。
- `333-378`：发布报告，只依赖 AI 批改结果，不做篇幅门槛校验。
- `384-456`：教师批阅流程同样不做 800 字门槛。

判断：

- 这条链路是**真实提交入口**。
- 这里没有直接的 800 字拒绝条件。

#### `server/src/services/essay-access.js`

- `5-10`：`countEssayWords()` 只负责统计篇幅。
- `56-77`：`resolveEssayAssignmentTarget()` 检查任务存在、是否已发布、学生是否属于该班级。
- `79-110`：`resolveEssaySubmitTarget()` 检查正文非空、截止时间、重复提交，**没有 800 字限制**。
- `113-136`：草稿保存只写 `word_count`，不拒绝短文。
- `148-169`：提交状态读取只看 `essays.grading_status / status`，不看 800 字门槛。

判断：

- 这是**最核心的提交校验路径**。
- 从当前源码看，它不会因为 `< 800` 直接拦截。

#### `server/src/services/assignment-access.js`

- `337-346`：任务创建表单接受 `min_words` / `max_words`。
- `361-363`：只校验 `max_words >= min_words`，没有最小 800 字拒绝逻辑。
- `375-404`：任务去重和插入时会把 `min_words` / `max_words` 写入数据库。
- `475-476`：测试 fixture 默认 `min_words: 300, max_words: 0`。
- `597`：Feishu 卡片显示“最低/最高字数”。

判断：

- 这里保存的是**任务元数据**，不是提交拦截点。
- 但如果某个旧路径把 `min_words=800` 当成提交校验阈值，这里就是最可能的来源之一。

#### `server/src/services/essay-grading/grading-service.js`

- `97-106`：批改结果里带出 `wordCount`。

判断：

- 这是批改输出字段，不是提交门槛。

#### `server/src/services/ai-tutor.js`

- `135`：仲裁提示里把作文正文截取到 `800` 字符用于上下文。

判断：

- 这是上下文截断，不是提交拒绝。

#### `server/src/services/prompt.js`

- `58-62`：明确写了“不要因为篇幅不足而拒绝批改，不要返回‘字数不足’之类的失败结论”。
- 同时写了 800+ / 300-800 / 300- 的批改策略。

判断：

- 这段提示词**明确反对**把短文当成失败。
- 它更像批改策略分档，不是拦截器。

### Database

#### `server/src/db/schema.js`

- `138-139`：`assignments.min_words` / `assignments.max_words`
- `170`：`essays.word_count`
- `189`：`submission_drafts.word_count`

#### `server/src/db/init.js`

- `199-200`：初始化/迁移 `assignments.min_words` / `assignments.max_words`
- `220`：初始化 `essays.word_count`
- `248`：初始化草稿表的 `word_count`

判断：

- 数据库只存储字数字段，没有看到直接的 800 字约束。

### Tests / Docs（非运行时，但能说明设计意图）

#### `server/test/student-access.test.js`

- `229-243`：测试名称明确写着“短作文也应进入 AI 批改流程”，即使任务设了 `min_words = 800`。

#### `server/test/assignment-access.test.js`

- `113-126`：验证 `min_words: 800, max_words: 1000` 能正确写入。

#### `server/test/essay-engine-p15.test.js`

- `82-83`：校验 prompt 里确实包含 800/300-800 的分档说明。

判断：

- 这些测试反而说明：**800 是批改分档，不是提交拒绝条件**。

## 3. 重点判断：是否存在 800 字硬拦截

### 目前可确认

1. 前端上传页没有看到 `wordCount < 800` 的阻断代码。
2. 后端提交入口没有看到 `wordCount < 800` 的阻断代码。
3. AI 提示词明确要求**不要因为篇幅不足而拒绝批改**。
4. 数据库里只有 `min_words / max_words` 任务元数据字段，没有硬约束。

### 当前最可能的解释

- 800 字限制更可能来自：
  - 旧构建产物或缓存；
  - 另一个未被当前搜索命中的旧入口；
  - 某个上游错误被前端统一包装成“上传批改失败”；
  - 或者任务创建时把 `min_words=800` 作为展示/提示逻辑，误被其他层当成了提交硬门槛。

## 4. 发现数量

- Frontend: 1
- Backend: 5
- Database: 2
- Config: 0
- Prompt: 1

## 5. 结论

从当前源码审计结果看，**没有找到直接导致“作文字符不足，最低要求800字”这一句的硬拦截实现**。  
现阶段最需要优先回查的是：

1. 生产运行中的实际 bundle 是否还是旧版本；
2. 图片上传 / OCR / 提交错误是否来自另一条旧接口；
3. 前端是否在某个未命中的组件里做了同样的提交前校验；
4. 部署实例是否和当前仓库源码不一致。

如果后续要继续定位，应优先抓：

- 浏览器 Network 请求
- 后端实际返回的 HTTP 状态与响应体
- 运行中的 bundle 源映射
- 任务创建时的 `min_words` 实际值

