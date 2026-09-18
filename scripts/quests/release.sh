#!/usr/bin/env bash
# Uploads built zips to CurseForge through the author API.
#
#   ./scripts/release.sh --dry-run    # say what would be sent, send nothing
#   ./scripts/release.sh              # every project
#   ./scripts/release.sh player       # just the player addon
#   ./scripts/release.sh audio-horde  # just one sound pack
#
# The sound pack ships in five pieces (see tts_cli/factions.py). Each is a CurseForge project of
# its own rather than another file on one project, because an addon manager installs the newest
# file for a project - so two packs under one project would silently move a player from the one
# they chose to whichever was uploaded last, which would mean the wrong faction.
#
# The audio shipped at two qualities for a while, five projects each. That is over: there is one
# pack format now, and the audio-* targets below are the projects that carry it. The five
# projects the other set used stay published so existing installs keep working, and are never
# uploaded to again - which is why no target names them.
#
# Needs CURSEFORGE_TOKEN in the environment or in .env. Generate one at
# https://authors-old.curseforge.com/account/api-tokens -- it is an author token tied to your
# account rather than to a project, so one token covers both.
#
# This uploads files, and declares each file's required dependencies along with it - relations
# are part of the upload metadata rather than a project setting, so the meta addon's
# dependencies travel with the file that needs them.
#
# It does not create projects or edit descriptions. There is no API for either, and a script
# that rewrote project pages every release would be one that could quietly undo an edit made
# in the web UI. curseforge/ holds the descriptions to paste.
#
# Modelled on ../wow-lore/scripts/release.sh, which does the same job for three projects.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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
#
# The 1.12, 2.4.3 and 3.3.5 zips package.sh also builds are deliberately not uploaded here:
# CurseForge has no game version to file them against. They go out on the GitHub release that
# .github/workflows/release-player.yaml publishes from a tag.
GAME_VERSION_ERA="${GAME_VERSION_ERA:-1.15.9}"
GAME_VERSION_ANNIVERSARY="${GAME_VERSION_ANNIVERSARY:-2.5.6}"

# CurseForge's own channel. Marking these "beta" would keep most addon managers from offering
# them to players on the default channel.
RELEASE_TYPE="${RELEASE_TYPE:-release}"

# target -> CurseForge project id. A target with no id here fails below rather than POSTing to
# /projects//upload-file, which would fail somewhere less legible or land on whatever project
# the API resolved.
#
# The complete pack (make package-audio-complete) is deliberately absent: the whole corpus in one
# folder is twice the upload ceiling, so the site hosts it instead - see deploy/README.md. The
# audio-all target here is the meta addon, not that pack.
#
# A pack whose project does not exist yet has no id, and the run fails on it rather than
# uploading a Horde pack over the Alliance project. Create the project on CurseForge, then
# write its id in here.
# `spoken` is the player. Its project had to exist AND be approved before any other target
# could name it as a dependency (errorCode 1018 otherwise); it was created first for that
# reason. SPOKEN_PROJECT_ID still overrides, for a test project.
#
# THE RETIRED PROJECTS ARE DELIBERATELY ABSENT. 1655867, 1658236, 1658237, 1658239 and 1658235
# carried the second pack format; an id left here is an id something eventually uploads to.
target_project() { case "$1" in
  spoken)         echo "${SPOKEN_PROJECT_ID:-1700375}";;
  player)         echo "1655859";;
  audio-all)      echo "1660196";;
  audio-alliance) echo "1660197";;
  audio-horde)    echo "1660198";;
  audio-shared)   echo "1660199";;
  audio-gossip)   echo "1660202";;
esac; }

# The addon folder each target ships, which is also the basename package*.sh gives its zip.
#
# audio-all is a meta addon (scripts/package-meta.sh) rather than a one-folder pack: the whole
# corpus in one zip comes back 413, so that project ships a few kilobytes declaring the other
# four packs as required dependencies, and the manager fetches them.
#
# The folder names still say VoiceOverReduxHQAudio, and stay that way. They are the paths every
# player who installed one of these packs already has on disk, and DataModules matches an
# installed pack by exactly this name - so a rename is both a re-download of 300 MB per pack and
# a player being offered a pack they already have. The name is historical in both halves and
# that costs nothing: nobody reads a folder name, and every title and page says Spoken Quests.
target_zip_name() { case "$1" in
  spoken)         echo "SpokenPlayer";;
  player)         echo "SpokenQuests";;
  audio-all)      echo "VoiceOverReduxHQAudio";;
  audio-alliance) echo "VoiceOverReduxHQAudioAlliance";;
  audio-horde)    echo "VoiceOverReduxHQAudioHorde";;
  audio-shared)   echo "VoiceOverReduxHQAudioShared";;
  audio-gossip)   echo "VoiceOverReduxHQAudioGossip";;
