#!/usr/bin/env bash
# Makes addon/ZoneLore and addon/ZoneLoreAudio visible to the WoW Classic Era client.
#
#   ./scripts/deploy.sh          # symlink (edits are live, just /reload in-game)
#   ./scripts/deploy.sh --copy   # rsync a real copy instead
#   ./scripts/deploy.sh --status  # show what is currently installed
#   ./scripts/deploy.sh --remove  # uninstall
#
# Symlinking is preferred: no re-run needed after each edit. If the client's
# AddOns list does not show ZoneLore, fall back to --copy and re-run per change.
#
# Both addons are handled together. ZoneLoreAudio is optional to the player but
# not to development: symlinking it means a generation run lands in the client
# without a redeploy, exactly as an edit to a .lua does.
#
# SavedVariables live under WTF/, not in the addon folder, so neither mode can
# destroy saved settings.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADDONS="/Applications/World of Warcraft/_classic_era_/Interface/AddOns"
NAMES=(ZoneLore ZoneLoreAudio)

mode="${1:-}"

if [[ ! -d "$ADDONS" ]]; then
  echo "error: Classic Era AddOns directory not found at:" >&2
  echo "       $ADDONS" >&2
  echo "       Is World of Warcraft installed to the default location?" >&2
  exit 1
fi

case "$mode" in
  --status)
    for name in "${NAMES[@]}"; do
      dest="$ADDONS/$name"
      if [[ -L "$dest" ]]; then
        printf '%-14s symlinked -> %s\n' "$name" "$(readlink "$dest")"
      elif [[ -d "$dest" ]]; then
        printf '%-14s copy, %s files\n' "$name" "$(find "$dest" -type f | wc -l | tr -d ' ')"
      else
        printf '%-14s not installed\n' "$name"
      fi
    done

    # The count is the quickest answer to "why is it still playing the
    # placeholder", which is otherwise indistinguishable from a broken lookup.
    sounds="$REPO/addon/ZoneLoreAudio/Sounds"
    if [[ -d "$sounds" ]]; then
      count="$(find "$sounds" -name '*.mp3' | wc -l | tr -d ' ')"
      echo "voicelines      $count mp3 in $sounds"
    fi
    exit 0
    ;;
  --remove)
    for name in "${NAMES[@]}"; do
      dest="$ADDONS/$name"
      if [[ -L "$dest" ]]; then
        rm "$dest"
        echo "removed symlink $dest"
      elif [[ -d "$dest" ]]; then
        rm -rf "$dest"
        echo "removed directory $dest"
      else
        echo "$name: nothing to remove"
      fi
    done
    exit 0
    ;;
esac

for name in "${NAMES[@]}"; do
  src="$REPO/addon/$name"
  dest="$ADDONS/$name"

  if [[ ! -d "$src" ]]; then
    echo "error: $src does not exist" >&2
    exit 1
  fi

  # Refuse to clobber a real directory that this script did not create, in case
  # an unrelated copy was installed from elsewhere.
  if [[ -d "$dest" && ! -L "$dest" && "$mode" != "--copy" ]]; then
    echo "error: $dest exists as a real directory." >&2
    echo "       Re-run with --copy to overwrite it, or --remove first." >&2
    exit 1
  fi

  if [[ "$mode" == "--copy" ]]; then
    [[ -L "$dest" ]] && rm "$dest"
    mkdir -p "$dest"
    rsync -a --delete "$src/" "$dest/"
    echo "copied $src -> $dest"
  else
    [[ -L "$dest" ]] && rm "$dest"
    ln -s "$src" "$dest"
    echo "symlinked $dest -> $src"
  fi
done

if [[ "$mode" == "--copy" ]]; then
  echo "re-run this script after every edit."
else
  echo "edits are live; just /reload in-game."
fi

echo
echo "next steps in-game:"
echo "  1. enable ZoneLore in the AddOns list at the character select screen"
echo "  2. /console scriptErrors 1     (surface Lua errors)"
echo "  3. /zl                         (status for the current zone)"
echo "  4. /zl verify                  (check data against this client)"
