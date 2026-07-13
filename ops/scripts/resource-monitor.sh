#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_common.sh"

APP_DIR="$(project_root)"
LOG_DIR="$APP_DIR/logs"
mkdir -p "$LOG_DIR"
load_env_file "$APP_DIR/.env.production"

STATUS_JSON="$(curl -fsS http://127.0.0.1:4000/api/system/status 2>/dev/null || true)"
MONITOR_LOG="$LOG_DIR/resource-monitor.log"
printf '[%s] %s\n' "$(timestamp)" "$STATUS_JSON" >> "$MONITOR_LOG"

DISK_CAPACITY="$(printf '%s' "$STATUS_JSON" | node -e 'const fs=require("fs"); const raw=fs.readFileSync(0,"utf8")||"{}"; try { const data=JSON.parse(raw); process.stdout.write(String(data.diskUsage?.capacity || "")); } catch { process.stdout.write(""); }')"

if [[ -n "$DISK_CAPACITY" ]]; then
  bash "$SCRIPT_DIR/notify.sh" --markdown "$(cat <<MSG
资源监控
磁盘占用：$DISK_CAPACITY
MSG
)"
fi

echo "$MONITOR_LOG"
