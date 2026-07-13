#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$APP_DIR/logs"
STATE_DIR="$LOG_DIR/watchdog-state"
SERVER_PLIST="$APP_DIR/ops/launchd/com.zhenwanyue.ai-server.plist"
TUNNEL_PLIST="$APP_DIR/ops/launchd/com.zhenwanyue.cloudflared.plist"
SERVER_LABEL="com.zhenwanyue.ai-server"
TUNNEL_LABEL="com.zhenwanyue.cloudflared"
SERVER_HEALTH="http://127.0.0.1:4000/api/health"
PUBLIC_HEALTH="https://pi.zhenwanyue.icu/api/health"
COOLDOWN_SECONDS=180
CHECK_INTERVAL_SECONDS=60
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"
WATCHDOG_LOG="$LOG_DIR/watchdog.log"
SERVER_RESTART_FILE="$STATE_DIR/server.restart"
TUNNEL_RESTART_FILE="$STATE_DIR/tunnel.restart"
SERVER_FAIL_FILE="$STATE_DIR/server.fail"
PUBLIC_FAIL_FILE="$STATE_DIR/public.fail"

mkdir -p "$LOG_DIR" "$STATE_DIR"
touch "$WATCHDOG_LOG"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$WATCHDOG_LOG"
}

health_ok() {
  local url="$1"
  local body
  if body="$(curl -fsS --max-time 8 "$url" 2>/dev/null)"; then
    grep -q '"ok"[[:space:]]*:[[:space:]]*true' <<<"$body"
  else
    return 1
  fi
}

read_counter() {
  local file="$1"
  if [[ -f "$file" ]]; then
    cat "$file"
  else
    printf '0'
  fi
}

write_counter() {
  local file="$1"
  local value="$2"
  printf '%s' "$value" > "$file"
}

cooldown_passed() {
  local file="$1"
  local now last
  now="$(date +%s)"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  last="$(cat "$file" 2>/dev/null || printf '0')"
  [[ -n "$last" ]] || last=0
  (( now - last >= COOLDOWN_SECONDS ))
}

record_restart() {
  local file="$1"
  date +%s > "$file"
}

restart_service() {
  local label="$1"
  local plist="$2"
  local stamp_file="$3"
  local human_name="$4"

  if ! cooldown_passed "$stamp_file"; then
    log "$human_name 冷却中，跳过重启"
    return 0
  fi

  log "重启 $human_name"
  launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  launchctl bootstrap "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  launchctl enable "$DOMAIN/$label" >/dev/null 2>&1 || true
  launchctl kickstart -k "$DOMAIN/$label" >/dev/null 2>&1 || true
  record_restart "$stamp_file"
}

run_once() {
  local local_ok=0
  local public_ok=0
  local server_fail_count
  local public_fail_count

  if health_ok "$SERVER_HEALTH"; then
    local_ok=1
    write_counter "$SERVER_FAIL_FILE" 0
    log "本地 health 通过"
  else
    server_fail_count=$(( $(read_counter "$SERVER_FAIL_FILE") + 1 ))
    write_counter "$SERVER_FAIL_FILE" "$server_fail_count"
    log "本地 health 失败，连续 ${server_fail_count} 次：$SERVER_HEALTH"
    if (( server_fail_count >= 2 )); then
      log "本地 health 连续失败，触发后端重启"
    fi
    restart_service "$SERVER_LABEL" "$SERVER_PLIST" "$SERVER_RESTART_FILE" "后端"
  fi

  if (( local_ok )); then
    if health_ok "$PUBLIC_HEALTH"; then
      public_ok=1
      write_counter "$PUBLIC_FAIL_FILE" 0
      log "公网 health 通过"
    else
      public_fail_count=$(( $(read_counter "$PUBLIC_FAIL_FILE") + 1 ))
      write_counter "$PUBLIC_FAIL_FILE" "$public_fail_count"
      log "公网 health 失败，连续 ${public_fail_count} 次：$PUBLIC_HEALTH"
      if (( public_fail_count >= 2 )); then
        log "公网 health 连续失败，触发 Cloudflare Tunnel 重启"
      fi
      restart_service "$TUNNEL_LABEL" "$APP_DIR/ops/launchd/com.zhenwanyue.cloudflared.plist" "$TUNNEL_RESTART_FILE" "Cloudflare Tunnel"
    fi
  else
    log "公网 health 跳过：本地 health 未恢复"
  fi

  if (( local_ok && public_ok )); then
    log "本轮检查全部通过"
  fi
}

if [[ "${1:-}" == "--once" ]]; then
  run_once
  exit 0
fi

log "watchdog 启动，每 ${CHECK_INTERVAL_SECONDS}s 检查一次"
while true; do
  run_once
  sleep "$CHECK_INTERVAL_SECONDS"
done
