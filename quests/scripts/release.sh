#!/usr/bin/env bash
# Uploads built zips to CurseForge through the author API.
#
#   ./scripts/release.sh --dry-run    # say what would be sent, send nothing
#   ./scripts/release.sh              # both projects
#   ./scripts/release.sh player       # just the player addon
#   ./scripts/release.sh audio        # just the sound pack
#
# Needs CURSEFORGE_TOKEN in the environment or in .env. Generate one at
# https://authors-old.curseforge.com/account/api-tokens -- it is an author token tied to your
# account rather than to a project, so one token covers both.
#
# This uploads files. It does not create projects, edit descriptions or set relations: those
# are one-time settings that live in the web UI, and a script that rewrote them on every
# release would be a script that could quietly undo an edit made there.
#
# Modelled on ../wow-lore/scripts/release.sh, which does the same job for three projects.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${DIST:-$REPO/dist}"

# Site-relative API, per game. WoW projects are not reachable through another game's
# subdomain even with a valid token.
API="https://wow.curseforge.com/api"

# The clients a file is offered to. Matched by name against /api/game/versions rather than
# hardcoded as numeric ids, because those ids are undocumented and would be mystery constants
# the first time they needed changing.
#
# Era and the 2.5.6 Anniversary client only. The zip carries _Wrath and _Mainline TOCs as
# well, but nothing here has been run on those clients, and a file offered to a client it
# misbehaves on is worse than one that is simply absent there.
GAME_VERSION_ERA="${GAME_VERSION_ERA:-1.15.9}"
GAME_VERSION_ANNIVERSARY="${GAME_VERSION_ANNIVERSARY:-2.5.6}"

# CurseForge's own channel. Marking these "beta" would keep most addon managers from offering
# them to players on the default channel.
RELEASE_TYPE="${RELEASE_TYPE:-release}"

# target -> CurseForge project id. A target with no id here fails below rather than POSTing to
# /projects//upload-file, which would fail somewhere less legible or land on whatever project
# the API resolved.
#
# The HQ pack (make package-audio-hq) is deliberately absent: it has no project of its own,
# and uploading it to the audio project would put two files of different quality under one
# name with nothing on the Files tab to tell a player which is which.
target_project() { case "$1" in
  player) echo "1655859";;
  audio)  echo "1655867";;
esac; }

# Where each target's version comes from, which is not the same question for the two.
#
# The player is a directory of committed files with a .toc in it, so its version is read
# there and package.sh names the zip from the same line.
#
# The pack has no committed .toc at all: build generates one, and package-audio.sh passes the
# version in. So the version of the pack is whatever was last built, read back out of the
# built module - which also means releasing a pack nobody built fails here rather than
# uploading a stale zip that happens to still be in dist/.
target_version() { case "$1" in
  player) sed -n 's/^## Version:[[:space:]]*//p' "$REPO/VoiceOverRedux/VoiceOverRedux.toc" \
            | head -1 | tr -d '\r';;
  audio)  sed -n 's/^## Version:[[:space:]]*//p' \
            "$DIST/VoiceOverReduxAudio/VoiceOverReduxAudio.toc" 2>/dev/null \
            | head -1 | tr -d '\r';;
esac; }

target_zip_name() { case "$1" in
  player) echo "VoiceOverRedux";;
  audio)  echo "VoiceOverReduxAudio";;
esac; }

dry_run=""
targets=()
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) dry_run=1;;
    player|audio) targets+=("$arg");;
    *) echo "error: unknown argument '$arg' (expected: player, audio, --dry-run)" >&2; exit 1;;
  esac
