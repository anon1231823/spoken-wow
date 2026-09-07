import json

import pytest

from tts_cli.factions import (PACK_LABELS, PACK_SUFFIXES, PACKS, load_sides,
                              pack_of_line, pack_stems, pack_title)

CORPUS = {
    "lines": [
        {"lineId": "q:5:accept", "source": "accept", "questId": 5, "fileName": "5-accept"},
        {"lineId": "q:7:accept", "source": "accept", "questId": 7, "fileName": "7-accept"},
        {"lineId": "q:9:accept", "source": "accept", "questId": 9, "fileName": "9-accept"},
        {"lineId": "g:abc123", "source": "gossip", "questId": None, "fileName": "abc123"},
    ],
}
SIDES = {5: "alliance", 7: "horde"}


def test_a_quest_with_a_side_lands_in_that_pack():
    assert pack_of_line(CORPUS["lines"][0], SIDES) == "alliance"
    assert pack_of_line(CORPUS["lines"][1], SIDES) == "horde"


def test_a_quest_with_no_side_is_shared():
    # Absent means both sides can take it, which is the common case and why the export lists
    # only the exceptions.
    assert pack_of_line(CORPUS["lines"][2], SIDES) == "shared"


def test_gossip_is_its_own_pack_whatever_the_speaker():
    assert pack_of_line(CORPUS["lines"][3], SIDES) == "gossip"


def test_stems_are_extension_free_so_they_match_a_transcoded_store():
    assert pack_stems(CORPUS, SIDES, "alliance") == {"quests/5-accept"}
    assert pack_stems(CORPUS, SIDES, "gossip") == {"gossip/abc123"}


def test_the_all_pack_is_every_stem():
    assert pack_stems(CORPUS, SIDES, "all") == {
        "quests/5-accept", "quests/7-accept", "quests/9-accept", "gossip/abc123"}


def test_the_packs_partition_the_corpus():
    # Nothing may fall between the four: a line in no pack is a line that ships nowhere.
    split = set()
    for pack in ("alliance", "horde", "shared", "gossip"):
        stems = pack_stems(CORPUS, SIDES, pack)
        assert not (split & stems), "a stem appears in two packs"
        split |= stems
    assert split == pack_stems(CORPUS, SIDES, "all")


def test_an_unknown_pack_is_refused():
    with pytest.raises(ValueError):
        pack_stems(CORPUS, SIDES, "neutral")


def test_sides_load_with_integer_quest_ids(tmp_path):
    path = tmp_path / "factions.json"
    path.write_text(json.dumps({"sides": {"5": "alliance", "7": "horde"}}))

    assert load_sides(str(path)) == {5: "alliance", 7: "horde"}


def test_a_missing_export_sides_with_nobody(tmp_path):
    """A checkout with no export builds one pack of everything rather than failing: the
    split is a packaging decision, and `build` still has to work without it."""
    assert load_sides(str(tmp_path / "nope.json")) == {}


def test_pack_names_are_stable():
    assert PACKS == ("all", "alliance", "horde", "shared", "gossip")


def test_every_pack_has_a_folder_suffix_and_a_label():
    # A pack with no suffix would build over another pack's folder, and one with no label
    # would be indistinguishable in the AddOns list.
    assert set(PACK_SUFFIXES) == set(PACKS)
    assert set(PACK_LABELS) == set(PACKS)
    assert len(set(PACK_SUFFIXES.values())) == len(PACKS)
    assert len(set(PACK_LABELS.values())) == len(PACKS)


def test_a_title_reads_as_the_project_it_ships_to():
    assert pack_title("alliance") == "VoiceOver Redux Audio: Alliance"
    assert pack_title("shared") == "VoiceOver Redux Audio: Shared Quests"


def test_a_family_names_a_whole_set_of_packs_at_once():
    # The HQ packs are the same four cut the same way at a different quality, and their
    # CurseForge projects are named for the family rather than per pack - so the family is a
    # parameter and not five more constants to keep in step.
    assert pack_title("horde", "VoiceOver Redux HQ Audio") == "VoiceOver Redux HQ Audio: Horde"
