#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"
SERVER_LABEL="com.zhenwanyue.ai-server"
TUNNEL_LABEL="com.zhenwanyue.cloudflared"
WATCHDOG_LABEL="com.zhenwanyue.health-watchdog"
WAIT_SECONDS="${PROD_RESTART_WAIT_SECONDS:-30}"
CHECK_INTERVAL_SECONDS="${PROD_RESTART_CHECK_INTERVAL_SECONDS:-1}"
STABLE_SUCCESS_COUNT="${PROD_RESTART_STABLE_SUCCESS_COUNT:-3}"

service_loaded() {
  launchctl print "$DOMAIN/$1" >/dev/null 2>&1
}

service_pid() {
  local label="$1"
  local output pid
  output="$(launchctl print "$DOMAIN/$label" 2>/dev/null || true)"
  pid="$(printf '%s\n' "$output" | awk -F'= ' '/pid =/ {print $2; exit}')"
  printf '%s' "${pid:-}"
}

port_listening() {
  lsof -nP -iTCP:4000 -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_core_ready() {
  local deadline now
  local stable_count=0
  local status_output final_status
  deadline=$((SECONDS + WAIT_SECONDS))
  while (( SECONDS < deadline )); do
    if service_loaded "$SERVER_LABEL" && service_loaded "$TUNNEL_LABEL" && service_loaded "$WATCHDOG_LABEL" \
      && [[ -n "$(service_pid "$SERVER_LABEL")" ]] \
      && port_listening; then
      status_output="$(bash "$APP_DIR/ops/scripts/status-production.sh" --local-only 2>/dev/null || true)"
      final_status="$(printf '%s\n' "$status_output" | awk -F': ' '/^final status:/ {print $2; exit}')"
      if [[ "$final_status" == "HEALTHY" ]]; then
        ((stable_count++))
        if (( stable_count >= STABLE_SUCCESS_COUNT )); then
          return 0
        fi
      else
        stable_count=0
      fi
    else
      stable_count=0
    fi
    sleep "$CHECK_INTERVAL_SECONDS"
  done
  return 1
}

if service_loaded "$SERVER_LABEL" && service_loaded "$TUNNEL_LABEL" && service_loaded "$WATCHDOG_LABEL"; then
  launchctl kickstart -k "$DOMAIN/$SERVER_LABEL"
  launchctl kickstart -k "$DOMAIN/$TUNNEL_LABEL"
  launchctl kickstart -k "$DOMAIN/$WATCHDOG_LABEL"
else
  bash "$APP_DIR/ops/scripts/install-launchd.sh"
fi

echo "== waiting for production services =="
if wait_for_core_ready; then
  echo "core services ready"
else
  echo "core services not fully ready within ${WAIT_SECONDS}s"
fi

bash "$APP_DIR/ops/scripts/status-production.sh"
