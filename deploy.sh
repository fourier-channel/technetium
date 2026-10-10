#!/usr/bin/env bash
# Deploy Technetium. A build is published to a PREVIEW first and promoted to
# production as the same bytes; nothing is rebuilt between the two.
#
#   ./deploy.sh             build the working tree, ship it to a new release dir,
#                           point 'preview' at it (build.tc.41chan.net). Production
#                           is untouched.
#   ./deploy.sh --promote   give the preview's release a VERSION, point 'current'
#                           (tc.41chan.net) at it, and tag its commit; the release
#                           it replaces becomes 'previous'.
#   ./deploy.sh --rollback  swap 'current' and 'previous'. Run twice, it undoes
#                           itself. No new version: each release keeps its own.
#   ./deploy.sh --status    print where each link points and the release history.
#
# VERSIONS ARE CALVER, ASSIGNED AT PROMOTE (operator, 2026-10-10): the UTC date
# of the promote, YYYY.MM.DD, and YYYY.MM.DD.2, .3 for a second and third
# promote that day; the commit is tagged v<version> and pushed. A preview has no
# version -- it is not a release until it is promoted. Each release dir carries
# release.json {release, commit, version}, which the client reads to show its
# build in the beta notice (client/releaseInfo.ts): written with version null
# when published, rewritten with the version when promoted. A release built
# from an uncommitted tree (-dirty) cannot be promoted: no commit to tag.
#
# Every flip is atomic (a temp link renamed over the old one, never an unlink then
# a link), so no request ever finds the link missing. Every flip is appended to
# /srv/tc/history. Pruning keeps the newest KEEP releases plus whatever current,
# previous and preview point at, so a rollback target is never pruned.
#
# A promote is verified against the SERVED site, not the link: the asset name
# tc.41chan.net's index.html references must be the one in the promoted release,
# and its /release.json must carry the new version.
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

die() { echo "!! $*" >&2; exit 1; }

# The remote half. $1 the action, $2 the base dir, $3 a release, link or KEEP,
# $4 a version.
remote() {
  ssh "$REMOTE" bash -s -- "$@" <<'REMOTE_EOF'
set -euo pipefail
action="$1"; base="$2"; arg="${3:-}"; version="${4:-}"
cd "$base"
flip() { # flip <link> <target-dir>
  ln -sfn "$2" ".$1.tmp"
  mv -T ".$1.tmp" "$1"
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$(basename "$2")" >> history
}
target() { [ -L "$1" ] && basename "$(readlink "$1")" || echo "-"; }
case "$action" in
  target)
    target "$arg"; exit 0 ;;
  release-json)
    cat -- "releases/$arg/release.json" 2>/dev/null || true; exit 0 ;;
  stamp)
    [[ "$arg" =~ ^[0-9]{8}-[0-9]{6}-([0-9a-f]{7,40})$ ]] || { echo "refusing to version release '$arg': not <stamp>-<commit>" >&2; exit 1; }
    commit="${BASH_REMATCH[1]}"
    [[ "$version" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$ ]] || { echo "refusing version '$version': not YYYY.MM.DD[.N]" >&2; exit 1; }
    [ -d "releases/$arg" ] || { echo "no release $arg" >&2; exit 1; }
    printf '{"release":"%s","commit":"%s","version":"%s"}\n' "$arg" "$commit" "$version" > "releases/$arg/.release.json.tmp"
    mv -T "releases/$arg/.release.json.tmp" "releases/$arg/release.json"
    exit 0 ;;
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
for l in current previous preview; do
  r="$(target "$l")"
  v="$(grep -o '"version":"[^"]*"' "releases/$r/release.json" 2>/dev/null | cut -d'"' -f4 || true)"
  printf '%-9s %s%s\n' "$l" "$r" "${v:+  (v$v)}"
done
echo "-- last flips"; tail -n 5 history 2>/dev/null || echo "(no history yet)"
REMOTE_EOF
}

# The asset name an index.html references -- the identity of a build.
asset_of() { grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -n 1; }
# The version a release.json carries, or nothing.
version_of() { grep -o '"version":"[^"]*"' | cut -d'"' -f4 || true; }

