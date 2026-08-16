#!/usr/bin/env bash
# Builds the player addon's distributable zips, one per client.
#
#   ./scripts/package.sh                 # dist/VoiceOverRedux-WoW_<client>-<version>.zip
#   ALLOW_DIRTY=1 ./scripts/package.sh   # build from an uncommitted tree
#
# Four zips rather than one, because a WoW client loads <Folder>.toc and nothing else: each
# zip carries exactly one .toc, copied from the variant for that client. Shipping all eight
# variants in one zip would work on modern clients, which pick by suffix, and silently load
# the wrong file list on 1.12, which does not.
#
# The version comes from `## Version:` in the .toc, so bumping the addon and naming the zip
# stay one edit rather than two. Same rule as ../wow-lore/scripts/package.sh, which this is
# modelled on; the differences are the four clients and the audio living elsewhere.
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

# client label -> the .toc variant it loads. The label lands in the zip name, where it is
# what a player picks between.
CLIENTS=(
  "1.12:1.12"
  "2.4.3:2.4.3"
  "3.3.5:3.3.5"
  "BlizzClassic:Mainline"
)

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
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

for pair in "${CLIENTS[@]}"; do
  client="${pair%%:*}"
  variant="${pair##*:}"
  source_toc="$SRC/${NAME}_${variant}.toc"
  [ -f "$source_toc" ] || { echo "error: no $source_toc for client $client" >&2; exit 1; }

  folder="$staging/$client/$NAME"
  mkdir -p "$folder"
  # -a and not -r: the addon carries no symlinks today, and copying one as a link would
  # produce a zip that unpacks into nothing on someone else's machine.
  (cd "$SRC" && tar -cf - --exclude '.DS_Store' --exclude '*.bak' --exclude '*.orig' .) \
    | (cd "$folder" && tar -xf -)

  # The unsuffixed name is what every client actually opens; the variants ride along
  # harmlessly, and dropping them would make the zips differ from the tree they came from.
  cp "$source_toc" "$folder/$NAME.toc"

  zip_path="$DIST/$NAME-WoW_$client-$version.zip"
  rm -f "$zip_path"
  # -X drops the extra macOS attributes that otherwise ride along.
  (cd "$staging/$client" && zip -r -q -X "$zip_path" "$NAME" \
    -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig')

  files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"
  echo "built $(basename "$zip_path")   files: $files   size: $(du -h "$zip_path" | cut -f1)"
done

echo
echo "version $version, from $NAME.toc"
echo "sanity check the layout (the root must be $NAME/):"
echo "  unzip -l $DIST/$NAME-WoW_1.12-$version.zip | head"
