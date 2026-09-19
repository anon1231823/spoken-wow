#!/usr/bin/env bash
# Publishes the sound packs as GitHub releases, which is the only channel that will take them.
#
#   ./scripts/audio-github-release.sh --dry-run          # say what would be sent, send nothing
#   ./scripts/audio-github-release.sh                    # every pack
#   ./scripts/audio-github-release.sh zones-audio        # just one
#
# WHY THIS EXISTS. CurseForge takes the packs and Wago does not: each is 280-452 MB and
# Cloudflare answers 413 to Wago's version endpoint before Wago sees the body. A player who
# installs an addon from Wago therefore has nowhere to get its audio, so the packs get a
# second home here, where the ceiling is 2 GB a file.
#
# WHY IT IS NOT THE WORKFLOW. .github/workflows/release-addons.yaml builds its zips on the
# runner, which the packs cannot be: the audio is outside git (see .gitignore) and exists only
# on the machine that generated it. So this uploads what is already in dist/ from that machine,
# the same contract scripts/*/release.sh has, and the workflow keeps the addons.
#
# ONE TAG PER PACK PROJECT. A pack is versioned by the module last built for it and the three
# groups move independently -- zones audio is at 2.0.1 while the quests packs are at 2.0.0 --
# so a tag spanning them would name a version that is only true for one. The tags are
# deliberately outside the prefixes release-addons.yaml watches (spoken/, quests/, zones/):
# that workflow would try to build an addon from a pack tag and fail the tag.
#
# The meta addon has no release here on purpose. SpokenQuestsAudio is a few kilobytes that
# declares the four packs as dependencies, which only an addon manager resolves; downloaded by
# hand it is an empty folder, so the four packs are what this offers.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$REPO/dist"

# The branch a tag is cut against. Tags land on master rather than on whatever is checked out:
# a release whose tag points into a feature branch loses its commit the moment that branch is
# squashed, and takes the "what shipped" answer with it.
TARGET_BRANCH="${TARGET_BRANCH:-master}"

# tag prefix -> the zip basename, where the version is read, and which changelog it is in.
#
# A pack has no committed .toc: the build generates one and package-audio.sh passes the version
# in, so the quests packs read theirs back out of the built module in dist/. Releasing a pack
# nobody built therefore fails here rather than uploading whatever stale zip is lying about.
target_zip() { case "$1" in
  quests-audio-alliance) echo "SpokenQuestsAudioAlliance";;
  quests-audio-horde)    echo "SpokenQuestsAudioHorde";;
  quests-audio-shared)   echo "SpokenQuestsAudioShared";;
  quests-audio-gossip)   echo "SpokenQuestsAudioGossip";;
  zones-audio)           echo "SpokenZonesAudio";;
  books-audio)           echo "SpokenBooksAudio";;
esac; }
target_toc() { local zip; zip="$(target_zip "$1")"; case "$1" in
  quests-audio-*) echo "$DIST/$zip/$zip.toc";;
  *)              echo "$REPO/addons/$zip/$zip.toc";;
esac; }
target_changelog() { case "$1" in
  quests-audio-*) echo "$REPO/docs/quests/CHANGELOG.md";;
  zones-audio)    echo "$REPO/docs/zones/CHANGELOG.md";;
  books-audio)    echo "$REPO/docs/books/CHANGELOG.md";;
esac; }
# Which heading in that file is this pack's. The kind is half the key in two of the three:
# the quests player and its packs have collided on a version number before, and zones numbers
# its addon and its pack independently, so `## 2.0.1 — audio` is the pack's and anything else
# at that number is the addon's. Books has one changelog per version and no such split.
target_changelog_kind() { case "$1" in
  quests-audio-*) echo "pack";;
  zones-audio)    echo "audio";;
  books-audio)    echo "";;
esac; }
# What the pack is called in the release title and in the store pages it is linked from.
target_title() { case "$1" in
  quests-audio-alliance) echo "Spoken Quests Audio: Alliance";;
  quests-audio-horde)    echo "Spoken Quests Audio: Horde";;
  quests-audio-shared)   echo "Spoken Quests Audio: Shared Quests";;
  quests-audio-gossip)   echo "Spoken Quests Audio: Gossip";;
  zones-audio)           echo "Spoken Zones Audio";;
  books-audio)           echo "Spoken Books Audio";;
