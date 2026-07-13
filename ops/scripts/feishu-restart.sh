#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "$APP_DIR/ops/scripts/feishu-control.mjs" restart "$APP_DIR"
