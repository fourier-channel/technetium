#!/usr/bin/env bash
# Run client/deviceLock.ts against the REAL Web Locks API and BroadcastChannel
# in the installed headless Chromium, two same-origin frames standing in for
# two tabs (devicelock.html). Proves the browser behaves as the model in
# checks/deviceLock.check.ts assumes: ifAvailable answers busy, steal hands the
# lock over and the old holder is told (onLost), its stop is heard, a release
# frees it. Does NOT prove the app's boot path against a live homeserver.
#
#   tools/visual/devicelock.sh        -> prints the result block
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
shell="$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell"
[ -x "$shell" ] || { echo "no headless chromium at $shell" >&2; exit 1; }
mkdir -p "$here/out"
# The module as the browser will run it: Node strips the types, nothing else.
node --no-warnings -e "const m=require('node:module');const fs=require('node:fs');fs.writeFileSync(process.argv[2], m.stripTypeScriptTypes(fs.readFileSync(process.argv[1],'utf8')))" \
  "$root/src/client/deviceLock.ts" "$here/out/deviceLock.js"
# Web Locks need a secure context with a real origin: localhost http is one, file:// is not.
port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$here" >/dev/null 2>&1 &
srv=$!
trap 'kill $srv 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$port/devicelock.html" && break; sleep 0.1; done
node "$here/cdp-result.mjs" "$shell" "http://127.0.0.1:$port/devicelock.html"
