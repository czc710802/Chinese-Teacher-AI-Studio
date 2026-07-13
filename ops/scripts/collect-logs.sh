#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$APP_DIR/logs"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$LOG_DIR/diagnostic-$STAMP.tar.gz"
STAGE_DIR="$(mktemp -d)"
SNAPSHOT_DIR="$STAGE_DIR/diagnostic-$STAMP"

mkdir -p "$LOG_DIR" "$SNAPSHOT_DIR/logs"
touch "$LOG_DIR/server.out.log" "$LOG_DIR/server.err.log" "$LOG_DIR/cloudflared.out.log" "$LOG_DIR/cloudflared.err.log" "$LOG_DIR/watchdog.log"

cp "$LOG_DIR"/server.out.log "$SNAPSHOT_DIR/logs/" 2>/dev/null || true
cp "$LOG_DIR"/server.err.log "$SNAPSHOT_DIR/logs/" 2>/dev/null || true
cp "$LOG_DIR"/cloudflared.out.log "$SNAPSHOT_DIR/logs/" 2>/dev/null || true
cp "$LOG_DIR"/cloudflared.err.log "$SNAPSHOT_DIR/logs/" 2>/dev/null || true
cp "$LOG_DIR"/watchdog.log "$SNAPSHOT_DIR/logs/" 2>/dev/null || true

bash "$APP_DIR/ops/scripts/status-production.sh" > "$SNAPSHOT_DIR/status.txt" 2>&1 || true
sw_vers > "$SNAPSHOT_DIR/system.txt" 2>&1 || true
node -v > "$SNAPSHOT_DIR/node.txt" 2>&1 || true
npm -v > "$SNAPSHOT_DIR/npm.txt" 2>&1 || true

tar -czf "$ARCHIVE" -C "$STAGE_DIR" "diagnostic-$STAMP"
rm -rf "$STAGE_DIR"

echo "$ARCHIVE"
