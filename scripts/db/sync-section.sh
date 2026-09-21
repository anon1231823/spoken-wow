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

# Loaded into a staging copy of each table first, then moved across. The reason is rows the
# sync does not bring: a take or an ignore records who made it, and a settled speaker the
# contribution it came from, and those rows exist on production and not here -- so a straight
# load fails the foreign key into "user" or "contribution". Copying those tables would bring
# real accounts, email addresses and players' submissions onto this machine, so instead a
# reference this machine cannot satisfy is left blank. Production keeps the link; this copy
# is for building and testing.
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
  -- Every single-column foreign key from a staged table into a table the sync does not
  -- bring, blanked where the row it names is not on this machine. Found from the catalog
  -- rather than listed, so the next such column -- contributionId was the second, after the
  -- authors -- cannot fail a sync again.
  for fk in
    select src.relname as tbl, a.attname as col, dst.relname as ref, ra.attname as refcol
      from pg_constraint c
      join pg_class src on src.oid = c.conrelid
      join pg_class dst on dst.oid = c.confrelid
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
     where c.contype = 'f' and cardinality(c.conkey) = 1
       and c.connamespace = 'public'::regnamespace
       and to_regclass(format('$staging.%I', src.relname)) is not null
       and to_regclass(format('$staging.%I', dst.relname)) is null
  loop
    execute format(
      'update $staging.%I set %I = null where %I is not null and %I not in (select %I from public.%I)',
      fk.tbl, fk.col, fk.col, fk.col, fk.refcol, fk.ref);
  end loop;
end
\$\$;
SQL
  echo "truncate ${quoted%, };"
  echo "delete from \"take\" where \"source\" = '$source_name';"
  # Take ids are one sequence across all three sections, so another section's local row can
  # hold an id production has since given to one of these -- a quests take here sitting on
  # production's books take 10049 failed the whole sync on the primary key. Such a row is not
  # production's anyway: that section's own sync replaces every row it has. So it goes, and
  # the count says which section to sync next. A warning, not a notice: the dump sets
  # client_min_messages to warning, and a notice would never be seen.
  cat <<SQL
do \$\$
declare r record;
begin
  for r in
    with gone as (
      delete from public."take" t using $staging."take" s where t."id" = s."id" returning t."source")
    select "source", count(*) as n from gone group by 1
  loop
    raise warning '% local % takes held ids production uses for $source_name; run make %-sync',
      r.n, r."source", r."source";
  end loop;
end
\$\$;
SQL
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
