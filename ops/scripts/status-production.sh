#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"
SERVER_LABEL="com.zhenwanyue.ai-server"
TUNNEL_LABEL="com.zhenwanyue.cloudflared"
WATCHDOG_LABEL="com.zhenwanyue.health-watchdog"
LOCAL_HEALTH_URL="${PROD_LOCAL_HEALTH_URL:-http://127.0.0.1:4000/api/health}"
LOCALHOST_HEALTH_URL="${PROD_LOCALHOST_HEALTH_URL:-http://localhost:4000/api/health}"
PUBLIC_HEALTH_URL="${PROD_PUBLIC_HEALTH_URL:-https://pi.zhenwanyue.icu/api/health}"
PORT="${PROD_PORT:-4000}"
CONNECT_TIMEOUT_SECONDS="${PROD_STATUS_CONNECT_TIMEOUT_SECONDS:-2}"
MAX_TIME_SECONDS="${PROD_STATUS_MAX_TIME_SECONDS:-5}"
RETRY_COUNT="${PROD_STATUS_RETRIES:-10}"
RETRY_DELAY_SECONDS="${PROD_STATUS_RETRY_DELAY_SECONDS:-1}"
INITIAL_WAIT_SECONDS="${PROD_STATUS_INITIAL_WAIT_SECONDS:-2}"
STRICT_MODE="${PROD_STATUS_STRICT:-0}"
LOCAL_ONLY=0
if [[ "${1:-}" == "--local-only" ]]; then
  LOCAL_ONLY=1
fi
if [[ "${1:-}" == "--strict" ]]; then
  STRICT_MODE=1
fi

cleanup_tmp_files=()

add_tmp_file() {
  cleanup_tmp_files+=("$1")
}

cleanup() {
  for file in "${cleanup_tmp_files[@]:-}"; do
    [[ -n "${file:-}" ]] && rm -f "$file" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

service_state_raw() {
  local label="$1"
  launchctl print "$DOMAIN/$label" 2>/dev/null || return 1
}

service_state_summary() {
  local label="$1"
  local output state pid program last_exit
  if ! output="$(service_state_raw "$label")"; then
    printf 'not loaded|||'
    return 0
  fi

  state="$(printf '%s\n' "$output" | awk -F'= ' '/state =/ {print $2; exit}')"
  pid="$(printf '%s\n' "$output" | awk -F'= ' '/pid =/ {print $2; exit}')"
  program="$(printf '%s\n' "$output" | awk -F'= ' '/^[[:space:]]*program = / {print $2; exit}')"
  last_exit="$(printf '%s\n' "$output" | awk -F'= ' '/last exit code =/ {print $2; exit}')"
  printf '%s|%s|%s|%s\n' "${state:-unknown}" "${pid:-}" "${program:-}" "${last_exit:-}"
}

port_state_summary() {
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | awk 'NR==2 {print $1, $2, $9}'
  else
    printf 'not listening'
  fi
}

http_probe() {
  local url="$1"
  local body_file err_file http_code body
  body_file="$(mktemp)"
  err_file="$(mktemp)"
  add_tmp_file "$body_file"
  add_tmp_file "$err_file"

  if http_code="$(
    env \
      NO_PROXY="localhost,127.0.0.1,::1" \
      no_proxy="localhost,127.0.0.1,::1" \
      HTTP_PROXY= \
      HTTPS_PROXY= \
      ALL_PROXY= \
      http_proxy= \
      https_proxy= \
      all_proxy= \
      curl \
        --silent \
        --show-error \
        --noproxy '*' \
        --connect-timeout "$CONNECT_TIMEOUT_SECONDS" \
        --max-time "$MAX_TIME_SECONDS" \
        --output "$body_file" \
        --write-out '%{http_code}' \
        "$url" 2>"$err_file"
  )"; then
    body="$(cat "$body_file" 2>/dev/null || true)"
    if [[ "$http_code" == "200" ]] && grep -q '"ok"[[:space:]]*:[[:space:]]*true' <<<"$body"; then
      printf '%s|%s|%s\n' "$http_code" "ok" "$body"
      return 0
    fi
    printf '%s|%s|%s\n' "${http_code:-000}" "bad" "$body"
    return 1
  fi

  body="$(cat "$body_file" 2>/dev/null || true)"
  local err
  err="$(cat "$err_file" 2>/dev/null || true)"
  printf '%s|%s|%s\n' "${http_code:-000}" "error:${err:-curl failed}" "$body"
  return 1
}

