#!/usr/bin/env bash
# Refuse to build a pack from data that production has moved past -- or ask first.
#
#   scripts/db/check-synced.sh <section>
#
# Compares deploy/web/sql/<section>_stamp.sql run here and on production. A pack is built
# from the local database, and production is upstream for every edit and every take, so a
# laptop that has not synced would ship what production has already corrected.
#
# Asks rather than deciding, because the droplet being unreachable is not the same thing as
# the data being wrong. With no droplet configured it says so and continues -- a clone with
# no access still has to be able to build. With no TTY, as in CI, the prompt fails closed.
#
# Environment as for sync-section.sh: DROPLET, SSH, REMOTE_ROOT, LOCAL_DB, SOURCE_DB.
set -euo pipefail

section=${1:?usage: check-synced.sh <section>}
stamp="$(dirname "$0")/../../deploy/web/sql/${section}_stamp.sql"
[ -f "$stamp" ] || { echo "no stamp for $section at $stamp" >&2; exit 2; }
: "${LOCAL_DB:?LOCAL_DB is not set}"
REMOTE_ROOT=${REMOTE_ROOT:-/srv/spoken}

if [ -n "${SOURCE_DB:-}" ]; then
  there=$(psql "$SOURCE_DB" -tA -f "$stamp" 2>/dev/null || true)
elif [ -z "${DROPLET:-}" ]; then
  echo "no droplet configured; skipping the $section freshness check"
  exit 0
else
  # shellcheck disable=SC2086 -- SSH carries its own flags
  there=$($SSH "$DROPLET" "set -a; . $REMOTE_ROOT/shared/app.env; set +a; psql \"\$DATABASE_URL\" -tA -f -" \
    <"$stamp" 2>/dev/null || true)
fi
here=$(psql "$LOCAL_DB" -tA -f "$stamp" 2>/dev/null || true)

if [ -z "$there" ]; then
  echo "could not read production's $section stamp; continuing without the check"
  exit 0
fi
if [ "$here" = "$there" ]; then
  echo "$section is in step with production"
  exit 0
fi

echo "the local $section data and production's disagree:"
echo "  local:      ${here:-(unreadable)}"
echo "  production: $there"
echo "Run 'make $section-sync' first, or continue and ship what is here."
printf 'Continue anyway? [y/N] '
read -r answer || answer=
[ "$answer" = y ] || { echo aborted; exit 1; }
