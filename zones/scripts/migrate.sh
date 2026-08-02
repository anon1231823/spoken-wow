#!/usr/bin/env bash
# Applies web/migrations/*.sql in filename order, once each.
#
#   ./scripts/migrate.sh          # apply anything not yet applied
#   ./scripts/migrate.sh --status # list what has and has not run
#
# Forward-only and additive, the same contract ../wow-voiceover/deploy/bin/migrate.sh
# holds itself to: a migration is never edited after it has run anywhere, and never
# drops or narrows a column, so the previous release keeps working against the new
# schema. That is what makes a rollback safe.
#
# Deliberately psql and a table rather than an ORM's migration runner. The schema is
# two tables; a dependency that owns them would be larger than they are.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$REPO/web/migrations"

# Same default the app uses. Port 5433 because ../wow-voiceover's postgres holds 5432.
DATABASE_URL="${DATABASE_URL:-postgres://zonelore:zonelore@localhost:5433/zonelore}"

if ! command -v psql >/dev/null; then
  echo "error: psql not found. brew install libpq (or postgresql)." >&2
  exit 1
fi

# -v ON_ERROR_STOP=1 is the whole reason this is safe to loop: without it psql reports
# a failed statement and carries on to the next one, and the migration would be
# recorded as applied having half run.
run() {
  # client_min_messages=warning: "relation already exists, skipping" on every run is
  # noise that trains you to ignore psql's output, which is where real problems appear.
  PGOPTIONS='-c client_min_messages=warning' \
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --quiet --no-psqlrc "$@"
}

if ! run -c 'select 1' >/dev/null 2>&1; then
  echo "error: cannot reach $DATABASE_URL" >&2
  echo "       start it with:  docker compose up -d" >&2
  exit 1
fi

run -c 'create table if not exists "schema_migration" (
  "name"      text        primary key,
  "appliedAt" timestamptz not null default now()
)'

applied="$(run --tuples-only --no-align -c 'select "name" from "schema_migration"')"

has_run() {
  printf '%s\n' "$applied" | grep -qxF "$1"
}

if [[ "${1:-}" == "--status" ]]; then
  for file in "$MIGRATIONS"/*.sql; do
    name="$(basename "$file")"
    if has_run "$name"; then
      printf '  applied  %s\n' "$name"
    else
      printf '  pending  %s\n' "$name"
    fi
  done
  exit 0
fi

count=0
for file in "$MIGRATIONS"/*.sql; do
  name="$(basename "$file")"
  has_run "$name" && continue

  echo "applying $name"
  # One transaction per migration, with the bookkeeping insert inside it: a migration
  # that fails partway leaves nothing behind, including no claim to have run.
  run --single-transaction \
      -f "$file" \
      -c "insert into \"schema_migration\" (\"name\") values ('$name')"
  count=$((count + 1))
done

if [[ $count -eq 0 ]]; then
  echo "up to date."
else
  echo "applied $count migration(s)."
fi
