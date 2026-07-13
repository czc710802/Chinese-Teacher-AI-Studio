#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"
SERVER_LABEL="com.zhenwanyue.ai-server"
TUNNEL_LABEL="com.zhenwanyue.cloudflared"
WATCHDOG_LABEL="com.zhenwanyue.health-watchdog"
SERVER_HEALTH="http://127.0.0.1:4000/api/health"
PUBLIC_HEALTH="https://pi.zhenwanyue.icu/api/health"

service_state() {
  local label="$1"
  if output="$(launchctl print "$DOMAIN/$label" 2>/dev/null)"; then
    local state pid
    state="$(printf '%s\n' "$output" | awk -F'= ' '/state =/ {print $2; exit}')"
    pid="$(printf '%s\n' "$output" | awk -F'= ' '/pid =/ {print $2; exit}')"
    printf '%s%s\n' "${state:-loaded}" "${pid:+ (pid $pid)}"
  else
    printf 'not loaded\n'
  fi
}

port_state() {
  if lsof -nP -iTCP:4000 -sTCP:LISTEN >/dev/null 2>&1; then
    lsof -nP -iTCP:4000 -sTCP:LISTEN | awk 'NR==2 {print $1, $2, $9}'
  else
    printf 'not listening\n'
  fi
}

echo "== launchd =="
echo "server:      $(service_state "$SERVER_LABEL")"
echo "cloudflared: $(service_state "$TUNNEL_LABEL")"
echo "watchdog:    $(service_state "$WATCHDOG_LABEL")"
echo
echo "== port 4000 =="
port_state
echo
echo "== local health =="
curl -fsS --max-time 8 "$SERVER_HEALTH"
echo
echo "== public health =="
curl -fsS --max-time 8 "$PUBLIC_HEALTH"
echo
echo "== public access =="
curl -fsS --max-time 8 http://127.0.0.1:4000/api/public-access
echo
echo "== logs =="
echo "$APP_DIR/logs/server.out.log"
echo "$APP_DIR/logs/server.err.log"
echo "$APP_DIR/logs/cloudflared.out.log"
echo "$APP_DIR/logs/cloudflared.err.log"
echo "$APP_DIR/logs/watchdog.log"
