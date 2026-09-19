#!/usr/bin/env bash
# Uploading a built zip to Wago Addons, for the three scripts/*/release.sh to source.
#
# Shared, where the CurseForge halves of those scripts are not, because there is nothing
# per project in it: Wago takes a project id, a file and a small blob of metadata, and every
# decision that differs between the addons -- which zip, which version, which changelog
# section -- has already been made by the caller by the time it gets here. The CurseForge
# halves stayed separate precisely because those decisions differ there too (a pack reads its
# version out of a built module, the player out of a committed .toc), and merging them would
# have meant one function with three shapes.
#
# Sourced, not executed:
#
#   source "$REPO/scripts/lib/wago.sh"
#   wago_require_token                                   # once, before the first upload
#   wago_upload <project id> <zip> <label> <changelog> <slug>
#
# WAGO_TOKEN comes from the environment or the repo-root .env, the same arrangement as
# CURSEFORGE_TOKEN and for the same reason: one account-wide token that uploads all eleven
# projects, living in one file rather than in a shell history or a copy per pipeline.
# Generate one at https://addons.wago.io/account/apikeys.

WAGO_API="${WAGO_API:-https://addons.wago.io/api}"

# The clients a file is offered to, by Wago's own names for the metadata keys. Wago files
# against a *patch* per game flavour rather than against an id per client the way CurseForge
# does, so these are the version strings themselves and need no lookup call.
#
# Classic is Era and bc is the Anniversary client -- the same two clients the CurseForge side
# calls GAME_VERSION_ERA and GAME_VERSION_ANNIVERSARY, so a client added there is a client to
# add here.
WAGO_PATCH_CLASSIC="${WAGO_PATCH_CLASSIC:-1.15.9}"
WAGO_PATCH_BC="${WAGO_PATCH_BC:-2.5.6}"

# THE FOREVER CLIENT IS OPTIONAL BECAUSE ITS KEY IS UNDOCUMENTED. docs.wago.io lists only
# retail, classic, bc and wotlk, while the site's release-automation page names a
# `-forever.zip` suffix for Classic Forever, so the key almost certainly exists and is almost
# certainly this. Unset it and the upload simply does not claim that client, which is the safe
# direction to be wrong in: a file missing from a client is a download nobody makes, while a
# rejected request is a release that does not go out at all.
WAGO_PATCH_FOREVER="${WAGO_PATCH_FOREVER-1.60.1}"

# Wago's own channel, matching RELEASE_TYPE on the CurseForge side: "release" there is
# "stable" here. Marking these beta would keep most addon managers from offering them on the
# default channel, which is the audience this is for.
wago_stability() {
  case "${1:-release}" in
    release) echo "stable";;
    *)       echo "${1}";;
  esac
}

wago_require_token() {
  if [[ -z "${WAGO_TOKEN:-}" && -f "$REPO/.env" ]]; then
    WAGO_TOKEN="$(sed -n 's/^WAGO_TOKEN=//p' "$REPO/.env" | head -1 | tr -d '\r"')"
  fi
  if [[ -z "${WAGO_TOKEN:-}" ]]; then
    echo "error: WAGO_TOKEN is not set" >&2
    echo "       Generate one at https://addons.wago.io/account/apikeys" >&2
    echo "       then put WAGO_TOKEN=... in the repo root's .env, or export it." >&2
    return 1
  fi
}

