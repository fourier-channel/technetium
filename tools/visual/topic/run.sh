#!/usr/bin/env bash
# The room header's topic popup and editor, driven in headless Chromium:
# builds main.tsx (the real component, a stand-in room), serves it on
# loopback, runs drive.mjs. Usage: tools/visual/topic/run.sh [shot.png]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
shell="$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell"
[ -x "$shell" ] || { echo "no headless chromium at $shell -- see memory vesper-chromium-install-stalls" >&2; exit 1; }
(cd "$root" && npx --no-install vite build -c "$here/vite.config.mjs" > /dev/null)
dist="$here/../out/topic-dist"
python3 -m http.server 18766 --bind 127.0.0.1 --directory "$dist" > /dev/null 2>&1 &
server=$!
trap 'kill "$server"' EXIT
sleep 1
node "$here/drive.mjs" "$shell" http://127.0.0.1:18766/index.html "${1:-}"
