#!/usr/bin/env bash
set -euo pipefail

echo "=== Agent Bridge Status ==="
systemctl --user status agent-bridge --no-pager 2>&1 | head -8 || true
echo ""
echo "=== Live Logs (Ctrl+C to exit) ==="
journalctl --user -u agent-bridge -f --no-pager
