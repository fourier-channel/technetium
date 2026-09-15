#!/usr/bin/env bash
# Render one harness page from tools/visual/ with the repo's OWN stylesheets and
# screenshot it, so a CSS change can be LOOKED AT on a headless box instead of
# being asserted (VERIFICATION-DOCTRINE rule 9).
#
# What it proves: the stylesheet in this tree produces this shape for this
# markup. What it does NOT prove: that the React tree emits this markup, or
# that anything works against a live homeserver. Say which half you saw.
#
# Each page carries the literal marker <!--#head--> where _head.html goes; the
# substitution happens into a temp copy, so the page in the repo stays a
# template and re-rendering is idempotent.
#
#   tools/visual/render.sh rows.html 900 700 [out.png] [scale]
#
# `scale` is the device scale factor: 2 renders the same layout at twice the
# pixel density, which is how a 1px outline or a 3px rail gets looked at
# honestly rather than through a screenshot that lost it to rounding.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
page="${1:?usage: render.sh <page.html> [w] [h] [out.png]}"
w="${2:-900}"
h="${3:-700}"
out="${4:-$here/out/$(basename "${page%.html}").png}"
scale="${5:-1}"
shell="$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell"
[ -x "$shell" ] || { echo "no headless chromium at $shell -- see memory vesper-chromium-install-stalls" >&2; exit 1; }
[ -f "$here/$page" ] || { echo "no such harness page: $here/$page" >&2; exit 1; }
mkdir -p "$(dirname "$out")"
tmp="$here/.render.$$.html"
trap 'rm -f "$tmp"' EXIT
python3 - "$here/$page" "$here/_head.html" "$tmp" <<'PY'
import sys, pathlib
page, head, out = (pathlib.Path(a) for a in sys.argv[1:4])
body = page.read_text()
if '<!--#head-->' not in body:
    sys.exit('harness page %s has no <!--#head--> marker' % page.name)
out.write_text(body.replace('<!--#head-->', head.read_text()))
PY
"$shell" --no-sandbox --disable-gpu --hide-scrollbars \
  --virtual-time-budget=2500 --force-device-scale-factor="$scale" \
  --screenshot="$out" --window-size="$w,$h" \
  "file://$tmp" >/dev/null 2>&1
echo "$out"
