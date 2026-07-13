#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "== system =="
sw_vers || true
uname -a || true
echo

echo "== runtime =="
command -v node || true
node -v || true
command -v npm || true
npm -v || true
command -v cloudflared || true
"$APP_DIR/tools/cloudflared" --version 2>/dev/null || true
echo

echo "== port 4000 =="
lsof -nP -iTCP:4000 -sTCP:LISTEN || echo "not listening"
echo

echo "== production status =="
bash "$APP_DIR/ops/scripts/status-production.sh"
