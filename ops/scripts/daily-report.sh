#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_common.sh"

APP_DIR="$(project_root)"
REPORT_DIR="$APP_DIR/reports"
LOG_DIR="$APP_DIR/logs"
mkdir -p "$REPORT_DIR" "$LOG_DIR"
load_env_file "$APP_DIR/.env.production"

STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_FILE="$REPORT_DIR/daily-report-$STAMP.md"
STATUS_JSON="$(curl -fsS http://127.0.0.1:4000/api/system/status 2>/dev/null || true)"

cat > "$REPORT_FILE" <<EOF
# Daily Report

- timestamp: $(date '+%Y-%m-%d %H:%M:%S')
- version: $(printf '%s' "$STATUS_JSON" | node -e 'const fs=require("fs"); const raw=fs.readFileSync(0,"utf8")||"{}"; try { const data=JSON.parse(raw); process.stdout.write(String(data.version || "unknown")); } catch { process.stdout.write("unknown"); }')
- local health: $(printf '%s' "$STATUS_JSON" | node -e 'const fs=require("fs"); const raw=fs.readFileSync(0,"utf8")||"{}"; try { const data=JSON.parse(raw); process.stdout.write(data.localHealth?.ok ? "PASS" : "FAIL"); } catch { process.stdout.write("unknown"); }')
- public health: $(printf '%s' "$STATUS_JSON" | node -e 'const fs=require("fs"); const raw=fs.readFileSync(0,"utf8")||"{}"; try { const data=JSON.parse(raw); process.stdout.write(data.publicHealth?.ok ? "PASS" : "FAIL"); } catch { process.stdout.write("unknown"); }')
EOF

bash "$SCRIPT_DIR/notify.sh" --markdown "$(cat <<MSG
运维日报已生成
报告路径：$REPORT_FILE
MSG
)"

echo "$REPORT_FILE"
