#!/usr/bin/env bash
set -euo pipefail

echo "Building..."
npm run build

echo "Stopping agent-bridge..."
systemctl --user stop agent-bridge

# Kill any stray node processes running dist/transport.js or dist/index.js (outside systemd)
stray_pids=$(ps aux | grep -E 'node.*dist/(transport|index)\.js' | grep -v grep | awk '{print $2}' || true)
if [ -n "$stray_pids" ]; then
  echo "Killing stray bridge processes: $stray_pids"
  echo "$stray_pids" | xargs kill 2>/dev/null || true
  sleep 1
fi

echo "Starting agent-bridge..."
systemctl --user start agent-bridge
sleep 1

systemctl --user status agent-bridge --no-pager
