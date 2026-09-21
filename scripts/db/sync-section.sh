#!/usr/bin/env bash
# Replace this machine's copy of one section's data with production's.
#
#   scripts/db/sync-section.sh <source> <corpus table>...
#   scripts/db/sync-section.sh zones lore_line
#
# Production is upstream for everything the site writes -- corpus edits and takes -- so
# data only ever flows droplet -> here. This is the one recipe for all three sections: the
# section's corpus tables whole, and its rows of the shared `take` table. It replaced a
# quests `sync`, a books `db-pull` that fetched takes but not the text they were cut from,
# and a zones `db-pull`/`db-push` pair written against a table and a Docker database that
# no longer exist.
#
# Environment, as the Makefiles pass it:
#   DROPLET, SSH, REMOTE_ROOT   how to reach production (make/droplet.mk)
#   LOCAL_DB                    the database to replace into
#   SOURCE_DB                   instead of the droplet, dump from this database directly --
#                               for rehearsing the sync against a local copy
set -euo pipefail
. "$(dirname "$0")/lib.sh"

source_name=${1:?usage: sync-section.sh <source> <table>...}
shift
tables=("$@")
[ ${#tables[@]} -gt 0 ] || { echo "no corpus tables given" >&2; exit 2; }

: "${LOCAL_DB:?LOCAL_DB is not set}"

counts="select (select count(*) from \"${tables[0]}\") || ' ${tables[0]} rows, '
               || (select count(*) from \"take\" where \"source\" = '$source_name') || ' $source_name takes'"
echo "local:    $(psql "$LOCAL_DB" -tAc "$counts")"
# On stdin rather than inside the command, so the query's quotes never pass through ssh.
echo "upstream: $(upstream 'psql "$DATABASE_URL" -tA -f -' <<<"$counts")"
printf 'Replace the LOCAL %s data with the upstream copy? [y/N] ' "$source_name"
read -r answer
[ "$answer" = y ] || { echo aborted; exit 1; }

dump_tables=()
for table in "${tables[@]}"; do dump_tables+=("--table=$table"); done
quoted=$(printf '"%s", ' "${tables[@]}")

# Loaded into a staging copy of each table first, then moved across. The reason is authors:
# a take or an ignore records who made it, and those accounts exist on production and not
# here -- so a straight load fails the foreign key into "user". Copying production's user
# table would bring real accounts and email addresses onto this machine, so instead an
# author this machine does not have is left blank. Production keeps the attribution; this
# copy is for building and testing.
staging=sync_staging
take_columns=$(psql "$LOCAL_DB" -tAc "select string_agg(quote_ident(column_name), ', '
                                          order by ordinal_position)
                                     from information_schema.columns
                                    where table_schema = 'public' and table_name = 'take'")
{
  echo 'begin;'
  echo "drop schema if exists $staging cascade; create schema $staging;"
  for table in "${tables[@]}" take; do
    echo "create table $staging.\"$table\" (like public.\"$table\");"
  done
  upstream "pg_dump \"\$DATABASE_URL\" --data-only ${dump_tables[*]}" \
    | unrestrict | sed -E "s/^COPY public\./COPY $staging./"
  # This section's rows of the shared take table, selected on production with a WHERE
  # rather than grepped out of a dump. Named columns, in this machine's order: a local table
  # whose columns were added in a different order still gets each value in its place.
  echo "copy $staging.\"take\" ($take_columns) from stdin;"
  upstream 'psql "$DATABASE_URL" -X -q -f -' \
    <<<"copy (select $take_columns from \"take\" where \"source\" = '$source_name') to stdout;"
  echo '\.'
  # pg_dump's output empties search_path for the session; put it back for what follows.
  echo 'set search_path = public;'
  cat <<SQL
do \$\$
declare fk record;
begin
  -- Every column in the staged tables that points at "user", blanked where the account is
  -- not on this machine.
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f' and c.confrelid = '"user"'::regclass
       and c.connamespace = 'public'::regnamespace
  loop
    if to_regclass('$staging.' || quote_ident(split_part(fk.tbl, '.', 1))) is not null then
      execute format(
        'update $staging.%I set %I = null where %I is not null and %I not in (select "id" from "user")',
        replace(fk.tbl, '"', ''), fk.col, fk.col, fk.col);
    end if;
  end loop;
end
\$\$;
SQL
  echo "truncate ${quoted%, };"
  echo "delete from \"take\" where \"source\" = '$source_name';"
  for table in "${tables[@]}" take; do
    echo "insert into public.\"$table\" select * from $staging.\"$table\";"
  done
  echo "drop schema $staging cascade;"
  echo 'commit;'
} | psql "$LOCAL_DB" -v ON_ERROR_STOP=1 -q

# --data-only carries no sequences, so the next insert would reuse an id the dump already
# holds. Tables with no serial id get a null here, which setval ignores.
for table in "${tables[@]}" take; do
  psql "$LOCAL_DB" -q -c "select setval(pg_get_serial_sequence('public.$table', 'id'),
                                        (select coalesce(max(\"id\"), 1) from \"$table\"))" \
    >/dev/null 2>&1 || true
done

echo "==> synced: $(psql "$LOCAL_DB" -tAc "$counts")"
