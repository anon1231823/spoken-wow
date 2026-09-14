#!/usr/bin/env bash
#
# Keep the newest N releases (default 5), never removing the current one.
#
# Each release is ~70 MB of standalone bundle. Audio lives in shared/, not in a release, so
# pruning never touches the ~1.9 GB of stores -- nor the previews, nor the exported
# manifest, both of which are in shared/ for exactly this reason.
set -euo pipefail

ROOT=${SPOKEN_ROOT:-/srv/spoken}
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
