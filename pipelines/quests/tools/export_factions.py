"""Which side of the war a quest belongs to, exported from the vmangos world DB.

Writes corpus/factions.json: {questId: "alliance" | "horde"}, and nothing for the quests
either side can take - the absent case is the common one and listing it would triple the file.

WHY THIS IS NOT A CORPUS FIELD. The corpus is rewritten only by `extract`, which re-reads
every line of text in the world DB; running it to add one column would put 17.5k lines of
text back through a database that has moved on since. So this is a snapshot beside the
corpus, the way corpus/ignored.json is, and `make factions` refreshes it.

HOW A QUEST GETS A SIDE. Two signals, and only the second one is worth much:

  quest_template.RequiredRaces is a race bitmask, and vanilla almost never sets it - it gates
  race and class starting chains and little else. Taken alone it calls 34 MB of audio
  Alliance and 34 MB Horde, and everything else neutral, which is plainly wrong.

  The questgiver's faction template is the real signal. Vanilla makes a quest faction-specific
  by putting its giver in Orgrimmar and letting hostility do the rest, so a giver hostile to
  Horde and not to Alliance is an Alliance questgiver. That classifies ~1,300 Alliance and
  ~1,100 Horde quests, and leaves the neutral hubs - Booty Bay, Gadgetzan, Everlook - shared,
  which is the case a naive split gets wrong.

An explicit race gate wins where the two disagree: it is authored, while the giver's faction
is inferred.

A QUEST WITH GIVERS ON BOTH SIDES IS SHARED, and so is one with no giver at all. Being wrong
in that direction costs a player some megabytes; being wrong the other way costs them a line
that never plays.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tts_cli.sql_queries import make_connection  # noqa: E402

DEFAULT_OUT = "corpus/factions.json"

#: Vanilla's race bits in quest_template.RequiredRaces.
ALLIANCE_RACES = 1 | 4 | 8 | 64      # human, dwarf, night elf, gnome
HORDE_RACES = 2 | 16 | 32 | 128      # orc, undead, tauren, troll

#: faction_template's masks. 1 is players, 2 Alliance, 4 Horde, 8 monsters.
ALLIANCE_MASK = 2
HORDE_MASK = 4

# One row per quest that has a giver, with the side that giver stands on. The window function
# picks the highest build of each faction template, since the table carries several.
GIVER_SIDES = f"""
WITH ft AS (
  SELECT id, hostile_mask,
         ROW_NUMBER() OVER (PARTITION BY id ORDER BY build DESC) AS rn
  FROM faction_template
),
side AS (
  SELECT id,
    CASE
      WHEN (hostile_mask & {HORDE_MASK}) > 0 AND (hostile_mask & {ALLIANCE_MASK}) = 0
        THEN 'alliance'
      WHEN (hostile_mask & {ALLIANCE_MASK}) > 0 AND (hostile_mask & {HORDE_MASK}) = 0
        THEN 'horde'
      ELSE 'shared'
    END AS side
  FROM ft WHERE rn = 1
),
givers AS (
  SELECT qr.quest, s.side
  FROM creature_questrelation qr
  JOIN creature_template ct ON ct.entry = qr.id
  JOIN side s ON s.id = ct.faction
  UNION ALL
  SELECT qr.quest, s.side
  FROM gameobject_questrelation qr
  JOIN gameobject_template gt ON gt.entry = qr.id
  JOIN side s ON s.id = gt.faction
)
SELECT quest, CASE WHEN COUNT(DISTINCT side) > 1 THEN 'shared' ELSE MIN(side) END
FROM givers GROUP BY quest
"""

RACE_GATES = "SELECT entry, RequiredRaces FROM quest_template WHERE RequiredRaces > 0"


def side_from_races(mask: int) -> str:
    alliance, horde = mask & ALLIANCE_RACES, mask & HORDE_RACES
    if alliance and horde:
        return "shared"
    return "alliance" if alliance else "horde"


def export(connection) -> dict:
    with connection.cursor() as cursor:
        cursor.execute(GIVER_SIDES)
        sides = {int(quest): side for quest, side in cursor.fetchall()}
        cursor.execute(RACE_GATES)
        gates = {int(entry): int(mask) for entry, mask in cursor.fetchall()}

    for entry, mask in gates.items():
        side = side_from_races(mask)
        if side != "shared":
            sides[entry] = side

    return {quest: side for quest, side in sorted(sides.items()) if side != "shared"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=DEFAULT_OUT)
    args = parser.parse_args()

    factions = export(make_connection())
    document = {
        "source": "vmangos world DB: questgiver faction templates, and RequiredRaces where set",
        "sides": {str(quest): side for quest, side in factions.items()},
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(document, f, indent=1, sort_keys=True)
        f.write("\n")

    counts = {}
    for side in factions.values():
        counts[side] = counts.get(side, 0) + 1
    print(f"wrote {args.out}: " + ", ".join(f"{n} {side}" for side, n in sorted(counts.items()))
          + ", everything else shared")
