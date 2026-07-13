# 数据库设计

数据库使用 SQLite，主库位于 `data/essay-review.sqlite`；建表定义在 `server/src/db/schema.js`。

| 领域 | 数据表 |
|---|---|
| 账户与组织 | `users`、`students`、`teachers`、`classes`、`class_students` |
| 作文流程 | `assignments`、`essays`、`essay_images`、`ai_reviews`、`teacher_comments` |
| 成长与导出 | `student_profiles`、`export_records` |
| AI 训练 | `ai_tutor_conversations`、`ai_writing_exercises`、`ai_upgrade_records`、`mock_marking_records` |
| 教学内容与报告 | `teacher_reports`、`material_library`、`student_weekly_reports` |

## 核心关联

- `users` 与 `students` / `teachers` 为一对一扩展关系。
- 教师拥有多个 `classes`，学生通过 `class_students` 加入班级。
- 班级发布多个 `assignments`；学生针对任务提交多个 `essays`。
- 作文可关联图片、AI 批改记录、教师评论和模拟阅卷记录。
- 学生维护一份 `student_profiles` 成长档案。

JSON 类字段（如维度得分、问题列表、点评）以文本形式存储，读取后由应用层解析。

