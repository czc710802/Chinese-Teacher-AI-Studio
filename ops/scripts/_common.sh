#!/bin/bash
set -euo pipefail

project_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
}

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}
