# P1.5 AI 批改质量 Benchmark Center

## 定位

Benchmark Center 是独立的作文 AI 批改质量验证模块。它只读或导入历史样本，输出对比、评分、图表和导出报告，不改变现有作文批改、飞书、NAS、学生成长档案和教师后台主流程。

## 目录

```text
benchmark/
  history/   历史作文与旧平台报告
  reports/   单篇新报告、compare.json、teacher-review.json
  result/    summary.json、model-comparison.json、retry-queue.json
  charts/    雷达图、柱状图、趋势图、饼图、模型比较图
  export/    Benchmark_Report.md/docx/pdf/csv/xlsx/zip
  logs/      benchmark.log
  config/    benchmark.config.ts、benchmark-dataset.schema.json
```

## 系统架构图

```text
Benchmark Center
  |
  |-- Dataset Manager
  |     |-- JSON / TXT / Markdown / DOCX / PDF import hooks
  |     |-- anonymous authorId
  |
  |-- Provider Adapter
  |     |-- MockProvider
  |     |-- DeepSeekProvider
  |     |-- OpenAIProvider
  |     |-- GeminiProvider
  |     |-- CustomProvider
  |
  |-- Benchmark Runner
  |     |-- batch grading
  |     |-- resume / retry queue
  |     |-- compare and scoring
  |
  |-- Export
  |     |-- Markdown / Word / PDF / CSV / Excel / ZIP
  |
  |-- Teacher Review
  |     |-- AI Score
  |     |-- Teacher Score
  |     |-- Final Score
  |
  |-- Teacher Dashboard
```

## 数据流程图

```text
benchmark/history/*.json
  -> Provider Adapter
  -> new_report.json
  -> compare.json
  -> benchmark-score.json
  -> charts/*
  -> Benchmark_Report.*
  -> optional Feishu notification
```

## Provider Adapter 架构

Benchmark 主流程不直接调用 DeepSeek、OpenAI 或 Gemini。所有模型必须实现统一适配层：

```text
createProviderAdapter(name)
  -> isConfigured()
  -> gradeEssay({ dataset, taskType })
  -> { provider, model, report, latencyMs, tokenUsage, cost }
```

当前默认测试使用 `mock`，避免自动测试调用付费 API。生产验证可用：

```bash
npm run benchmark -- --providers=deepseek
```

## BenchmarkDataset

统一字段：

```json
{
  "id": "",
  "title": "",
  "authorId": "",
  "grade": "",
  "className": "",
  "wordCount": 0,
  "originalEssay": "",
  "oldReport": {},
  "newReport": null,
  "compareResult": null,
  "benchmarkScore": null,
  "createdAt": "",
  "updatedAt": ""
}
```

JSON Schema 位于：

```text
benchmark/config/benchmark-dataset.schema.json
```

## API

所有 API 需要教师或管理员身份。

```text
GET  /api/benchmark/status
GET  /api/benchmark/datasets
GET  /api/benchmark/datasets/:id
POST /api/benchmark/import
POST /api/benchmark/run
POST /api/benchmark/review/:id
GET  /api/benchmark/reports/latest
GET  /api/benchmark/download/:file
```

## 命令

```bash
npm run benchmark:test
npm run benchmark:check
npm run benchmark -- --mock
npm run benchmark -- --providers=deepseek
```

`benchmark:test` 全部通过时输出：

```text
PASS
```

`benchmark:check` 会检查：

- Benchmark 数据目录；
- Provider Adapter；
- 导出功能；
- 图表生成；
- 飞书通知开关；
- Word/PDF 导出；
- WebDAV 写入、读取、删除。

全部通过时输出：

```text
PASS
```

## 后台页面

教师后台新增：

```text
/teacher/benchmark
```

页面提供：

- 历史样本数量
- 平均分
- 提升率
- 最近运行时间
- 待重试任务
- 历史运行记录
- 重新运行 Benchmark
- 一键下载 Word、PDF、Excel、Markdown 报告

## 异常恢复

- 单篇失败不会中断整批 Benchmark。
- 失败任务写入 `benchmark/result/retry-queue.json`。
- 运行时可使用断点续跑，已存在 `benchmark-score.json` 的样本会被跳过。
- 错误日志写入 `benchmark/logs/benchmark.log`，不记录 API Key、Cookie、Token 或完整作文正文。

## 飞书通知

默认不发送真实飞书通知。只有显式启用以下开关时才尝试发送：

```bash
BENCHMARK_FEISHU_NOTIFY=true npm run benchmark -- --providers=deepseek --notify-feishu
```

## 安全规则

- 不在前端暴露模型 API Key。
- 不输出飞书密钥、WebDAV 密码或 Authorization。
- Benchmark 自动测试默认使用 mock Provider。
- Benchmark 文件统一存放在项目内 `benchmark/`，不写入生产业务数据表。
