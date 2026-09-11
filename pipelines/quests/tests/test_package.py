"""The addon zips: one for Blizzard's clients, one apiece for the older ones, and the player.

A WoW client before flavor suffixes opens `SpokenQuests.toc` and nothing else, so what these
pin is which single .toc each legacy zip carries and which vendored Ace3 travels with it. Both
mistakes are silent - the addon simply does not load, or loads a library that binds an API the
client has never had - and neither shows up until somebody launches that client.

Two more things are pinned since the rename. The Blizzard zip carries a tombstone folder under
the old name, TOC-only, so the client keeps loading the old SavedVariables file for the
migration to read. The legacy zips carry the Spoken player itself, because those clients have
no addon manager to install a dependency, and what they carry must be byte-identical to the
player's own tree.
"""
import os
import subprocess
import zipfile

import pytest

#: The monorepo root. This file is pipelines/quests/tests/, so four dirnames.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SCRIPT = os.path.join(REPO, "scripts", "quests", "package.sh")
PLAYER_SCRIPT = os.path.join(REPO, "scripts", "spoken", "package.sh")
ADDON_DIR = os.path.join(REPO, "addons", "SpokenQuests")
PLAYER_DIR = os.path.join(REPO, "addons", "Spoken")
NAME = "SpokenQuests"
PLAYER = "Spoken"
TOMBSTONE = "VoiceOverRedux"

#: client label -> the Interface version its .toc must declare.
LEGACY_CLIENTS = {"1.12": "11200", "2.4.3": "20400", "3.3.5": "30300"}


def version_of(directory, name):
    path = os.path.join(directory, f"{name}.toc")
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("## Version:"):
                return line.split(":", 1)[1].strip()
    raise AssertionError(f"no '## Version:' line in {path}")


def toc_version():
    return version_of(ADDON_DIR, NAME)


def run(script, dist):
    # ALLOW_DIRTY, because a test run must not depend on the working tree being committed.
    subprocess.run([script], check=True, cwd=REPO,
                   env={**os.environ, "DIST": str(dist), "ALLOW_DIRTY": "1"},
                   capture_output=True)


def read_zips(dist):
    zips = {}
    for name in os.listdir(dist):
        with zipfile.ZipFile(dist / name) as archive:
            zips[name] = (archive.namelist(),
                          {n: archive.read(n) for n in archive.namelist() if not n.endswith("/")})
    return zips


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    """Every zip the quests script produces, as {zip name: (namelist, {name: bytes})}."""
    dist = tmp_path_factory.mktemp("dist")
    run(SCRIPT, dist)
    return read_zips(dist)


@pytest.fixture(scope="module")
def player_built(tmp_path_factory):
    dist = tmp_path_factory.mktemp("dist-player")
    run(PLAYER_SCRIPT, dist)
    return read_zips(dist)


def modern(built):
    return built[f"{NAME}-{toc_version()}.zip"]


def legacy(built, client):
    return built[f"{NAME}-WoW_{client}-{toc_version()}.zip"]


def tocs_in(files, folder):
    return {n: files[n].decode("utf-8", "replace") for n in files if n.startswith(folder + "/") and n.endswith(".toc")}


def test_one_zip_per_client_family(built):
    assert set(built) == {f"{NAME}-{toc_version()}.zip"} | {
        f"{NAME}-WoW_{client}-{toc_version()}.zip" for client in LEGACY_CLIENTS}


@pytest.mark.parametrize("client,interface", sorted(LEGACY_CLIENTS.items()))
def test_a_legacy_zip_carries_exactly_one_toc_and_it_is_that_client_s(built, client, interface):
    names, files = legacy(built, client)
    tocs = tocs_in(files, NAME)
    assert list(tocs) == [f"{NAME}/{NAME}.toc"], names
    assert tocs[f"{NAME}/{NAME}.toc"].startswith(f"## Interface: {interface}")


@pytest.mark.parametrize("client", sorted(LEGACY_CLIENTS))
def test_a_legacy_zip_carries_only_its_own_ace3(built, client):
    names, _ = legacy(built, client)
    # The root Libs/ binds C_Timer.After while loading, which is an error on every client this
    # zip is for; each of them has a fork of Ace3 under its own directory instead.
    for folder in (NAME, PLAYER):
        assert not any(name.startswith(f"{folder}/Libs/") for name in names)
        assert f"{folder}/{client}/embeds.xml" in names
        for other in LEGACY_CLIENTS:
            if other != client:
                assert not any(name.startswith(f"{folder}/{other}/") for name in names)


