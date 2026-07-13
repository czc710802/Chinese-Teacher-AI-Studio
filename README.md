# Chinese Teacher AI Studio

Chinese Teacher AI Studio 是面向高中语文教师、学生和班级教学管理的作文 AI 批改工作台。系统以 DeepSeek 批改引擎为生产默认模型，集成学生端作文提交、OCR、AI 批改、报告导出、极空间 NAS 归档、学生成长档案、教师班级管理、飞书双向互动和 Benchmark 质量评测中心。

## 模块说明

- 学生端：作文拍照/图片上传、文本确认、批改结果查看、Word/PDF 下载。
- 作文 AI：DeepSeek 生产批改、统一 AI Router、P1.5 深度批改报告结构。
- 报告中心：HTML、Markdown、Word、PDF 报告生成与受控下载。
- NAS 归档：通过极空间 WebDAV 保存作文原文、OCR 文本、JSON、Markdown、Word、PDF 和 metadata。
- 学生成长档案：基于历次归档生成分数趋势、能力趋势、高频问题和训练计划。
- 教师后台：班级管理、学生管理、作文管理、任务中心、教师点评、统计与审计。
- 飞书集成：飞书机器人双向消息、签名下载链接、报告/Word/PDF 可访问。
- Benchmark Center：历史作文导入、批量重批、旧新报告对比、评分、导出和健康检查。

## 启动方式

```bash
cd /Users/chenxiansheng/Desktop/workspace/高中作文AI批改App
npm install
npm run dev
```

常用本地入口：

- 前端开发入口：http://localhost:5173
- 后端健康检查：http://localhost:4000/api/health
- 生产单端口入口：http://localhost:4000

## 生产运行

生产环境使用 `.env.production`，该文件不得提交到 Git。

```bash
npm run prod:restart
npm run prod:status
```

关键生产检查：

```bash
npm run ai:check
npm run zspace:test
npm run archive:smoke
npm run profiles:smoke
npm run teacher:smoke
npm run feishu:file-smoke
npm run feishu:smoke
npm run benchmark:check
```

## 部署方式

当前公网入口通过 Cloudflare Tunnel 暴露：

```text
https://pi.zhenwanyue.icu
```

生产服务和隧道由本地脚本及 launchd 相关配置托管。部署变更后应至少执行：

```bash
npm run build
npm run prod:restart
npm run prod:status
```

## Benchmark

Benchmark Center 用于验证作文 AI 批改质量，不影响生产批改链路。

常用命令：

```bash
npm run benchmark
npm run benchmark:test
npm run benchmark:check
```

运行产物默认写入 `benchmark/` 下的运行目录，其中报告、结果、图表、导出和日志目录已在 `.gitignore` 中排除。

## 飞书

飞书模块负责接收学生/教师消息、触发作文批改、发送结果卡片和文件下载链接。飞书消息中的报告、Word、PDF 均通过公网域名下的签名链接访问，不直接暴露 NAS、WebDAV、内网 IP 或本机路径。

相关文档：

- `docs/FEISHU_INTEGRATION.md`

## Cloudflare Tunnel

公网域名：

```text
https://pi.zhenwanyue.icu
```

验证命令：

```bash
npm run public-files:check
npm run prod:status
```

## WebDAV

极空间 NAS WebDAV 相关配置只允许写入 `.env.production` 等本地环境文件，不得写入源码、README 或日志。

验证命令：

```bash
npm run zspace:test
```

相关文档：

- `docs/ZSPACE_WEBDAV_SETUP.md`

## 目录结构

```text
.
├── client/                 # 前端页面与交互
├── server/                 # 后端 API、服务层、测试
├── ops/                    # 运维和检查脚本
├── docs/                   # 项目文档
├── benchmark/              # Benchmark 数据和运行产物
├── data/                   # 本地运行数据，默认不入库
├── logs/                   # 本地日志，默认不入库
├── tools/                  # 本地工具
├── package.json            # 根命令入口
├── README.md               # 项目说明
└── VERSION.md              # 阶段版本记录
```

## 安全要求

- 不提交 `.env`、`.env.production`、密钥文件、日志和运行数据。
- 不在终端输出 API Key、WebDAV 密码、飞书密钥、Authorization、Cookie 或完整签名 token。
- 生产链接必须使用公网域名，不使用 localhost、内网 IP、WebDAV URL 或 file 路径。
