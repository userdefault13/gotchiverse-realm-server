#!/usr/bin/env bash
# Start REALM BE (:2567) + Gotchiverse FE (:3001) together.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FE_DIR="${GOTCHIVERSE_FE_DIR:-$ROOT/../gotchiverse-2d}"

if [[ ! -f "$FE_DIR/package.json" ]]; then
  echo "Frontend not found at $FE_DIR" >&2
  echo "Clone gotchiverse-2d as a sibling, or set GOTCHIVERSE_FE_DIR." >&2
  exit 1
fi

cleanup() {
  trap - EXIT INT TERM
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "BE  → http://localhost:2567  ($ROOT)"
echo "FE  → http://localhost:3001  ($FE_DIR)"
echo "Ctrl+C stops both."

(cd "$ROOT" && npm run dev) &
(cd "$FE_DIR" && yarn dev) &
wait
