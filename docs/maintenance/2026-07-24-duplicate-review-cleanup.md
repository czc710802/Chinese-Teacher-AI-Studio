# 2026-07-24 重复批改结果清理记录

本次仅处理 `503001 / 陈振聪 / 周练` 相关的历史冗余 submission。

已完成动作：

- 备份数据库快照到 `backups/2026-07-24-dup-cleanup/essay-review.sqlite`
- 删除冗余作文提交 `77`、`79`
- 一并删除其关联 `ai_reviews`、`essay_images`
- 重新刷新 `student_profiles`，使成长档案回到当前保留作文

当前保留：

- `essay_id=73`：`高一年周练`
- `essay_id=86`：`周练`

说明：

- `essay_id=73` 仍保留为更早的历史记录，且其批改历史已由 canonical 查询统一收口
- `essay_id=86` 为当前最新且分数最高的正式结果

