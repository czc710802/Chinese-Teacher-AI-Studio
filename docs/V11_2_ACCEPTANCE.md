# V11.2 验收清单

## 必须通过

- `npm run essay:test`
- `curl http://127.0.0.1:4000/api/essay/history`
- `curl https://pi.zhenwanyue.icu/api/essay/history`
- `curl -X POST http://127.0.0.1:4000/api/essay/analyze ...`

## 飞书验收

- 发送 `作文`
- 发送 `/essay`
- 发送 `作文：正文`
- 发送 `/essay 正文`

## 结果验收

- 能返回作文菜单卡片
- 能返回作文批改结果卡片
- 能保存批改记录
- 能查询最近 20 条历史
- 上传图片或文件时不会崩溃

