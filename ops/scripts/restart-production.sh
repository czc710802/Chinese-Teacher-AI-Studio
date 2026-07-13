#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

if launchctl print "$DOMAIN/com.zhenwanyue.ai-server" >/dev/null 2>&1 \
  && launchctl print "$DOMAIN/com.zhenwanyue.cloudflared" >/dev/null 2>&1 \
  && launchctl print "$DOMAIN/com.zhenwanyue.health-watchdog" >/dev/null 2>&1; then
  launchctl kickstart -k "$DOMAIN/com.zhenwanyue.ai-server"
  launchctl kickstart -k "$DOMAIN/com.zhenwanyue.cloudflared"
  launchctl kickstart -k "$DOMAIN/com.zhenwanyue.health-watchdog"
else
  bash "$APP_DIR/ops/scripts/install-launchd.sh"
fi
