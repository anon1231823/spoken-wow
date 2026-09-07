#!/usr/bin/env bash
# Builds the player addon's distributable zips.
#
#   ./scripts/quests/package.sh                 # dist/VoiceOverRedux-<version>.zip + one per legacy client
#   ALLOW_DIRTY=1 ./scripts/quests/package.sh   # build from an uncommitted tree
#
# ONE ZIP FOR BLIZZARD'S CLIENTS, ONE APIECE FOR THE PRIVATE-SERVER ONES. Blizzard's clients
# pick their .toc by flavor suffix - _Vanilla, _TBC, _Wrath, _Mainline - so a single archive
# serves Classic Era through retail and the client decides. The 1.12, 2.4.3 and 3.3.5 clients
# predate suffix support: each reads VoiceOverRedux.toc and nothing else, and each wants a
# different file under that one name, so each needs an archive of its own. They also load a
# vendored Ace3 of their own - the root Libs/ binds C_Timer.After at load time - which is why
# every legacy zip carries its client's directory and none of the others.
#
# The version comes from `## Version:` in the unsuffixed .toc, so bumping the addon and naming
# every zip stay one edit rather than five. Modelled on ../wow-lore/scripts/package.sh; the
# differences are the legacy clients and the audio living elsewhere.
#
# Addon hosts unpack the zip straight into Interface/AddOns, so its root must contain the
# VoiceOverRedux/ folder itself - hence the `cd` before zipping.
#
# The sound pack is NOT here: it is 1.5 GB and rebuilt from the audio store on its own
# schedule. See scripts/quests/package-audio.sh, or `make quests-package-audio`.
#
# SOURCE DIRECTORY AND SHIPPED FOLDER NAME ARE NOT THE SAME THING. The source lives at
# addons/SpokenQuests/, but what a player installs must still be called VoiceOverRedux
# until the rename ships with its SavedVariables migration -- an installed folder is the
# addon's identity to the client, to LibDBIcon and to every superseded-fork check. So
# ADDON says where to read from and NAME says what to write, and both zips are built
# from a staging copy: zipping in place would put the source directory's name in the
# archive root.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADDON="${ADDON:-addons/SpokenQuests}"
NAME="${NAME:-VoiceOverRedux}"
SRC="$REPO/$ADDON"
TOC="$SRC/$NAME.toc"
DIST="${DIST:-$REPO/dist}"

# client label -> the .toc variant it loads, which is also the directory holding that client's
# vendored Ace3. The label lands in the zip name, where it is what a player picks between.
CLIENTS=(
  "1.12:1.12"
  "2.4.3:2.4.3"
  "3.3.5:3.3.5"
)

[ -f "$TOC" ] || { echo "error: $TOC not found" >&2; exit 1; }

version="$(sed -n 's/^## Version:[[:space:]]*//p' "$TOC" | head -1 | tr -d '\r')"
[ -n "$version" ] || { echo "error: no '## Version:' line in $TOC" >&2; exit 1; }

# A zip built from uncommitted edits cannot be traced back to a commit later.
if [ -z "${ALLOW_DIRTY:-}" ] && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  if [ -n "$(git -C "$REPO" status --porcelain -- "$ADDON")" ]; then
    echo "error: $ADDON/ has uncommitted changes." >&2
    echo "       Commit them, or re-run with ALLOW_DIRTY=1 to package anyway." >&2
    exit 1
  fi
fi

