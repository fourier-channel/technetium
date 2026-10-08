#!/usr/bin/env bash
# Measure dividerdrag.html in headless Chromium on this tree's own stylesheet
# (launch-polish L29): a panel's size one frame after a drag step, with and
# without the held-divider attribute, and the name card's height across the
# widths a room-list drag passes through. Pass a git ref to measure that
# revision's stylesheet instead (e.g. HEAD~1) -- the page is the same, only
# src/index.css changes.
#
# Proves the stylesheet's half; checks/dividerDrag.check.ts holds the source.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
shell="$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell"
[ -x "$shell" ] || { echo "no headless chromium at $shell" >&2; exit 1; }
tmp="$here/.dividerdrag.$$.html"
css="$root/src/.dividerdrag.$$.css"
trap 'rm -f "$tmp" "$css"; kill ${srv:-0} 2>/dev/null || true' EXIT
head="$(cat "$here/_head.html")"
if [ -n "${1:-}" ]; then
  git -C "$root" show "$1:src/index.css" > "$css"
  head="${head//src\/index.css/src\/$(basename "$css")}"
fi
HEAD_HTML="$head" python3 - "$here/dividerdrag.html" "$tmp" <<'PY'
import os, sys, pathlib
page, out = (pathlib.Path(a) for a in sys.argv[1:3])
out.write_text(page.read_text().replace('<!--#head-->', os.environ['HEAD_HTML']))
PY
port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$root" >/dev/null 2>&1 &
srv=$!
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$port/tools/visual/$(basename "$tmp")" && break; sleep 0.1; done
node "$here/cdp-result.mjs" "$shell" "http://127.0.0.1:$port/tools/visual/$(basename "$tmp")"
