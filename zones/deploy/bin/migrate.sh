#!/usr/bin/env bash
#
# Apply a release's pending SQL migrations to the app database.
#
#   migrate.sh /srv/zonelore/releases/20260802-1143-a1b2c3d
#
# The droplet counterpart of scripts/migrate.sh, which does the same job against the
# repo. Two scripts rather than one because they have different inputs: that one reads
# web/migrations/ out of a checkout, this one reads migrations/ out of a release
# directory that has no checkout behind it. They agree on the schema_migration table, so
# a database is readable by both.
#
# Called by activate.sh *before* the symlink swap, so a migration that fails leaves the
# previous release serving rather than pointing `current` at code whose schema was never
# applied.
#
# Forward-only and additive, the same contract scripts/migrate.sh states: rollback.sh
# restores code and never un-applies a migration, so a release has to be able to run
# against the schema of the release *after* it. Adding a nullable column is fine;
# renaming or dropping one needs two deploys.
set -euo pipefail

TARGET=${1:?usage: migrate.sh <release-dir>}
DIR="$TARGET/migrations"

# A non-interactive `ssh host migrate.sh` gets a minimal PATH, so resolve psql rather
# than trusting it to be on it.
PSQL=${PSQL:-$(command -v psql || echo /usr/bin/psql)}

ROOT=${ZONELORE_DEPLOY_ROOT:-/srv/zonelore}

# activate.sh has app.env in its environment already, but this is also worth running by
# hand, and then it does not.
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/shared/app.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/shared/app.env"
  set +a
fi
: "${DATABASE_URL:?migrate: DATABASE_URL is unset and shared/app.env did not provide it}"

[ -d "$DIR" ] || { echo "migrate: $TARGET has no migrations/ - bad release?" >&2; exit 1; }

# PGOPTIONS silences the "relation already exists, skipping" notice the bootstrap below
# emits on every deploy after the first. Noise on every run trains you to ignore psql's
# output, which is where a real problem would appear.
run() {
  PGOPTIONS='-c client_min_messages=warning' \
    "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --no-psqlrc "$@"
}

run -c 'create table if not exists "schema_migration" (
          "name"      text primary key,
          "appliedAt" timestamptz not null default now())'

applied=0
for file in "$DIR"/*.sql; do
  name=$(basename "$file")
  if [ -n "$(run -tAc "select 1 from \"schema_migration\" where \"name\" = '$name'")" ]; then
    continue
  fi
  echo "migrate: applying $name"
  # The bookkeeping insert goes inside the same transaction as the DDL, so a migration
  # that fails partway leaves nothing behind -- including no claim to have run.
  run --single-transaction -f "$file" \
      -c "insert into \"schema_migration\" (\"name\") values ('$name')"
  applied=$((applied + 1))
done

echo "migrate: $applied applied, database up to date"
