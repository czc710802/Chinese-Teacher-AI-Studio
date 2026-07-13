# 作文 AI API

## POST /api/essay/analyze

直接批改文本作文。

请求体：

```json
{
  "title": "出发与到达",
  "text": "青年应在时代中寻找自己的位置。"
}
```

返回：

- `id`
- `taskId`
- `status`
- `result`

## POST /api/essay/upload

上传图片或文件，支持：

- 图片
- `txt`
- `doc`
- `docx`
- `pdf`

文件会保存到 `server/uploads/essay-ai/`。

## GET /api/essay/result/:id

查询单条批改结果。

## GET /api/essay/history

返回最近 20 条记录。

## GET /api/essay/download/:id

默认返回 Markdown 报告。

- `?format=word` 预留
- `?format=pdf` 预留

