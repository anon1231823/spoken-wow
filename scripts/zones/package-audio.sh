#!/usr/bin/env bash
# Builds the Spoken Zones sound pack.
#
#   ./scripts/package-audio.sh                 # the English pack
#   ./scripts/package-audio.sh standard        # just the 64kbps one
#   ./scripts/package-audio.sh high            # just the 128kbps one
#   LOCALE=deDE ./scripts/package-audio.sh     # the German pack, VBR only
#
# Two tiers exist because this is a ~790MB download at the source bitrate, which
# is a lot to ask for narration that is mostly listened to once per zone. The
# standard tier is VBR mono (lame -V6, ~50kbps effective on speech): close to
# transparent for narration, and VBR spends the bits where the voice needs them
# instead of padding silence to a constant rate. The pack keeps "64" in its name
# and .toc as the nominal tier label.
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
#
# ONE LANGUAGE PER RUN, and only English gets two tiers. A language is a tenfold
# multiplication of everything expensive here -- generation credits, a CurseForge
# project, a several-hundred-megabyte upload -- so a second tier for a language is
# a decision to take when somebody asks for it, not a default. LOCALE picks the
# language; unset means English, which is every run so far.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCALE="${LOCALE:-enUS}"

# Exported, not just used here: the validate-audio and descriptions runs below are
# Node processes that resolve their own manifest and Sounds paths from it, and a
# packaging run that checked English's manifest against another language's files
# would pass by looking at neither.
export SPOKEN_ZONES_LANG="$LOCALE"

# The masters live in the language's own pack folder; English's are the high tier
# it already publishes. Kept in step with packFolder() in tools/lib/locales.mjs:
# the full locale code, because a truncation would give esES and esMX one folder.
if [[ "$LOCALE" == "enUS" ]]; then
  SRC="$REPO/addons/SpokenZonesAudio"
else
  SRC="$REPO/addons/SpokenZonesAudio_$LOCALE"
fi
TOC="$SRC/$(basename "$SRC").toc"
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
CACHE_ROOT="$REPO/pipelines/zones/audio-transcoded"

checksum() {
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$1" | cut -d' ' -f1
  else
    md5 -q "$1"
  fi
}
export -f checksum

# libmp3lame is single-threaded, so the corpus encodes as fast as there are cores
# to put ffmpeg processes on. Override with JOBS=1 to get the old serial order
# back when a failing encode needs readable output.
JOBS="${JOBS:-$( (command -v nproc >/dev/null 2>&1 && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"

# tier -> folder name, bitrate, title. The source tree is already the high tier,
# so that one is copied rather than transcoded, and it keeps the unqualified name:
# the full-quality pack is the one a player should land on without having to
# choose, and the smaller one advertises the trade in its own name.
#
# tier_encoding names the ffmpeg recipe AND the cache directory, so changing the
# recipe automatically starts a fresh cache instead of serving entries cut with
# the old one. "copy" means no transcode.
#
# A non-English pack ships one tier and so carries no bitrate marker in its name:
# there is nothing to tell it apart from. If a second tier is ever wanted for a
# language, it needs a suffix of its own -- and a rename of what is already
# published, which is the reason not to invent one now.
tier_folder() {
  if [[ "$LOCALE" != "enUS" ]]; then basename "$SRC"; return; fi
  case "$1" in standard) echo "ZoneLoreAudio64";; high) echo "SpokenZonesAudio";; esac
}
tier_bitrate()  { case "$1" in standard) echo "64";; high) echo "128";; esac; }
tier_encoding() { case "$1" in standard) echo "vbr-v6";; high) echo "copy";; esac; }
# The high tier was renamed from ZoneLoreAudio with the projects: a pack reads its own folder
# name out of the loader, so nothing breaks, and the re-download it costs is one the release
# doing the rename costs anyway. ZoneLoreAudio64 keeps its name because it is retired.
tier_title() {
  if [[ "$LOCALE" != "enUS" ]]; then echo "Spoken Zones Audio $LOCALE"; return; fi
  case "$1" in standard) echo "Spoken Zones Audio 64";; high) echo "Spoken Zones Audio";; esac
}

# One tier per language, now that the 64 kbps English pack is retired: two qualities meant
# two CurseForge projects, two folder names and a question at install time that the answer
# "take the bigger one" always won. ZoneLoreAudio64 stays published so existing installs keep
# working and is never uploaded to again.
#
# `standard` is still reachable by naming it, and is still what a non-English pack ships:
# a language has one tier, and its folder carries no bitrate marker because there is nothing
# to tell it apart from.
if [[ "$LOCALE" == "enUS" ]]; then
  tiers=("high")
else
  tiers=("standard")
fi

