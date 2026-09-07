#!/usr/bin/env bash
#
# Roll back to a previous release.
#
#   rollback.sh                          # the release before the current one
#   rollback.sh 20260727-2143-a1b2c3d    # a specific release
#   rollback.sh --list                   # what is available
#
# No CI, no network, no git: releases are directories and `current` is a symlink, so this
# is a local rename that takes about a second.
set -euo pipefail

ROOT=${VOICEOVER_ROOT:-/srv/voiceover}
RELEASES=$ROOT/releases

list() {
  local current
  current=$(basename "$(readlink -f "$ROOT/current" 2>/dev/null || echo none)")
  # Newest first. Release names are UTC timestamps, so lexical order is chronological and
  # does not depend on mtime surviving rsync.
  for r in $(ls -1 "$RELEASES" | sort -r); do
    if [ "$r" = "$current" ]; then echo "  $r  <- current"; else echo "  $r"; fi
  done
}

if [ "${1:-}" = "--list" ]; then
  echo "releases:"
  list
  exit 0
fi

CURRENT=$(basename "$(readlink -f "$ROOT/current" 2>/dev/null || echo none)")

if [ -n "${1:-}" ]; then
  TARGET=$1
else
  # The release immediately *older* than the current one, not merely the newest one that
  # is not current: otherwise two rollbacks in a row ping-pong between the newest two and
  # the second one lands you back on the release you just rejected.
  TARGET=$(ls -1 "$RELEASES" | sort -r | awk -v cur="$CURRENT" '
    found { print; exit }
    $0 == cur { found = 1 }
  ')
  if [ -z "$TARGET" ]; then
    if ls -1 "$RELEASES" | grep -qx "$CURRENT"; then
      echo "rollback: $CURRENT is the oldest release, nothing older to roll back to" >&2
    else
      echo "rollback: current ($CURRENT) is not a known release; name one explicitly" >&2
    fi
    list >&2
    exit 1
  fi
fi

[ -d "$RELEASES/$TARGET" ] || { echo "rollback: no such release: $TARGET" >&2; list >&2; exit 1; }
[ "$TARGET" != "$CURRENT" ] || { echo "rollback: $TARGET is already current" >&2; exit 1; }

echo "rollback: $CURRENT -> $TARGET"
exec "$ROOT/bin/activate.sh" "$RELEASES/$TARGET"