probe_url_with_retries() {
  local prefix="$1"
  local url="$2"
  local attempt=1
  local probe_result probe_http

  while (( attempt <= RETRY_COUNT )); do
    if probe_result="$(http_probe "$url")"; then
      probe_http="$(cut -d'|' -f1 <<<"$probe_result")"
      printf -v "${prefix}_OK" '1'
      printf -v "${prefix}_HTTP" '%s' "$probe_http"
      printf -v "${prefix}_ATTEMPTS" '%s' "$attempt"
      return 0
    fi
    if (( attempt < RETRY_COUNT )); then
      sleep "$RETRY_DELAY_SECONDS"
    fi
    ((attempt++))
  done

  printf -v "${prefix}_OK" '0'
  printf -v "${prefix}_HTTP" '000'
  printf -v "${prefix}_ATTEMPTS" '%s' "$RETRY_COUNT"
  return 1
}

probe_local_health() {
  probe_url_with_retries "PROBE_127" "$LOCAL_HEALTH_URL"
  probe_url_with_retries "PROBE_LOCALHOST" "$LOCALHOST_HEALTH_URL"

  PROBE_LOCAL_OK=0
  PROBE_LOCAL_HTTP='000'
  PROBE_LOCAL_URL="$LOCAL_HEALTH_URL"
  PROBE_LOCAL_ATTEMPTS="${PROBE_127_ATTEMPTS:-$RETRY_COUNT}"
  PROBE_LOCALHOST_ATTEMPTS="${PROBE_LOCALHOST_ATTEMPTS:-$RETRY_COUNT}"
  PROBE_LOCAL_FALLBACK=0
  PROBE_LOCAL_STARTING=0
  PROBE_LOCAL_LOOPBACK_MISMATCH=0

  if [[ "${PROBE_127_OK:-0}" == "1" || "${PROBE_LOCALHOST_OK:-0}" == "1" ]]; then
    PROBE_LOCAL_OK=1
    if [[ "${PROBE_127_OK:-0}" == "1" ]]; then
      PROBE_LOCAL_HTTP="${PROBE_127_HTTP:-000}"
      PROBE_LOCAL_URL="$LOCAL_HEALTH_URL"
    fi
    if [[ "${PROBE_127_OK:-0}" != "${PROBE_LOCALHOST_OK:-0}" ]]; then
      PROBE_LOCAL_FALLBACK=1
      PROBE_LOCAL_LOOPBACK_MISMATCH=1
      if [[ "${PROBE_LOCALHOST_OK:-0}" == "1" ]]; then
        PROBE_LOCAL_URL="$LOCALHOST_HEALTH_URL"
        PROBE_LOCAL_HTTP="${PROBE_LOCALHOST_HTTP:-000}"
      fi
    fi
    if [[ "${PROBE_127_OK:-0}" == "1" && "${PROBE_LOCALHOST_OK:-0}" == "1" ]]; then
      if (( PROBE_127_ATTEMPTS > 1 || PROBE_LOCALHOST_ATTEMPTS > 1 )); then
        PROBE_LOCAL_STARTING=1
      fi
      if (( PROBE_127_ATTEMPTS > 1 || PROBE_LOCALHOST_ATTEMPTS > 1 )); then
        PROBE_LOCAL_HTTP="${PROBE_127_HTTP:-${PROBE_LOCALHOST_HTTP:-000}}"
      fi
    fi
    return 0
  fi

  return 1
}

