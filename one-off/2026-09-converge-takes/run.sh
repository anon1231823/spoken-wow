#!/usr/bin/env bash
# ONE-OFF: move production onto "the archive is the only audio". RUN ONCE, then never again.
# Kept for the record; see README.md here and ../README.md. Not maintained.
#
#   one-off/2026-09-converge-takes/run.sh
#
# From a laptop, at the commit about to be deployed, BEFORE deploying it. Every step that
# writes says what it will do and asks first. Needs SPOKEN_DROPLET (make/droplet.mk), the
# deploy key, psql, node, and pipelines/quests/.venv with requirements-extract.txt.
#
# Rehearse against a local copy of production instead of the droplet:
#   REHEARSE_DB=postgres://localhost/spoken_prod_rehearsal LISTING=/path/to/shared.txt run.sh
# which skips everything that needs the droplet and only lists what step 5 would archive.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
work=$(mktemp -d)
python=$repo/pipelines/quests/.venv/bin/python

DROPLET=${DROPLET:-${SPOKEN_DROPLET:-}}
SSH=${SSH:-ssh -i ${SPOKEN_DEPLOY_KEY:-$HOME/.ssh/id_spoken_deploy} -o IdentitiesOnly=yes}
REMOTE_ROOT=${REMOTE_ROOT:-/srv/spoken}
PORT=${PORT:-15432}
rehearse=${REHEARSE_DB:-}

ask() { printf '%s [y/N] ' "$1"; read -r a; [ "$a" = y ] || { echo aborted; exit 1; }; }
step() { printf '\n==> %s\n' "$1"; }

cleanup() {
  [ -n "${sock:-}" ] && $SSH -S "$sock" -O exit "$DROPLET" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

echo "commit $(git -C "$repo" rev-parse --short HEAD) -- the one about to be deployed"
[ -z "$(git -C "$repo" status --porcelain)" ] || { echo "the checkout has changes; commit or stash them first"; exit 1; }
"$python" -c 'import psycopg2' || { echo "pipelines/quests/.venv needs requirements-extract.txt"; exit 1; }

if [ -n "$rehearse" ]; then
  db=$rehearse
  : "${LISTING:?LISTING=<a shared/ listing> is needed to rehearse}"
  cp "$LISTING" "$work/shared.txt"
  echo "REHEARSING against $db"
else
  : "${DROPLET:?export SPOKEN_DROPLET=deploy@<host>}"
  # One ssh connection for the tunnel and every command after it.
  sock=$work/ssh.sock
  $SSH -f -N -M -S "$sock" -o ExitOnForwardFailure=yes -L "$PORT:127.0.0.1:5432" "$DROPLET"
  SSH="$SSH -S $sock"
  url=$($SSH "$DROPLET" "sed -n 's/^DATABASE_URL=//p' $REMOTE_ROOT/shared/app.env" | tr -d "\"'")
  db=$(printf '%s' "$url" | sed -E "s#@[^/]+/#@127.0.0.1:$PORT/#")
fi
q() { psql "$db" -v ON_ERROR_STOP=1 -tA "$@"; }

step "1. Migrations: the take table's archiveFile and the quests corpus tables"
if [ -n "$rehearse" ]; then
  DATABASE_URL=$db "$repo/deploy/web/bin/migrate.sh" "$repo/apps/web"
else
  # Additive only, so the release still serving runs against them unchanged.
  $SSH "$DROPLET" "rm -rf /tmp/converge-release && mkdir -p /tmp/converge-release"
  tar -C "$repo/apps/web" -cf - migrations | $SSH "$DROPLET" "tar -C /tmp/converge-release -xf -"
  $SSH "$DROPLET" "$REMOTE_ROOT/bin/migrate.sh /tmp/converge-release"
fi

step "2. The quests corpus into quest_line"
(cd "$repo/pipelines/quests" && DATABASE_URL=$db "$python" cli-main.py import-corpus)

step "3. Production's shared/ listing: the stores and the archive"
if [ -z "$rehearse" ]; then
  $SSH "$DROPLET" "cd $REMOTE_ROOT/shared && find -L audio sounds books audio-history -type f -name '*.mp3' -printf '%s %p\n'" >"$work/shared.txt"
fi
wc -l <"$work/shared.txt" | xargs printf '%s mp3\n'

step "4. The take table records every take that happened"
DATABASE_URL=$db node "$here/rebuild-takes.mjs" --listing "$work/shared.txt" --dry-run
ask "Rebuild the take table as above?"
DATABASE_URL=$db node "$here/rebuild-takes.mjs" --listing "$work/shared.txt"

step "5. Live takes only a store holds get a file in the archive"
q -F $'\t' -c "select source, file, version from take
                where \"isCurrent\" and \"archiveFile\" is null and lang = 'enUS'
                order by 1, 2" >"$work/live.tsv"
cut -f1 "$work/live.tsv" | sort | uniq -c | sed 's/^/  /'
if [ ! -s "$work/live.tsv" ]; then
  echo "  none"
elif [ -n "$rehearse" ]; then
  # The files are on the droplet, so nothing is archived here; the listing says which of
  # them adopt-store.sh would find.
  awk -F'\t' 'NR == FNR { split($0, f, " "); have[substr($0, length(f[1]) + 2)] = 1; next }
    { path = $1 == "quests" ? "audio/" $2 : ($1 == "zones" ? "sounds/" : "books/") $2 ".mp3"
      if (path in have) found[$1]++; else lost[$1]++ }
    END { for (s in found) printf "  %s: would archive %d\n", s, found[s]
          for (s in lost) printf "  %s: %d have no store file on the droplet\n", s, lost[s] }' \
    "$work/shared.txt" "$work/live.tsv"
else
  ask "Hard-link these store files into the archive and record them?"
  $SSH "$DROPLET" "cat > /tmp/converge-adopt.sh" <"$here/adopt-store.sh"
  $SSH "$DROPLET" "bash /tmp/converge-adopt.sh $REMOTE_ROOT/shared" <"$work/live.tsv" >"$work/adopted.tsv"
  q <<SQL
begin;
create temp table adopted (source text, file text, version int, name text);
\copy adopted from '$work/adopted.tsv'
update take t set "archiveFile" = a.name
  from adopted a
 where t.source = a.source and t.file = a.file and t.version = a.version
   and t.lang = 'enUS' and t."isCurrent" and t."archiveFile" is null;
commit;
SQL
  wc -l <"$work/adopted.tsv" | xargs printf '  archived %s\n'
fi

step "Done. Live takes still without a clip, per section (their audio was not kept anywhere):"
q -c "select source || ': ' || count(*) from take
       where \"isCurrent\" and \"archiveFile\" is null group by source order by source"
echo
echo "Deploy now, and cut no take on the site until it is live: the release still serving"
echo "numbers takes the old way."
