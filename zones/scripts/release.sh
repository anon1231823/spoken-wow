#!/usr/bin/env bash
# Uploads built zips to CurseForge through the author API.
#
#   ./scripts/release.sh --dry-run        # say what would be sent, send nothing
#   ./scripts/release.sh                  # all three projects
#   ./scripts/release.sh zonelore         # just the addon
#   ./scripts/release.sh audio audio64    # just the sound packs
#
# Needs CURSEFORGE_TOKEN in the environment or in .env. Generate one at
# https://authors-old.curseforge.com/account/api-tokens -- it is an author token
# tied to your account, not to a project, so the same one covers all three.
#
# This uploads files. It does not create projects, edit descriptions, or set
# relations: those are one-time settings that live in the web UI, and a script
# that rewrites them on every release is a script that can quietly undo an edit
# made there.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$REPO/dist"

# Site-relative API, per game. WoW projects are not reachable through another
# game's subdomain even with a valid token.
API="https://wow.curseforge.com/api"

# The clients a zip can target. Matched by name against /api/game/versions rather
# than hardcoding the numeric IDs, because those IDs are not documented anywhere
# and would be mystery constants the first time they need changing.
#
# ANNIVERSARY is the 2.5.6 client the Anniversary realms run. Its name on
# CurseForge is whatever /api/game/versions calls it -- if the default below is
# not it, the exactly-one-match check further down fails loudly before anything is
# uploaded, which is the failure mode to want.
GAME_VERSION_ERA="${GAME_VERSION_ERA:-1.15.9}"
GAME_VERSION_ANNIVERSARY="${GAME_VERSION_ANNIVERSARY:-2.5.6}"

# CurseForge's own channel, which is not the same thing as the beta disclaimer in
# the descriptions. Marking these "beta" would keep most addon managers from
# offering them to players on the default channel -- the audience this is for.
RELEASE_TYPE="${RELEASE_TYPE:-release}"

# project key -> CurseForge project ID, addon folder the version is read from,
# and the zip basename package*.sh produces.
target_project() { case "$1" in
  zonelore) echo "1636521";;
  audio)    echo "1636532";;
  audio64)  echo "1636548";;
esac; }
target_addon() { case "$1" in
  zonelore) echo "ZoneLore";;
  audio)    echo "ZoneLoreAudio";;
  audio64)  echo "ZoneLoreAudio";;   # both packs are versioned from the one tree
esac; }
target_zip() { case "$1" in
  zonelore) echo "ZoneLore";;
  audio)    echo "ZoneLoreAudio";;
  audio64)  echo "ZoneLoreAudio64";;
esac; }
# Which clients each file is offered to. Every zip built from 0.3.1 onwards carries
# a .toc for both clients, so all three are filed against both. Files uploaded
# before that are Era-only and stay filed as they were -- a file offered to a
# client it cannot load on is worse than one that is simply absent there.
target_game_versions() { case "$1" in
  zonelore) echo "$GAME_VERSION_ERA $GAME_VERSION_ANNIVERSARY";;
  audio)    echo "$GAME_VERSION_ERA $GAME_VERSION_ANNIVERSARY";;
  audio64)  echo "$GAME_VERSION_ERA $GAME_VERSION_ANNIVERSARY";;
esac; }

dry_run=""
targets=()
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) dry_run=1;;
    zonelore|audio|audio64) targets+=("$arg");;
    *) echo "error: unknown argument '$arg' (expected: zonelore, audio, audio64, --dry-run)" >&2; exit 1;;
  esac
