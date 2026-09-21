#!/usr/bin/env bash
# ONE-OFF, RUN ONCE ON THE DROPLET BY run.sh. Kept for the record; see ../README.md.
#
#   bash adopt-store.sh /srv/spoken/shared < live-takes.tsv > adopted.tsv
#
# Gives every live take that only a store holds a file in the archive, so the archive holds
# every take and the stores can be left behind.
#
# Input, one per line: <source> <tab> <file> <tab> <version>, for live takes with no
# archiveFile. Output: the same three and the name each was archived under. A take whose
# store file is not there is reported on stderr and left out: nothing can be archived for it,
# and its row goes on saying its clip was not kept.
#
# A HARD LINK, NOT A COPY. The store file and its archived name become one file on the one
# volume -- no space, no time -- and nothing writes a store any more, so nothing can change
# it through the other name. The store keeps its name, so a rollback to a release from
# before still finds its audio. The archived name is the one the site gives a take it cuts,
# v{version}-{first 8 hex of sha256}.mp3.
set -euo pipefail

shared=${1:?usage: adopt-store.sh <shared dir>}

while IFS=$'\t' read -r source file version; do
  [ -n "$source" ] || continue
  stem=${file%.mp3}
  case "$source" in
    quests) store=$shared/audio/$file ;;
    zones) store=$shared/sounds/$file.mp3 ;;
    books) store=$shared/books/$file.mp3 ;;
    *) echo "unknown source $source" >&2; exit 1 ;;
  esac
  if [ ! -f "$store" ]; then
    echo "missing	$source	$file	$version	$store" >&2
    continue
  fi
  sha=$(sha256sum "$store" | cut -c1-8)
  name=v$version-$sha.mp3
  dir=$shared/audio-history/$source/$stem
  mkdir -p "$dir"
  [ -e "$dir/$name" ] || ln "$store" "$dir/$name" 2>/dev/null || cp -p "$store" "$dir/$name"
  printf '%s\t%s\t%s\t%s\n' "$source" "$file" "$version" "$name"
done
