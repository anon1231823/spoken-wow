from tts_cli.select import estimate, select_lines, unique_by_file

CORPUS = {
    "lines": [
        {"lineId": "q:5:accept", "fileName": "5-accept", "npcId": 288, "npcName": "Jitters",
         "questId": 5, "questTitle": "Growling Gut", "voice": "human-male",
         "npcType": "creature", "text": "aaa", "generatable": True},
        {"lineId": "q:9:accept", "fileName": "9-accept", "npcId": 68, "npcName": "Guard",
         "questId": 9, "questTitle": "The Watch", "voice": "dwarf-male",
         "npcType": "creature", "text": "bb", "generatable": True},
        # same fileName as the line above it in output terms: shared gossip hash
        {"lineId": "g:dup", "fileName": "dup", "npcId": 70, "npcName": "Guard A",
         "questId": None, "questTitle": None, "voice": "human-male",
         "npcType": "creature", "text": "cccc", "generatable": True},
        {"lineId": "g:dup:m", "fileName": "dup", "npcId": 71, "npcName": "Guard B",
         "questId": None, "questTitle": None, "voice": "human-male",
         "npcType": "creature", "text": "cccc", "generatable": True},
    ],
    "spawns": {"creature:288": [{"map": 0, "x": -9465.0, "y": 74.0}]},
}


def test_selects_by_npc_id():
    assert [l["lineId"] for l in select_lines(CORPUS, "audio", npc="288")] == ["q:5:accept"]


def test_selects_by_npc_name_substring():
    assert [l["lineId"] for l in select_lines(CORPUS, "audio", npc="jitt")] == ["q:5:accept"]


def test_selects_by_quest_id():
    assert [l["lineId"] for l in select_lines(CORPUS, "audio", quest="9")] == ["q:9:accept"]


def test_selects_by_quest_title_substring():
    assert [l["lineId"] for l in select_lines(CORPUS, "audio", quest="watch")] == ["q:9:accept"]


def test_selects_by_voice():
    assert len(select_lines(CORPUS, "audio", voice="human-male")) == 3


def test_selects_by_line_id():
    assert [l["lineId"] for l in select_lines(CORPUS, "audio", line_id="g:dup")] == ["g:dup"]


def test_selects_by_area():
    hits = select_lines(CORPUS, "audio", area=(0, (-9500, -9400), (0, 100)))
    assert [l["lineId"] for l in hits] == ["q:5:accept"]


def test_filters_combine_with_and():
    assert select_lines(CORPUS, "audio", npc="jitters", voice="dwarf-male") == []


def test_empty_query_returns_everything():
    assert len(select_lines(CORPUS, "audio")) == 4


def test_unique_by_file_collapses_a_shared_hash():
    ids = [l["lineId"] for l in unique_by_file(CORPUS["lines"])]
    assert ids == ["q:5:accept", "q:9:accept", "g:dup"]


def test_estimate_counts_files_not_lines():
    """Two NPCs sharing gossip text produce one file, so it is paid for once."""
    est = estimate(CORPUS["lines"])
    assert est["lines"] == 4
    assert est["files"] == 3
    assert est["characters"] == len("aaa") + len("bb") + len("cccc")


def test_estimate_lists_required_voices():
    assert estimate(CORPUS["lines"])["voices"] == ["dwarf-male", "human-male"]


def test_an_ignored_line_is_never_selected():
    # Not even by naming it: --line-id q:5:accept on an ignored line selects nothing.
    assert select_lines(CORPUS, "audio", npc="288", ignored={"q:5:accept"}) == []
    assert select_lines(CORPUS, "audio", line_id="q:5:accept", ignored={"q:5:accept"}) == []