done
if (( ${#targets[@]} == 0 )); then
  targets=("player" "audio")
fi

command -v curl >/dev/null || { echo "error: curl is required" >&2; exit 1; }
command -v node >/dev/null || { echo "error: node is required (for JSON handling)" >&2; exit 1; }

# .env is the same file the pipeline reads its ElevenLabs key from, so the token has one
# obvious home rather than living only in a shell history.
if [[ -z "${CURSEFORGE_TOKEN:-}" && -f "$REPO/.env" ]]; then
  CURSEFORGE_TOKEN="$(sed -n 's/^CURSEFORGE_TOKEN=//p' "$REPO/.env" | head -1 | tr -d '\r"')"
fi
if [[ -z "${CURSEFORGE_TOKEN:-}" ]]; then
  echo "error: CURSEFORGE_TOKEN is not set" >&2
  echo "       Generate one at https://authors-old.curseforge.com/account/api-tokens" >&2
  echo "       then put CURSEFORGE_TOKEN=... in .env, or export it." >&2
  exit 1
fi

api_get() {
  curl -fsSL -H "X-Api-Token: $CURSEFORGE_TOKEN" "$API/$1"
}

#-- the game versions ---------------------------------------------------------------------
# Fetched once, then each name resolved against it. A name matching anything other than
# exactly one version is fatal: an unresolved name is what otherwise produces a file filed
# against the wrong client, which players meet as "the addon does not show up in my list".
versions_json="$(api_get "game/versions")" || {
  echo "error: could not list game versions -- is the token valid?" >&2
  exit 1
}

resolve_game_version() {
  node -e '
    const wanted = process.argv[1];
    const versions = JSON.parse(process.argv[2]);
    const hits = versions.filter((v) => v.name === wanted);
    if (hits.length !== 1) {
      console.error(`expected exactly one game version named ${wanted}, found ${hits.length}`);
      if (hits.length > 1) console.error(JSON.stringify(hits));
      process.exit(1);
    }
    process.stdout.write(String(hits[0].id));
  ' "$1" "$versions_json"
}

echo "resolving game versions..."
game_version_ids=""
for name in $GAME_VERSION_ERA $GAME_VERSION_ANNIVERSARY; do
  id="$(resolve_game_version "$name")"
  echo "  $name -> id $id"
  game_version_ids="$game_version_ids $id"
done

#-- the changelog -------------------------------------------------------------------------
# The section of CHANGELOG.md for the version being uploaded, so the notes on the site and
# the notes in the repository cannot drift apart. Per version rather than the whole file: a
# player opening the Files tab wants to know what changed in this one.
#
# The two projects are versioned independently - the pack moves when the audio is rebuilt,
# the player when its Lua changes - so a section is looked up by version string alone and
# each target finds its own.
changelog_for() {
  node -e '
    const { readFileSync } = require("fs");
    const [path, version] = process.argv.slice(1);
    const lines = readFileSync(path, "utf8").split("\n");
    const start = lines.findIndex((l) => l.startsWith(`## ${version}`));
    if (start === -1) {
      console.error(`no "## ${version}" section in CHANGELOG.md`);
      process.exit(1);
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) { end = i; break; }
    }
    process.stdout.write(lines.slice(start, end).join("\n").trim());
  ' "$REPO/CHANGELOG.md" "$1"
}

#-- upload --------------------------------------------------------------------------------
for target in "${targets[@]}"; do
  project="$(target_project "$target")"
  zip_name="$(target_zip_name "$target")"
  version="$(target_version "$target")"

  if [[ -z "$project" ]]; then
    echo "error: no CurseForge project id for '$target' -- add it to target_project()" >&2
    exit 1
  fi
  if [[ -z "$version" ]]; then
    echo "error: no version for '$target'." >&2
    [[ "$target" = audio ]] && \
      echo "       The pack's version comes from the built module; run make package-audio." >&2
    exit 1
  fi

  zip_path="$DIST/$zip_name-$version.zip"

  echo
  echo "=== $target -> project $project ==="

  if [[ ! -f "$zip_path" ]]; then
    echo "error: $zip_path does not exist -- run make package / make package-audio first" >&2
    exit 1
  fi

  changelog="$(changelog_for "$version")"
  size="$(du -h "$zip_path" | cut -f1)"

  # Built with node rather than a heredoc: the changelog is markdown holding quotes,
  # backticks and newlines, and hand-escaping that into JSON is how a release ends up with a
  # mangled changelog nobody notices for a month.
  metadata="$(node -e '
    const [changelog, releaseType, gameVersionIds, displayName] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      changelog,
      changelogType: "markdown",
      displayName,
      gameVersions: gameVersionIds.trim().split(/\s+/).map(Number),
      releaseType,
    }));
  ' "$changelog" "$RELEASE_TYPE" "$game_version_ids" "$zip_name $version")"

  echo "  file:      $zip_path ($size)"
  echo "  version:   $version   release type: $RELEASE_TYPE"
  echo "  clients:   $GAME_VERSION_ERA $GAME_VERSION_ANNIVERSARY"
  echo "  changelog: $(echo "$changelog" | head -1) ($(echo "$changelog" | wc -l | tr -d ' ') lines)"

  if [[ -n "$dry_run" ]]; then
    echo "  dry run -- not uploading"
    continue
  fi

  # --progress-bar because the pack is hundreds of megabytes and a silent curl for several
  # minutes is indistinguishable from a hang.
  #
  # Deliberately not -f: on a rejection the API explains itself in the response body, and -f
  # discards exactly that, leaving "curl: (22)" as the only evidence of a release that will
  # not go out. The status code is appended on its own line instead and split back off below.
  #
  # --form-string for the metadata, never -F: -F reads `;` in a value as the start of a
  # `;type=` parameter and truncates there, so a changelog with a semicolon in it arrives as
  # invalid JSON. The file part stays -F, which is what makes @ mean "read this file".
  response="$(curl -sS --progress-bar -w '\n%{http_code}' \
    -H "X-Api-Token: $CURSEFORGE_TOKEN" \
    --form-string "metadata=$metadata" \
    -F "file=@$zip_path" \
    "$API/projects/$project/upload-file")" || {
      echo "error: could not reach CurseForge for $target" >&2
      exit 1
    }

  status="${response##*$'\n'}"
  response="${response%$'\n'*}"

  if [[ "$status" != 2* ]]; then
    echo "error: upload failed for $target -- HTTP $status" >&2
    echo "$response" >&2
    exit 1
  fi

  file_id="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).id ?? "?"))' "$response")"
  echo "  uploaded -- file id $file_id"
done

echo
echo "done. Uploads sit in moderation before they appear publicly."
