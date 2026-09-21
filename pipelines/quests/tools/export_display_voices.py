"""
Which model and voice set every NPC appearance uses, from a local game client.

The web app resolves an NPC from the appearance ids in the client's creature cache
(/contributions/game-data). An appearance id means nothing on its own: CreatureDisplayInfo
names its model and its NPCSounds voice set, and both live only in the client. This reads
them out of the install and writes the one table the app needs:

    { "<display id>": [model file id, NPCSounds id, "race-gender-flavor" or null] }

The voice name is recovered the way tts_cli/flavors.py recovers it: from the voice set's
greeting files, named like sound/creature/taurenmalewarriornpc/... in the community
listfile. A set the listfile has not named yet (the Skybourne elves') gets null, and the app
matches it by id against the roster, which names such sets by id.

Only appearances that could voice anything are kept: a character model, or a voice set.

Usage:
    curl -sL https://github.com/wowdev/wow-listfile/releases/latest/download/community-listfile.csv \\
        -o /tmp/listfile.csv
    python tools/export_display_voices.py --listfile /tmp/listfile.csv
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

try:
    from tools.wow_client import Client
except ImportError:  # run as a script from pipelines/quests
    from wow_client import Client

REPO_ROOT = Path(__file__).resolve().parents[3]
WEB_NPC = REPO_ROOT / "apps" / "web" / "src" / "lib" / "npc"
DEFAULT_OUT = WEB_NPC / "display-voices.json"

# The race tokens the sound files use, as the corpus names the race. Same idea as
# RACE_TO_SLOT in tts_cli/flavors.py, lower-cased because file paths are.
SOUND_RACES = {
    "human": "human", "dwarf": "dwarf", "nightelf": "nightelf", "gnome": "gnome", "orc": "orc",
    "troll": "troll", "tauren": "tauren", "undead": "scourge", "scourge": "scourge",
    "goblin": "goblin", "bloodelf": "bloodelf", "draenei": "draenei",
}
# `taurenmalewarriornpc` on the older sets, `npcbloodelfmalemilitary` on the later ones; the
# `npc` is stripped first so it can never be read as the flavor.
SET_DIR = re.compile(
    r"^(?P<race>" + "|".join(SOUND_RACES) + r")(?P<gender>male|female)(?P<flavor>[a-z]+?)(?:vendor)?$"
)


def voice_from_dir(directory: str) -> str | None:
    bare = directory[3:] if directory.startswith("npc") else directory.removesuffix("npc")
    match = SET_DIR.match(bare)
    if not match or not match.group("flavor"):
        return None
    return f"{SOUND_RACES[match.group('race')]}-{match.group('gender')}-{match.group('flavor')}"


def sound_dirs(listfile: Path, wanted: set[int]) -> dict[int, str]:
    """The sound/creature/<dir> of each wanted file, from the listfile."""
    out = {}
    with listfile.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            if ";sound/creature/" not in line:
                continue
            fid, _, path = line.partition(";")
            if int(fid) in wanted:
                out[int(fid)] = path.strip().split("/")[2]
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--product", default="wow_classic_beta", help="Product in .build.info")
    parser.add_argument("--listfile", type=Path, required=True, help="community-listfile.csv")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    client = Client(args.product)
    displays = client.table("CreatureDisplayInfo")
    models = client.table("CreatureModelData")
    sounds = client.table("NPCSounds")
    kits: dict[int, list[int]] = {}
    for entry in client.table("SoundKitEntry").values():
        kits.setdefault(entry["SoundKitID"], []).append(entry["FileDataID"])
    character_models = {int(k) for k in json.loads((WEB_NPC / "character-models.json").read_text())}

    def sound_set(value: int) -> int:
        # This client stores the NPCSounds reference with 0x20000 added; the plain value on
        # the ones that do not.
        if value and value not in sounds and value - 0x20000 in sounds:
            return value - 0x20000
        return value if value in sounds else 0

    # A voice set's name, from the directory most of its greeting files sit in.
    greetings = {sid: kits.get(row["SoundID"][0], []) for sid, row in sounds.items()}
    dirs = sound_dirs(args.listfile, {f for files in greetings.values() for f in files})
    names = {}
    for sid, files in greetings.items():
        voices = Counter(voice_from_dir(dirs[f]) for f in files if f in dirs)
        voices.pop(None, None)
        names[sid] = voices.most_common(1)[0][0] if voices else None

    table = {}
    for display_id, row in sorted(displays.items()):
        model = models.get(row["ModelID"], {}).get("FileDataID", 0)
        sid = sound_set(row["NPCSoundID"])
        if model in character_models or sid:
            table[str(display_id)] = [model, sid, names.get(sid)]

    args.out.write_text(json.dumps(table, separators=(",", ":")) + "\n", encoding="utf-8")
    named = sum(1 for v in table.values() if v[2])
    print(f"{client.version}: {len(table)} appearances, {named} with a named voice set -> {args.out}")


if __name__ == "__main__":
    main()
