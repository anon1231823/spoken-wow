"""Which corpus quests a 1.12 server would never hand out.

The corpus is extracted with no patch filter at all: tts_cli/sql_queries.py joins
quest_template to the questgiver relations and takes whatever the dump holds. vmangos does
not. Every table it loads a quest through is gated on the patch the server runs
(src/game/ObjectMgr.cpp), so the dump is a superset of the game and some of what we voice is
content no player can reach.

The three gates, exactly as the core applies them:

* `quest_template` holds a row per content patch and the core takes the newest one at or
  below the server's patch: `patch = (select max(patch) ... where patch <= P)`. A quest whose
  every row is above P is never loaded at all.
* `creature_questrelation`, `creature_involvedrelation` and their gameobject twins are read
  `WHERE P BETWEEN patch_min AND patch_max`. A quest whose every relation is out of range has
  a definition and no way to be handed out.
* `creature_template` is versioned the same way `quest_template` is, and the `creature` and
  `gameobject` spawn tables carry patch_min/patch_max per spawn point. A questgiver with no
  spawn valid at P exists as data and stands nowhere in the world.

The spawn gate is a lead rather than a verdict, and the run against the real dump shows why:
it flags the Alterac Valley quests 6846 and 6901, whose questgivers are put in the world by
the battleground's own scripts, and the two Seal of Ascension quests, whose giver is summoned.
An NPC absent from the `creature` table is sometimes a scripted spawn and sometimes a hole in
vmangos itself, which is why it is reported as "likely" and never acted on automatically.

An item-started quest is deliberately not judged by the last gate: `item_template.start_quest`
names no spawn, and the item may be a drop, a reward or a vendor's.

The rules live here rather than in the tool so they can be tested against fixtures. The tool
supplies the facts; this decides what they mean, and says how sure it is - a quest with no
definition is a fact, a questgiver that does not spawn is an inference, because vmangos
spawn data is itself incomplete in places.
"""

#: What `sWorld.GetWowPatch()` returns on a 1.12 server, and what the corpus was taken from.
DEFAULT_PATCH = 10

#: The reasons, worst first. A quest is reported under the first one that fits.
NO_DEFINITION = "no-definition"
NO_QUESTGIVER = "no-questgiver"
NO_SPAWN = "no-spawn"

#: How much weight to put on each: a missing definition is certain, an absent spawn is not.
CONFIDENCE = {
    NO_DEFINITION: "certain",
    NO_QUESTGIVER: "certain",
    NO_SPAWN: "likely",
}

EXPLANATION = {
    NO_DEFINITION: "quest_template has no row at or below patch {patch}",
    NO_QUESTGIVER: "every questgiver relation is outside patch {patch}",
    NO_SPAWN: "no questgiver spawns at patch {patch}",
}


def classify_quest(facts: dict, patch: int = DEFAULT_PATCH) -> str | None:
    """Why this quest is unreachable at `patch`, or None if it is reachable.

    `facts` is what the world DB says about one quest:

        definition_patches  every `quest_template.patch` value the quest has
        relations           [{"type": "creature"|"gameobject"|"item", "id": int,
                             "patch_min": int, "patch_max": int}], all of them, unfiltered
        spawned             {(type, id)} entity keys with at least one spawn valid at `patch`

    Item relations are counted as questgivers and never asked to spawn.
    """
    if not any(p <= patch for p in facts.get("definition_patches", ())):
        return NO_DEFINITION

    live = [
        relation for relation in facts.get("relations", ())
        if relation["patch_min"] <= patch <= relation["patch_max"]
    ]
    if not live:
        return NO_QUESTGIVER

    spawned = facts.get("spawned", set())
    if any(relation["type"] == "item" or (relation["type"], relation["id"]) in spawned
           for relation in live):
        return None
    return NO_SPAWN


def findings(corpus: dict, facts_by_quest: dict, patch: int = DEFAULT_PATCH) -> list:
    """One finding per unreachable corpus quest, worst first then by quest id.

    A quest the world DB says nothing about is skipped rather than reported: that is a dump
    older or newer than the corpus, which is a different problem from an unreachable quest
    and would otherwise flood the report.
    """
    lines_by_quest = {}
    titles = {}
    for line in corpus["lines"]:
        if not line["questId"]:
            continue
        lines_by_quest.setdefault(line["questId"], []).append(line["lineId"])
        titles.setdefault(line["questId"], line["questTitle"])

    order = (NO_DEFINITION, NO_QUESTGIVER, NO_SPAWN)
    found = []
    for quest_id, line_ids in lines_by_quest.items():
        facts = facts_by_quest.get(quest_id)
        if facts is None:
            continue
        reason = classify_quest(facts, patch)
        if not reason:
            continue
        found.append({
            "questId": quest_id,
            "questTitle": titles[quest_id],
            "reason": reason,
            "confidence": CONFIDENCE[reason],
            "explanation": EXPLANATION[reason].format(patch=patch),
            "lineIds": sorted(line_ids),
        })

    return sorted(found, key=lambda f: (order.index(f["reason"]), f["questId"]))
