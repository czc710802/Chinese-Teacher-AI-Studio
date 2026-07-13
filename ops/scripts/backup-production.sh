#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_common.sh"

APP_DIR="$(project_root)"
BACKUP_DIR="$APP_DIR/backups"
mkdir -p "$BACKUP_DIR"
load_env_file "$APP_DIR/.env.production"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/backup-$STAMP.tar.gz"

paths=()
for candidate in \
  server \
  client \
  ops \
  docs \
  package.json \
  package-lock.json \
  .env.production.example \
  server/package.json \
  client/package.json
do
  [[ -e "$APP_DIR/$candidate" ]] && paths+=("$candidate")
done

tar -czf "$BACKUP_FILE" --exclude='node_modules' --exclude='logs' --exclude='backups' --exclude='reports' -C "$APP_DIR" "${paths[@]}" >/dev/null 2>&1 || true

if [[ ! -f "$BACKUP_FILE" ]]; then
  printf '%s\n' "backup file not created" >&2
  exit 1
fi

bash "$SCRIPT_DIR/notify.sh" --markdown "$(cat <<MSG
备份完成
备份文件：$BACKUP_FILE
MSG
)"

echo "$BACKUP_FILE"
