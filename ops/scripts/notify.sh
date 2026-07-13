#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_common.sh"

APP_DIR="$(project_root)"
LOG_DIR="$APP_DIR/logs"
LOG_FILE="$LOG_DIR/notify.log"
ENV_FILE="$APP_DIR/.env.production"
WEBHOOK_URL=""
SECRET=""
MODE="text"
TITLE="Chinese Teacher AI Studio"
MESSAGE=""
TEST_MODE=0

mkdir -p "$LOG_DIR"
touch "$LOG_FILE"
load_env_file "$ENV_FILE"
WEBHOOK_URL="${FEISHU_WEBHOOK_URL:-}"
SECRET="${FEISHU_SECRET:-}"

json_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1] ?? ""))' "$1"
}

sign_payload() {
  local ts="$1"
  local secret="$2"
  printf '%s\n%s' "$ts" "$secret" | openssl dgst -sha256 -binary -hmac "$secret" | base64 | tr -d '\n'
}

log_line() {
  printf '[%s] %s\n' "$(timestamp)" "$*" | tee -a "$LOG_FILE"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --text)
      MODE="text"
      MESSAGE="${2:-}"
      shift 2
      ;;
    --markdown)
      MODE="markdown"
      MESSAGE="${2:-}"
      shift 2
      ;;
    --title)
      TITLE="${2:-$TITLE}"
      shift 2
      ;;
    --test)
      TEST_MODE=1
      shift
      ;;
    *)
      MESSAGE="${1:-}"
      shift
      ;;
  esac
done

if [[ $TEST_MODE -eq 1 && -z "$MESSAGE" ]]; then
  MESSAGE="飞书通知测试消息：$(timestamp)"
  MODE="text"
fi

if [[ -z "$WEBHOOK_URL" ]]; then
  log_line "FEISHU_WEBHOOK_URL 未配置，已跳过通知：${MESSAGE:-未提供消息}"
  exit 0
fi

timestamp_sec=""
signature=""
if [[ -n "$SECRET" ]]; then
  timestamp_sec="$(date +%s)"
  signature="$(sign_payload "$timestamp_sec" "$SECRET")"
fi

payload=""
payload="$(
  node - "$MODE" "$TITLE" "${MESSAGE:-}" "$timestamp_sec" "$signature" <<'NODE'
const [mode, title, message, timestamp, sign] = process.argv.slice(2);
const payload = mode === 'markdown'
  ? {
      msg_type: 'post',
      content: {
        post: {
          zh_cn: {
            title,
            content: String(message || '').split('\n').map((line) => ([{ tag: 'text', text: line }]))
          }
        }
      }
    }
  : {
      msg_type: 'text',
      content: {
        text: String(message || '')
      }
    };

if (timestamp && sign) {
  payload.timestamp = timestamp;
  payload.sign = sign;
}

process.stdout.write(JSON.stringify(payload));
NODE
)"

if response="$(curl -fsS -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK_URL" 2>&1)"; then
  log_line "飞书通知发送成功：${MESSAGE:-<empty>}"
  echo "$response" >> "$LOG_FILE"
else
  log_line "飞书通知发送失败：$response"
fi
