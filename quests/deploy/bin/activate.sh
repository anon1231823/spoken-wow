#!/usr/bin/env bash
#
# Point /srv/voiceover/current at a release and reload pm2.
#
# Usage: activate.sh /srv/voiceover/releases/20260727-2143-a1b2c3d
#
# The symlink swap is the versioning: pm2 always runs whatever `current` resolves to, so
# activating a release and rolling back to one are the same operation.
set -euo pipefail

ROOT=${VOICEOVER_ROOT:-/srv/voiceover}
TARGET=${1:?usage: activate.sh <release-dir>}

# A non-interactive `ssh host activate.sh` gets a minimal PATH, so resolve pm2 rather
# than trusting it to be on it.
PM2=${PM2:-$(command -v pm2 || echo /usr/local/bin/pm2)}

[ -d "$TARGET" ] || { echo "activate: no such release: $TARGET" >&2; exit 1; }
[ -f "$TARGET/server.js" ] || { echo "activate: $TARGET has no server.js - bad build?" >&2; exit 1; }
[ -f "$TARGET/corpus/corpus.json.gz" ] || { echo "activate: $TARGET has no corpus" >&2; exit 1; }

PREVIOUS=$(readlink -f "$ROOT/current" 2>/dev/null || echo "(none)")
echo "activate: $PREVIOUS -> $TARGET"

# Migrate before the swap, so a migration that fails leaves the previous release serving
# rather than pointing `current` at code whose schema was never applied. `set -e` makes a
# non-zero exit here abort the deploy.
"$ROOT/bin/migrate.sh" "$TARGET"

# Build the new link beside the old one and rename over it: the rename is atomic, so
# `current` never fails to resolve, and plain `ln -sfn` would instead nest the new link
# inside the directory the old one points at.
#
# The flag makes the rename replace the destination symlink rather than follow it:
# -T on GNU coreutils (the droplet), -h on BSD (so this stays testable on macOS).
rm -f "$ROOT/current.new"
ln -s "$TARGET" "$ROOT/current.new"
mv -T "$ROOT/current.new" "$ROOT/current" 2>/dev/null \
  || mv -h "$ROOT/current.new" "$ROOT/current"

# startOrReload covers both the first deploy and the steady state. --update-env forces pm2
# to re-read the config instead of reusing its cached resolution of the old symlink target.
"$PM2" startOrReload "$ROOT/shared/ecosystem.config.js" --update-env
"$PM2" save --force

echo "activate: done"
