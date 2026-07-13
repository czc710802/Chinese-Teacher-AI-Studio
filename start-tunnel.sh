#!/bin/bash
# 高中作文AI批改App - 一键启动（前端 + 后端 + Cloudflare Tunnel）
PROJECT_DIR="/Users/chenxiansheng/Desktop/workspace/高中作文AI批改App"
PATH_BIN="/Users/chenxiansheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin"
CLOUDFLARED="$PROJECT_DIR/tools/cloudflared"
cd "$PROJECT_DIR"
echo "=== 启动 高中作文AI批改App ==="
# 启动后端
PUBLIC_APP_ORIGIN="https://pi.zhenwanyue.icu" PATH="$PATH_BIN/node/bin:$PATH" $PATH_BIN/pnpm --dir server dev > /tmp/server.log 2>&1 &
echo "后端: PID $!"
# 启动前端
PATH="$PATH_BIN/node/bin:$PATH" $PATH_BIN/pnpm --dir client dev > /tmp/client.log 2>&1 &
echo "前端: PID $!"
sleep 4
# 启动 Tunnel
$CLOUDFLARED --config "$PROJECT_DIR/tools/cloudflared-production.yml" tunnel run gaozhong-yuwen > /tmp/tunnel.log 2>&1 &
echo "Tunnel: PID $!"
sleep 3
echo "公网地址: https://pi.zhenwanyue.icu"
echo "按 Ctrl+C 停止"
wait
