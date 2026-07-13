#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_common.sh"

APP_DIR="$(project_root)"
ENV_FILE="$APP_DIR/.env.production"
LOG_DIR="$APP_DIR/logs"
mkdir -p "$LOG_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo ".env.production 不存在"
  exit 1
fi

load_env_file "$ENV_FILE"

if [[ -z "${FEISHU_APP_ID:-}" ]]; then
  echo "FEISHU_APP_ID 未配置"
else
  echo "FEISHU_APP_ID 已配置"
fi

if [[ -z "${FEISHU_APP_SECRET:-}" ]]; then
  echo "FEISHU_APP_SECRET 未配置"
else
  echo "FEISHU_APP_SECRET 已配置"
fi

echo "== feishu health =="
HEALTH_JSON="$(curl -fsS http://127.0.0.1:4000/api/feishu/health)"
printf '%s\n' "$HEALTH_JSON"

echo "== system status =="
curl -fsS http://127.0.0.1:4000/api/system/status

node - <<'NODE' "$HEALTH_JSON"
const health = JSON.parse(process.argv[2]);
const configured = Boolean(health.appConfigured);
const connected = Boolean(health.connected);
if (configured && !connected) {
  console.error('飞书已配置但当前未连接，请先运行 npm run feishu:connect');
  process.exit(1);
}
console.log(configured ? (connected ? '飞书长连接已连接' : '飞书配置已读取，但未启用') : '飞书配置未完成，已跳过连接测试');
NODE
