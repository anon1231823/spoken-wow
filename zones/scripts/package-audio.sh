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

# Transcoded clips, kept between runs. A sibling of dist/ rather than a child,
# because `make clean` removes dist/ and re-encoding the corpus is five minutes.
#
# CONTENT-ADDRESSED: the file name is the checksum of the master it came from, so
# a cache hit cannot be stale -- a re-cut voiceline hashes differently and misses.
# Keying on mtime would be cheaper and wrong: `make pull` copies the droplet's
# timestamps, so a freshly pulled clip can be older than the cache entry it should
# be replacing. Checksumming all 1353 masters costs ~2s against ~5min of ffmpeg.
CACHE_ROOT="$REPO/audio-transcoded"

checksum() {
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$1" | cut -d' ' -f1
  else
    md5 -q "$1"
  fi
}

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
    # No transcode, but ~790MB of copying is still a long silence.
    echo "copying $count masters..."
    rsync -a --exclude '.DS_Store' --exclude '*.part' "$SOUNDS/" "$staging/$folder/Sounds/"
  else
    cache="$CACHE_ROOT/$bitrate"
    mkdir -p "$cache"
    used="$(mktemp)"
    hits=0
    encoded=0

    done_n=0

    # Minutes of ffmpeg with nothing on stdout is indistinguishable from a hang.
    # On a terminal the count is rewritten in place; piped to a file or a CI log,
    # \r would produce one unreadable line, so there it is a line every 100.
    progress() {
      if [[ -t 1 ]]; then
        printf '\r  %4d/%-4d  %d encoded, %d reused' "$done_n" "$count" "$encoded" "$hits"
      elif (( done_n % 100 == 0 || done_n == count )); then
        echo "  $done_n/$count  $encoded encoded, $hits reused"
      fi
    }

    echo "encoding $count files to ${bitrate}k mono (cache: $cache)"
    while IFS= read -r file; do
      rel="${file#"$SOUNDS"/}"
      out="$staging/$folder/Sounds/$rel"
      mkdir -p "$(dirname "$out")"

      key="$(checksum "$file")"
      cached="$cache/$key.mp3"
      echo "$key.mp3" >>"$used"

      if [[ -f "$cached" ]]; then
        hits=$((hits + 1))
      else
        # Via .part and mv, so an interrupted run cannot leave a truncated file
        # under a name that claims to be a complete encode of that checksum.
        # -f mp3 is required with it: ffmpeg picks the muxer from the extension,
        # and ".part" is not one it knows.
        ffmpeg -nostdin -loglevel error -f mp3 -i "$file" \
          -codec:a libmp3lame -b:a "${bitrate}k" -ac 1 -f mp3 "$cached.part"
        mv "$cached.part" "$cached"
        encoded=$((encoded + 1))
      fi

      cp "$cached" "$out"
      done_n=$((done_n + 1))
      progress
    done < <(find "$SOUNDS" -name '*.mp3')
    [[ -t 1 ]] && printf '\n'

    # Entries for masters that have since been re-cut or deleted. Without this the
    # cache keeps every superseded encode forever, which is what audio-history/ is
    # for and this is not.
    pruned=0
    while IFS= read -r stale; do
      [[ -n "$stale" ]] || continue
      rm -f "$cache/$stale"
      pruned=$((pruned + 1))
    done < <(comm -23 \
      <(find "$cache" -name '*.mp3' -exec basename {} \; | sort) \
      <(sort -u "$used") || true)
    rm -f "$used"

    echo "  $hits reused, $encoded encoded, $pruned superseded entries dropped"
  fi

  echo "zipping $folder..."

  (cd "$staging" && zip -r -q -X "$zip_path" "$folder" \
    -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig' '*.part')

  rm -rf "$staging"
  trap - EXIT

  files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"
  size="$(du -h "$zip_path" | cut -f1)"
  echo "built $zip_path"
  echo "  version: $version   files: $files   size: $size   bitrate: ${bitrate}k"
done