if [[ $# -gt 0 ]]; then
  for arg in "$@"; do
    if [[ -z "$(tier_bitrate "$arg")" ]]; then
      echo "error: unknown tier '$arg' (expected: standard, high)" >&2
      exit 1
    fi
    if [[ "$LOCALE" != "enUS" && "$arg" != "standard" ]]; then
      echo "error: $LOCALE ships the standard tier only -- see the header of this script" >&2
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

# The language is set by rewriting this line, so a .toc without it would ship a
# pack that reports itself as English and plays under English text only.
if ! grep -q '^## X-SpokenZones-Language:' "$TOC"; then
  echo "error: $TOC has no '## X-SpokenZones-Language:' line to rewrite" >&2
  exit 1
fi

count="$(find "$SOUNDS" -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$count" -eq 0 ]]; then
  echo "error: no mp3 files in $SOUNDS" >&2
  echo "       Generate some first:  node pipelines/zones/tools/voice/generate.mjs --all --generate" >&2
  exit 1
fi

# A lookup table that does not match the files on disk is the failure that plays
# silence in-game rather than erroring, so check it here rather than discovering
# it after upload.
echo "checking the lookup table against the files..."
node "$REPO/pipelines/zones/tools/voice/validate-audio.mjs"

# Each tier ships the README for its own CurseForge page, so the description a
# player read before downloading is the file they end up with.
node "$REPO/scripts/descriptions.mjs" --write >/dev/null
# A language with no CurseForge page of its own ships the English description
# rather than nothing: the page it was downloaded from is the honest fallback
# until somebody writes one for it.
# Named by CurseForge slug, which is what descriptions.mjs writes the files out as -- not by
# folder, which still carries the pre-rename name.
#
# The retired 64 kbps page is gone, so every tier without a page of its own falls back to the
# one shipping description rather than to a page nobody maintains.
tier_readme() {
  local path
  if [[ "$LOCALE" != "enUS" ]]; then
    path="$REPO/dist/descriptions/$(echo "$(tier_folder "$1")" | tr '[:upper:]' '[:lower:]').md"
    [[ -f "$path" ]] || path="$REPO/dist/descriptions/spoken-zones-audio.md"
    echo "$path"
    return
  fi
  echo "$REPO/dist/descriptions/spoken-zones-audio.md"
}

# Transcoding needs ffmpeg, but only for the tiers that are not a straight copy.
for tier in "${tiers[@]}"; do
  if [[ "$(tier_encoding "$tier")" != "copy" ]]; then
    command -v ffmpeg >/dev/null || { echo "error: ffmpeg is required to build the $tier tier" >&2; exit 1; }
    break
  fi
done

mkdir -p "$DIST"

