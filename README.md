# Chinese Teacher AI Studio

Chinese Teacher AI Studio 是面向高中语文作文教学的 AI 工作台，覆盖学生作文提交、OCR、AI 批改、报告导出、极空间 NAS 归档、学生成长档案、教师班级管理、飞书双向互动和 Benchmark 质量评测中心。

当前生产默认模型为 DeepSeek。OpenAI 保留配置能力但生产默认禁用。公网入口为 `https://pi.zhenwanyue.icu`，文件访问通过后端签名链接完成，不直接暴露 WebDAV、内网 IP、Cookie 或密钥。

## 项目介绍

本项目服务于高中语文教师的作文教学闭环：

1. 学生提交作文图片、文本或附件。
2. 后端完成 OCR、文本校验和 DeepSeek 批改。
3. 系统生成 HTML、Markdown、Word、PDF 报告。
4. 作文原文、OCR、批改 JSON、报告和 metadata 自动归档到 NAS。
5. 学生成长档案和教师班级统计异步更新。
6. 飞书机器人向学生或教师返回摘要、完整报告和文件下载链接。
7. Benchmark Center 用于评估批改质量和模型表现。

## 系统架构

```text
学生端 / 教师后台 / 飞书机器人
        |
        v
Express API Server
        |
        +-- AI Router -> DeepSeek
        +-- Archive Pipeline -> ZSpace WebDAV
        +-- Student Profile -> 成长档案
        +-- Teacher Dashboard -> 班级/学生/作文/任务
        +-- File Access -> 签名报告/Word/PDF 链接
        +-- Benchmark Center -> 批改质量评测
        |
        v
Client Build + Cloudflare Tunnel
```

## 功能模块

- 学生端：作文上传、OCR 确认、批改结果、升格稿、报告下载。
- 作文 AI：DeepSeek 批改、统一 AI Router、P1.5 深度报告结构。
- 报告中心：HTML、Markdown、Word、PDF 生成和公网签名访问。
- NAS 归档：极空间 WebDAV 自动归档与离线队列。
- 学生成长档案：分数趋势、能力趋势、高频问题、训练计划。
- 教师后台：班级管理、学生管理、作文管理、任务中心、教师点评。
- 飞书机器人：双向消息、身份绑定、结果卡片、文件链接。
- Benchmark Center：历史作文、批量重批、旧新报告对比、评分、导出。
- 运维脚本：生产启动、健康检查、Cloudflare Tunnel、WebDAV、CI 自检。

## 目录结构

```text
.
├── client/                 # 前端页面与交互
├── server/                 # 后端 API、服务层、测试
├── ops/                    # 运维、检查、smoke 脚本
├── docs/                   # 项目文档
├── benchmark/              # Benchmark 数据、配置和运行产物
├── apps/                   # 独立应用模块
├── tools/                  # 本地工具和隧道配置
├── .github/workflows/      # GitHub Actions CI
├── package.json            # 根命令入口
├── README.md               # 项目说明
├── CONTRIBUTING.md         # 开发规范
└── VERSION.md              # 阶段版本记录
```

## 安装方式

```bash
cd /Users/chenxiansheng/Desktop/workspace/高中作文AI批改App
npm install
npm run install:all
```

环境变量请参考：

- `.env.example`
- `.env.production.example`
- `.env.nas.example`

真实 `.env`、`.env.production`、密钥和日志不得提交到 GitHub。

## 启动方式

开发模式：

```bash
npm run dev
```

常用本地入口：

- 前端开发入口：http://localhost:5173
- 后端健康检查：http://localhost:4000/api/health
- 生产单端口入口：http://localhost:4000

## 生产部署

生产环境使用 `.env.production`，并由本地生产脚本管理服务和 Cloudflare Tunnel：

```bash
npm run build
npm run prod:restart
npm run prod:status
```

生产健康检查建议：

```bash
npm run ai:check
npm run zspace:test
npm run archive:smoke
npm run profiles:smoke
npm run teacher:smoke
npm run public-files:check
npm run feishu:file-smoke
npm run feishu:smoke
npm run benchmark:check
```

## Benchmark

Benchmark Center 用于评估作文 AI 批改质量，不影响生产批改链路。

```bash
npm run benchmark
npm run benchmark:test
npm run benchmark:check
```

运行产物默认写入 `benchmark/` 下的运行目录，其中 `benchmark/reports`、`benchmark/result`、`benchmark/charts`、`benchmark/export`、`benchmark/logs` 已在 `.gitignore` 中排除。

## 飞书机器人

飞书模块负责接收消息、识别身份、触发作文批改、发送结果卡片和文件链接。

```bash
npm run feishu:status
npm run feishu:smoke
npm run feishu:file-smoke
```

飞书消息中的完整报告、Word 和 PDF 均使用公网签名链接，不直接返回 NAS URL、WebDAV 账号、内网 IP 或本机路径。

## Cloudflare Tunnel

公网入口：

```text
https://pi.zhenwanyue.icu
```

验证：

```bash
npm run public-files:check
npm run prod:status
```

## WebDAV

极空间 NAS WebDAV 用于正式归档。真实账号密码只允许放在本地环境变量文件中。

```bash
npm run zspace:test
npm run zspace:init
```

## 教师后台

教师后台包含工作台、班级、学生、作文、任务、教师点评和 Benchmark Center。

常用验证：

```bash
npm run teacher:smoke
```

## 学生端

学生端支持作文上传、OCR 文本确认、批改报告查看、Word/PDF 下载、成长档案和训练建议入口。

## GitHub 与 CI

推荐 GitHub 仓库名：

```text
Chinese-Teacher-AI-Studio
```

默认推荐 Private 仓库，避免误公开教学数据、配置文件和运维信息。若需要公开展示，可在脱敏和数据清理后再切换 Public。

CI 入口：

```text
.github/workflows/ci.yml
```

本地 CI 自检：

```bash
npm run ci:check
npm run typecheck
npm run lint
npm test
npm run benchmark:test
npm run build
```

## 后续开发路线

- P2：飞书完整教学流程增强与班级互动闭环。
- P3：学生长期成长数据分析和教师教学诊断。
- P4：PPT、试卷、备课、知识库 RAG 等扩展模块。
- 工程化：GitHub Remote、受保护分支、Release、备份和部署流水线。

## 安全要求

- 不提交 `.env`、`.env.production`、密钥文件、日志和运行数据。
- 不输出 API Key、WebDAV 密码、飞书密钥、Authorization、Cookie 或完整签名 token。
- 生产链接必须使用公网域名，不使用 localhost、内网 IP、WebDAV URL 或 file 路径。
