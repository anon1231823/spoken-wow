#!/usr/bin/env bash
# Builds the ZoneLore sound packs, one zip per quality tier.
#
#   ./scripts/package-audio.sh                 # both tiers
#   ./scripts/package-audio.sh standard        # just the 64kbps one
#   ./scripts/package-audio.sh high            # just the 128kbps one
#
# Two tiers exist because this is a ~790MB download at the source bitrate, which
# is a lot to ask for narration that is mostly listened to once per zone. 64kbps
# mono is close to transparent for speech and roughly halves that.
#
# Separate from package.sh because the two addons are released on their own
# cadences: most ZoneLore releases do not touch a single voiceline, and the audio
# should not ride along with a Lua bugfix.
#
# ElevenLabs bills characters, not bytes, so the audio is generated at the highest
# quality the plan allows and shrunk here instead. That keeps a high-quality master
# on disk: raising a shipped bitrate later is a re-run of this script rather than
# a second purchase.
#
# Each tier ships as its own addon folder so a player can install both and switch
# between them in-game. They share one generated Data/Sounds.lua, which reads its
# own folder name and tier out of the .toc at load time -- see build-lookup.mjs.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/addon/ZoneLoreAudio"
TOC="$SRC/ZoneLoreAudio.toc"
SOUNDS="$SRC/Sounds"
DIST="$REPO/dist"

# tier -> folder name, bitrate, title. The source tree is already the high tier,
# so that one is copied rather than transcoded, and it keeps the unqualified name:
# the full-quality pack is the one a player should land on without having to
# choose, and the smaller one advertises the trade in its own name.
tier_folder() { case "$1" in standard) echo "ZoneLoreAudio64";; high) echo "ZoneLoreAudio";; esac; }
tier_bitrate() { case "$1" in standard) echo "64";; high) echo "128";; esac; }
tier_title()   { case "$1" in standard) echo "ZoneLore Audio 64";; high) echo "ZoneLore Audio";; esac; }

tiers=("standard" "high")
if [[ $# -gt 0 ]]; then
  for arg in "$@"; do
    if [[ -z "$(tier_folder "$arg")" ]]; then
      echo "error: unknown tier '$arg' (expected: standard, high)" >&2
      exit 1
    fi
  done
  tiers=("$@")
fi

if [[ ! -f "$TOC" ]]; then
  echo "error: $TOC not found" >&2
  exit 1
fi

version="$(sed -n 's/^## Version:[[:space:]]*//p' "$TOC" | head -1 | tr -d '\r')"
if [[ -z "$version" ]]; then
  echo "error: no '## Version:' line in $TOC" >&2
  exit 1
fi

count="$(find "$SOUNDS" -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$count" -eq 0 ]]; then
  echo "error: no mp3 files in $SOUNDS" >&2
  echo "       Generate some first:  node tools/voice/generate.mjs --all --generate" >&2
  exit 1
fi

# A lookup table that does not match the files on disk is the failure that plays
# silence in-game rather than erroring, so check it here rather than discovering
# it after upload.
echo "checking the lookup table against the files..."
node "$REPO/tools/voice/validate-audio.mjs"

# Each tier ships the README for its own CurseForge page, so the description a
# player read before downloading is the file they end up with.
node "$REPO/tools/descriptions.mjs" --write >/dev/null
tier_readme() { case "$1" in
  standard) echo "$REPO/dist/descriptions/zoneloreaudio64.md";;
  high)     echo "$REPO/dist/descriptions/zoneloreaudio.md";;
esac; }

# Transcoding needs ffmpeg, but only for the tiers that are not a straight copy.
for tier in "${tiers[@]}"; do
  if [[ "$(tier_bitrate "$tier")" != "128" ]]; then
    command -v ffmpeg >/dev/null || { echo "error: ffmpeg is required to build the $tier tier" >&2; exit 1; }
    break
  fi
done

mkdir -p "$DIST"

for tier in "${tiers[@]}"; do
  folder="$(tier_folder "$tier")"
  bitrate="$(tier_bitrate "$tier")"
  title="$(tier_title "$tier")"
  zip_path="$DIST/$folder-$version.zip"

  echo
  echo "=== $tier tier -> $folder (${bitrate}kbps) ==="
  rm -f "$zip_path"

  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' EXIT
  mkdir -p "$staging/$folder"

  # Everything except the audio is copied; the audio is either re-encoded or
  # copied into place, so the tree the client sees is identical apart from the
  # bitrate and the three .toc lines rewritten below.
  rsync -a --exclude 'Sounds/' --exclude '.DS_Store' "$SRC/" "$staging/$folder/"
  # The .toc must be named after its folder. The high tier already is, and mv
  # onto itself is an error rather than a no-op.
  if [[ "$folder" != "ZoneLoreAudio" ]]; then
    mv "$staging/$folder/ZoneLoreAudio.toc" "$staging/$folder/$folder.toc"
  fi
  cp "$(tier_readme "$tier")" "$staging/$folder/README.md"

  # The .toc is the only place the tier is recorded. Data/Sounds.lua reads these
  # back through GetAddOnMetadata, which is what lets one generated file serve
  # every tier.
  sed -i.bak \
    -e "s|^## Title:.*|## Title: $title|" \
    -e "s|^## X-ZoneLore-Quality:.*|## X-ZoneLore-Quality: $tier|" \
    -e "s|^## X-ZoneLore-Bitrate:.*|## X-ZoneLore-Bitrate: $bitrate|" \
    "$staging/$folder/$folder.toc"
  rm -f "$staging/$folder/$folder.toc.bak"

  if [[ "$bitrate" == "128" ]]; then
    rsync -a --exclude '.DS_Store' --exclude '*.part' "$SOUNDS/" "$staging/$folder/Sounds/"
  else
    echo "transcoding $count files to ${bitrate}k mono..."
    while IFS= read -r file; do
      rel="${file#"$SOUNDS"/}"
      out="$staging/$folder/Sounds/$rel"
      mkdir -p "$(dirname "$out")"
      ffmpeg -nostdin -loglevel error -i "$file" -codec:a libmp3lame -b:a "${bitrate}k" -ac 1 "$out"
    done < <(find "$SOUNDS" -name '*.mp3')
  fi

  (cd "$staging" && zip -r -q -X "$zip_path" "$folder" \
    -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig' '*.part')

  rm -rf "$staging"
  trap - EXIT

  files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"
  size="$(du -h "$zip_path" | cut -f1)"
  echo "built $zip_path"
  echo "  version: $version   files: $files   size: $size   bitrate: ${bitrate}k"
done