for tier in "${tiers[@]}"; do
  folder="$(tier_folder "$tier")"
  bitrate="$(tier_bitrate "$tier")"
  encoding="$(tier_encoding "$tier")"
  title="$(tier_title "$tier")"
  zip_path="$DIST/$folder-$version.zip"

  echo
  echo "=== $tier tier -> $folder ($encoding, nominal ${bitrate}kbps) ==="
  rm -f "$zip_path"

  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' EXIT
  mkdir -p "$staging/$folder"

  # Everything except the audio is copied; the audio is either re-encoded or
  # copied into place, so the tree the client sees is identical apart from the
  # bitrate and the three .toc lines rewritten below.
  rsync -a --exclude 'Sounds/' --exclude '.DS_Store' "$SRC/" "$staging/$folder/"
  # The .toc must be named after its folder. The source tier already is, and mv
  # onto itself is an error rather than a no-op.
  if [[ "$folder" != "$(basename "$SRC")" ]]; then
    mv "$staging/$folder/$(basename "$SRC").toc" "$staging/$folder/$folder.toc"
  fi
  cp "$(tier_readme "$tier")" "$staging/$folder/README.md"

  # The .toc is the only place the tier is recorded. Data/Sounds.lua reads these
  # back through GetAddOnMetadata, which is what lets one generated file serve
  # every tier.
  #
  # ## Interface is deliberately NOT rewritten here: the clients a pack loads on
  # are a property of the audio, which is identical across tiers, not of the tier.
  # It comes through from the source .toc so both tiers can only ever agree.
  # IconTexture names the folder it lives in, and the standard tier's folder is not
  # the source's -- an unrewritten path points at an addon the player may not have
  # installed, which the client answers with no icon at all rather than an error.
  sed -i.bak \
    -e "s|^## IconTexture:.*|## IconTexture: Interface\\\\AddOns\\\\$folder\\\\Textures\\\\AddonIcon.tga|" \
    -e "s|^## Title:.*|## Title: $title|" \
    -e "s|^## X-SpokenZones-Quality:.*|## X-SpokenZones-Quality: $tier|" \
    -e "s|^## X-SpokenZones-Bitrate:.*|## X-SpokenZones-Bitrate: $bitrate|" \
    -e "s|^## X-SpokenZones-Language:.*|## X-SpokenZones-Language: $LOCALE|" \
    "$staging/$folder/$folder.toc"
  rm -f "$staging/$folder/$folder.toc.bak"

  if [[ "$encoding" == "copy" ]]; then
    # No transcode, but ~790MB of copying is still a long silence.
    echo "copying $count masters..."
    rsync -a --exclude '.DS_Store' --exclude '*.part' "$SOUNDS/" "$staging/$folder/Sounds/"
  else
    cache="$CACHE_ROOT/$encoding"
    mkdir -p "$cache"

    # Three passes rather than one loop, because only the middle one is expensive
    # and only it is worth spreading over the cores: checksum every master to
    # learn its cache key, encode the keys that are missing, then place them.
    plan="$(mktemp)"
    find "$SOUNDS" -name '*.mp3' -print0 \
      | xargs -0 -P "$JOBS" -n 1 bash -c 'printf "%s\t%s\n" "$(checksum "$1")" "$1"' _ \
      >"$plan"

    # Deduplicated, because two identical masters share a key and must not become
    # two workers writing the same cache entry.
    todo="$(mktemp)"
    sort -u -t"$(printf '\t')" -k1,1 "$plan" | while IFS=$'\t' read -r key file; do
      [[ -f "$cache/$key.mp3" ]] || printf '%s\t%s\n' "$key" "$file"
    done >"$todo"

    encoded="$(wc -l <"$todo" | tr -d ' ')"
    hits=$((count - encoded))

    if (( encoded > 0 )); then
      # Minutes of ffmpeg with nothing on stdout is indistinguishable from a hang.
      # The count has to come from a file rather than a variable: each worker is
      # its own process, so an incremented shell variable would die with it.
      progress_file="$(mktemp)"
      export CACHE="$cache" PROGRESS="$progress_file" TOTAL="$encoded"
      encode_one() {
        # Via .part and mv, so an interrupted run cannot leave a truncated file
        # under a name that claims to be a complete encode of that checksum. The
        # pid is in there too, so a second copy of this script running against the
        # same cache cannot land in the other's scratch file.
        # -f mp3 is required with it: ffmpeg picks the muxer from the extension,
        # and ".part" is not one it knows.
        # VBR (-q:a 6, ~50kbps effective on mono speech) rather than CBR: the bits
        # follow the voice instead of padding silence to a constant rate. Nominal
        # tier stays "64" in the pack name and .toc.
        local part="$CACHE/$2.$$.part"
        ffmpeg -nostdin -loglevel error -f mp3 -i "$1" \
          -codec:a libmp3lame -q:a 6 -ac 1 -f mp3 "$part"
        mv "$part" "$CACHE/$2.mp3"

        # One byte appended per finished file; short appends to O_APPEND do not
        # interleave, so the size is the count.
        printf '.' >>"$PROGRESS"
        local n
        n="$(wc -c <"$PROGRESS" | tr -d ' ')"
        # On a terminal the count is rewritten in place; piped to a file or a CI
        # log, \r would produce one unreadable line, so there it is every 100.
        if [[ -t 1 ]]; then
          printf '\r  %4d/%-4d encoded' "$n" "$TOTAL"
        elif (( n % 100 == 0 || n == TOTAL )); then
          echo "  $n/$TOTAL encoded"
        fi
      }
      export -f encode_one

      echo "encoding $encoded files ($encoding, mono) across $JOBS jobs (cache: $cache)"
      echo "  $hits of $count already cached"
      tr '\t\n' '\0\0' <"$todo" \
        | xargs -0 -P "$JOBS" -n 2 bash -c 'encode_one "$1" "$0"'
      [[ -t 1 ]] && printf '\n'
      rm -f "$progress_file"
    else
      echo "all $count files already cached ($encoding, $cache)"
    fi

    # Directories first in one pass, so placing the clips is a flat run of cp
    # rather than 1353 mkdir processes.
    rsync -a -f'+ */' -f'- *' "$SOUNDS/" "$staging/$folder/Sounds/"
    while IFS=$'\t' read -r key file; do
      cp "$cache/$key.mp3" "$staging/$folder/Sounds/${file#"$SOUNDS"/}"
    done <"$plan"

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
      <(cut -f1 "$plan" | sed 's/$/.mp3/' | sort -u) || true)
    rm -f "$plan" "$todo"

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
  echo "  version: $version   files: $files   size: $size   encoding: $encoding"
done
