#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_ROOT="$APP_DIR/backups/nas"
STAMP="$(date +%Y%m%d-%H%M%S)"
DOW="$(date +%u)"
DOM="$(date +%d)"

mkdir -p "$BACKUP_ROOT/database" "$BACKUP_ROOT/uploads" "$BACKUP_ROOT/config"

make_archive() {
  local kind="$1"
  local scope="$2"
  shift 2
  local archive="$BACKUP_ROOT/$scope/${kind}-${scope}-${STAMP}.tar.gz"
  local existing=()
  for item in "$@"; do
    [[ -e "$APP_DIR/$item" ]] && existing+=("$item")
  done
  if [[ ${#existing[@]} -eq 0 ]]; then
    printf '%s\n' "skip empty backup scope: $scope" >&2
    return 0
  fi
  tar -czf "$archive" \
    --exclude='node_modules' \
    --exclude='client/dist' \
    --exclude='logs' \
    --exclude='backups' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='.env.production' \
    --exclude='.env.production.local' \
    --exclude='.env.nas' \
    --exclude='.env.*.local' \
    --exclude='*.pem' \
    --exclude='*.key' \
    --exclude='*.token' \
    --exclude='*.creds' \
    -C "$APP_DIR" "${existing[@]}"
  tar -tzf "$archive" >/dev/null
  printf '%s\n' "$archive"
}

sync_archive() {
  local archive="$1"
  [[ -z "$archive" ]] && return 0
  local scope
  scope="$(basename "$(dirname "$archive")")"
  local remote="backups/$scope/$(basename "$archive")"
  node "$APP_DIR/ops/scripts/sync-nas-now.mjs" --file "$archive" --remote "$remote"
}

prune_local_scope() {
  local scope="$1"
  local pattern="$2"
  local keep="$3"
  find "$BACKUP_ROOT/$scope" -type f -name "$pattern" -print | sort -r | awk "NR>${keep}" | while IFS= read -r old_file; do
    rm -f "$old_file"
  done
}

run_backup_set() {
  local kind="$1"
  local db_archive uploads_archive config_archive
  db_archive="$(make_archive "$kind" database data/essay-review.sqlite data/essay-ai)"
  uploads_archive="$(make_archive "$kind" uploads server/uploads server/exports)"
  config_archive="$(make_archive "$kind" config package.json package-lock.json server/package.json client/package.json ops docs start-production.sh start-tunnel.sh .env.production.example .env.nas.example)"

  sync_archive "$db_archive"
  sync_archive "$uploads_archive"
  sync_archive "$config_archive"
}

run_backup_set daily
[[ "$DOW" == "1" ]] && run_backup_set weekly
[[ "$DOM" == "01" ]] && run_backup_set monthly

prune_local_scope database 'daily-database-*.tar.gz' 7
prune_local_scope uploads 'daily-uploads-*.tar.gz' 7
prune_local_scope config 'daily-config-*.tar.gz' 7
prune_local_scope database 'weekly-database-*.tar.gz' 4
prune_local_scope uploads 'weekly-uploads-*.tar.gz' 4
prune_local_scope config 'weekly-config-*.tar.gz' 4
prune_local_scope database 'monthly-database-*.tar.gz' 6
prune_local_scope uploads 'monthly-uploads-*.tar.gz' 6
prune_local_scope config 'monthly-config-*.tar.gz' 6

printf '%s\n' "NAS backup finished: $STAMP"
