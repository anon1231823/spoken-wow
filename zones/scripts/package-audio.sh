#!/usr/bin/env bash
# Builds a distributable zip of the ZoneLoreAudio companion addon.
#
#   ./scripts/package-audio.sh              # ship the 128kbps masters as-is
#   BITRATE=64 ./scripts/package-audio.sh   # transcode down on the way in
#
# Separate from package.sh because the two addons are released on their own
# cadences: most ZoneLore releases do not touch a single voiceline, and the audio
# is a ~700MB download that should not ride along with a Lua bugfix.
#
# ElevenLabs bills characters, not bytes, so the audio is generated at the highest
# quality the plan allows and shrunk here instead. That keeps a high-quality master
# on disk: raising the shipped bitrate later is a re-run of this script rather than
# a second purchase.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="ZoneLoreAudio"
SRC="$REPO/addon/$NAME"
TOC="$SRC/$NAME.toc"
SOUNDS="$SRC/Sounds"
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

zip_path="$DIST/$NAME-$version.zip"
mkdir -p "$DIST"
rm -f "$zip_path"

if [[ -n "${BITRATE:-}" ]]; then
  command -v ffmpeg >/dev/null || { echo "error: BITRATE set but ffmpeg is not installed" >&2; exit 1; }

  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' EXIT
  mkdir -p "$staging/$NAME"

  # Everything except the audio is copied; the audio is re-encoded into place so
  # the tree the client sees is identical apart from the bitrate.
  rsync -a --exclude 'Sounds/' "$SRC/" "$staging/$NAME/"

  echo "transcoding $count files to ${BITRATE}k mono..."
  while IFS= read -r file; do
    rel="${file#"$SOUNDS"/}"
    out="$staging/$NAME/Sounds/$rel"
    mkdir -p "$(dirname "$out")"
    ffmpeg -nostdin -loglevel error -i "$file" -codec:a libmp3lame -b:a "${BITRATE}k" -ac 1 "$out"
  done < <(find "$SOUNDS" -name '*.mp3')

  (cd "$staging" && zip -r -q -X "$zip_path" "$NAME" -x '*.DS_Store')
else
  (cd "$REPO/addon" && zip -r -q -X "$zip_path" "$NAME" \
    -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig' '*.part')
fi

files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"
size="$(du -h "$zip_path" | cut -f1)"

echo "built $zip_path"
echo "  version: $version   files: $files   size: $size   bitrate: ${BITRATE:-source}"