# wago_upload <project id> <zip path> <label> <changelog> <slug>
#
# Prints what it is sending, then sends it. Returns non-zero on anything but a 2xx, leaving
# the caller to decide whether that fails the release -- the same contract the CurseForge
# upload has, so one store rejecting a file does not stop the other from taking it.
wago_upload() {
  local project="$1" zip_path="$2" label="$3" changelog="$4" slug="$5"
  local size metadata response status version_id

  if [[ -z "$project" ]]; then
    echo "error: no Wago project id -- create the project at https://addons.wago.io and" >&2
    echo "       write its id into the page's frontmatter under publishers/." >&2
    return 1
  fi
  if [[ ! -f "$zip_path" ]]; then
    echo "error: $zip_path does not exist" >&2
    return 1
  fi

  size="$(du -h "$zip_path" | cut -f1)"

  # Built with node rather than a heredoc for the same reason the CurseForge metadata is:
  # the changelog is markdown holding quotes, backticks and newlines, and hand-escaping that
  # into JSON is how a release ends up with a mangled changelog nobody notices for a month.
  #
  # NO DEPENDENCIES GO WITH THE FILE. CurseForge takes a relations block per upload, which is
  # what makes `audio-all` pull the four packs in; Wago's version endpoint documents no such
  # field. The pack pages say in words what they need instead, and a Wago user installing a
  # pack alone gets silence rather than a broken install -- worth knowing before wondering why
  # the meta pack behaves differently on the two stores.
  metadata="$(node -e '
    const [label, stability, changelog, classic, bc, forever] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      label,
      stability,
      changelog,
      supported_classic_patch: classic,
      supported_bc_patch: bc,
      ...(forever ? { supported_forever_patch: forever } : {}),
    }));
  ' "$label" "$(wago_stability "${RELEASE_TYPE:-release}")" "$changelog" \
    "$WAGO_PATCH_CLASSIC" "$WAGO_PATCH_BC" "$WAGO_PATCH_FOREVER")"

  echo "  wago:      project $project, $size"
  echo "  clients:   classic $WAGO_PATCH_CLASSIC, bc $WAGO_PATCH_BC${WAGO_PATCH_FOREVER:+, forever $WAGO_PATCH_FOREVER}"

  # --progress-bar because a pack is hundreds of megabytes and a silent curl for several
  # minutes is indistinguishable from a hang; not -f because on a rejection the API explains
  # itself in the body and -f throws exactly that away; --form-string for the metadata because
  # -F reads `;` in a value as the start of a `;type=` parameter and truncates there.
  response="$(curl -sS --progress-bar -w '\n%{http_code}' \
    -H "authorization: Bearer $WAGO_TOKEN" \
    -H "accept: application/json" \
    --form-string "metadata=$metadata" \
    -F "file=@$zip_path" \
    "$WAGO_API/projects/$project/version")" || {
      echo "error: could not reach Wago for $slug" >&2
      return 1
    }

  status="${response##*$'\n'}"
  response="${response%$'\n'*}"

  if [[ "$status" != 2* ]]; then
    echo "error: Wago upload failed for $slug -- HTTP $status" >&2
    echo "$response" >&2
    # 413 is Cloudflare refusing the body before Wago sees it, and no retry helps: the file is
    # simply too large for the endpoint. Every sound pack meets this -- they run from 300 MB to
    # 450 MB -- which is why the packs are on CurseForge only and the Wago pages for the addons
    # say where the audio comes from. The addons themselves are kilobytes and upload fine.
    if [[ "$status" = 413 ]]; then
      echo "       $size is over Wago's upload limit. The sound packs cannot be published" >&2
      echo "       through this endpoint; ship them on CurseForge and leave the Wago page" >&2
      echo "       pointing there. See publishers/README.md." >&2
    fi
    # The other failure worth naming: if the undocumented forever key is what Wago objected to,
    # the fix is to drop it rather than to go looking through the metadata for a typo.
    if [[ -n "$WAGO_PATCH_FOREVER" && "$response" == *forever* ]]; then
      echo "       Wago did not accept supported_forever_patch. Re-run with" >&2
      echo "       WAGO_PATCH_FOREVER= to upload without claiming the Forever client." >&2
    fi
    return 1
  fi

  version_id="$(node -e '
    const body = JSON.parse(process.argv[1]);
    process.stdout.write(String(body.id ?? body.version_id ?? "?"));
  ' "$response" 2>/dev/null || echo "?")"
  echo "  uploaded -- wago version $version_id"
  echo "  https://addons.wago.io/addons/$slug"
}
