#!/usr/bin/env bash
# Builds the Spoken player's zip for Blizzard's clients.
#
#   ./scripts/spoken/package.sh                 # dist/Spoken-<version>.zip
#   ALLOW_DIRTY=1 ./scripts/spoken/package.sh   # build from an uncommitted tree
#
# One zip, four flavor-suffixed .toc files, and the client picks. There are no legacy-client
# zips of the player on its own: those clients have no addon manager, so the quests addon's
# 1.12/2.4.3/3.3.5 zips carry the player inside them (scripts/quests/package.sh). This zip
# is what the CurseForge project ships, and what every other Spoken addon's required
# dependency resolves to.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="SpokenPlayer"
SRC="$REPO/addons/$NAME"
TOC="$SRC/$NAME.toc"
DIST="${DIST:-$REPO/dist}"
LEGACY_CLIENTS=(1.12 2.4.3 3.3.5)

[ -f "$TOC" ] || { echo "error: $TOC not found" >&2; exit 1; }
version="$(sed -n 's/^## Version:[[:space:]]*//p' "$TOC" | head -1 | tr -d '\r')"
[ -n "$version" ] || { echo "error: no '## Version:' line in $TOC" >&2; exit 1; }

if [ -z "${ALLOW_DIRTY:-}" ] && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  if [ -n "$(git -C "$REPO" status --porcelain -- "addons/$NAME")" ]; then
    echo "error: addons/$NAME/ has uncommitted changes." >&2
    echo "       Commit them, or re-run with ALLOW_DIRTY=1 to package anyway." >&2
    exit 1
  fi
fi

# Every .toc variant carries one version, and Environment.lua's literal agrees with it.
for toc in "$SRC"/*.toc; do
  v="$(sed -n 's/^## Version:[[:space:]]*//p' "$toc" | head -1 | tr -d '\r')"
  [ "$v" = "$version" ] || { echo "error: $(basename "$toc") says $v, $NAME.toc says $version" >&2; exit 1; }
done
literal="$(sed -n 's/^[[:space:]]*AddonVersion = "\(.*\)",/\1/p' "$SRC/Environment.lua" | head -1)"
[ "$literal" = "$version" ] || { echo "error: Environment.lua says $literal but the .toc says $version" >&2; exit 1; }

# Every file a .toc or .xml lists exists.
for toc in "$SRC"/*.toc; do
  while IFS= read -r line; do
    case "$line" in \#*|"") continue;; esac
    f="${line//\\//}"; f="${f%"${f##*[![:space:]]}"}"
    case "$f" in *.lua|*.xml) [ -f "$SRC/$f" ] || { echo "error: $(basename "$toc") lists missing $f" >&2; exit 1; };; esac
  done < "$toc"
done

mkdir -p "$DIST"
zip_path="$DIST/$NAME-$version.zip"
rm -f "$zip_path"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/$NAME"
(cd "$SRC" && tar -cf - --exclude '.DS_Store' --exclude '*.bak' --exclude '*.orig' .) | (cd "$staging/$NAME" && tar -xf -)

excludes=()
for client in "${LEGACY_CLIENTS[@]}"; do
  excludes+=("$NAME/$client/*" "$NAME/${NAME}_$client.toc")
done
(cd "$staging" && zip -r -q -X "$zip_path" "$NAME" -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig' "${excludes[@]}")
echo "built $(basename "$zip_path")   files: $(unzip -Z1 "$zip_path" | grep -cv '/$')   size: $(du -h "$zip_path" | cut -f1)"
