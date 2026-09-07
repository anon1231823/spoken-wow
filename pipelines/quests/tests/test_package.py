"""The player addon's zips: one for Blizzard's clients, one apiece for the older ones.

A WoW client before flavor suffixes opens `VoiceOverRedux.toc` and nothing else, so what these
pin is which single .toc each legacy zip carries and which vendored Ace3 travels with it. Both
mistakes are silent - the addon simply does not load, or loads a library that binds an API the
client has never had - and neither shows up until somebody launches that client.
"""
import os
import subprocess
import zipfile

import pytest

#: The monorepo root. This file is pipelines/quests/tests/, so four dirnames. The addon
#: source and the packaging scripts both moved out from under the pipeline in the merge.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SCRIPT = os.path.join(REPO, "scripts", "quests", "package.sh")
#: Where the addon is read from, and what it ships as. Not the same thing until the
#: rename lands with its SavedVariables migration.
ADDON_DIR = os.path.join(REPO, "addons", "SpokenQuests")
NAME = "VoiceOverRedux"

#: client label -> the Interface version its .toc must declare.
LEGACY_CLIENTS = {"1.12": "11200", "2.4.3": "20400", "3.3.5": "30300"}


def toc_version():
    path = os.path.join(ADDON_DIR, f"{NAME}.toc")
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("## Version:"):
                return line.split(":", 1)[1].strip()
    raise AssertionError(f"no '## Version:' line in {path}")


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    """Every zip the script produces, as {zip name: ZipFile namelist}."""
    dist = tmp_path_factory.mktemp("dist")
    # ALLOW_DIRTY, because a test run must not depend on the working tree being committed.
    subprocess.run([SCRIPT], check=True, cwd=REPO,
                   env={**os.environ, "DIST": str(dist), "ALLOW_DIRTY": "1"},
                   capture_output=True)
    zips = {}
    for name in os.listdir(dist):
        with zipfile.ZipFile(dist / name) as archive:
            zips[name] = (archive.namelist(),
                          {n: archive.read(n).decode("utf-8", "replace")
                           for n in archive.namelist() if n.endswith(".toc")})
    return zips


def modern(built):
    return built[f"{NAME}-{toc_version()}.zip"]


def legacy(built, client):
    return built[f"{NAME}-WoW_{client}-{toc_version()}.zip"]


def test_one_zip_per_client_family(built):
    assert set(built) == {f"{NAME}-{toc_version()}.zip"} | {
        f"{NAME}-WoW_{client}-{toc_version()}.zip" for client in LEGACY_CLIENTS}


@pytest.mark.parametrize("client,interface", sorted(LEGACY_CLIENTS.items()))
def test_a_legacy_zip_carries_exactly_one_toc_and_it_is_that_client_s(built, client, interface):
    names, tocs = legacy(built, client)
    assert list(tocs) == [f"{NAME}/{NAME}.toc"], names
    assert tocs[f"{NAME}/{NAME}.toc"].startswith(f"## Interface: {interface}")


@pytest.mark.parametrize("client", sorted(LEGACY_CLIENTS))
def test_a_legacy_zip_carries_only_its_own_ace3(built, client):
    names, _ = legacy(built, client)
    # The root Libs/ binds C_Timer.After while loading, which is an error on every client this
    # zip is for; each of them has a fork of Ace3 under its own directory instead.
    assert not any(name.startswith(f"{NAME}/Libs/") for name in names)
    assert f"{NAME}/{client}/embeds.xml" in names
    for other in LEGACY_CLIENTS:
        if other != client:
            assert not any(name.startswith(f"{NAME}/{other}/") for name in names)


def test_the_blizzard_zip_carries_every_flavor_and_no_legacy_client(built):
    names, tocs = modern(built)
    assert sorted(tocs) == sorted(f"{NAME}/{NAME}{suffix}.toc" for suffix in
                                  ("", "_Mainline", "_TBC", "_Vanilla", "_Wrath"))
    for client in LEGACY_CLIENTS:
        assert not any(name.startswith(f"{NAME}/{client}/") for name in names)
    assert any(name.startswith(f"{NAME}/Libs/") for name in names)


def test_every_zip_unpacks_into_the_addons_folder(built):
    # Addon hosts unpack the archive straight into Interface/AddOns, so a zip whose root is
    # anything but the addon folder installs into a directory the client never reads.
    for name, (names, _) in built.items():
        assert all(entry.startswith(f"{NAME}/") for entry in names), name