probe_public_health() {
  local attempt=1 probe_result probe_http
  while (( attempt <= 3 )); do
    if probe_result="$(http_probe "$PUBLIC_HEALTH_URL")"; then
      probe_http="$(cut -d'|' -f1 <<<"$probe_result")"
      PROBE_PUBLIC_OK=1
      PROBE_PUBLIC_HTTP="$probe_http"
      PROBE_PUBLIC_ATTEMPTS="$attempt"
      return 0
    fi
    if (( attempt < 3 )); then
      sleep 1
    fi
    ((attempt++))
  done

  PROBE_PUBLIC_OK=0
  PROBE_PUBLIC_HTTP='000'
  PROBE_PUBLIC_ATTEMPTS=3
  return 1
}

tail_logs() {
  local file="$1"
  if [[ -f "$file" ]]; then
    echo "-- $file --"
    tail -n 30 "$file"
  fi
}

launchd_loaded=0
SERVER_SUMMARY="$(service_state_summary "$SERVER_LABEL")"
TUNNEL_SUMMARY="$(service_state_summary "$TUNNEL_LABEL")"
WATCHDOG_SUMMARY="$(service_state_summary "$WATCHDOG_LABEL")"
SERVER_STATE="${SERVER_SUMMARY%%|*}"
SERVER_REST="${SERVER_SUMMARY#*|}"
SERVER_PID="${SERVER_REST%%|*}"
SERVER_REST="${SERVER_REST#*|}"
SERVER_PROGRAM="${SERVER_REST%%|*}"
SERVER_LAST_EXIT="${SERVER_REST#*|}"
TUNNEL_STATE="${TUNNEL_SUMMARY%%|*}"
TUNNEL_REST="${TUNNEL_SUMMARY#*|}"
TUNNEL_PID="${TUNNEL_REST%%|*}"
TUNNEL_REST="${TUNNEL_REST#*|}"
TUNNEL_PROGRAM="${TUNNEL_REST%%|*}"
TUNNEL_LAST_EXIT="${TUNNEL_REST#*|}"
WATCHDOG_STATE="${WATCHDOG_SUMMARY%%|*}"
WATCHDOG_REST="${WATCHDOG_SUMMARY#*|}"
WATCHDOG_PID="${WATCHDOG_REST%%|*}"
WATCHDOG_REST="${WATCHDOG_REST#*|}"
WATCHDOG_PROGRAM="${WATCHDOG_REST%%|*}"
WATCHDOG_LAST_EXIT="${WATCHDOG_REST#*|}"

PORT_STATE="$(port_state_summary)"

sleep "$INITIAL_WAIT_SECONDS"
if probe_local_health; then
  LOCAL_STATUS="HEALTHY"
  if (( PROBE_LOCAL_LOOPBACK_MISMATCH == 1 )); then
    LOCAL_STATUS="DEGRADED"
  fi
else
  LOCAL_STATUS="UNHEALTHY"
fi

PUBLIC_STATUS="UNKNOWN"
if (( LOCAL_ONLY == 0 )); then
  if probe_public_health; then
    PUBLIC_STATUS="HEALTHY"
  else
    PUBLIC_STATUS="DEGRADED"
  fi
fi

FINAL_STATUS="UNKNOWN"
REASON=""
EXIT_CODE=2

if [[ "$SERVER_STATE" == "not loaded" && "$TUNNEL_STATE" == "not loaded" && "$WATCHDOG_STATE" == "not loaded" ]]; then
  FINAL_STATUS="UNHEALTHY"
  REASON="launchctl 服务未加载"
  EXIT_CODE=1
elif [[ "$SERVER_STATE" != "running" ]]; then
  FINAL_STATUS="UNHEALTHY"
  REASON="后端 launchd 状态异常：$SERVER_STATE"
  EXIT_CODE=1
elif [[ "$SERVER_PID" == "" || "$PORT_STATE" == "not listening" ]]; then
  if [[ "$LOCAL_STATUS" == "HEALTHY" || "$LOCAL_STATUS" == "DEGRADED" ]]; then
    FINAL_STATUS="$LOCAL_STATUS"
    REASON="服务已启动，但端口或 loopback 路径仍有差异"
    EXIT_CODE=0
  else
    FINAL_STATUS="STARTING"
    REASON="服务正在启动或端口尚未就绪"
    EXIT_CODE=1
  fi
