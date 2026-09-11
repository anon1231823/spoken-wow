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
[ -f "$TARGET/apps/web-zones/server.js" ]        || { echo "activate: no apps/web-zones/server.js - bad build?" >&2; exit 1; }
[ -d "$TARGET/apps/web-zones/.next/static" ]     || { echo "activate: no apps/web-zones/.next/static - the page would render unstyled" >&2; exit 1; }
[ -f "$TARGET/addons/SpokenZones/Data/enUS/Zones.lua" ]    || { echo "activate: no Zones.lua - the corpus did not ship" >&2; exit 1; }
[ -f "$TARGET/addons/SpokenZones/Data/enUS/Subzones.lua" ] || { echo "activate: no Subzones.lua - the corpus did not ship" >&2; exit 1; }
[ -f "$TARGET/pipelines/zones/tools/voice/config.json" ] || { echo "activate: no voice config - regeneration would fail" >&2; exit 1; }

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

# startOrReload covers both the first deploy and the steady state. --update-env forces pm2
# to re-read the config instead of reusing its cached resolution of the old symlink target.
#
# BUT --update-env DOES NOT UPDATE THE SCRIPT PATH. pm2 keeps the `script` it first
# started an app with; reload re-reads the environment and nothing else. When the
# monorepo move changed the path from server.js to apps/web-zones/server.js, every
# reload kept launching the old one, the app errored 70 times over, and the site served
# 502 while pm2 reported the config it was not using. Recovering needed a delete and a
# fresh start, which is what this does automatically now -- but only when the path has
# actually moved, because delete+start drops the connections that a reload preserves.
expected="$(node -e 'const c=require(process.argv[1]);const a=(c.apps||[]).find(x=>x.name==="zonelore");process.stdout.write(a?a.script:"")' "$ROOT/shared/ecosystem.config.js" 2>/dev/null || true)"
running="$("$PM2" jlist 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let l=[];try{l=JSON.parse(s)}catch{};const a=l.find(x=>x.name==="zonelore");process.stdout.write(a&&a.pm2_env&&a.pm2_env.pm_exec_path?a.pm2_env.pm_exec_path:"")})' 2>/dev/null || true)"

if [ -n "$running" ] && [ -n "$expected" ] && [ "$running" != "$ROOT/current/$expected" ]; then
  echo "activate: script path moved ($running -> $ROOT/current/$expected); recreating the pm2 app"
  "$PM2" delete zonelore >/dev/null 2>&1 || true
  "$PM2" start "$ROOT/shared/ecosystem.config.js" --only zonelore
else
  "$PM2" startOrReload "$ROOT/shared/ecosystem.config.js" --update-env
fi
"$PM2" save --force

echo "activate: done"
