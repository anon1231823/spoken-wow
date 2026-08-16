#!/usr/bin/env bash
# Build the data module from VBR copies of the audio store, and zip it.
#
#   make pack                    # the shipping pack: VBR, zipped, into dist/
#   make pack VERSION=1.4.0      # the version written into the .toc
#   ENCODE=copy make pack        # the masters, untranscoded, for a listening check
#   JOBS=1 make pack             # serial, when a failing encode needs readable output
#
# The store is 1.6 GB of mono speech at 64 and 128 kbps CBR - 128 for everything
# ElevenLabs has made since this pipeline existed, 64 for the pack this project
# inherited. Shipping that as-is asks a player to download well over a gigabyte for
# audio most of them hear once per quest.
#
# -q:a 6 is LAME's VBR, and VBR rather than CBR because the bits follow the voice
# instead of padding silence to a constant rate. The masters stay in audio/
# untouched: raising the shipped quality later is a re-run of this script rather
# than a second purchase from ElevenLabs, which bills characters and not bytes.
#
# ONLY THE 128 kbps CLIPS ARE TRANSCODED. -q:a 6 lands around 65 kbps on this
# speech, so putting the inherited 64 kbps pack through it would produce files no
# smaller and audibly worse - a second lossy pass buys nothing. That is a bitrate
# test rather than a list, so a re-generated line starts being transcoded the day
# it replaces an inherited one. See tools/plan_transcode.py.
#
# Separate from `python cli-main.py build`, which copies the store as it finds it.
# That command is still what assembles the module - this stages a transcoded store
# and hands it over, so there is one definition of what a module contains.
#
# Durations come out right without doing anything: build computes
# sound_length_table.lua from the mp3s it just copied, and mutagen reads the Xing
# header a VBR file carries. A table built from the masters and shipped beside VBR
# clips would drift, which is the failure this ordering avoids.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

STORE="${STORE:-audio}"
DIST="${DIST:-dist}"
MODULE="${MODULE:-VoiceOverReduxAudio}"
VERSION="${VERSION:-0.1}"
ENCODE="${ENCODE:-vbr-v6}"
ZIP="${ZIP:-1}"
# kbps above which a clip is worth transcoding. See tools/plan_transcode.py.
THRESHOLD="${THRESHOLD:-80}"

# Transcoded clips, kept between runs. A sibling of dist/ and of the store, for the
# reason web/src/lib/paths.ts gives about audio-history: anything living under
# audio/ would be walked as if it were a voiceline.
#
# CONTENT-ADDRESSED, so a cache hit cannot be stale: the entry is named for the
# md5 of the master it came from, and a regenerated line hashes differently and
# misses. Keying on mtime would be cheaper and wrong - `make pull` copies the
# droplet's timestamps, so a freshly pulled take can be older than the entry it
# ought to replace.
CACHE_ROOT="${CACHE_ROOT:-audio-transcoded}"

PYTHON="${PYTHON:-$([ -x .venv/bin/python ] && echo .venv/bin/python || command -v python3)}"
JOBS="${JOBS:-$( (command -v nproc >/dev/null 2>&1 && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"

case "$ENCODE" in
  vbr-v6|copy) ;;
  *) echo "error: unknown ENCODE '$ENCODE' (expected: vbr-v6, copy)" >&2; exit 1;;
esac

[ -d "$STORE" ] || { echo "error: no audio store at $STORE" >&2; exit 1; }
if [ "$ENCODE" != copy ] && ! command -v ffmpeg >/dev/null 2>&1; then
  echo "error: ffmpeg is not on PATH. brew install ffmpeg, or run with ENCODE=copy" >&2
  exit 1
fi

# --- the plan ---------------------------------------------------------------------------
#
# tools/plan_transcode.py decides what happens to each clip and why; see its header. Two
# thirds of the store is the inherited 64 kbps pack, which -q:a 6 cannot beat, so those are
# copied rather than put through a second lossy pass. Ignored lines are dropped there too,
# before the expensive stage sees them.
plan="$(mktemp)"
staging="$(mktemp -d)"
trap 'rm -f "$plan"; rm -rf "$staging"' EXIT

echo "planning..."
"$PYTHON" tools/plan_transcode.py --store "$STORE" --threshold "$THRESHOLD" > "$plan"
count="$(wc -l <"$plan" | tr -d ' ')"

# Directories first in one pass, so placing the clips below is a flat run of cp rather
# than thousands of mkdir processes.
rsync -a -f'+ */' -f'- *' "$STORE/" "$staging/"

if [ "$ENCODE" = copy ]; then
  echo "copying $count masters (ENCODE=copy)..."
  cut -f4 "$plan" | while IFS= read -r rel; do cp "$STORE/$rel" "$staging/$rel"; done
