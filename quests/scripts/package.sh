#!/usr/bin/env bash
# Builds the player addon's distributable zip.
#
#   ./scripts/package.sh                 # dist/VoiceOverRedux-<version>.zip
#   ALLOW_DIRTY=1 ./scripts/package.sh   # build from an uncommitted tree
#
# ONE ZIP, because the addon targets Blizzard's clients only. Those pick their .toc by flavor
# suffix - _Vanilla, _TBC, _Wrath, _Mainline - so a single archive serves Classic Era through
# retail and the client decides. This used to be four zips: the 1.12, 2.4.3 and 3.3.5 private
# server clients predate suffix support, read VoiceOverRedux.toc and nothing else, and each
# wanted a different file under that one name. Dropping them dropped the zip matrix with them.
#
# The version comes from `## Version:` in the .toc, so bumping the addon and naming the zip
# stay one edit rather than two. Modelled on ../wow-lore/scripts/package.sh, and now the same
# shape as it - the audio is the only thing that lives elsewhere.
#
# Addon hosts unpack the zip straight into Interface/AddOns, so its root must contain the
# VoiceOverRedux/ folder itself - hence the `cd` before zipping.
#
# The sound pack is NOT here: it is 1.5 GB and rebuilt from the audio store on its own
# schedule. See scripts/package-audio.sh, or `make package-audio`.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${NAME:-VoiceOverRedux}"
SRC="$REPO/$NAME"
TOC="$SRC/$NAME.toc"
DIST="${DIST:-$REPO/dist}"

[ -f "$TOC" ] || { echo "error: $TOC not found" >&2; exit 1; }

version="$(sed -n 's/^## Version:[[:space:]]*//p' "$TOC" | head -1 | tr -d '\r')"
[ -n "$version" ] || { echo "error: no '## Version:' line in $TOC" >&2; exit 1; }

# A zip built from uncommitted edits cannot be traced back to a commit later.
if [ -z "${ALLOW_DIRTY:-}" ] && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  if [ -n "$(git -C "$REPO" status --porcelain -- "$NAME")" ]; then
    echo "error: $NAME/ has uncommitted changes." >&2
    echo "       Commit them, or re-run with ALLOW_DIRTY=1 to package anyway." >&2
    exit 1
  fi
fi

# The client silently ignores files the .toc does not list, but a .toc listing files that do
# not exist is a typo nobody sees until the addon half-loads in game.
missing=()
while IFS= read -r entry; do
  [ -f "$SRC/$entry" ] || missing+=("$entry")
done < <(sed -e 's/#.*//' -e 's/[[:space:]]*$//' "$TOC" | grep -E '\.(lua|xml)$' || true)

if [ ${#missing[@]} -gt 0 ]; then
  echo "error: $NAME.toc lists files that do not exist:" >&2
  printf '       %s\n' "${missing[@]}" >&2
  exit 1
fi

mkdir -p "$DIST"
zip_path="$DIST/$NAME-$version.zip"
rm -f "$zip_path"

# Addon hosts unpack into Interface/AddOns, so the archive root must be the folder itself.
# -X drops the extra macOS attributes that otherwise ride along.
(cd "$REPO" && zip -r -q -X "$zip_path" "$NAME" \
  -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig')

files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"

echo "built $zip_path"
echo "  version: $version   files: $files   size: $(du -h "$zip_path" | cut -f1)"
echo
echo "sanity check the layout (the root must be $NAME/):"
echo "  unzip -l $zip_path | head"