# The client silently ignores files the .toc does not list, but a .toc listing files that do
# not exist is a typo nobody sees until the addon half-loads in game. Every variant is checked,
# not just the one this script reads the version from: the legacy ones point at directories no
# other client loads, so nothing else would ever notice them going missing. A .toc separates
# path segments with a backslash, which is not a separator on this side.
for toc in "$SRC"/*.toc; do
  missing=()
  while IFS= read -r entry; do
    [ -f "$SRC/$(printf '%s' "$entry" | tr '\\' '/')" ] || missing+=("$entry")
  done < <(sed -e 's/#.*//' -e 's/[[:space:]]*$//' "$toc" | grep -E '\.(lua|xml)$' || true)

  # A version that drifts between variants is invisible until it ships, and it did drift: the
  # legacy TOCs still said 1.0.0 when the rest said 1.1.1.
  toc_version="$(sed -n 's/^## Version:[[:space:]]*//p' "$toc" | head -1 | tr -d '\r')"
  if [ "$toc_version" != "$version" ]; then
    echo "error: $(basename "$toc") says $toc_version, $NAME.toc says $version" >&2
    exit 1
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    echo "error: $(basename "$toc") lists files that do not exist:" >&2
    printf '       %s\n' "${missing[@]}" >&2
    exit 1
  fi
done

# Environment.lua carries the same version as a literal, because it loads before the addon has
# any metadata API to ask. /vo diagnostics prints it, so a stale one misreports every bug
# report filed against it.
env_version="$(sed -n 's/.*AddonVersion = "\([^"]*\)".*/\1/p' "$SRC/Environment.lua" | head -1)"
if [ "$env_version" != "$version" ]; then
  echo "error: Environment.lua says $env_version, $NAME.toc says $version" >&2
  exit 1
fi

mkdir -p "$DIST"
zip_path="$DIST/$NAME-$version.zip"
rm -f "$zip_path"

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

# The archive root has to be the installed folder name, which is not the source
# directory's name, so every zip is built from a copy laid out under it.
stage_addon() {
  local dest="$1/$NAME"
  mkdir -p "$dest"
  # -a and not -r: the addon carries no symlinks today, and copying one as a link would
  # produce a zip that unpacks into nothing on someone else's machine.
  (cd "$SRC" && tar -cf - --exclude '.DS_Store' --exclude '*.bak' --exclude '*.orig' .) \
    | (cd "$dest" && tar -xf -)
}

# Addon hosts unpack into Interface/AddOns, so the archive root must be the folder itself.
# -X drops the extra macOS attributes that otherwise ride along. The legacy client directories
# are excluded: a Blizzard client loads none of them, and they are most of the archive.
legacy_excludes=()
for pair in "${CLIENTS[@]}"; do
  legacy_excludes+=("$NAME/${pair##*:}/*" "$NAME/${NAME}_${pair%%:*}.toc")
done

stage_addon "$staging/blizzard"
(cd "$staging/blizzard" && zip -r -q -X "$zip_path" "$NAME" \
  -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig' "${legacy_excludes[@]}")

files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"

echo "built $(basename "$zip_path")   files: $files   size: $(du -h "$zip_path" | cut -f1)"

for pair in "${CLIENTS[@]}"; do
  client="${pair%%:*}"
  variant="${pair##*:}"
  source_toc="$SRC/${NAME}_${variant}.toc"
  [ -f "$source_toc" ] || { echo "error: no $source_toc for client $client" >&2; exit 1; }

  stage_addon "$staging/$client"
  folder="$staging/$client/$NAME"

  # The unsuffixed name is the only one this client opens, so the variant for it goes there.
  # Everything the other clients need is then dead weight: the suffixed .toc files, the root
  # Libs/ (its AceTimer binds C_Timer.After, which does not exist here), and the two other
  # vendored trees.
  cp "$source_toc" "$folder/$NAME.toc"
  rm -rf "$folder/Libs" "$folder/embeds.xml"
  rm -f "$folder"/${NAME}_*.toc
  for other in "${CLIENTS[@]}"; do
    [ "${other##*:}" = "$variant" ] || rm -rf "$folder/${other##*:}"
  done

  zip_path="$DIST/$NAME-WoW_$client-$version.zip"
  rm -f "$zip_path"
  (cd "$staging/$client" && zip -r -q -X "$zip_path" "$NAME" \
    -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig')

  files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"
  echo "built $(basename "$zip_path")   files: $files   size: $(du -h "$zip_path" | cut -f1)"
done

echo
echo "version $version, from $NAME.toc"
echo "sanity check the layout (the root must be $NAME/):"
echo "  unzip -l $DIST/$NAME-$version.zip | head"
