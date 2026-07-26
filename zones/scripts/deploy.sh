#!/usr/bin/env bash
# Makes addon/ZoneLore visible to the WoW Classic Era client.
#
#   ./scripts/deploy.sh          # symlink (edits are live, just /reload in-game)
#   ./scripts/deploy.sh --copy   # rsync a real copy instead
#   ./scripts/deploy.sh --status  # show what is currently installed
#   ./scripts/deploy.sh --remove  # uninstall
#
# Symlinking is preferred: no re-run needed after each edit. If the client's
# AddOns list does not show ZoneLore, fall back to --copy and re-run per change.
#
# SavedVariables live under WTF/, not in the addon folder, so neither mode can
# destroy saved settings.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/addon/ZoneLore"
ADDONS="/Applications/World of Warcraft/_classic_era_/Interface/AddOns"
DEST="$ADDONS/ZoneLore"

mode="${1:-}"

if [[ ! -d "$SRC" ]]; then
  echo "error: $SRC does not exist" >&2
  exit 1
fi

if [[ ! -d "$ADDONS" ]]; then
  echo "error: Classic Era AddOns directory not found at:" >&2
  echo "       $ADDONS" >&2
  echo "       Is World of Warcraft installed to the default location?" >&2
  exit 1
fi

case "$mode" in
  --status)
    if [[ -L "$DEST" ]]; then
      echo "symlinked -> $(readlink "$DEST")"
    elif [[ -d "$DEST" ]]; then
      echo "installed as a real directory (copy mode)"
      echo "files: $(find "$DEST" -type f | wc -l | tr -d ' ')"
    else
      echo "not installed"
    fi
    exit 0
    ;;
  --remove)
    if [[ -L "$DEST" ]]; then
      rm "$DEST"
      echo "removed symlink $DEST"
    elif [[ -d "$DEST" ]]; then
      rm -rf "$DEST"
      echo "removed directory $DEST"
    else
      echo "nothing to remove"
    fi
    exit 0
    ;;
esac

# Refuse to clobber a real directory that this script did not create, in case
# an unrelated ZoneLore addon was installed from elsewhere.
if [[ -d "$DEST" && ! -L "$DEST" && "$mode" != "--copy" ]]; then
  echo "error: $DEST exists as a real directory." >&2
  echo "       Re-run with --copy to overwrite it, or --remove first." >&2
  exit 1
fi

if [[ "$mode" == "--copy" ]]; then
  [[ -L "$DEST" ]] && rm "$DEST"
  mkdir -p "$DEST"
  rsync -a --delete "$SRC/" "$DEST/"
  echo "copied $SRC -> $DEST"
  echo "re-run this script after every edit."
else
  [[ -L "$DEST" ]] && rm "$DEST"
  ln -s "$SRC" "$DEST"
  echo "symlinked $DEST -> $SRC"
  echo "edits are live; just /reload in-game."
fi

echo
echo "next steps in-game:"
echo "  1. enable ZoneLore in the AddOns list at the character select screen"
echo "  2. /console scriptErrors 1     (surface Lua errors)"
echo "  3. /zl                         (status for the current zone)"
echo "  4. /zl verify                  (check data against this client)"
