# API 接口文档

服务地址：`http://localhost:4000`；健康检查：`GET /api/health`。

| 前缀 | 主要能力 |
|---|---|
| `/api/auth` | 登录与用户身份 |
| `/api/classes` | 班级创建、查询、学生管理 |
| `/api/assignments` | 作文任务创建与查询 |
| `/api/essays` | 作文提交、OCR、详情、教师评论 |
| `/api/analytics` | 班级分析与学生成长档案 |
| `/api/reports` | 作文、学生、班级报告 Word/PDF 导出 |
| `/api/ai` | AI 辅导、训练与模拟阅卷 |

## 主要端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 学生、教师登录 |
| GET / POST | `/api/classes` | 查询或创建班级 |
| GET / POST | `/api/assignments` | 查询或发布作文任务 |
| GET / POST | `/api/essays` | 查询或提交作文并触发批改 |
| POST | `/api/essays/ocr` | 上传多张图片并合并 OCR 文字 |
| GET | `/api/essays/:id` | 获取作文及批改详情 |
| POST | `/api/essays/:id/comments` | 教师追加批注 |
| GET | `/api/analytics/classes/:classId` | 获取班级分析 |
| GET | `/api/analytics/students/:studentId` | 获取学生档案 |
| POST | `/api/reports/essay/:essayId/:format` | 导出作文报告，`format` 为 `docx` 或 `pdf` |

接口具体请求/响应字段以对应路由实现为准；变更接口时须同步更新本文件。
