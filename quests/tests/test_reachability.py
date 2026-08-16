from tts_cli.reachability import (NO_DEFINITION, NO_QUESTGIVER, NO_SPAWN,
                                  classify_quest, findings)


def facts(definition=(0,), relations=(), spawned=()):
    return {
        "definition_patches": list(definition),
        "relations": [dict(r) for r in relations],
        "spawned": set(spawned),
    }


CREATURE = {"type": "creature", "id": 240, "patch_min": 0, "patch_max": 10}


def test_a_quest_with_a_spawned_giver_is_reachable():
    assert classify_quest(facts(relations=[CREATURE], spawned=[("creature", 240)])) is None


def test_a_definition_added_after_this_patch_is_not_loaded():
    # vmangos takes max(patch) <= P, so a quest that only exists at 1.13 is simply absent.
    assert classify_quest(facts(definition=(11,), relations=[CREATURE])) == NO_DEFINITION


def test_an_older_definition_still_counts():
    # Rows at 0 and 11: the server serves the 0 one, so the quest is in the game.
    assert classify_quest(
        facts(definition=(0, 11), relations=[CREATURE], spawned=[("creature", 240)]),
    ) is None


def test_a_relation_retired_before_this_patch_hands_nothing_out():
    retired = {**CREATURE, "patch_max": 4}
    assert classify_quest(facts(relations=[retired])) == NO_QUESTGIVER


def test_one_live_relation_is_enough():
    retired = {**CREATURE, "patch_max": 4}
    live = {"type": "creature", "id": 241, "patch_min": 0, "patch_max": 10}
    assert classify_quest(
        facts(relations=[retired, live], spawned=[("creature", 241)]),
    ) is None


def test_a_giver_that_stands_nowhere_is_reported_but_only_as_likely():
    # The weakest of the three: vmangos spawn data has real gaps, so this is a lead.
    assert classify_quest(facts(relations=[CREATURE], spawned=[])) == NO_SPAWN


def test_an_item_started_quest_is_never_judged_on_spawns():
    # item_template.start_quest names no spawn point: the item is a drop or a reward.
    item = {"type": "item", "id": 1307, "patch_min": 0, "patch_max": 10}
    assert classify_quest(facts(relations=[item], spawned=[])) is None


def test_a_gameobject_giver_is_looked_up_in_its_own_id_space():
    # Creature 68 and gameobject 68 are different things; spawned is keyed on both.
    obj = {"type": "gameobject", "id": 68, "patch_min": 0, "patch_max": 10}
    assert classify_quest(facts(relations=[obj], spawned=[("creature", 68)])) == NO_SPAWN
    assert classify_quest(facts(relations=[obj], spawned=[("gameobject", 68)])) is None


CORPUS = {
    "lines": [
        {"lineId": "q:5:accept", "questId": 5, "questTitle": "Growling Gut"},
        {"lineId": "q:5:complete", "questId": 5, "questTitle": "Growling Gut"},
        {"lineId": "q:9:accept", "questId": 9, "questTitle": "The Grave"},
        {"lineId": "q:11:accept", "questId": 11, "questTitle": "The Note"},
        {"lineId": "g:abc123", "questId": None, "questTitle": None},
    ],
}


def test_findings_name_every_line_of_an_unreachable_quest():
    found = findings(CORPUS, {5: facts(definition=(11,), relations=[CREATURE])})

    assert [f["questId"] for f in found] == [5]
    assert found[0]["lineIds"] == ["q:5:accept", "q:5:complete"]
    assert found[0]["confidence"] == "certain"
    assert "patch 10" in found[0]["explanation"]


def test_findings_put_the_certain_ones_first():
    found = findings(CORPUS, {
        5: facts(relations=[CREATURE], spawned=[]),
        9: facts(definition=(11,), relations=[CREATURE]),
    })

    assert [f["reason"] for f in found] == [NO_DEFINITION, NO_SPAWN]


def test_a_quest_the_dump_does_not_mention_is_skipped():
    # An older or newer dump than the corpus is a different problem, and reporting every
    # quest it happens not to hold would bury the ones this is looking for.
    assert findings(CORPUS, {}) == []


def test_gossip_lines_are_not_quests_and_are_left_alone():
    found = findings(CORPUS, {5: facts(definition=(11,))})
    assert all("g:abc123" not in f["lineIds"] for f in found)
