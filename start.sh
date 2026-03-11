#!/bin/bash
# ============================================================
# UAE WAR ROOM — Start Script
# Usage:
#   ./start.sh           → run directly (foreground)
#   ./start.sh pm2       → run via PM2 (background, auto-restart)
#   ./start.sh stop      → stop PM2 instance
#   ./start.sh restart   → restart PM2 instance
#   ./start.sh status    → show PM2 status
#   PORT=8080 ./start.sh → run on custom port
# ============================================================

set -e

APP_NAME="warroom"
PORT="${PORT:-3000}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "🛡  UAE WAR ROOM CONSOLE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Check / install Node.js ─────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "⚙  Node.js not found — installing via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo "✓  Node.js $(node -v) installed"
else
  echo "✓  Node.js $(node -v)"
fi

# ── Handle commands ─────────────────────────────────────────
case "${1:-start}" in

  pm2)
    if ! command -v pm2 &>/dev/null; then
      echo "⚙  PM2 not found — installing..."
      sudo npm install -g pm2
    fi
    echo "✓  PM2 $(pm2 -v)"
    echo ""
    cd "$DIR"
    pm2 describe "$APP_NAME" &>/dev/null \
      && pm2 restart "$APP_NAME" \
      || PORT=$PORT pm2 start server.js --name "$APP_NAME" \
           --env production \
           --log "$DIR/warroom.log" \
           --time
    pm2 save
    echo ""
    echo "✓  Running via PM2 on port $PORT"
    echo "   Logs:    pm2 logs $APP_NAME"
    echo "   Status:  pm2 status"
    echo "   Stop:    ./start.sh stop"
    ;;

  stop)
    pm2 stop "$APP_NAME" && echo "✓  Stopped" || echo "✗  Not running"
    ;;

  restart)
    pm2 restart "$APP_NAME" && echo "✓  Restarted" || echo "✗  Not running — use: ./start.sh pm2"
    ;;

  status)
    pm2 describe "$APP_NAME" || echo "Not running via PM2"
    ;;

  start|*)
    echo "   Port:    $PORT"
    echo "   URL:     http://localhost:$PORT"
    echo "   Debug:   http://localhost:$PORT/api/status"
    echo ""
    echo "   Tip: run './start.sh pm2' to run in background"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    cd "$DIR"
    PORT=$PORT node server.js
    ;;

esac
