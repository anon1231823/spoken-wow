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
# contain the ZoneLore/ folder itself -- hence the `cd` before zipping.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="ZoneLore"
SRC="$REPO/addon/$NAME"
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
  if [[ -n "$(git -C "$REPO" status --porcelain -- addon)" ]]; then
    echo "error: addon/ has uncommitted changes." >&2
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

# -X drops the extra macOS attributes that otherwise ride along.
(cd "$REPO/addon" && zip -r -q -X "$zip_path" "$NAME" \
  -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig')

files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"
size="$(du -h "$zip_path" | cut -f1)"

echo "built $zip_path"
echo "  version: $version   files: $files   size: $size"
echo
echo "sanity check the layout (the root must be $NAME/):"
echo "  unzip -l $zip_path | head"
