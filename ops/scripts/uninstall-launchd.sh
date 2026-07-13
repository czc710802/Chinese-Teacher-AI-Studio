#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLIST_DIR="$APP_DIR/ops/launchd"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

SERVER_PLIST="$PLIST_DIR/com.zhenwanyue.ai-server.plist"
TUNNEL_PLIST="$PLIST_DIR/com.zhenwanyue.cloudflared.plist"
WATCHDOG_PLIST="$PLIST_DIR/com.zhenwanyue.health-watchdog.plist"

uninstall_job() {
  local label="$1"
  local plist="$2"
  launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  launchctl disable "$DOMAIN/$label" >/dev/null 2>&1 || true
}

uninstall_job "com.zhenwanyue.health-watchdog" "$WATCHDOG_PLIST"
uninstall_job "com.zhenwanyue.cloudflared" "$TUNNEL_PLIST"
uninstall_job "com.zhenwanyue.ai-server" "$SERVER_PLIST"

echo "launchd 已卸载。"
