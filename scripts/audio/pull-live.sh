#!/usr/bin/env bash
# Fetch the archived takes a section's pack is built from, and no others.
#
#   scripts/audio/pull-live.sh <quests|zones|books>
#
# The list is the local database's live takes, written by `sounds.mjs --list` -- the same
# query that later copies them into the pack -- so run the section's sync first: a pull
# against a stale database fetches the takes production has already replaced. The full
# archive, every take ever cut, is still `make <section>-pull-history`, for listening to
# old takes; a build does not need it.
#
# rsync --files-from rather than a loop: one connection, and files already here are
# skipped by size and mtime like any other rsync. Never --delete: takes that stop being
# live stay on disk, and the archive only ever grows.
#
# A live take production has no file for fails the pull (rsync exits 23), because that
# pack would ship silence for the line.
#
# Environment, as the Makefiles pass it (make/droplet.mk's DB_ENV, plus RSYNC):
#   DROPLET, SSH, REMOTE_ROOT   how to reach production
#   LOCAL_DB                    the database whose live takes are listed
#   RSYNC                       an rsync 3.x; macOS's openrsync lacks --info
set -euo pipefail

section=${1:?usage: pull-live.sh <quests|zones|books>}
: "${DROPLET:?no droplet configured: export SPOKEN_DROPLET=deploy@<host>}"
: "${RSYNC:?no rsync 3.x found. macOS ships openrsync, which lacks --info: brew install rsync}"
REMOTE_ROOT=${REMOTE_ROOT:-/srv/spoken}

root="$(cd "$(dirname "$0")/../.." && pwd)"
# Where sounds.mjs reads the archive from, including its SPOKEN_<SECTION>_AUDIO_HISTORY
# override, so the pull lands where the build looks.
override="SPOKEN_$(printf '%s' "$section" | tr '[:lower:]' '[:upper:]')_AUDIO_HISTORY"
archive=${!override:-$root/pipelines/$section/audio-history}

list=$(mktemp)
trap 'rm -f "$list"' EXIT
node "$root/scripts/audio/sounds.mjs" --list "$section" >"$list"
echo "==> $(wc -l <"$list" | tr -d ' ') live $section takes"

mkdir -p "$archive"
# shellcheck disable=SC2086 -- SSH carries its own flags
"$RSYNC" -a --partial --human-readable --info=stats1,progress2 -e "$SSH" \
  --files-from="$list" "$DROPLET:$REMOTE_ROOT/shared/audio-history/$section/" "$archive/" || {
  status=$?
  if [ "$status" = 23 ]; then
    echo "Some live takes are not in production's archive. If this database has not been" >&2
    echo "synced lately, those rows are ones production has moved past: make $section-sync" >&2
  fi
  exit "$status"
}
echo "==> pulled into ${archive#"$root"/}. Build the pack's audio with:  make $section-sounds"
