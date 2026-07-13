#!/bin/bash
# 高中作文 AI 批改 App - 生产模式启动脚本
# 启动 Express（带自动重启）+ Cloudflare Tunnel

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="/Users/chenxiansheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
CLOUDFLARED="$APP_DIR/tools/cloudflared"
TUNNEL_CONFIG="$APP_DIR/tools/cloudflared-production.yml"
PORT=4000
PUBLIC_APP_ORIGIN="${PUBLIC_APP_ORIGIN:-https://pi.zhenwanyue.icu}"

cd "$APP_DIR"
mkdir -p data

echo "=== 启动 高中作文 AI 批改 App（生产模式）==="
echo "端口: $PORT"
echo "公网 Origin: $PUBLIC_APP_ORIGIN"
echo "PID 文件: /tmp/express.pid /tmp/tunnel.pid"
echo "日志: /tmp/express.log /tmp/tunnel.log"
echo ""

# 启动 Express（带自动重启循环）
start_express() {
  while true; do
    echo "[$(date)] 启动 Express..."
    PORT=$PORT PUBLIC_APP_ORIGIN="$PUBLIC_APP_ORIGIN" $NODE server/src/index.js 2>&1
    EXIT_CODE=$?
    echo "[$(date)] Express 退出 (代码: $EXIT_CODE)，3 秒后重启..."
    sleep 3
  done
}

start_express &
EXPRESS_PID=$!
echo $EXPRESS_PID > /tmp/express.pid
echo "Express 包装器 PID: $EXPRESS_PID"

sleep 4

if ! curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  echo "Express 未能在端口 $PORT 启动，请查看 /tmp/express.log"
  exit 1
fi

# 启动 Tunnel
$CLOUDFLARED tunnel --config "$TUNNEL_CONFIG" run gaozhong-yuwen &
TUNNEL_PID=$!
echo $TUNNEL_PID > /tmp/tunnel.pid
echo "Tunnel PID: $TUNNEL_PID"

echo ""
echo "=== 启动完成 ==="
echo "本地访问: http://localhost:$PORT"
echo "公网地址: https://pi.zhenwanyue.icu"
echo ""
echo "停止服务: kill \$(cat /tmp/express.pid) \$(cat /tmp/tunnel.pid)"

wait