esac; }

# Where a version comes from, which is not the same question for the player and a pack.
#
# The player is a directory of committed files with a .toc in it, so its version is read there
# and package.sh names the zip from the same line.
#
# A pack has no committed .toc at all: build generates one and package-audio.sh passes the
# version in. So a pack's version is whatever was last built, read back out of the built
# module - which also means releasing a pack nobody built fails here rather than uploading a
# stale zip that happens to still be in dist/.
target_toc() { case "$1" in
  player) echo "$REPO/addons/SpokenQuests/SpokenQuests.toc";;
  spoken) echo "$REPO/addons/SpokenPlayer/SpokenPlayer.toc";;
  *)      local name; name="$(target_zip_name "$1")"; echo "$DIST/$name/$name.toc";;
esac; }
target_version() {
  sed -n 's/^## Version:[[:space:]]*//p' "$(target_toc "$1")" 2>/dev/null | head -1 | tr -d '\r'
}

# Required dependencies, declared per uploaded file. Only the meta addon has any: it holds no
# audio, and the four packs it names are the whole point of installing it. Both the CurseForge
# app and WowUp fetch required dependencies, so "install All" still means "get everything".
#
# By slug, which is why the slugs are read off the live projects rather than guessed - see
# curseforge/README.md. A slug that no longer resolves is a dependency silently not installed.
target_dependencies() { case "$1" in
  player)    echo "spoken-player";;
  audio-all) echo "spoken-quests-audio-alliance spoken-quests-audio-horde \
                   spoken-quests-audio-shared spoken-quests-audio-gossip";;
esac; }

# THE META ADDON GOES LAST. It names the four packs as dependencies, and CurseForge resolves
# those at upload time, so anything about them that has to be true - the project existing and
# being approved, above all - is truest after they have just been uploaded. It costs nothing to
# order it this way and it removes a class of first-release surprise.
ALL_TARGETS="spoken player audio-alliance audio-horde audio-shared audio-gossip audio-all"

dry_run=""
targets=()
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) dry_run=1;;
    spoken|player|audio-all|audio-alliance|audio-horde|audio-shared|audio-gossip) targets+=("$arg");;
    *) echo "error: unknown argument '$arg' (expected: $ALL_TARGETS, --dry-run)" >&2; exit 1;;
  esac