done
if (( ${#targets[@]} == 0 )); then
  targets=("zonelore" "audio" "audio64")
fi

command -v curl >/dev/null || { echo "error: curl is required" >&2; exit 1; }
command -v node >/dev/null || { echo "error: node is required (for JSON handling)" >&2; exit 1; }

# .env is the same file tools/voice reads its ElevenLabs key from, so the token
# has one obvious home rather than living only in a shell history.
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

#-- the game versions ---------------------------------------------------------
# The list is fetched once; each name is resolved against it separately, and a
# name matching anything other than exactly one version is fatal. An unknown name
# here is the failure that otherwise produces a file uploaded against the wrong
# client, which players discover as "the addon does not appear in my AddOns list".
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
for name in $GAME_VERSION_ERA $GAME_VERSION_ANNIVERSARY; do
  echo "  $name -> id $(resolve_game_version "$name")"
done

#-- the changelog -------------------------------------------------------------
# The section of CHANGELOG.md for the version being uploaded, so the release
# notes on the site and the notes in the repository cannot drift apart. Extracted
# per version rather than sending the whole file: a player opening the Files tab
# wants to know what changed in this one.
changelog_for() {
  node -e '
    const { readFileSync } = require("fs");
    const [path, version] = process.argv.slice(1);
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");
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

#-- upload --------------------------------------------------------------------
for target in "${targets[@]}"; do
  project="$(target_project "$target")"
  addon="$(target_addon "$target")"
  zip_name="$(target_zip "$target")"

  toc="$REPO/addon/$addon/$addon.toc"
  version="$(sed -n 's/^## Version:[[:space:]]*//p' "$toc" | head -1 | tr -d '\r')"
  zip_path="$DIST/$zip_name-$version.zip"

  echo
  echo "=== $target -> project $project ==="

  if [[ ! -f "$zip_path" ]]; then
    echo "error: $zip_path does not exist -- run make package / make package-audio first" >&2
    exit 1
  fi

  changelog="$(changelog_for "$version")"
  size="$(du -h "$zip_path" | cut -f1)"

  game_version_names="$(target_game_versions "$target")"
  game_version_ids=""
  for name in $game_version_names; do
    game_version_ids="$game_version_ids $(resolve_game_version "$name")"
  done

  # One file can carry versions from more than one client. If CurseForge ever
  # rejects the pair (Era and Anniversary are different game-version *types*),
  # the fix is to upload the same zip once per id rather than to drop one of them.
  #
  # Built with node rather than a heredoc: the changelog is markdown containing
  # quotes, backticks and newlines, and hand-escaping it into JSON is how a
  # release ends up with a mangled changelog nobody notices for a month.
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

  echo "  file:     $zip_path ($size)"
  echo "  version:  $version   release type: $RELEASE_TYPE   game versions: $game_version_names"
  echo "  changelog: $(echo "$changelog" | head -1) ..."

  if [[ -n "$dry_run" ]]; then
    echo "  dry run -- not uploading"
    continue
  fi

  # --progress-bar because the packs are hundreds of megabytes and a silent curl
  # for six minutes is indistinguishable from a hang.
  #
  # Deliberately not -f: on a rejection the API explains itself in the response
  # body, and -f discards exactly that, leaving "curl: (56) error 400" as the only
  # evidence of a release that will not go out. The status code is appended on its
  # own line instead, and split back off below.
  #
  # --form-string for the metadata, never -F: -F reads `;` in a value as the start
  # of a `;type=` parameter and silently truncates there, so a changelog with a
  # semicolon in it arrives as invalid JSON and the API rejects the whole release.
  # The file part stays -F, which is what makes @ mean "read this file".
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
  echo "  https://www.curseforge.com/wow/addons/$zip_name/files/$file_id"
done

#-- descriptions --------------------------------------------------------------
# There is no API for these. Uploading a file cannot update the page around it,
# so the most this can do is notice that the text in the repository has moved on
# from what was last pasted, and say so at the moment somebody is already looking
# at the project pages.
echo
stale="$(node "$REPO/tools/descriptions.mjs" --drift)"
if [[ -n "$stale" ]]; then
  echo "descriptions that differ from what was last pasted into the site:"
  echo "$stale" | while IFS=$'\t' read -r slug why; do
    echo "  $slug -- $why  ($DIST/descriptions/$slug.md)"
  done
  echo "  paste them, then: make descriptions-published"
else
  echo "descriptions match what was last pasted."
fi

echo
echo "done. Uploads sit in moderation before they appear publicly."