else
  cache="$CACHE_ROOT/$ENCODE"
  mkdir -p "$cache"

  # Deduplicated: two identical masters share a key, and two workers must not write one
  # cache entry between them.
  todo="$(mktemp)"
  awk -F'\t' '$3 == "encode" {print $1 "\t" $4}' "$plan" | sort -u -k1,1 \
    | while IFS=$'\t' read -r key rel; do
        [ -f "$cache/$key.mp3" ] || printf '%s\t%s\n' "$key" "$STORE/$rel"
      done > "$todo"

  wanted="$(awk -F'\t' '$3 == "encode"' "$plan" | wc -l | tr -d ' ')"
  encoded="$(wc -l <"$todo" | tr -d ' ')"
  hits=$((wanted - encoded))

  if [ "$encoded" -gt 0 ]; then
    # Minutes of ffmpeg with nothing on stdout is indistinguishable from a hang. The
    # count comes from a file rather than a variable: each worker is its own process, so
    # an incremented shell variable would die with it.
    progress="$(mktemp)"
    export CACHE="$cache" PROGRESS="$progress" TOTAL="$encoded"
    encode_one() {
      # Via .part and mv, so an interrupted run cannot leave a truncated file under a
      # name claiming to be a complete encode of that checksum. The pid is in there too,
      # so two copies of this script cannot land in each other's scratch file. -f mp3 is
      # required with it: ffmpeg picks the muxer from the extension, and ".part" is not
      # one it knows.
      local part="$CACHE/$2.$$.part"
      ffmpeg -nostdin -loglevel error -f mp3 -i "$1" \
        -codec:a libmp3lame -q:a 6 -ac 1 -f mp3 "$part"
      mv "$part" "$CACHE/$2.mp3"

      # One byte per finished file; short appends to O_APPEND do not interleave, so the
      # size is the count.
      printf '.' >>"$PROGRESS"
      local n; n="$(wc -c <"$PROGRESS" | tr -d ' ')"
      if [ -t 1 ]; then printf '\r  %5d/%-5d encoded' "$n" "$TOTAL"
      elif [ $((n % 250)) -eq 0 ] || [ "$n" -eq "$TOTAL" ]; then echo "  $n/$TOTAL encoded"; fi
    }
    export -f encode_one

    echo "encoding $encoded files ($ENCODE, mono) across $JOBS jobs (cache: $cache)"
    echo "  $hits of $wanted already cached"
    tr '\t\n' '\0\0' <"$todo" | xargs -0 -P "$JOBS" -n 2 bash -c 'encode_one "$1" "$0"'
    [ -t 1 ] && printf '\n'
    rm -f "$progress"
  else
    echo "all $wanted encodable files already cached ($ENCODE, $cache)"
  fi

  # Placement, and the one judgement left to make here: an encode that came out no smaller
  # than its master is a second lossy pass for nothing, so the master wins. plan_transcode
  # keeps that rare by reading bitrates, but bitrate is an average and some clips will
  # still land the wrong way round.
  kept=0
  while IFS=$'\t' read -r key kbps action rel; do
    if [ "$action" = encode ] \
       && [ "$(wc -c <"$cache/$key.mp3")" -lt "$(wc -c <"$STORE/$rel")" ]; then
      cp "$cache/$key.mp3" "$staging/$rel"
    else
      [ "$action" = encode ] && kept=$((kept + 1))
      cp "$STORE/$rel" "$staging/$rel"
    fi
  done <"$plan"

  # Entries for masters since re-cut or deleted. Without this the cache keeps every
  # superseded encode forever, which is what audio-history/ is for and this is not.
  pruned=0
  while IFS= read -r stale; do
    [ -n "$stale" ] || continue
    rm -f "$cache/$stale"
    pruned=$((pruned + 1))
  done < <(comm -23 \
    <(find "$cache" -name '*.mp3' -exec basename {} \; | sort) \
    <(awk -F'\t' '$3 == "encode" {print $1 ".mp3"}' "$plan" | sort -u) || true)

  echo "  $hits reused, $encoded encoded, $kept masters kept as smaller, $pruned superseded entries dropped"
  rm -f "$todo"
fi

# --- the module ------------------------------------------------------------------------
#
# --store, so this is the same build everyone runs, over a store whose clips happen to be
# smaller. The lookup tables, the TOC and the length table are all built by that command
# and are not this script's business.
"$PYTHON" cli-main.py build --store "$staging" --dist "$DIST" --module "$MODULE" \
  --version "$VERSION"

module_dir="$DIST/$MODULE"
echo "  module size: $(du -sh "$module_dir" | cut -f1)  (store: $(du -sh "$STORE" | cut -f1))"

if [ "$ZIP" = 1 ]; then
  # Absolute before the subshell cds into DIST, and derived from DIST itself so an
  # absolute DIST (a scratch directory in a test run) is not glued onto the repo root.
  zip_path="$(cd "$DIST" && pwd)/$MODULE-$VERSION.zip"
  rm -f "$zip_path"
  echo "zipping $(basename "$zip_path")..."
  (cd "$DIST" && zip -r -q -X "$zip_path" "$MODULE" -x '*.DS_Store' '*.part')
  echo "==> $zip_path ($(du -h "$zip_path" | cut -f1))"
fi
