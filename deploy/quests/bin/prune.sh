#!/usr/bin/env bash
#
# Keep the newest N releases (default 5), never removing the current one.
#
# Each release is ~60 MB of standalone bundle. Audio lives in shared/, not in a release,
# so pruning never touches the 1.1 GB store.
set -euo pipefail

ROOT=${VOICEOVER_ROOT:-/srv/voiceover}
RELEASES=$ROOT/releases
KEEP=${1:-5}

CURRENT=$(basename "$(readlink -f "$ROOT/current" 2>/dev/null || echo none)")

# The current release is skipped explicitly, in case it has fallen outside the newest N.
for r in $(ls -1 "$RELEASES" | sort -r | tail -n "+$((KEEP + 1))"); do
  if [ "$r" = "$CURRENT" ]; then
    echo "prune: skipping $r (current)"
    continue
  fi
  echo "prune: removing $r"
  rm -rf "${RELEASES:?}/$r"
done
