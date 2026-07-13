#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLIST_DIR="$APP_DIR/ops/launchd"
LOG_DIR="$APP_DIR/logs"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

SERVER_LABEL="com.zhenwanyue.ai-server"
TUNNEL_LABEL="com.zhenwanyue.cloudflared"
WATCHDOG_LABEL="com.zhenwanyue.health-watchdog"

SERVER_SOURCE_PLIST="$PLIST_DIR/$SERVER_LABEL.plist"
TUNNEL_SOURCE_PLIST="$PLIST_DIR/$TUNNEL_LABEL.plist"
WATCHDOG_SOURCE_PLIST="$PLIST_DIR/$WATCHDOG_LABEL.plist"
SERVER_PLIST="$LAUNCH_AGENTS_DIR/$SERVER_LABEL.plist"
TUNNEL_PLIST="$LAUNCH_AGENTS_DIR/$TUNNEL_LABEL.plist"
WATCHDOG_PLIST="$LAUNCH_AGENTS_DIR/$WATCHDOG_LABEL.plist"
LEGACY_SERVER_PLIST="$APP_DIR/tools/launchd/icu.zhenwanyue.gaozhong-zuowen.server.plist"
LEGACY_TUNNEL_PLIST="$APP_DIR/tools/launchd/icu.zhenwanyue.gaozhong-zuowen.tunnel.plist"

mkdir -p "$LOG_DIR"
mkdir -p "$LAUNCH_AGENTS_DIR"
ln -sfn /tmp/gaozhong-zuowen-server.out.log "$LOG_DIR/server.out.log"
ln -sfn /tmp/gaozhong-zuowen-server.err.log "$LOG_DIR/server.err.log"
ln -sfn /tmp/gaozhong-zuowen-cloudflared.out.log "$LOG_DIR/cloudflared.out.log"
ln -sfn /tmp/gaozhong-zuowen-cloudflared.err.log "$LOG_DIR/cloudflared.err.log"
ln -sfn /tmp/gaozhong-zuowen-watchdog.log "$LOG_DIR/watchdog.log"

ensure_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "缺少文件: $file" >&2
    exit 1
  fi
}

resolve_executable() {
  local label="$1"
  shift
  local candidate
  for candidate in "$@"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  echo "无法定位可执行文件: $label" >&2
  exit 1
}

command_path() {
  command -v "$1" 2>/dev/null || true
}

install_plists() {
  local node_bin cloudflared_bin
  node_bin="$(resolve_executable \
    "node" \
    "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" \
    "$(command_path node)" \
    /usr/local/bin/node \
    /opt/homebrew/bin/node \
    /usr/bin/node)"
  cloudflared_bin="$(resolve_executable \
    "cloudflared" \
    "$APP_DIR/tools/cloudflared" \
    "$(command_path cloudflared)" \
    /usr/local/bin/cloudflared \
    /opt/homebrew/bin/cloudflared)"

  cp "$SERVER_SOURCE_PLIST" "$SERVER_PLIST"
  cp "$TUNNEL_SOURCE_PLIST" "$TUNNEL_PLIST"
  cp "$WATCHDOG_SOURCE_PLIST" "$WATCHDOG_PLIST"

  /usr/libexec/PlistBuddy -c "Set :WorkingDirectory $APP_DIR" "$SERVER_PLIST"
  /usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $node_bin" "$SERVER_PLIST"
  /usr/libexec/PlistBuddy -c "Set :ProgramArguments:1 $APP_DIR/server/src/index.js" "$SERVER_PLIST"
  /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:PATH $(dirname "$node_bin"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" "$SERVER_PLIST"

  /usr/libexec/PlistBuddy -c "Set :WorkingDirectory $APP_DIR" "$TUNNEL_PLIST"
  /usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $cloudflared_bin" "$TUNNEL_PLIST"
  /usr/libexec/PlistBuddy -c "Set :ProgramArguments:3 $APP_DIR/tools/cloudflared-production.yml" "$TUNNEL_PLIST"

  /usr/libexec/PlistBuddy -c "Set :WorkingDirectory $APP_DIR" "$WATCHDOG_PLIST"
  /usr/libexec/PlistBuddy -c "Set :ProgramArguments:1 $APP_DIR/ops/scripts/health-watchdog.sh" "$WATCHDOG_PLIST"

  chmod 644 "$SERVER_PLIST" "$TUNNEL_PLIST" "$WATCHDOG_PLIST"
}

install_job() {
  local label="$1"
  local plist="$2"
  launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  launchctl bootstrap "$DOMAIN" "$plist"
  launchctl enable "$DOMAIN/$label" >/dev/null 2>&1 || true
  launchctl kickstart -k "$DOMAIN/$label"
}

uninstall_legacy_job() {
  local label="$1"
  local plist="$2"
  if [[ -f "$plist" ]]; then
    launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  fi
  launchctl disable "$DOMAIN/$label" >/dev/null 2>&1 || true
}

ensure_file "$SERVER_SOURCE_PLIST"
ensure_file "$TUNNEL_SOURCE_PLIST"
ensure_file "$WATCHDOG_SOURCE_PLIST"
ensure_file "$APP_DIR/server/src/index.js"
ensure_file "$APP_DIR/tools/cloudflared-production.yml"
ensure_file "$APP_DIR/ops/scripts/health-watchdog.sh"

install_plists

uninstall_legacy_job "icu.zhenwanyue.gaozhong-zuowen.server" "$LEGACY_SERVER_PLIST"
uninstall_legacy_job "icu.zhenwanyue.gaozhong-zuowen.tunnel" "$LEGACY_TUNNEL_PLIST"

install_job "$SERVER_LABEL" "$SERVER_PLIST"
install_job "$TUNNEL_LABEL" "$TUNNEL_PLIST"
install_job "$WATCHDOG_LABEL" "$WATCHDOG_PLIST"

echo "launchd 已安装并启动。"
echo "server:    $SERVER_PLIST"
echo "cloudflared: $TUNNEL_PLIST"
echo "watchdog:   $WATCHDOG_PLIST"
