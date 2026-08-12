#!/usr/bin/env bash
#
# Point /srv/zonelore/current at a release and reload pm2.
#
#   activate.sh /srv/zonelore/releases/20260802-1143-a1b2c3d
#
# The symlink swap is the versioning: pm2 always runs whatever `current` resolves to, so
# activating a release and rolling back to one are the same operation.
set -euo pipefail

ROOT=${ZONELORE_DEPLOY_ROOT:-/srv/zonelore}
TARGET=${1:?usage: activate.sh <release-dir>}

# A non-interactive `ssh host activate.sh` gets a minimal PATH.
PM2=${PM2:-$(command -v pm2 || echo /usr/local/bin/pm2)}

[ -d "$TARGET" ] || { echo "activate: no such release: $TARGET" >&2; exit 1; }

# Everything the app cannot start without, checked here rather than discovered as a 500
# after the swap. The three data files are the ones ZONELORE_ROOT resolves against, and
# they are copied into the release by CI rather than traced into the bundle -- Next
# cannot trace a readFile of a path computed at runtime, so a missing copy step in the
# workflow shows up exactly here.
[ -f "$TARGET/web/server.js" ]                      || { echo "activate: no web/server.js - bad build?" >&2; exit 1; }
[ -d "$TARGET/web/.next/static" ]                   || { echo "activate: no web/.next/static - the page would render unstyled" >&2; exit 1; }
[ -f "$TARGET/addon/ZoneLore/Data/enUS/Zones.lua" ]    || { echo "activate: no Zones.lua - the corpus did not ship" >&2; exit 1; }
[ -f "$TARGET/addon/ZoneLore/Data/enUS/Subzones.lua" ] || { echo "activate: no Subzones.lua - the corpus did not ship" >&2; exit 1; }
[ -f "$TARGET/tools/voice/config.json" ]            || { echo "activate: no voice config - regeneration would fail" >&2; exit 1; }

# The live pronunciation.json sits in shared/ and outlives every release, so a rule
# hand-edited on the droplet survives a deploy. Seed it from the release on the first
# deploy only: doing it every time would overwrite those edits with what was last
# committed.
if [ ! -f "$ROOT/shared/pronunciation.json" ] && [ -f "$TARGET/tools/voice/pronunciation.json" ]; then
  echo "activate: seeding shared/pronunciation.json from the release"
  cp "$TARGET/tools/voice/pronunciation.json" "$ROOT/shared/pronunciation.json"
fi

PREVIOUS=$(readlink -f "$ROOT/current" 2>/dev/null || echo "(none)")
echo "activate: $PREVIOUS -> $TARGET"

# Migrate before the swap, so a migration that fails leaves the previous release serving.
# `set -e` makes a non-zero exit here abort the deploy.
"$ROOT/bin/migrate.sh" "$TARGET"

# Build the new link beside the old one and rename over it: the rename is atomic, so
# `current` never fails to resolve, and a plain `ln -sfn` would instead nest the new link
# inside the directory the old one points at.
#
# The flag makes the rename replace the destination symlink rather than follow it:
# -T on GNU coreutils (the droplet), -h on BSD (so this stays testable on macOS).
rm -f "$ROOT/current.new"
ln -s "$TARGET" "$ROOT/current.new"
mv -T "$ROOT/current.new" "$ROOT/current" 2>/dev/null \
  || mv -h "$ROOT/current.new" "$ROOT/current"

# startOrReload covers both the first deploy and the steady state. --update-env forces
# pm2 to re-read the config rather than reusing its cached resolution of the old symlink
# target -- which is the whole mechanism, since ZONELORE_ROOT points at `current`.
"$PM2" startOrReload "$ROOT/shared/ecosystem.config.js" --update-env
"$PM2" save --force

echo "activate: done"
