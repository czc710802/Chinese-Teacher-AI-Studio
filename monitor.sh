#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$APP_DIR/ops/scripts/health-watchdog.sh" --once
