#!/usr/bin/env bash
# The pull tabs' press areas on a phone, measured: pulltabs-touch.html against
# this tree's stylesheets, driven by pulltabs-touch.mjs. Usage:
#   tools/visual/pulltabs-touch.sh [out.png]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
shell="$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell"
[ -x "$shell" ] || { echo "no headless chromium at $shell -- see memory vesper-chromium-install-stalls" >&2; exit 1; }
tmp="$here/.pulltabs-touch.$$.html"
trap 'rm -f "$tmp"' EXIT
python3 - "$here/pulltabs-touch.html" "$here/_head.html" "$tmp" <<'PY'
import sys, pathlib
page, head, out = (pathlib.Path(a) for a in sys.argv[1:4])
out.write_text(page.read_text().replace('<!--#head-->', head.read_text()))
PY
node "$here/pulltabs-touch.mjs" "$shell" "file://$tmp" "${1:-}"