@pytest.mark.parametrize("client,interface", sorted(LEGACY_CLIENTS.items()))
def test_a_legacy_zip_bundles_the_player_with_a_hard_dependency(built, client, interface):
    # No addon manager on these clients, so the player travels inside the zip - and since it
    # is guaranteed present, the dependency can be hard here where it is soft everywhere else.
    names, files = legacy(built, client)
    tocs = tocs_in(files, PLAYER)
    assert list(tocs) == [f"{PLAYER}/{PLAYER}.toc"], names
    assert tocs[f"{PLAYER}/{PLAYER}.toc"].startswith(f"## Interface: {interface}")
    assert "## Dependencies: Spoken" in files[f"{NAME}/{NAME}.toc"].decode()
    assert "## OptionalDeps: Spoken" not in files[f"{NAME}/{NAME}.toc"].decode()


@pytest.mark.parametrize("client", sorted(LEGACY_CLIENTS))
def test_the_bundled_player_is_byte_identical_to_its_tree(built, client):
    # The one source tree, staged at build time: there is no committed second copy that
    # could drift. Everything under Spoken/ in the zip equals the repo file, except the
    # per-client Libs pruning and the .toc swap the packaging is for.
    names, files = legacy(built, client)
    bundled = [n for n in names if n.startswith(f"{PLAYER}/") and not n.endswith("/")]
    assert bundled, names
    for name in bundled:
        relative = name[len(PLAYER) + 1:]
        if relative == f"{PLAYER}.toc":
            source = os.path.join(PLAYER_DIR, f"{PLAYER}_{client}.toc")
        else:
            source = os.path.join(PLAYER_DIR, relative)
        with open(source, "rb") as handle:
            assert files[name] == handle.read(), name


def test_the_blizzard_zip_carries_every_flavor_and_no_legacy_client(built):
    names, files = modern(built)
    tocs = tocs_in(files, NAME)
    assert sorted(tocs) == sorted(f"{NAME}/{NAME}{suffix}.toc" for suffix in
                                  ("", "_Mainline", "_TBC", "_Vanilla", "_Wrath"))
    for client in LEGACY_CLIENTS:
        assert not any(name.startswith(f"{NAME}/{client}/") for name in names)
    assert any(name.startswith(f"{NAME}/Libs/") for name in names)
    # Managers install the player from the CurseForge dependency; it is not bundled here.
    assert not any(name.startswith(f"{PLAYER}/") for name in names)
    assert "## OptionalDeps: Spoken" in tocs[f"{NAME}/{NAME}.toc"]


def test_the_blizzard_zip_carries_the_tombstone(built):
    # A TOC and nothing else under the old folder name: enough for the client to keep loading
    # the old SavedVariables file, and no code that could run twice.
    names, files = modern(built)
    under = [n for n in names if n.startswith(f"{TOMBSTONE}/") and not n.endswith("/")]
    assert under == [f"{TOMBSTONE}/{TOMBSTONE}.toc"], under
    toc = files[f"{TOMBSTONE}/{TOMBSTONE}.toc"].decode()
    assert "## SavedVariables: VoiceOverDB" in toc
    assert "## LoadSavedVariablesFirst: true" in toc


def test_every_zip_unpacks_into_the_addons_folder(built):
    # Addon hosts unpack the archive straight into Interface/AddOns, so every root must be a
    # folder the client reads: the addon, the player it bundles, or the tombstone.
    for name, (names, _) in built.items():
        roots = {entry.split("/", 1)[0] for entry in names}
        assert roots <= {NAME, PLAYER, TOMBSTONE}, (name, roots)


def test_the_player_ships_on_its_own_for_blizzard_clients(player_built):
    version = version_of(PLAYER_DIR, PLAYER)
    assert set(player_built) == {f"{PLAYER}-{version}.zip"}
    names, files = player_built[f"{PLAYER}-{version}.zip"]
    tocs = tocs_in(files, PLAYER)
    assert sorted(tocs) == sorted(f"{PLAYER}/{PLAYER}{suffix}.toc" for suffix in
                                  ("", "_Mainline", "_TBC", "_Vanilla", "_Wrath"))
    for client in LEGACY_CLIENTS:
        assert not any(name.startswith(f"{PLAYER}/{client}/") for name in names)
    assert {entry.split("/", 1)[0] for entry in names} == {PLAYER}