done
if (( ${#targets[@]} == 0 )); then
  read -r -a targets <<<"$ALL_TARGETS"
fi

command -v curl >/dev/null || { echo "error: curl is required" >&2; exit 1; }
command -v node >/dev/null || { echo "error: node is required (for JSON handling)" >&2; exit 1; }

# .env is the same file the pipeline reads its ElevenLabs key from, so the token has one
# obvious home rather than living only in a shell history.
if [[ -z "${CURSEFORGE_TOKEN:-}" && -f "$REPO/pipelines/quests/.env" ]]; then
  CURSEFORGE_TOKEN="$(sed -n 's/^CURSEFORGE_TOKEN=//p' "$REPO/pipelines/quests/.env" | head -1 | tr -d '\r"')"
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
# The player and the packs are versioned independently - the packs move when the audio is
# rebuilt, the player when its Lua changes - so each target looks up its own section.
#
# A heading is `## <version> — player` or `## <version> — sound pack(s)`, and the kind is half
# the key: the player and the packs number themselves independently and have already collided
# once on 1.1.0. Matching on the version alone would have sent the player's notes out with a
# sound pack.
changelog_for() {
  local file="$REPO/docs/quests/CHANGELOG.md"
  [ "$2" = spoken ] && file="$REPO/docs/spoken/CHANGELOG.md"
  node -e '
    const { readFileSync } = require("fs");
    const [path, version, kind] = process.argv.slice(1);
    const lines = readFileSync(path, "utf8").split("\n");
    const matches = (l) => l.startsWith(`## ${version}`) &&
      (kind === "spoken" ? true : kind === "player" ? /player/i.test(l) : /pack/i.test(l));
    const start = lines.findIndex(matches);
    if (start === -1) {
      console.error(`no "## ${version} ... ${kind}" section in CHANGELOG.md`);
      process.exit(1);
    }
    if (lines.findIndex((l, i) => i > start && matches(l)) !== -1) {
      console.error(`two "## ${version} ... ${kind}" sections in CHANGELOG.md`);
      process.exit(1);
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) { end = i; break; }
    }
    process.stdout.write(lines.slice(start, end).join("\n").trim());
  ' "$file" "$1" "$2"
}

#-- upload --------------------------------------------------------------------------------
#
# ONE TARGET'S FAILURE DOES NOT STOP THE REST. There are seven of them now and they fail
# independently: the complete pack is over CurseForge's upload ceiling while the four split
# packs are well under it, so exiting on the first error meant one 413 held back five uploads
# that would have gone through. Failures are collected and reported at the end, and the script
# still exits non-zero, so a release that half-worked cannot be mistaken for one that worked.
#
# The errors before the token check stay fatal: no token and no game versions are conditions
# under which no target could succeed.
failed=()
uploaded=()

upload_target() {
  local target="$1"
  local project zip_name version zip_path kind changelog size metadata response status file_id
  local dependencies

  project="$(target_project "$target")"
  zip_name="$(target_zip_name "$target")"
  version="$(target_version "$target")"

  echo
  echo "=== $target -> project ${project:-<none>} ==="

  if [[ -z "$project" ]]; then
    echo "error: no CurseForge project id for '$target' -- create the project and write its" >&2
    echo "       id into target_project() in this script." >&2
    return 1
  fi
  if [[ -z "$version" ]]; then
    echo "error: no version for '$target'." >&2
    [[ "$target" != player ]] && \
      echo "       A pack's version comes from the built module; run make package-audio." >&2
    return 1
  fi

  zip_path="$DIST/$zip_name-$version.zip"

  if [[ ! -f "$zip_path" ]]; then
    echo "error: $zip_path does not exist -- run make package / make package-audio first" >&2
    return 1
  fi

  case "$target" in player|spoken) kind=$target;; *) kind=pack;; esac
  changelog="$(changelog_for "$version" "$kind")" || return 1
  size="$(du -h "$zip_path" | cut -f1)"

  # Built with node rather than a heredoc: the changelog is markdown holding quotes,
  # backticks and newlines, and hand-escaping that into JSON is how a release ends up with a
  # mangled changelog nobody notices for a month.
  dependencies="$(target_dependencies "$target")"
  metadata="$(node -e '
    const [changelog, releaseType, gameVersionIds, displayName, dependencies] =
      process.argv.slice(1);
    const slugs = dependencies.trim().split(/\s+/).filter(Boolean);
    process.stdout.write(JSON.stringify({
      changelog,
      changelogType: "markdown",
      displayName,
      gameVersions: gameVersionIds.trim().split(/\s+/).map(Number),
      releaseType,
      ...(slugs.length ? {
        relations: { projects: slugs.map((slug) => ({ slug, type: "requiredDependency" })) },
      } : {}),
    }));
  ' "$changelog" "$RELEASE_TYPE" "$game_version_ids" "$zip_name $version" "$dependencies")"

  echo "  file:      $zip_path ($size)"
  echo "  version:   $version   release type: $RELEASE_TYPE"
  echo "  clients:   $GAME_VERSION_ERA $GAME_VERSION_ANNIVERSARY"
  echo "  changelog: $(echo "$changelog" | head -1) ($(echo "$changelog" | wc -l | tr -d ' ') lines)"
  [[ -n "$dependencies" ]] && echo "  requires:  $(echo $dependencies)"

  if [[ -n "$dry_run" ]]; then
    echo "  dry run -- not uploading"
    return 0
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
      return 1
    }

  status="${response##*$'\n'}"
  response="${response%$'\n'*}"

  if [[ "$status" != 2* ]]; then
    echo "error: upload failed for $target -- HTTP $status" >&2
    echo "$response" >&2
    # 413 is Cloudflare rejecting the body before CurseForge sees it, and no retry helps: the
    # file is simply too big for the endpoint. Worth saying so here rather than leaving it to
    # be rediscovered, since the split packs exist precisely because of this limit.
    [[ "$status" = 413 ]] && \
      echo "       $size is over CurseForge's upload limit. Ship the split packs instead." >&2
    # 1018 is a relation naming a project CurseForge will not resolve. The usual cause is not
    # a wrong slug but an unapproved one: a project sits at status "New" until moderation
    # clears it, and until then nothing may depend on it. Re-run this target afterwards - the
    # packs themselves upload fine in the meantime, they are only the dependencies.
    if [[ "$response" == *1018* ]]; then
      echo "       A dependency is not resolvable yet. New projects cannot be depended on" >&2
      echo "       until moderation approves them - check authors.curseforge.com/#/projects" >&2
      echo "       and re-run: ./scripts/release.sh $target" >&2
    fi
    return 1
  fi

  file_id="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).id ?? "?"))' "$response")"
  echo "  uploaded -- file id $file_id"
}

for target in "${targets[@]}"; do
  if upload_target "$target"; then
    uploaded+=("$target")
  else
    failed+=("$target")
    echo "  skipping $target and continuing" >&2
  fi
done

echo
if (( ${#uploaded[@]} > 0 )); then
  echo "done: ${uploaded[*]}"
  [[ -z "$dry_run" ]] && echo "Uploads sit in moderation before they appear publicly."
fi
if (( ${#failed[@]} > 0 )); then
  echo "FAILED: ${failed[*]}" >&2
  exit 1
fi