esac; }
# The addon each pack is inert without, by store slug, for the release notes. A pack installed
# alone is several hundred megabytes of silence.
target_needs() { case "$1" in
  quests-audio-*) echo "spoken-quests";;
  zones-audio)    echo "spoken-zones";;
  books-audio)    echo "spoken-books";;
esac; }

ALL_TARGETS="quests-audio-alliance quests-audio-horde quests-audio-shared quests-audio-gossip \
zones-audio books-audio"

dry_run=""
targets=()
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) dry_run=1;;
    quests-audio-alliance|quests-audio-horde|quests-audio-shared|quests-audio-gossip|zones-audio|books-audio)
      targets+=("$arg");;
    *) echo "error: unknown argument '$arg' (expected: $ALL_TARGETS, --dry-run)" >&2; exit 1;;
  esac
done
if (( ${#targets[@]} == 0 )); then
  read -r -a targets <<<"$ALL_TARGETS"
fi

command -v gh >/dev/null || { echo "error: gh is required (https://cli.github.com)" >&2; exit 1; }
command -v node >/dev/null || { echo "error: node is required (for the changelog)" >&2; exit 1; }

# The section of the pack's CHANGELOG for the version being released, so the notes on the
# release and the notes in the repository cannot drift apart.
changelog_for() {
  node -e '
    const { readFileSync } = require("fs");
    const [path, version, kind] = process.argv.slice(1);
    const lines = readFileSync(path, "utf8").split("\n");
    const matches = (l) =>
      l.startsWith(`## ${version}`) && (kind ? new RegExp(kind, "i").test(l) : true);
    const start = lines.findIndex(matches);
    if (start === -1) {
      console.error(`no "## ${version}${kind ? ` ... ${kind}` : ""}" section in ${path}`);
      process.exit(1);
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) { end = i; break; }
    }
    process.stdout.write(lines.slice(start, end).join("\n").trim());
  ' "$1" "$2" "$3"
}

failed=()
released=()

release_target() {
  local target="$1"
  local zip_name version zip_path tag title notes size

  zip_name="$(target_zip "$target")"
  version="$(sed -n 's/^## Version:[[:space:]]*//p' "$(target_toc "$target")" 2>/dev/null \
    | head -1 | tr -d '\r')"

  echo
  echo "=== $target ==="

  if [[ -z "$version" ]]; then
    echo "error: no version for '$target' -- the pack has not been built on this machine." >&2
    echo "       Run make <group>-package-audio first; a pack's version comes from the" >&2
    echo "       module it produces, not from a committed .toc." >&2
    return 1
  fi

  zip_path="$DIST/$zip_name-$version.zip"
  tag="$target/v$version"
  title="$(target_title "$target") $version"

  if [[ ! -f "$zip_path" ]]; then
    echo "error: $zip_path does not exist -- run make <group>-package-audio first" >&2
    return 1
  fi

  size="$(du -h "$zip_path" | cut -f1)"
  notes="$(changelog_for "$(target_changelog "$target")" "$version" \
    "$(target_changelog_kind "$target")")" || return 1

  echo "  file:    $zip_path ($size)"
  echo "  tag:     $tag on $TARGET_BRANCH"
  echo "  title:   $title"
  echo "  notes:   $(echo "$notes" | head -1) ..."

  if [[ -n "$dry_run" ]]; then
    echo "  dry run -- not releasing"
    return 0
  fi

  # An existing release is added to rather than replaced: re-running after one upload of six
  # failed should finish the job, not start a new release that drops the five that worked.
  if gh release view "$tag" >/dev/null 2>&1; then
    echo "  release exists -- uploading the asset into it"
    gh release upload "$tag" "$zip_path" --clobber || return 1
  else
    gh release create "$tag" "$zip_path" \
      --target "$TARGET_BRANCH" \
      --title "$title" \
      --notes "$notes

**This pack is data only.** It needs [$(target_needs "$target")](https://addons.wago.io/addons/$(target_needs "$target")), which plays it; installed alone it does nothing.

Released here because the pack is $size: CurseForge carries it too, and Wago's upload endpoint refuses a file this size." || return 1
  fi

  echo "  released -- $(gh release view "$tag" --json url -q .url)"
}

for target in "${targets[@]}"; do
  if release_target "$target"; then
    released+=("$target")
  else
    failed+=("$target")
    echo "  skipping $target and continuing" >&2
  fi
done

echo
if (( ${#released[@]} > 0 )); then
  echo "done: ${released[*]}"
fi
if (( ${#failed[@]} > 0 )); then
  echo "FAILED: ${failed[*]}" >&2
  exit 1
fi
