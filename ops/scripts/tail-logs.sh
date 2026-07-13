#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$APP_DIR/logs"

mkdir -p "$LOG_DIR"
touch "$LOG_DIR/server.out.log" "$LOG_DIR/server.err.log" "$LOG_DIR/cloudflared.out.log" "$LOG_DIR/cloudflared.err.log" "$LOG_DIR/watchdog.log"

tail -n 200 -F \
  "$LOG_DIR/server.out.log" \
  "$LOG_DIR/server.err.log" \
  "$LOG_DIR/cloudflared.out.log" \
  "$LOG_DIR/cloudflared.err.log" \
  "$LOG_DIR/watchdog.log"
