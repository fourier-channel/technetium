#!/usr/bin/env bash
# Deploy Technetium. A build is published to a PREVIEW first and promoted to
# production as the same bytes; nothing is rebuilt between the two.
#
#   ./deploy.sh             build the working tree, ship it to a new release dir,
#                           point 'preview' at it (build.tc.41chan.net). Production
#                           is untouched.
#   ./deploy.sh --promote   point 'current' (tc.41chan.net) at the release the
#                           preview serves; the release it replaces becomes
#                           'previous'.
#   ./deploy.sh --rollback  swap 'current' and 'previous'. Run twice, it undoes
#                           itself.
#   ./deploy.sh --status    print where each link points and the release history.
#
# Every flip is atomic (a temp link renamed over the old one, never an unlink then
# a link), so no request ever finds the link missing. Every flip is appended to
# /srv/tc/history. Pruning keeps the newest KEEP releases plus whatever current,
# previous and preview point at, so a rollback target is never pruned.
#
# A promote is verified against the SERVED page, not the link: the asset name
# tc.41chan.net's index.html references must be the one in the promoted release.
#
# Driven from vesper; reaches the origin via the 41chan-origin SSH alias. The
# remote half is one quoted heredoc fed to `bash -s` with positional arguments:
# nothing local is interpolated into the remote command line.
set -euo pipefail

REMOTE="41chan-origin"
REMOTE_BASE="/srv/tc"
PROD_URL="https://tc.41chan.net/"
KEEP=5

cd "$(dirname "$0")"

# The remote half. $1 is the action, $2 the base dir, $3 a release name or KEEP.
remote() {
  ssh "$REMOTE" bash -s -- "$@" <<'REMOTE_EOF'
set -euo pipefail
action="$1"; base="$2"; arg="${3:-}"
cd "$base"
flip() { # flip <link> <target-dir>
  ln -sfn "$2" ".$1.tmp"
  mv -T ".$1.tmp" "$1"
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$(basename "$2")" >> history
}
target() { [ -L "$1" ] && basename "$(readlink "$1")" || echo "-"; }
case "$action" in
  preview)
    [ -d "releases/$arg" ] || { echo "no release $arg" >&2; exit 1; }
    flip preview "$base/releases/$arg" ;;
  promote)
    p="$(target preview)"; c="$(target current)"
    [ "$p" != "-" ] || { echo "nothing to promote: no preview link" >&2; exit 1; }
    [ "$p" != "$c" ] || { echo "preview already is production: $p" >&2; exit 1; }
    [ "$c" = "-" ] || flip previous "$base/releases/$c"
    flip current "$base/releases/$p" ;;
  rollback)
    p="$(target previous)"; c="$(target current)"
    [ "$p" != "-" ] && [ -d "releases/$p" ] || { echo "no previous release to roll back to" >&2; exit 1; }
    [ "$c" != "-" ] || { echo "no current release to roll back from" >&2; exit 1; }
    flip previous "$base/releases/$c"
    flip current "$base/releases/$p" ;;
  prune)
    keep="$(printf '%s\n' "$(target current)" "$(target previous)" "$(target preview)")"
    cd releases
    ls -1dt -- */ | sed 's#/$##' | tail -n +"$((arg + 1))" | while read -r r; do
      printf '%s\n' "$keep" | grep -qxF -- "$r" || rm -rf -- "$r"
    done ;;
  status) ;;
  *) echo "unknown action $action" >&2; exit 2 ;;
esac
for l in current previous preview; do printf '%-9s %s\n' "$l" "$(target "$l")"; done
echo "-- last flips"; tail -n 5 history 2>/dev/null || echo "(no history yet)"
REMOTE_EOF
}

# The asset name an index.html references -- the identity of a build.
asset_of() { grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -n 1; }

case "${1:-}" in
  "")
    HASH="$(git rev-parse --short HEAD)"
    if ! git diff --quiet || ! git diff --cached --quiet; then HASH="${HASH}-dirty"; fi
    RELEASE="$(date +%Y%m%d-%H%M%S)-${HASH}"

    echo ">> building (vite production)"
    npm run build

    echo ">> shipping dist/ -> ${REMOTE}:${REMOTE_BASE}/releases/${RELEASE}"
    ssh "$REMOTE" mkdir -p -- "${REMOTE_BASE}/releases/${RELEASE}"
    scp -q -r dist/. "${REMOTE}:${REMOTE_BASE}/releases/${RELEASE}/"

    echo ">> preview -> ${RELEASE}"
    remote preview "$REMOTE_BASE" "$RELEASE"
    remote prune "$REMOTE_BASE" "$KEEP" > /dev/null
    echo ">> production untouched. Click through build.tc.41chan.net, then ./deploy.sh --promote"
    ;;
  --promote|--rollback)
    remote "${1#--}" "$REMOTE_BASE"
    want="$(ssh "$REMOTE" cat -- "${REMOTE_BASE}/current/index.html" | asset_of)"
    served="$(curl -fsS "$PROD_URL" | asset_of || true)"
    if [ -z "$want" ] || [ "$want" != "$served" ]; then
      echo "!! ${PROD_URL} serves '${served}', the release holds '${want}'" >&2
      exit 1
    fi
    echo ">> ${PROD_URL} serves ${served}"
    ;;
  --status)
    remote status "$REMOTE_BASE"
    ;;
  *)
    echo "usage: ./deploy.sh [--promote | --rollback | --status]" >&2
    exit 2
    ;;
esac
