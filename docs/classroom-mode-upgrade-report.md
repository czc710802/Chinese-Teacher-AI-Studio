# Chinese Teacher AI Studio 班级管理模式升级报告

## 目标

将现有作文 AI 批改系统收敛为教师班级管理驱动的完整闭环，覆盖：

教师建班 -> 学生建号/导入 -> 学生登录 -> 查看任务 -> 提交作文 -> AI 批改 -> 报告生成 -> 教师审核 -> 学生成长档案。

本次重点补齐了教师端的学生管理入口，并把学生创建与导入能力统一回收到班级工作台。

## 角色体系

- 教师：管理自己的班级、学生、任务、提交、批改和审核。
- 学生：独立账号登录，仅能访问自己的班级、任务、作文和报告。
- 管理员：负责系统级诊断、测试环境和异常数据处理。

## 已有业务主线

系统保留并继续使用：

1. 教师创建班级
2. 学生申请加入
3. 教师审核
4. membership active
5. 教师发布任务
6. 学生查看任务
7. 学生提交作文
8. AI 自动批改
9. 报告生成
10. 教师查看与发布结果
11. 学生查看最终报告
12. 升格文章与后续修改

## 本次补齐内容

### 教师端学生管理

- 新增教师端一级入口：`/teacher/students`
- 在教师工作台与班级工作台中加入学生管理入口
- 班级页统一提供“创建学生账号”和“批量导入学生”
- 支持 live 班级模式和 legacy 班级模式两种数据入口

### 学生账号与名单维护

- 单个学生创建
- 批量粘贴导入
- 兼容旧班级数据页的学生维护
- 将创建/导入动作统一回收到班级工作台

## 路由整理

教师端保留的核心入口：

- `/teacher`
- `/teacher/dashboard`
- `/teacher/classes`
- `/teacher/students`
- `/teacher/join-requests`
- `/teacher/assignments`
- `/teacher/submissions`
- `/teacher/grading`
- `/teacher/reviews`
- `/teacher/growth`
- `/teacher/benchmark`
- `/teacher/test-center`
- `/teacher/settings`

学生端继续保留：

- `/student-mobile`
- `/student-mobile/home`
- `/student-mobile/classes`
- `/student-mobile/tasks`
- `/student-mobile/submissions`
- `/student-mobile/progress`
- `/student-mobile/reports`
- `/student-mobile/revisions`
- `/student-mobile/growth`
- `/student-mobile/profile`

## 数据模型

当前系统中与班级闭环相关的核心实体包括：

- users
- students
- teachers
- classes
- student_class_bindings
- class_join_requests
- assignments
- essays
- ai_reviews
- teacher_comments
- student_profiles
- ai_upgrade_records
- teacher_reports
- student_weekly_reports

## 当前实现状态

- 教师端学生管理入口已落地
- 班级工作台已能进入学生创建与批量导入
- live/legacy 两条入口均可接入学生管理能力
- 现有作文任务、学生任务、提交、AI 批改、报告与升格能力继续复用

## 验证建议

后续验收按以下顺序执行：

1. 教师创建班级
2. 创建学生账号或导入名单
3. 学生登录并进入学生工作台
4. 教师发布任务
5. 学生查看任务并提交
6. AI 批改生成报告
7. 教师审核并发布结果
8. 学生查看最终批改与升格内容

## 备注

本报告只记录当前代码库中的班级管理模式升级结果，不新增新的作文 AI 内核，不修改评分模型与报告核心逻辑。
