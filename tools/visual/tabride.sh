#!/usr/bin/env bash
# Frame-sample the pull tabs against their panels in headless Chromium, on
# this tree's own stylesheet (tabride.html): every animation frame through an
# open and a close of the dock, the thread strip and the thread view, where
# the tab's attached side is against the panel's moving edge, and the largest
# frame-to-frame step the tab takes beyond the edge's own (a teleport).
#
# Proves: the stylesheet and the state sequence App.tsx uses carry the tab
# with the edge. Does NOT prove the React tree emits that sequence (the
# source checks in checks/tabRide.check.ts hold that), nor a real browser
# window's frame pacing.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
shell="$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell"
[ -x "$shell" ] || { echo "no headless chromium at $shell" >&2; exit 1; }
tmp="$here/.tabride.$$.html"
trap 'rm -f "$tmp"; kill ${srv:-0} 2>/dev/null || true' EXIT
python3 - "$here/tabride.html" "$here/_head.html" "$tmp" <<'PY'
import sys, pathlib
page, head, out = (pathlib.Path(a) for a in sys.argv[1:4])
out.write_text(page.read_text().replace('<!--#head-->', head.read_text()))
PY
port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$root" >/dev/null 2>&1 &
srv=$!
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$port/tools/visual/$(basename "$tmp")" && break; sleep 0.1; done
node "$here/cdp-result.mjs" "$shell" "http://127.0.0.1:$port/tools/visual/$(basename "$tmp")?before=1"
node "$here/cdp-result.mjs" "$shell" "http://127.0.0.1:$port/tools/visual/$(basename "$tmp")"