# The next free CalVer for today (UTC), from the tags origin holds.
next_version() {
  git fetch -q --tags origin
  local d n
  d="$(date -u +%Y.%m.%d)"
  n="$(git tag -l "v$d" "v$d.*" | wc -l)"
  if [ "$n" -eq 0 ]; then echo "$d"; else echo "$d.$((n + 1))"; fi
}

case "${1:-}" in
  "")
    HASH="$(git rev-parse --short HEAD)"
    if ! git diff --quiet || ! git diff --cached --quiet; then HASH="${HASH}-dirty"; fi
    RELEASE="$(date -u +%Y%m%d-%H%M%S)-${HASH}"

    echo ">> building (vite production)"
    npm run build
    printf '{"release":"%s","commit":"%s","version":null}\n' "$RELEASE" "$HASH" > dist/release.json

    echo ">> shipping dist/ -> ${REMOTE}:${REMOTE_BASE}/releases/${RELEASE}"
    ssh "$REMOTE" mkdir -p -- "${REMOTE_BASE}/releases/${RELEASE}"
    scp -q -r dist/. "${REMOTE}:${REMOTE_BASE}/releases/${RELEASE}/"

    echo ">> preview -> ${RELEASE}"
    remote preview "$REMOTE_BASE" "$RELEASE"
    remote prune "$REMOTE_BASE" "$KEEP" > /dev/null
    echo ">> production untouched. Click through build.tc.41chan.net, then ./deploy.sh --promote"
    ;;
  --promote)
    P="$(remote target "$REMOTE_BASE" preview)"
    [ "$P" != "-" ] || die "nothing to promote: no preview. Run ./deploy.sh first."
    [ "$P" != "$(remote target "$REMOTE_BASE" current)" ] || die "the preview ($P) already is production. Run ./deploy.sh to publish a new one."
    case "$P" in *-dirty) die "preview $P was built from an uncommitted tree, so it has no commit to version. Commit, run ./deploy.sh, then --promote." ;; esac
    COMMIT="${P##*-}"
    git rev-parse -q --verify "${COMMIT}^{commit}" > /dev/null || die "commit $COMMIT (from release $P) is not in this checkout. git fetch, then --promote."
    VERSION="$(remote release-json "$REMOTE_BASE" "$P" | version_of)"
    NEW_TAG=0
    if [ -z "$VERSION" ]; then
      VERSION="$(next_version)"
      NEW_TAG=1
      remote stamp "$REMOTE_BASE" "$P" "$VERSION"
    fi
    echo ">> promoting $P as v$VERSION"
    remote promote "$REMOTE_BASE"
    want="$(ssh "$REMOTE" cat -- "${REMOTE_BASE}/current/index.html" | asset_of)"
    served="$(curl -fsS "$PROD_URL" | asset_of || true)"
    [ -n "$want" ] && [ "$want" = "$served" ] || die "${PROD_URL} serves '${served}', the release holds '${want}'. 'current' already points at $P (v$VERSION, not yet tagged); ./deploy.sh --rollback returns to the previous release."
    served_v="$(curl -fsS "${PROD_URL}release.json" | version_of || true)"
    [ "$served_v" = "$VERSION" ] || die "${PROD_URL}release.json says '${served_v}', expected '${VERSION}'. 'current' already points at $P; find what serves the old file (Caddy, a cache), and once it serves v$VERSION, tag it by hand: git tag -a v$VERSION $COMMIT -m 'Technetium $VERSION (release $P)' && git push origin v$VERSION"
    echo ">> ${PROD_URL} serves ${served}, version ${served_v}"
    if [ "$NEW_TAG" = 1 ]; then
      git tag -a "v$VERSION" "$COMMIT" -m "Technetium $VERSION (release $P)"
      git push -q origin "v$VERSION" || die "production is v$VERSION but the tag did not push: git push origin v$VERSION"
      echo ">> tagged v$VERSION at $COMMIT and pushed"
    fi
    ;;
  --rollback)
    remote rollback "$REMOTE_BASE"
    want="$(ssh "$REMOTE" cat -- "${REMOTE_BASE}/current/index.html" | asset_of)"
    served="$(curl -fsS "$PROD_URL" | asset_of || true)"
    [ -n "$want" ] && [ "$want" = "$served" ] || die "${PROD_URL} serves '${served}', the release holds '${want}'"
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
