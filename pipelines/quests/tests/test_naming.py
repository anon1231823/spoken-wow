import pytest

from tts_cli.naming import (
    filename_for_row,
    filename_from_line_id,
    line_id_for_row,
    subfolder_from_line_id,
)

QUEST = {"quest": "5", "source": "accept",
         "templateText_race_gender_hash": "deadbeef", "player_gender": None}
QUEST_F = {"quest": "5", "source": "accept",
           "templateText_race_gender_hash": "deadbeef", "player_gender": "f"}
GOSSIP = {"quest": "", "source": "gossip",
          "templateText_race_gender_hash": "abc123", "player_gender": None}
GOSSIP_M = {"quest": "", "source": "gossip",
            "templateText_race_gender_hash": "abc123", "player_gender": "m"}


def test_quest_filename():
    assert filename_for_row(QUEST) == "5-accept"


def test_gendered_quest_filename():
    assert filename_for_row(QUEST_F) == "f-5-accept"


def test_gossip_filename_is_the_hash():
    assert filename_for_row(GOSSIP) == "abc123"


def test_gendered_gossip_filename():
    assert filename_for_row(GOSSIP_M) == "m-abc123"


def test_line_ids():
    assert line_id_for_row(QUEST) == "q:5:accept"
    assert line_id_for_row(QUEST_F) == "q:5:accept:f"
    assert line_id_for_row(GOSSIP) == "g:abc123"
    assert line_id_for_row(GOSSIP_M) == "g:abc123:m"


@pytest.mark.parametrize("row", [QUEST, QUEST_F, GOSSIP, GOSSIP_M])
def test_line_id_round_trips_to_filename(row):
    assert filename_from_line_id(line_id_for_row(row)) == filename_for_row(row)


def test_subfolder():
    assert subfolder_from_line_id("q:5:accept") == "quests"
    assert subfolder_from_line_id("g:abc123:m") == "gossip"


def test_rejects_unknown_line_id():
    with pytest.raises(ValueError):
        filename_from_line_id("x:nonsense")
    with pytest.raises(ValueError):
        subfolder_from_line_id("x:nonsense")
