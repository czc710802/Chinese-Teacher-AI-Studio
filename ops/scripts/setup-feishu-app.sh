#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_common.sh"

APP_DIR="$(project_root)"
ENV_FILE="$APP_DIR/.env.production"
EXAMPLE_FILE="$APP_DIR/.env.production.example"
BACKUP_FILE="$APP_DIR/.env.production.bak-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$APP_DIR/logs"

if [[ ! -f "$ENV_FILE" && -f "$EXAMPLE_FILE" ]]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "已从 example 生成 .env.production"
fi

if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$BACKUP_FILE"
  echo "已备份旧配置到 $BACKUP_FILE"
fi

read_field() {
  local label="$1"
  local current="$2"
  local secret_mode="${3:-0}"
  local value=""
  if [[ "$secret_mode" -eq 1 ]]; then
    read -r -s -p "$label" value
    printf '\n'
  else
    read -r -p "$label" value
  fi
  if [[ -z "$value" ]]; then
    value="$current"
  fi
  printf '%s' "$value"
}

quote_env() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

current_app_id="${FEISHU_APP_ID:-}"
current_app_secret="${FEISHU_APP_SECRET:-}"
current_verification_token="${FEISHU_VERIFICATION_TOKEN:-}"
current_encrypt_key="${FEISHU_ENCRYPT_KEY:-}"
current_webhook_url="${FEISHU_WEBHOOK_URL:-}"
current_secret="${FEISHU_SECRET:-}"
current_bot_name="${FEISHU_BOT_NAME:-Chinese Teacher AI Studio}"

load_env_file "$ENV_FILE"
current_app_id="${FEISHU_APP_ID:-$current_app_id}"
current_app_secret="${FEISHU_APP_SECRET:-$current_app_secret}"
current_verification_token="${FEISHU_VERIFICATION_TOKEN:-$current_verification_token}"
current_encrypt_key="${FEISHU_ENCRYPT_KEY:-$current_encrypt_key}"
current_webhook_url="${FEISHU_WEBHOOK_URL:-$current_webhook_url}"
current_secret="${FEISHU_SECRET:-$current_secret}"
current_bot_name="${FEISHU_BOT_NAME:-$current_bot_name}"

echo "请回车保留现有值。"
app_id="$(read_field "FEISHU_APP_ID: " "$current_app_id" 0)"
app_secret="$(read_field "FEISHU_APP_SECRET: " "$current_app_secret" 1)"
verification_token="$(read_field "FEISHU_VERIFICATION_TOKEN: " "$current_verification_token" 0)"
encrypt_key="$(read_field "FEISHU_ENCRYPT_KEY: " "$current_encrypt_key" 0)"
webhook_url="$(read_field "FEISHU_WEBHOOK_URL: " "$current_webhook_url" 0)"
secret="$(read_field "FEISHU_SECRET: " "$current_secret" 1)"
bot_name="$(read_field "FEISHU_BOT_NAME: " "$current_bot_name" 0)"

cat > "$ENV_FILE" <<EOF
PORT=4000
HOST=0.0.0.0
PUBLIC_APP_ORIGIN=https://pi.zhenwanyue.icu

AI_PROVIDER=deepseek
OPENAI_API_KEY=$(quote_env "${OPENAI_API_KEY:-your-openai-key}")
OPENAI_MODEL=$(quote_env "${OPENAI_MODEL:-gpt-5.5}")
DEEPSEEK_API_KEY=$(quote_env "${DEEPSEEK_API_KEY:-your-deepseek-key}")
DEEPSEEK_MODEL=$(quote_env "${DEEPSEEK_MODEL:-deepseek-chat}")
DEEPSEEK_BASE_URL=$(quote_env "${DEEPSEEK_BASE_URL:-https://api.deepseek.com/chat/completions}")

FEISHU_APP_ID=$(quote_env "$app_id")
FEISHU_APP_SECRET=$(quote_env "$app_secret")
FEISHU_VERIFICATION_TOKEN=$(quote_env "$verification_token")
FEISHU_ENCRYPT_KEY=$(quote_env "$encrypt_key")
FEISHU_WEBHOOK_URL=$(quote_env "$webhook_url")
FEISHU_SECRET=$(quote_env "$secret")
FEISHU_BOT_NAME=$(quote_env "$bot_name")
EOF

echo "已写入 $ENV_FILE"
