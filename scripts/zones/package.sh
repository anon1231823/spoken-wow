#!/usr/bin/env bash
# Builds a distributable zip for CurseForge / WoWInterface / Wago.
#
#   ./scripts/package.sh              # dist/ZoneLore-<version>.zip
#   ALLOW_DIRTY=1 ./scripts/package.sh  # build from an uncommitted tree
#
# The version comes from `## Version:` in the .toc, so bumping the addon and
# naming the zip stay one edit rather than two.
#
# Addon hosts unpack the zip straight into Interface/AddOns, so its root must
# contain the ZoneLore/ folder itself -- hence the staging copy before zipping.
#
# The zip also carries a ZoneLore/ tombstone: one .toc and no code, which keeps the old
# SavedVariables file loading for Migration.lua to read and overwrites the old addon's
# code when a manager installs this release over it. See scripts/quests/package.sh.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADDON="${ADDON:-addons/SpokenZones}"
NAME="${NAME:-SpokenZones}"
TOMBSTONE="ZoneLore"
TOMBSTONE_SRC="$REPO/addons/tombstones/$TOMBSTONE"
SRC="$REPO/$ADDON"
TOC="$SRC/$NAME.toc"
DIST="$REPO/dist"

if [[ ! -f "$TOC" ]]; then
  echo "error: $TOC not found" >&2
  exit 1
fi

version="$(sed -n 's/^## Version:[[:space:]]*//p' "$TOC" | head -1 | tr -d '\r')"
if [[ -z "$version" ]]; then
  echo "error: no '## Version:' line in $TOC" >&2
  exit 1
fi

# A zip built from uncommitted edits cannot be traced back to a tag later.
if [[ -z "${ALLOW_DIRTY:-}" ]] && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  if [[ -n "$(git -C "$REPO" status --porcelain -- "$ADDON")" ]]; then
    echo "error: $ADDON/ has uncommitted changes." >&2
    echo "       Commit them, or re-run with ALLOW_DIRTY=1 to package anyway." >&2
    exit 1
  fi
fi

# The client silently ignores files the .toc does not list, but shipping them
# still bloats the download and confuses reviewers, so flag the mismatch.
missing=()
while IFS= read -r entry; do
  [[ -f "$SRC/$entry" ]] || missing+=("$entry")
done < <(sed -e 's/#.*//' -e 's/[[:space:]]*$//' "$TOC" | grep -E '\.(lua|xml)$' || true)

if (( ${#missing[@]} )); then
  echo "error: .toc lists files that do not exist:" >&2
  printf '       %s\n' "${missing[@]}" >&2
  exit 1
fi

zip_path="$DIST/$NAME-$version.zip"
mkdir -p "$DIST"
rm -f "$zip_path"

# Staged under the installed folder name, because that is not the source directory's
# name and the archive root has to be the former.
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/$NAME"
(cd "$SRC" && tar -cf - --exclude '.DS_Store' --exclude '*.bak' --exclude '*.orig' .) \
  | (cd "$staging/$NAME" && tar -xf -)
mkdir -p "$staging/$TOMBSTONE"
cp "$TOMBSTONE_SRC/$TOMBSTONE.toc" "$staging/$TOMBSTONE/"

# -X drops the extra macOS attributes that otherwise ride along.
(cd "$staging" && zip -r -q -X "$zip_path" "$NAME" "$TOMBSTONE" \
  -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig')

files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"
size="$(du -h "$zip_path" | cut -f1)"

echo "built $zip_path"
echo "  version: $version   files: $files   size: $size"
echo
echo "sanity check the layout (the root must be $NAME/):"
echo "  unzip -l $zip_path | head"