elif [[ "$LOCAL_STATUS" == "HEALTHY" || "$LOCAL_STATUS" == "DEGRADED" ]]; then
  if [[ "$LOCAL_STATUS" == "DEGRADED" ]]; then
    FINAL_STATUS="DEGRADED"
    REASON="127.0.0.1 与 localhost 探测存在差异"
    EXIT_CODE=0
  elif [[ "$PUBLIC_STATUS" == "DEGRADED" && "$LOCAL_ONLY" -eq 0 ]]; then
    FINAL_STATUS="DEGRADED"
    REASON="本地服务正常，但公网 health 或 Cloudflare 暂时异常"
    EXIT_CODE=0
  else
    FINAL_STATUS="HEALTHY"
    REASON="本地服务与公网健康检查均通过"
    EXIT_CODE=0
  fi
else
  if [[ "$SERVER_STATE" == "running" && -n "$SERVER_PID" && "$PORT_STATE" != "not listening" ]]; then
    FINAL_STATUS="STARTING"
    REASON="后端进程和端口已就绪，但本地 health 在重试窗口内未恢复"
    EXIT_CODE=0
  else
    FINAL_STATUS="UNHEALTHY"
    REASON="本地 health 重试 ${RETRY_COUNT} 次后仍失败"
    EXIT_CODE=1
  fi
fi

if [[ "$STRICT_MODE" == "1" && "$FINAL_STATUS" == "DEGRADED" ]]; then
  EXIT_CODE=1
fi

echo "== production status =="
echo "launchd label: $SERVER_LABEL"
echo "launchctl state: $SERVER_STATE${SERVER_PID:+ (pid $SERVER_PID)}"
echo "process command: ${SERVER_PROGRAM:-unknown}"
[[ -n "${SERVER_LAST_EXIT:-}" ]] && echo "launchctl last exit: $SERVER_LAST_EXIT"
echo "tunnel label: $TUNNEL_LABEL"
echo "tunnel state: $TUNNEL_STATE${TUNNEL_PID:+ (pid $TUNNEL_PID)}"
echo "watchdog label: $WATCHDOG_LABEL"
echo "watchdog state: $WATCHDOG_STATE${WATCHDOG_PID:+ (pid $WATCHDOG_PID)}"
echo "port: $PORT_STATE"
echo "local health url: $LOCAL_HEALTH_URL"
echo "127.0.0.1 health attempts: ${PROBE_127_ATTEMPTS:-$RETRY_COUNT}"
echo "127.0.0.1 health result: ${PROBE_127_HTTP:-000}"
echo "localhost health attempts: ${PROBE_LOCALHOST_ATTEMPTS:-$RETRY_COUNT}"
echo "localhost health result: ${PROBE_LOCALHOST_HTTP:-000}"
echo "local health status: $LOCAL_STATUS"
echo "local health result: ${PROBE_LOCAL_HTTP:-000}"
echo "localhost health url: $LOCALHOST_HEALTH_URL"
echo "localhost fallback used: ${PROBE_LOCAL_FALLBACK:-0}"
if (( PROBE_LOCAL_STARTING == 1 )); then
  echo "boot phase: STARTING"
fi
echo "public health url: $PUBLIC_HEALTH_URL"
echo "public health status: $PUBLIC_STATUS"
echo "public health result: ${PROBE_PUBLIC_HTTP:-000}"
echo "proxy env: HTTP_PROXY=${HTTP_PROXY:+SET}${HTTP_PROXY:-UNSET} HTTPS_PROXY=${HTTPS_PROXY:+SET}${HTTPS_PROXY:-UNSET} NO_PROXY=${NO_PROXY:-UNSET}"
echo "final status: $FINAL_STATUS"
echo "reason: $REASON"

if [[ "$EXIT_CODE" -ne 0 ]]; then
  echo "== recent logs =="
  tail_logs "$APP_DIR/logs/server.out.log"
  tail_logs "$APP_DIR/logs/server.err.log"
  tail_logs "$APP_DIR/logs/cloudflared.out.log"
  tail_logs "$APP_DIR/logs/cloudflared.err.log"
  tail_logs "$APP_DIR/logs/watchdog.log"
fi

exit "$EXIT_CODE"
