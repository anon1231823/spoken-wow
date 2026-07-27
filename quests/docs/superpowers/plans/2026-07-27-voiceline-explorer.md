# Voiceline Explorer Implementation Plan

> **STATUS: partly superseded.** Tasks 1-3 are done, differently: line naming landed as
> `tts_cli/naming.py` (as planned) but the index became a committed corpus,
> `corpus/corpus.json.gz`, built by `tts_cli/corpus.py` rather than `tts_cli/index_export.py`.
> `tools/audit_npc.py` has not yet been repointed at it.
>
> Tasks 4-9 — the Next.js app, search API, audio route, triage store and reports — are
> still wanted and still accurate in shape. Substitute "corpus" for "index" throughout, and
> note the corpus deliberately carries no `hasAudio`/`durationSec`: audio presence is a
> property of the audio store (`tts_cli/store.py`), so `missing_lines()` answers it.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app to search, audition, and triage the ~9,500 generated voicelines without logging into WoW.

**Architecture:** Python exports a frozen `index.json` from the vmangos MySQL DB (build-time only) and owns all filename/hash derivation. Next.js loads that index server-side, exposes a search API, streams mp3s from the installed sound pack, and persists triage marks to a JSON file.

**Tech Stack:** Python 3.11 (pandas, PyMySQL, mutagen, pytest), Next.js App Router + TypeScript + React, pnpm.

Spec: `docs/superpowers/specs/2026-07-27-voiceline-explorer-design.md`

## Global Constraints

- Python is 3.11 via `.venv` at repo root. Always invoke as `./.venv/bin/python`, never bare `python` (system python is 3.9 and cannot run this code).
- **Never regenerate lookup tables.** The installed pack is an older data-module format (`gossip_file_lookups.lua`, no object/item tables). This plan is read-only against the pack regardless.
- **Filename derivation lives only in `tts_cli/naming.py`.** No TypeScript may construct a filename. Gossip names are `md5(original_text + race + gender)`; a one-character difference produces a file the addon can never find, and it fails silently.
- Sound pack location comes from `VOICEOVER_SOUNDS_DIR`, defaulting to `/Applications/World of Warcraft/_classic_era_/Interface/AddOns/AI_VoiceOverData_Vanilla/generated/sounds`.
- `id` from pandas is numpy `int64` and is not JSON-serializable — coerce with `int()`.
- `quest` is a **string** (`'5'`), empty `''` for gossip. `player_gender` is `None`, `'m'`, or `'f'`.
- Committed: `tts_cli/`, `web/` source, `docs/`. Gitignored: `web/data/`, `var/`, `web/node_modules`, `web/.next`.
- Branch: `feat/voiceline-explorer`.

---

### Task 1: Naming module — single source of truth for line identity

**Files:**
- Create: `tts_cli/naming.py`
- Create: `tests/test_naming.py`
- Create: `requirements-dev.txt`

**Interfaces:**
- Consumes: nothing.
- Produces: `filename_for_row(row) -> str`, `line_id_for_row(row) -> str`, `filename_from_line_id(line_id: str) -> str`, `subfolder_from_line_id(line_id: str) -> str`. `row` is any mapping with keys `quest`, `source`, `templateText_race_gender_hash`, `player_gender`.

- [ ] **Step 1: Add dev dependencies**

Create `requirements-dev.txt`:

```
-r requirements.txt
pytest==8.3.4
```

Install: `./.venv/bin/python -m pip install -r requirements-dev.txt`

- [ ] **Step 2: Write the failing test**

Create `tests/test_naming.py`:

```python
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `./.venv/bin/python -m pytest tests/test_naming.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts_cli.naming'`

- [ ] **Step 4: Write the implementation**

Create `tts_cli/naming.py`:

```python
"""Single source of truth for voiceline file naming and identity.

Filenames are load-bearing: the addon resolves a sound by looking its filename up in
SoundLengthLookupByFileName, so a name that differs by one character silently plays
nothing. Every filename in this project is derived here and nowhere else.

    quest lines   {questID}-{accept|complete}      optional m-/f- prefix
    gossip lines  md5(original_text+race+gender)   optional m-/f- prefix

lineId is a stable handle used by the web app and triage state. It is deliberately not
the filename, so triage marks survive a naming change.

    q:{questID}:{source}[:{m|f}]
    g:{hash}[:{m|f}]
"""


def filename_for_row(row) -> str:
    """Filename (without extension) the generator would produce for a dataframe row."""
    base = f'{row["quest"]}-{row["source"]}' if row["quest"] else row["templateText_race_gender_hash"]
    if row["player_gender"]:
        base = f'{row["player_gender"]}-{base}'
    return base


def line_id_for_row(row) -> str:
    """Stable identity for a dataframe row."""
    if row["quest"]:
        parts = ["q", str(row["quest"]), row["source"]]
    else:
        parts = ["g", row["templateText_race_gender_hash"]]
    if row["player_gender"]:
        parts.append(row["player_gender"])
    return ":".join(parts)


def filename_from_line_id(line_id: str) -> str:
    """Inverse of line_id_for_row, as far as the filename is concerned."""
    kind, *rest = line_id.split(":")
    if kind == "q":
        quest, source, *gender = rest
        base = f"{quest}-{source}"
    elif kind == "g":
        hash_, *gender = rest
        base = hash_
    else:
        raise ValueError(f"unknown lineId kind {kind!r} in {line_id!r}")
    if gender:
        base = f"{gender[0]}-{base}"
    return base


def subfolder_from_line_id(line_id: str) -> str:
    """Which sounds/ subdirectory a line lives in."""
    kind = line_id.split(":", 1)[0]
    if kind == "q":
        return "quests"
    if kind == "g":
        return "gossip"
    raise ValueError(f"unknown lineId kind {kind!r} in {line_id!r}")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./.venv/bin/python -m pytest tests/test_naming.py -v`
Expected: PASS, 8 passed

- [ ] **Step 6: Commit**

```bash
git add requirements-dev.txt tts_cli/naming.py tests/test_naming.py
git commit -m "Add naming module as single source of truth for line identity"
```

---

### Task 2: Index exporter

**Files:**
- Create: `tts_cli/index_export.py`
- Create: `tests/test_index_export.py`
- Modify: `cli-main.py` (add `export-index` subcommand)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `tts_cli.naming` (Task 1); existing `query_dataframe_for_all_quests_and_gossip(lang)` from `tts_cli/sql_queries.py` and `TTSProcessor.preprocess_dataframe(df)` from `tts_cli/tts_utils.py`.
- Produces: `build_index(df, sounds_dir) -> dict`, `write_index(path, index) -> None`, `sounds_dir() -> str`, and the file `web/data/index.json`.

Index schema (`schemaVersion: 1`):

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-27T12:00:00Z",
  "soundsDir": "/Applications/.../sounds",
  "lines": [{
    "lineId": "q:5:accept", "source": "accept",
    "questId": 5, "questTitle": "Jitters' Growling Gut",
    "npcId": 288, "npcName": "Jitters", "npcType": "creature",
    "voice": "human-male", "race": "human", "gender": "male",
    "playerGender": null,
    "text": "Ye can't be serious...",
    "fileName": "5-accept", "hasAudio": true, "durationSec": 12.34,
    "generatable": true, "skipReason": null
  }]
}
```

`generatable` is false with `skipReason` `"progress"` (never synthesized, see `tts_utils.py:183`) or `"invalid-chars"` (text still contains `$`, `<` or `>` after preprocessing, see `tts_utils.py:179`).

- [ ] **Step 1: Write the failing test**

Create `tests/test_index_export.py`:

```python
import os

import pandas as pd

from tts_cli.index_export import build_index

ROWS = [
    # generatable quest line, audio present
    {"quest": "5", "source": "accept", "quest_title": "Growling Gut", "name": "Jitters",
     "type": "creature", "id": 288, "race": "human", "gender": "male",
     "voice_name": "human-male", "player_gender": None, "cleanedText": "Hello there.",
     "templateText_race_gender_hash": "deadbeef"},
    # progress line, never generated
    {"quest": "7", "source": "progress", "quest_title": "Growling Gut", "name": "Jitters",
     "type": "creature", "id": 288, "race": "human", "gender": "male",
     "voice_name": "human-male", "player_gender": None, "cleanedText": "Still waiting.",
     "templateText_race_gender_hash": "deadbeef"},
    # unresolved token, skipped by the generator
    {"quest": "9", "source": "accept", "quest_title": "Broken", "name": "Jitters",
     "type": "creature", "id": 288, "race": "human", "gender": "male",
     "voice_name": "human-male", "player_gender": None, "cleanedText": "Hi $N.",
     "templateText_race_gender_hash": "deadbeef"},
    # gossip line, audio absent
    {"quest": "", "source": "gossip", "quest_title": "", "name": "Guard",
     "type": "creature", "id": 68, "race": "human", "gender": "male",
     "voice_name": "human-male", "player_gender": None, "cleanedText": "Move along.",
     "templateText_race_gender_hash": "abc123"},
]


def _sounds(tmp_path):
    for sub in ("quests", "gossip"):
        os.makedirs(tmp_path / sub)
    (tmp_path / "quests" / "5-accept.mp3").write_bytes(b"")
    return str(tmp_path)


def test_line_ids_and_shape(tmp_path):
    index = build_index(pd.DataFrame(ROWS), _sounds(tmp_path))
    assert index["schemaVersion"] == 1
    ids = [line["lineId"] for line in index["lines"]]
    assert ids == ["q:5:accept", "q:7:progress", "q:9:accept", "g:abc123"]


def test_has_audio_reflects_disk(tmp_path):
    index = build_index(pd.DataFrame(ROWS), _sounds(tmp_path))
    by_id = {line["lineId"]: line for line in index["lines"]}
    assert by_id["q:5:accept"]["hasAudio"] is True
    assert by_id["g:abc123"]["hasAudio"] is False


def test_generatable_flags(tmp_path):
    index = build_index(pd.DataFrame(ROWS), _sounds(tmp_path))
    by_id = {line["lineId"]: line for line in index["lines"]}
    assert by_id["q:5:accept"]["generatable"] is True
    assert by_id["q:5:accept"]["skipReason"] is None
    assert by_id["q:7:progress"]["generatable"] is False
    assert by_id["q:7:progress"]["skipReason"] == "progress"
    assert by_id["q:9:accept"]["generatable"] is False
    assert by_id["q:9:accept"]["skipReason"] == "invalid-chars"


def test_ids_are_json_serializable(tmp_path):
    import json
    index = build_index(pd.DataFrame(ROWS), _sounds(tmp_path))
    json.dumps(index)  # numpy int64 would raise here
    assert isinstance(index["lines"][0]["npcId"], int)


def test_gossip_lines_have_no_quest_id(tmp_path):
    index = build_index(pd.DataFrame(ROWS), _sounds(tmp_path))
    gossip = [line for line in index["lines"] if line["lineId"].startswith("g:")][0]
    assert gossip["questId"] is None
    assert gossip["questTitle"] is None


def test_records_audio_counts_for_drift_detection(tmp_path):
    index = build_index(pd.DataFrame(ROWS), _sounds(tmp_path))
    assert index["audioCounts"] == {"quests": 1, "gossip": 0}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/python -m pytest tests/test_index_export.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts_cli.index_export'`

- [ ] **Step 3: Write the implementation**

Create `tts_cli/index_export.py`:

```python
"""Export a frozen index of every voiceline for the web explorer.

MySQL is a build-time dependency only: once this index exists, neither browsing nor
generating needs the database, because the index carries the text and voice.
"""
import json
import os
from datetime import datetime, timezone

import mutagen.mp3

from tts_cli.naming import filename_for_row, line_id_for_row, subfolder_from_line_id

SCHEMA_VERSION = 1
DEFAULT_SOUNDS_DIR = ("/Applications/World of Warcraft/_classic_era_/Interface/AddOns"
                      "/AI_VoiceOverData_Vanilla/generated/sounds")
DEFAULT_INDEX_PATH = "web/data/index.json"
INVALID_CHARS = "$<>"


def sounds_dir() -> str:
    return os.environ.get("VOICEOVER_SOUNDS_DIR", DEFAULT_SOUNDS_DIR)


def _skip_reason(row):
    """Why the generator would not synthesize this row, or None."""
    if row["source"] == "progress":
        return "progress"
    if any(c in row["cleanedText"] for c in INVALID_CHARS):
        return "invalid-chars"
    return None


def _duration(path):
    try:
        return round(mutagen.mp3.MP3(path).info.length, 3)
    except Exception:
        return None


def build_index(df, sounds_directory: str) -> dict:
    lines = []
    for row in df.to_dict("records"):
        line_id = line_id_for_row(row)
        file_name = filename_for_row(row)
        path = os.path.join(sounds_directory, subfolder_from_line_id(line_id),
                            file_name + ".mp3")
        has_audio = os.path.isfile(path)
        reason = _skip_reason(row)
        lines.append({
            "lineId": line_id,
            "source": row["source"],
            "questId": int(row["quest"]) if row["quest"] else None,
            "questTitle": row["quest_title"] or None,
            "npcId": int(row["id"]),
            "npcName": row["name"],
            "npcType": row["type"],
            "voice": row["voice_name"],
            "race": row["race"],
            "gender": row["gender"],
            "playerGender": row["player_gender"],
            "text": row["cleanedText"],
            "fileName": file_name,
            "hasAudio": has_audio,
            "durationSec": _duration(path) if has_audio else None,
            "generatable": reason is None,
            "skipReason": reason,
        })
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "soundsDir": sounds_directory,
        # Recorded so the app can detect the pack drifting away from the index.
        "audioCounts": count_audio_files(sounds_directory),
        "lines": lines,
    }


def count_audio_files(sounds_directory: str) -> dict:
    """How many mp3s are in the pack right now, per subfolder."""
    counts = {}
    for sub in ("quests", "gossip"):
        directory = os.path.join(sounds_directory, sub)
        counts[sub] = (
            sum(1 for f in os.listdir(directory) if f.endswith(".mp3"))
            if os.path.isdir(directory) else 0
        )
    return counts


def write_index(path: str, index: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False)


def export(path: str = DEFAULT_INDEX_PATH) -> dict:
    """Query the world DB, preprocess, and write the index. Returns the index."""
    from tts_cli.sql_queries import query_dataframe_for_all_quests_and_gossip
    from tts_cli.tts_utils import TTSProcessor

    df = query_dataframe_for_all_quests_and_gossip(0)
    # preprocess_dataframe only uses self for handle_gender_options, so skip __init__
    # and avoid requiring an ElevenLabs key just to build the index.
    df = TTSProcessor.preprocess_dataframe(TTSProcessor.__new__(TTSProcessor), df)
    index = build_index(df, sounds_dir())
    write_index(path, index)
    return index
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/bin/python -m pytest tests/test_index_export.py -v`
Expected: PASS, 5 passed

- [ ] **Step 5: Wire up the CLI subcommand**

In `cli-main.py`, add to the subparsers block (after the `gen_lookup_tables` parser):

```python
subparsers.add_parser("export-index", help="Export web/data/index.json for the explorer app.")
```

And add to the dispatch chain, before the final `else`:

```python
elif args.mode == "export-index":
    from tts_cli.index_export import export, DEFAULT_INDEX_PATH
    index = export()
    print(f"Wrote {len(index['lines'])} lines to {DEFAULT_INDEX_PATH}")
```

- [ ] **Step 6: Add gitignore entries**

Append to `.gitignore`:

```
web/data
web/node_modules
web/.next
var/
```

- [ ] **Step 7: Run the real export and verify against known reconciliation numbers**

Run:
```bash
docker compose up -d
./.venv/bin/python cli-main.py export-index
```
Expected: `Wrote 17507 lines to web/data/index.json`

Verify the counts match the pack (6558 quest mp3s, 2997 gossip mp3s installed):
```bash
./.venv/bin/python -c "
import json
idx = json.load(open('web/data/index.json'))
lines = idx['lines']
q = [l for l in lines if l['lineId'].startswith('q:') and l['hasAudio']]
g = [l for l in lines if l['lineId'].startswith('g:') and l['hasAudio']]
print('quest with audio:', len(q), 'expect 6438')
print('gossip with audio:', len(g), 'expect 2970')
assert len(q) == 6438, len(q)
assert len(g) == 2970, len(g)
print('OK')
"
```
Expected: `OK`. These are the exact reconciliation figures measured during environment validation; a mismatch means the index disagrees with the installed pack.

- [ ] **Step 8: Commit**

```bash
git add tts_cli/index_export.py tests/test_index_export.py cli-main.py .gitignore
git commit -m "Add export-index command producing a frozen line index"
```

---

### Task 3: Point audit_npc.py at the index

**Files:**
- Modify: `tools/audit_npc.py`
- Create: `tests/test_audit_npc.py`

**Interfaces:**
- Consumes: `web/data/index.json` (Task 2), `tts_cli.naming` (Task 1).
- Produces: `load_index(path) -> dict`, `find_npcs(index, needle) -> list`, `lines_for_npc(index, npc) -> list`.

Removes the duplicated `expected_filename`/`path_for` logic so the CLI and web app cannot disagree about what a line is.

- [ ] **Step 1: Write the failing test**

Create `tests/test_audit_npc.py`:

```python
import json

import pytest

from tools.audit_npc import find_npcs, lines_for_npc

INDEX = {
    "schemaVersion": 1,
    "soundsDir": "/tmp/sounds",
    "lines": [
        {"lineId": "q:5:accept", "npcId": 288, "npcName": "Jitters", "voice": "human-male",
         "source": "accept", "hasAudio": True, "text": "Hi", "questTitle": "Gut",
         "fileName": "5-accept", "durationSec": 1.0, "generatable": True},
        {"lineId": "g:abc123", "npcId": 288, "npcName": "Jitters", "voice": "human-male",
         "source": "gossip", "hasAudio": False, "text": "Bye", "questTitle": None,
         "fileName": "abc123", "durationSec": None, "generatable": True},
        {"lineId": "q:9:accept", "npcId": 68, "npcName": "Guard", "voice": "human-male",
         "source": "accept", "hasAudio": True, "text": "Halt", "questTitle": "Watch",
         "fileName": "9-accept", "durationSec": 2.0, "generatable": True},
    ],
}


def test_find_npcs_is_case_insensitive_substring():
    hits = find_npcs(INDEX, "jitt")
    assert [n["npcId"] for n in hits] == [288]
    assert hits[0]["npcName"] == "Jitters"


def test_find_npcs_deduplicates():
    assert len(find_npcs(INDEX, "Jitters")) == 1


def test_lines_for_npc_by_id():
    lines = lines_for_npc(INDEX, "288")
    assert {l["lineId"] for l in lines} == {"q:5:accept", "g:abc123"}


def test_lines_for_npc_by_name():
    lines = lines_for_npc(INDEX, "jitters")
    assert len(lines) == 2


def test_lines_for_unknown_npc_is_empty():
    assert lines_for_npc(INDEX, "nobody") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/python -m pytest tests/test_audit_npc.py -v`
Expected: FAIL with `ImportError: cannot import name 'find_npcs'`

- [ ] **Step 3: Rewrite audit_npc.py against the index**

Replace the whole of `tools/audit_npc.py` with:

```python
"""Inspect and play the generated voicelines for a given NPC, out of game.

Generated filenames are keyed by quest ID or text hash, never by NPC, so there is no way
to group an NPC's lines from the filesystem alone. This reads the exported index, which
reconstructs that view.

    ./.venv/bin/python cli-main.py export-index    # build the index first

    python tools/audit_npc.py --find dughan            # search NPCs by name
    python tools/audit_npc.py --npc 240                # list that NPC's lines
    python tools/audit_npc.py --npc "Marshal Dughan"   # by exact name
    python tools/audit_npc.py --npc 240 --play         # ...and play them in order
    python tools/audit_npc.py --voice human-male --limit 20 --play
"""
import argparse
import json
import os
import subprocess
import sys
import textwrap

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tts_cli.index_export import DEFAULT_INDEX_PATH
from tts_cli.naming import subfolder_from_line_id


def load_index(path: str = DEFAULT_INDEX_PATH) -> dict:
    if not os.path.isfile(path):
        sys.exit(f"No index at {path}. Run: ./.venv/bin/python cli-main.py export-index")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def find_npcs(index: dict, needle: str) -> list:
    seen, out = set(), []
    for line in index["lines"]:
        if needle.lower() in line["npcName"].lower() and line["npcId"] not in seen:
            seen.add(line["npcId"])
            out.append(line)
    return out


def lines_for_npc(index: dict, npc: str) -> list:
    if npc.isdigit():
        return [l for l in index["lines"] if l["npcId"] == int(npc)]
    return [l for l in index["lines"] if l["npcName"].lower() == npc.lower()]


def path_for(index: dict, line: dict) -> str:
    return os.path.join(index["soundsDir"], subfolder_from_line_id(line["lineId"]),
                        line["fileName"] + ".mp3")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--npc", help="NPC id, or exact NPC name")
    p.add_argument("--find", help="substring search over NPC names")
    p.add_argument("--voice", help="filter by voice, e.g. human-male")
    p.add_argument("--play", action="store_true", help="play each existing line via afplay")
    p.add_argument("--missing", action="store_true", help="only show lines with no audio")
    p.add_argument("--limit", type=int, help="cap number of lines shown")
    args = p.parse_args()

    index = load_index()

    if args.find:
        hits = find_npcs(index, args.find)
        print(f"{'id':>8}  {'name':<34}{'voice'}")
        print("-" * 62)
        for r in hits:
            print(f"{r['npcId']:>8}  {r['npcName']:<34}{r['voice']}")
        print(f"\n{len(hits)} NPC(s)")
        return

    if not args.npc and not args.voice:
        p.error("give --npc, --voice, or --find")

    rows = lines_for_npc(index, args.npc) if args.npc else list(index["lines"])
    if args.voice:
        rows = [l for l in rows if l["voice"] == args.voice]
    rows = [l for l in rows if l["generatable"]]
    if not rows:
        print("no generatable lines found")
        return

    rows.sort(key=lambda l: (l["npcName"], l["source"], l["lineId"]))

    names = {l["npcName"] for l in rows}
    header = next(iter(names)) if len(names) == 1 else f"{len(names)} NPCs"
    voices = sorted({l["voice"] for l in rows})
    print(f"\n{header}   voice(s): {', '.join(voices)}")
    if len(voices) > 1:
        print("  NOTE: more than one voice across these lines")
    print("=" * 78)

    shown = present = 0
    for line in rows:
        if args.limit and shown >= args.limit:
            break
        if args.missing and line["hasAudio"]:
            continue
        shown += 1
        present += line["hasAudio"]
        tag = line["source"] if line["questId"] is None else f'{line["source"]} q{line["questId"]}'
        mark = f'{line["durationSec"]:5.1f}s' if line["durationSec"] else (
            "  --  " if line["hasAudio"] else "MISSING")
        title = f'  [{line["questTitle"]}]' if line["questTitle"] else ""
        print(f"\n{mark}  {tag}{title}")
        print(f'        {line["fileName"]}.mp3')
        for wrapped in textwrap.wrap(" ".join(line["text"].split()), 68)[:4]:
            print(f"        | {wrapped}")
        if line["hasAudio"] and args.play:
            print("        playing ...", flush=True)
            subprocess.run(["afplay", path_for(index, line)])

    print("\n" + "=" * 78)
    print(f"{shown} line(s), {present} with audio present")
    if not args.play and present:
        print("re-run with --play to listen in order")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/bin/python -m pytest tests/test_audit_npc.py -v`
Expected: PASS, 5 passed

If the import of `tools.audit_npc` fails, add an empty `tests/__init__.py` and `tools/__init__.py`.

- [ ] **Step 5: Verify against real data**

Run: `./.venv/bin/python tools/audit_npc.py --npc 240`
Expected: `Marshal Dughan   voice(s): human-male`, ending in `16 line(s), 15 with audio present` — identical to the pre-refactor output.

- [ ] **Step 6: Commit**

```bash
git add tools/audit_npc.py tests/test_audit_npc.py
git commit -m "Read audit_npc from the exported index instead of MySQL"
```

---

### Task 4: Next.js scaffold, index loading, and search API

**Files:**
- Create: `web/` (scaffold), `web/lib/index.ts`, `web/lib/types.ts`, `web/app/api/search/route.ts`
- Create: `web/lib/__tests__/search.test.ts`

**Interfaces:**
- Consumes: `web/data/index.json` (Task 2).
- Produces: `loadIndex(): VoiceIndex`, `searchLines(index, query): SearchResult`, types `Line`, `VoiceIndex`, `SearchQuery`, `SearchResult`. `GET /api/search?npc=&quest=&voice=&text=&missing=&limit=&offset=`.

- [ ] **Step 1: Scaffold the app**

```bash
cd web 2>/dev/null || pnpm create next-app@latest web --ts --app --eslint --no-tailwind --no-src-dir --import-alias "@/*" --use-pnpm
cd web && pnpm add -D vitest
```

Add to `web/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing test**

Create `web/lib/__tests__/search.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { searchLines } from "../index";
import type { VoiceIndex } from "../types";

const INDEX: VoiceIndex = {
  schemaVersion: 1,
  generatedAt: "2026-07-27T00:00:00Z",
  soundsDir: "/tmp/sounds",
  lines: [
    { lineId: "q:5:accept", source: "accept", questId: 5, questTitle: "Growling Gut",
      npcId: 288, npcName: "Jitters", npcType: "creature", voice: "human-male",
      race: "human", gender: "male", playerGender: null, text: "Hello there.",
      fileName: "5-accept", hasAudio: true, durationSec: 1, generatable: true, skipReason: null },
    { lineId: "g:abc123", source: "gossip", questId: null, questTitle: null,
      npcId: 288, npcName: "Jitters", npcType: "creature", voice: "human-male",
      race: "human", gender: "male", playerGender: null, text: "Move along.",
      fileName: "abc123", hasAudio: false, durationSec: null, generatable: true, skipReason: null },
    { lineId: "q:9:accept", source: "accept", questId: 9, questTitle: "The Watch",
      npcId: 68, npcName: "Stormwind Guard", npcType: "creature", voice: "dwarf-male",
      race: "dwarf", gender: "male", playerGender: null, text: "Halt!",
      fileName: "9-accept", hasAudio: true, durationSec: 2, generatable: true, skipReason: null },
  ],
};

describe("searchLines", () => {
  it("finds by npc name substring, case insensitive", () => {
    expect(searchLines(INDEX, { npc: "jitt" }).total).toBe(2);
  });

  it("finds by npc id", () => {
    expect(searchLines(INDEX, { npc: "68" }).total).toBe(1);
  });

  it("finds by quest id", () => {
    const r = searchLines(INDEX, { quest: "9" });
    expect(r.lines[0].lineId).toBe("q:9:accept");
  });

  it("finds by quest title substring", () => {
    expect(searchLines(INDEX, { quest: "watch" }).total).toBe(1);
  });

  it("filters by voice", () => {
    expect(searchLines(INDEX, { voice: "dwarf-male" }).total).toBe(1);
  });

  it("searches spoken text", () => {
    expect(searchLines(INDEX, { text: "halt" }).total).toBe(1);
  });

  it("filters to lines missing audio", () => {
    const r = searchLines(INDEX, { missing: true });
    expect(r.lines.map((l) => l.lineId)).toEqual(["g:abc123"]);
  });

  it("combines filters with AND", () => {
    expect(searchLines(INDEX, { npc: "jitters", voice: "dwarf-male" }).total).toBe(0);
  });

  it("paginates and reports the untruncated total", () => {
    const r = searchLines(INDEX, { limit: 1, offset: 1 });
    expect(r.total).toBe(3);
    expect(r.lines).toHaveLength(1);
  });

  it("returns everything when the query is empty", () => {
    expect(searchLines(INDEX, {}).total).toBe(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && pnpm test`
Expected: FAIL, cannot resolve `../index`

- [ ] **Step 4: Write types and search**

Create `web/lib/types.ts`:

```typescript
export type Source = "accept" | "progress" | "complete" | "gossip";
export type SkipReason = "progress" | "invalid-chars" | null;

export interface Line {
  lineId: string;
  source: Source;
  questId: number | null;
  questTitle: string | null;
  npcId: number;
  npcName: string;
  npcType: string;
  voice: string;
  race: string;
  gender: string;
  playerGender: "m" | "f" | null;
  text: string;
  fileName: string;
  hasAudio: boolean;
  durationSec: number | null;
  generatable: boolean;
  skipReason: SkipReason;
}

export interface VoiceIndex {
  schemaVersion: number;
  generatedAt: string;
  soundsDir: string;
  lines: Line[];
}

export interface SearchQuery {
  npc?: string;
  quest?: string;
  voice?: string;
  text?: string;
  missing?: boolean;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  total: number;
  lines: Line[];
}
```

Create `web/lib/index.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import type { SearchQuery, SearchResult, VoiceIndex } from "./types";

const INDEX_PATH = process.env.VOICEOVER_INDEX_PATH
  ?? path.join(process.cwd(), "data", "index.json");

let cached: VoiceIndex | null = null;

/** Load the exported index once per server process. */
export function loadIndex(): VoiceIndex {
  if (cached) return cached;
  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error(
      `No index at ${INDEX_PATH}. Run: ./.venv/bin/python cli-main.py export-index`,
    );
  }
  cached = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8")) as VoiceIndex;
  return cached;
}

const has = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.toLowerCase());

export function searchLines(index: VoiceIndex, query: SearchQuery): SearchResult {
  const { npc, quest, voice, text, missing, limit = 100, offset = 0 } = query;

  const matched = index.lines.filter((line) => {
    if (npc) {
      const byId = /^\d+$/.test(npc) && line.npcId === Number(npc);
      if (!byId && !has(line.npcName, npc)) return false;
    }
    if (quest) {
      const byId = /^\d+$/.test(quest) && line.questId === Number(quest);
      const byTitle = line.questTitle !== null && has(line.questTitle, quest);
      if (!byId && !byTitle) return false;
    }
    if (voice && line.voice !== voice) return false;
    if (text && !has(line.text, text)) return false;
    if (missing && line.hasAudio) return false;
    return true;
  });

  return { total: matched.length, lines: matched.slice(offset, offset + limit) };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && pnpm test`
Expected: PASS, 10 passed

- [ ] **Step 6: Add the search route**

Create `web/app/api/search/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { loadIndex, searchLines } from "@/lib/index";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const num = (key: string) => {
    const raw = params.get(key);
    return raw === null ? undefined : Number(raw);
  };
  try {
    return NextResponse.json(
      searchLines(loadIndex(), {
        npc: params.get("npc") ?? undefined,
        quest: params.get("quest") ?? undefined,
        voice: params.get("voice") ?? undefined,
        text: params.get("text") ?? undefined,
        missing: params.get("missing") === "true",
        limit: num("limit"),
        offset: num("offset"),
      }),
    );
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 });
  }
}
```

- [ ] **Step 7: Verify against real data**

Run `cd web && pnpm dev`, then:
```bash
curl -s 'http://localhost:3000/api/search?npc=240' | ./.venv/bin/python -c "
import json,sys; d=json.load(sys.stdin); print('total', d['total'])"
```
Expected: `total 16`

- [ ] **Step 8: Commit**

```bash
git add web/ && git commit -m "Add Next.js app with index loading and search API"
```

---

### Task 5: Audio streaming API

**Files:**
- Create: `web/app/api/audio/[lineId]/route.ts`, `web/lib/audio.ts`
- Create: `web/lib/__tests__/audio.test.ts`

**Interfaces:**
- Consumes: `loadIndex` (Task 4), index `soundsDir` and `fileName`.
- Produces: `resolveAudioPath(index, lineId, variant): string | null` where `variant` is `"live" | "staged"`. `GET /api/audio/{lineId}?variant=live|staged`.

`staged` resolves into `var/staging/` and is unused until the generation plan, but the route supports it now so the A/B player needs no change later.

- [ ] **Step 1: Write the failing test**

Create `web/lib/__tests__/audio.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveAudioPath } from "../audio";
import type { VoiceIndex } from "../types";

const INDEX = {
  schemaVersion: 1, generatedAt: "", soundsDir: "/tmp/sounds",
  lines: [
    { lineId: "q:5:accept", fileName: "5-accept", hasAudio: true },
    { lineId: "g:abc123", fileName: "abc123", hasAudio: true },
  ],
} as unknown as VoiceIndex;

describe("resolveAudioPath", () => {
  it("puts quest lines under quests/", () => {
    expect(resolveAudioPath(INDEX, "q:5:accept", "live"))
      .toBe("/tmp/sounds/quests/5-accept.mp3");
  });

  it("puts gossip lines under gossip/", () => {
    expect(resolveAudioPath(INDEX, "g:abc123", "live"))
      .toBe("/tmp/sounds/gossip/abc123.mp3");
  });

  it("resolves staged variants outside the pack", () => {
    expect(resolveAudioPath(INDEX, "q:5:accept", "staged"))
      .toMatch(/var\/staging\/q_5_accept\.mp3$/);
  });

  it("returns null for an unknown lineId", () => {
    expect(resolveAudioPath(INDEX, "q:404:accept", "live")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test`
Expected: FAIL, cannot resolve `../audio`

- [ ] **Step 3: Write the implementation**

Create `web/lib/audio.ts`:

```typescript
import path from "node:path";
import type { VoiceIndex } from "./types";

export type Variant = "live" | "staged";

const STAGING_DIR = process.env.VOICEOVER_STAGING_DIR
  ?? path.join(process.cwd(), "..", "var", "staging");

/** Staged files are named from the lineId, since ':' is not filename-safe. */
export const stagedFileName = (lineId: string) => `${lineId.replace(/:/g, "_")}.mp3`;

export function resolveAudioPath(
  index: VoiceIndex,
  lineId: string,
  variant: Variant,
): string | null {
  const line = index.lines.find((l) => l.lineId === lineId);
  if (!line) return null;
  if (variant === "staged") return path.join(STAGING_DIR, stagedFileName(lineId));
  const sub = lineId.startsWith("q:") ? "quests" : "gossip";
  return path.join(index.soundsDir, sub, `${line.fileName}.mp3`);
}
```

Create `web/app/api/audio/[lineId]/route.ts`:

```typescript
import fs from "node:fs";
import { NextResponse } from "next/server";
import { resolveAudioPath, type Variant } from "@/lib/audio";
import { loadIndex } from "@/lib/index";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ lineId: string }> },
) {
  const { lineId } = await params;
  const variant = (new URL(request.url).searchParams.get("variant") ?? "live") as Variant;

  const filePath = resolveAudioPath(loadIndex(), decodeURIComponent(lineId), variant);
  if (!filePath || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: "no audio for this line" }, { status: 404 });
  }
  const body = await fs.promises.readFile(filePath);
  return new NextResponse(body, {
    headers: { "Content-Type": "audio/mpeg", "Content-Length": String(body.length) },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test`
Expected: PASS, 4 passed in audio.test.ts

- [ ] **Step 5: Verify against real audio**

```bash
curl -s -o /tmp/line.mp3 -w '%{http_code} %{content_type}\n' \
  'http://localhost:3000/api/audio/q%3A123%3Acomplete'
afplay /tmp/line.mp3
```
Expected: `200 audio/mpeg`, and the clip opens with "Hm..." — the known pronunciation defect.

Missing audio returns 404:
```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/audio/q%3A999999%3Aaccept'
```
Expected: `404`

- [ ] **Step 6: Commit**

```bash
git add web/lib/audio.ts web/lib/__tests__/audio.test.ts web/app/api/audio
git commit -m "Add audio streaming API for live and staged variants"
```

---

### Task 6: Triage storage and API

**Files:**
- Create: `web/lib/triage.ts`, `web/app/api/triage/route.ts`
- Create: `web/lib/__tests__/triage.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond `lineId` strings.
- Produces: `readTriage(file): TriageMap`, `writeMark(file, lineId, mark): TriageMap`, `clearMark(file, lineId): TriageMap`, types `TriageCategory`, `TriageMark`, `TriageMap`. `GET /api/triage`, `POST /api/triage` (body `{lineId, category, note}`; `category: null` clears).

Categories: `wrong-voice`, `bad-pronunciation`, `bad-delivery`, `wrong-text`, `missing`.

- [ ] **Step 1: Write the failing test**

Create `web/lib/__tests__/triage.test.ts`:

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { clearMark, readTriage, writeMark } from "../triage";

let file: string;

beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "triage-")), "triage.json");
});

describe("triage store", () => {
  it("returns an empty map when the file does not exist", () => {
    expect(readTriage(file)).toEqual({});
  });

  it("persists a mark across reads", () => {
    writeMark(file, "q:5:accept", { category: "bad-pronunciation", note: "says H M" });
    expect(readTriage(file)["q:5:accept"].category).toBe("bad-pronunciation");
    expect(readTriage(file)["q:5:accept"].note).toBe("says H M");
  });

  it("records a timestamp", () => {
    writeMark(file, "q:5:accept", { category: "bad-delivery", note: "" });
    expect(readTriage(file)["q:5:accept"].markedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("overwrites an existing mark", () => {
    writeMark(file, "q:5:accept", { category: "bad-delivery", note: "a" });
    writeMark(file, "q:5:accept", { category: "wrong-voice", note: "b" });
    expect(readTriage(file)["q:5:accept"].category).toBe("wrong-voice");
  });

  it("keeps other marks when clearing one", () => {
    writeMark(file, "q:5:accept", { category: "bad-delivery", note: "" });
    writeMark(file, "g:abc123", { category: "wrong-text", note: "" });
    const after = clearMark(file, "q:5:accept");
    expect(Object.keys(after)).toEqual(["g:abc123"]);
  });

  it("creates the parent directory if missing", () => {
    const nested = path.join(os.tmpdir(), `t-${Date.now()}`, "deep", "triage.json");
    writeMark(nested, "q:1:accept", { category: "missing", note: "" });
    expect(fs.existsSync(nested)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test`
Expected: FAIL, cannot resolve `../triage`

- [ ] **Step 3: Write the implementation**

Create `web/lib/triage.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";

export const TRIAGE_CATEGORIES = [
  "wrong-voice",
  "bad-pronunciation",
  "bad-delivery",
  "wrong-text",
  "missing",
] as const;

export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

export interface TriageMark {
  category: TriageCategory;
  note: string;
  markedAt: string;
}

export type TriageMap = Record<string, TriageMark>;

export const TRIAGE_PATH = process.env.VOICEOVER_TRIAGE_PATH
  ?? path.join(process.cwd(), "..", "var", "triage.json");

export function readTriage(file: string = TRIAGE_PATH): TriageMap {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf-8")) as TriageMap;
}

function save(file: string, map: TriageMap): TriageMap {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`, "utf-8");
  return map;
}

export function writeMark(
  file: string,
  lineId: string,
  mark: { category: TriageCategory; note: string },
): TriageMap {
  const map = readTriage(file);
  map[lineId] = { ...mark, markedAt: new Date().toISOString() };
  return save(file, map);
}

export function clearMark(file: string, lineId: string): TriageMap {
  const map = readTriage(file);
  delete map[lineId];
  return save(file, map);
}
```

Create `web/app/api/triage/route.ts`:

```typescript
import { NextResponse } from "next/server";
import {
  clearMark,
  readTriage,
  TRIAGE_CATEGORIES,
  TRIAGE_PATH,
  writeMark,
  type TriageCategory,
} from "@/lib/triage";

export function GET() {
  return NextResponse.json(readTriage(TRIAGE_PATH));
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    lineId?: string;
    category?: TriageCategory | null;
    note?: string;
  };

  if (!body.lineId) {
    return NextResponse.json({ error: "lineId is required" }, { status: 400 });
  }
  if (body.category === null) {
    return NextResponse.json(clearMark(TRIAGE_PATH, body.lineId));
  }
  if (!body.category || !TRIAGE_CATEGORIES.includes(body.category)) {
    return NextResponse.json(
      { error: `category must be one of ${TRIAGE_CATEGORIES.join(", ")} or null` },
      { status: 400 },
    );
  }
  return NextResponse.json(
    writeMark(TRIAGE_PATH, body.lineId, { category: body.category, note: body.note ?? "" }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test`
Expected: PASS, 6 passed in triage.test.ts

- [ ] **Step 5: Verify end to end**

```bash
curl -s -X POST localhost:3000/api/triage -H 'content-type: application/json' \
  -d '{"lineId":"q:123:complete","category":"bad-pronunciation","note":"reads Hm as H M"}'
cat var/triage.json
```
Expected: the JSON contains `q:123:complete` with that category and a `markedAt` timestamp.

Rejects a bad category:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/triage \
  -H 'content-type: application/json' -d '{"lineId":"q:1:accept","category":"nonsense"}'
```
Expected: `400`

- [ ] **Step 6: Commit**

```bash
git add web/lib/triage.ts web/lib/__tests__/triage.test.ts web/app/api/triage
git commit -m "Add triage storage and API"
```

---

### Task 7: Explorer UI — search, results, player, triage controls

**Files:**
- Create: `web/app/page.tsx`, `web/components/SearchBar.tsx`, `web/components/LineRow.tsx`, `web/components/LineList.tsx`, `web/components/TriagePicker.tsx`
- Modify: `web/app/layout.tsx` (title), `web/app/globals.css`

**Interfaces:**
- Consumes: `GET /api/search` (Task 4), `GET /api/audio/{lineId}` (Task 5), `GET|POST /api/triage` (Task 6), types from `web/lib/types.ts`.
- Produces: the UI. No exports other tasks consume.

Layout: a single page. Search bar across the top (NPC, quest, voice, text, "missing audio only"). Below it a result list; each row shows source + quest title, NPC name, voice, duration, the spoken text, a play button, and a triage picker. A running count and a "flagged only" toggle sit between them.

- [ ] **Step 1: Write the failing test**

Create `web/components/__tests__/LineRow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LineRow from "../LineRow";
import type { Line } from "@/lib/types";

const LINE: Line = {
  lineId: "q:123:complete", source: "complete", questId: 123, questTitle: "The Collector",
  npcId: 240, npcName: "Marshal Dughan", npcType: "creature", voice: "human-male",
  race: "human", gender: "male", playerGender: null,
  text: "Hm... I have heard of this Collector.", fileName: "123-complete",
  hasAudio: true, durationSec: 6.6, generatable: true, skipReason: null,
};

describe("LineRow", () => {
  it("shows the NPC, quest title and spoken text", () => {
    render(<LineRow line={LINE} mark={undefined} onMark={vi.fn()} />);
    expect(screen.getByText(/Marshal Dughan/)).toBeTruthy();
    expect(screen.getByText(/The Collector/)).toBeTruthy();
    expect(screen.getByText(/I have heard of this Collector/)).toBeTruthy();
  });

  it("offers a play button when audio exists", () => {
    render(<LineRow line={LINE} mark={undefined} onMark={vi.fn()} />);
    expect(screen.getByRole("button", { name: /play/i })).toBeTruthy();
  });

  it("marks a line as missing instead of offering playback", () => {
    render(<LineRow line={{ ...LINE, hasAudio: false, durationSec: null }}
                    mark={undefined} onMark={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /play/i })).toBeNull();
    expect(screen.getByText(/no audio/i)).toBeTruthy();
  });

  it("shows the current triage category", () => {
    render(<LineRow line={LINE}
                    mark={{ category: "bad-pronunciation", note: "", markedAt: "" }}
                    onMark={vi.fn()} />);
    expect(screen.getByDisplayValue("bad-pronunciation")).toBeTruthy();
  });

  it("shows the existing note", () => {
    render(<LineRow line={LINE}
                    mark={{ category: "bad-pronunciation", note: "says H M", markedAt: "" }}
                    onMark={vi.fn()} />);
    expect(screen.getByDisplayValue("says H M")).toBeTruthy();
  });

  it("saves the note on blur, keeping the category", () => {
    const onMark = vi.fn();
    render(<LineRow line={LINE}
                    mark={{ category: "bad-delivery", note: "", markedAt: "" }}
                    onMark={onMark} />);
    const note = screen.getByLabelText(/note/i);
    fireEvent.change(note, { target: { value: "third take" } });
    fireEvent.blur(note);
    expect(onMark).toHaveBeenCalledWith("q:123:complete", "bad-delivery", "third take");
  });

  it("does not offer a note field until a category is chosen", () => {
    render(<LineRow line={LINE} mark={undefined} onMark={vi.fn()} />);
    expect(screen.queryByLabelText(/note/i)).toBeNull();
  });
});
```

Change the import line at the top of this test file to include `fireEvent`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
```

- [ ] **Step 2: Install test deps and run to verify it fails**

```bash
cd web && pnpm add -D @testing-library/react @testing-library/dom jsdom @vitejs/plugin-react
```

Create `web/vitest.config.ts`:

```typescript
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

Run: `cd web && pnpm test`
Expected: FAIL, cannot resolve `../LineRow`

- [ ] **Step 3: Write the components**

Create `web/components/TriagePicker.tsx`:

```tsx
"use client";

import { TRIAGE_CATEGORIES, type TriageCategory } from "@/lib/triage";

export default function TriagePicker({
  value,
  onChange,
}: {
  value: TriageCategory | undefined;
  onChange: (category: TriageCategory | null) => void;
}) {
  return (
    <select
      aria-label="triage category"
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || null) as TriageCategory | null)}
    >
      <option value="">unflagged</option>
      {TRIAGE_CATEGORIES.map((category) => (
        <option key={category} value={category}>{category}</option>
      ))}
    </select>
  );
}
```

Create `web/components/LineRow.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import TriagePicker from "./TriagePicker";
import type { TriageCategory, TriageMark } from "@/lib/triage";
import type { Line } from "@/lib/types";

export default function LineRow({
  line,
  mark,
  onMark,
  onChanged,
}: {
  line: Line;
  mark: TriageMark | undefined;
  onMark: (lineId: string, category: TriageCategory | null, note: string) => void;
  /** Optional so this component stays usable before the generation plan adds re-rolling. */
  onChanged?: () => void;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [note, setNote] = useState(mark?.note ?? "");

  // Keep the field in step when triage state is reloaded from the server.
  useEffect(() => setNote(mark?.note ?? ""), [mark?.note]);

  const play = () => {
    audio.current ??= new Audio(`/api/audio/${encodeURIComponent(line.lineId)}`);
    void audio.current.play();
  };

  return (
    <li className="line-row">
      <div className="line-meta">
        <strong>{line.npcName}</strong>
        <span>{line.voice}</span>
        <span>
          {line.source}
          {line.questTitle ? ` — ${line.questTitle}` : ""}
        </span>
        {line.durationSec !== null && <span>{line.durationSec.toFixed(1)}s</span>}
      </div>

      <p className="line-text">{line.text}</p>

      <div className="line-actions">
        {line.hasAudio ? (
          <button type="button" onClick={play}>Play</button>
        ) : (
          <span className="line-missing">no audio</span>
        )}
        <TriagePicker
          value={mark?.category}
          onChange={(category) => onMark(line.lineId, category, note)}
        />
        {mark && (
          <input
            aria-label="note"
            placeholder="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => onMark(line.lineId, mark.category, note)}
          />
        )}
      </div>
    </li>
  );
}
```

`onChanged` is declared now and left unused until the generation plan wires the re-roll panel
into this row, so adding it later needs no signature change here or in `LineList`.

Create `web/components/LineList.tsx`:

```tsx
"use client";

import LineRow from "./LineRow";
import type { TriageCategory, TriageMap } from "@/lib/triage";
import type { Line } from "@/lib/types";

export default function LineList({
  lines,
  triage,
  onMark,
  onChanged,
}: {
  lines: Line[];
  triage: TriageMap;
  onMark: (lineId: string, category: TriageCategory | null, note: string) => void;
  onChanged?: () => void;
}) {
  if (lines.length === 0) return <p>No lines match.</p>;
  return (
    <ul className="line-list">
      {lines.map((line) => (
        <LineRow
          key={line.lineId}
          line={line}
          mark={triage[line.lineId]}
          onMark={onMark}
          onChanged={onChanged}
        />
      ))}
    </ul>
  );
}
```

Create `web/components/SearchBar.tsx`:

```tsx
"use client";

import type { SearchQuery } from "@/lib/types";

export default function SearchBar({
  query,
  onChange,
}: {
  query: SearchQuery;
  onChange: (next: SearchQuery) => void;
}) {
  const set = (patch: Partial<SearchQuery>) => onChange({ ...query, ...patch });

  return (
    <div className="search-bar">
      <input placeholder="NPC name or id" value={query.npc ?? ""}
             onChange={(e) => set({ npc: e.target.value })} />
      <input placeholder="Quest title or id" value={query.quest ?? ""}
             onChange={(e) => set({ quest: e.target.value })} />
      <input placeholder="Voice, e.g. human-male" value={query.voice ?? ""}
             onChange={(e) => set({ voice: e.target.value })} />
      <input placeholder="Spoken text" value={query.text ?? ""}
             onChange={(e) => set({ text: e.target.value })} />
      <label>
        <input type="checkbox" checked={query.missing ?? false}
               onChange={(e) => set({ missing: e.target.checked })} />
        missing audio only
      </label>
    </div>
  );
}
```

Create `web/app/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import LineList from "@/components/LineList";
import SearchBar from "@/components/SearchBar";
import type { TriageCategory, TriageMap } from "@/lib/triage";
import type { SearchQuery, SearchResult } from "@/lib/types";

export default function Page() {
  const [query, setQuery] = useState<SearchQuery>({});
  const [result, setResult] = useState<SearchResult>({ total: 0, lines: [] });
  const [triage, setTriage] = useState<TriageMap>({});
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/triage").then((r) => r.json()).then(setTriage).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "" && value !== false) {
        params.set(key, String(value));
      }
    }
    const timer = setTimeout(() => {
      fetch(`/api/search?${params}`)
        .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(b.error))))
        .then((data: SearchResult) => { setResult(data); setError(null); })
        .catch((message: string) => setError(message));
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const mark = (lineId: string, category: TriageCategory | null, note: string) => {
    fetch("/api/triage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineId, category, note }),
    })
      .then((r) => r.json())
      .then(setTriage);
  };

  const lines = flaggedOnly
    ? result.lines.filter((line) => triage[line.lineId])
    : result.lines;

  return (
    <main>
      <h1>Voiceline Explorer</h1>
      {error && <p className="error">{error}</p>}
      <SearchBar query={query} onChange={setQuery} />
      <p>
        {result.total} matching lines
        {result.total > result.lines.length && ` (showing ${result.lines.length})`}
        {" · "}
        <label>
          <input type="checkbox" checked={flaggedOnly}
                 onChange={(e) => setFlaggedOnly(e.target.checked)} />
          flagged only
        </label>
      </p>
      <LineList lines={lines} triage={triage} onMark={mark} />
    </main>
  );
}
```

Append to `web/app/globals.css`:

```css
main { max-width: 60rem; margin: 0 auto; padding: 1.5rem; font-family: system-ui, sans-serif; }
.search-bar { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1rem; }
.search-bar input[type="text"], .search-bar input:not([type]) { padding: .4rem; min-width: 12rem; }
.line-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: .75rem; }
.line-row { border: 1px solid currentColor; border-radius: .4rem; padding: .75rem; }
.line-meta { display: flex; flex-wrap: wrap; gap: .75rem; font-size: .85rem; opacity: .8; }
.line-text { margin: .5rem 0; }
.line-actions { display: flex; gap: .75rem; align-items: center; }
.line-missing { font-size: .85rem; opacity: .7; }
.error { border: 1px solid currentColor; padding: .75rem; border-radius: .4rem; }
```

In `web/app/layout.tsx`, set the metadata title to `"Voiceline Explorer"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test`
Expected: PASS, 7 passed in LineRow.test.tsx

- [ ] **Step 5: Verify in the browser**

Run `cd web && pnpm dev` and open `http://localhost:3000`.
- Type `dughan` into the NPC field → 16 lines appear, one showing "no audio".
- Click Play on the `complete — The Collector` row → audio plays, opening with "Hm...".
- Set its triage category to `bad-pronunciation` → `var/triage.json` gains the entry.
- Tick "flagged only" → only that row remains.

- [ ] **Step 6: Commit**

```bash
git add web/app web/components web/vitest.config.ts web/package.json
git commit -m "Add explorer UI with search, playback and triage"
```

---

### Task 8: Reports — gaps and problems

**Files:**
- Create: `web/lib/reports.ts`, `web/app/api/reports/route.ts`, `web/app/reports/page.tsx`
- Create: `web/lib/__tests__/reports.test.ts`

**Interfaces:**
- Consumes: `loadIndex` (Task 4), `readTriage` (Task 6).
- Produces: `buildReports(index): Reports` with shape `{ missingAudio: Line[]; multiVoiceNpcs: {npcId, npcName, voices}[]; problemTokens: Line[]; ungeneratable: Line[] }`. `GET /api/reports`.

`problemTokens` finds spoken text likely to be mispronounced — currently standalone `Hm`/`hm` — which is the seed of the pronunciation dictionary in the generation plan.

- [ ] **Step 1: Write the failing test**

Create `web/lib/__tests__/reports.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildReports } from "../reports";
import type { VoiceIndex } from "../types";

const line = (over: Partial<Record<string, unknown>>) => ({
  lineId: "q:1:accept", source: "accept", questId: 1, questTitle: "T",
  npcId: 1, npcName: "A", npcType: "creature", voice: "human-male",
  race: "human", gender: "male", playerGender: null, text: "hello",
  fileName: "1-accept", hasAudio: true, durationSec: 1,
  generatable: true, skipReason: null, ...over,
});

const INDEX = {
  schemaVersion: 1, generatedAt: "", soundsDir: "/tmp",
  lines: [
    line({ lineId: "q:1:accept" }),
    line({ lineId: "q:2:accept", hasAudio: false, durationSec: null }),
    line({ lineId: "q:3:accept", text: "Hm... I see." }),
    line({ lineId: "q:4:progress", generatable: false, skipReason: "progress" }),
    line({ lineId: "q:5:accept", npcId: 2, npcName: "B", voice: "orc-male" }),
    line({ lineId: "q:6:accept", npcId: 2, npcName: "B", voice: "tauren-male" }),
  ],
} as unknown as VoiceIndex;

describe("buildReports", () => {
  it("lists lines with no audio", () => {
    expect(buildReports(INDEX).missingAudio.map((l) => l.lineId)).toEqual(["q:2:accept"]);
  });

  it("finds NPCs whose lines use more than one voice", () => {
    const multi = buildReports(INDEX).multiVoiceNpcs;
    expect(multi).toHaveLength(1);
    expect(multi[0].npcId).toBe(2);
    expect(multi[0].voices.sort()).toEqual(["orc-male", "tauren-male"]);
  });

  it("flags standalone Hm as a pronunciation risk", () => {
    expect(buildReports(INDEX).problemTokens.map((l) => l.lineId)).toEqual(["q:3:accept"]);
  });

  it("does not flag hm inside a longer word", () => {
    const idx = { ...INDEX, lines: [line({ text: "Chromie waits." })] } as VoiceIndex;
    expect(buildReports(idx).problemTokens).toHaveLength(0);
  });

  it("lists lines the generator will never synthesize", () => {
    expect(buildReports(INDEX).ungeneratable.map((l) => l.lineId)).toEqual(["q:4:progress"]);
  });
});

describe("checkDrift", () => {
  const withCounts = (quests: number, gossip: number) =>
    ({ ...INDEX, audioCounts: { quests, gossip } }) as unknown as VoiceIndex;

  it("reports no drift when the pack matches the index", () => {
    expect(checkDrift(withCounts(3, 1), { quests: 3, gossip: 1 })).toBeNull();
  });

  it("reports drift when files were added or removed since export", () => {
    const drift = checkDrift(withCounts(3, 1), { quests: 4, gossip: 1 });
    expect(drift).toMatch(/quests/);
    expect(drift).toMatch(/re-run/i);
  });

  it("treats a pre-drift index without counts as unknown, not drifted", () => {
    const legacy = { ...INDEX } as unknown as VoiceIndex;
    expect(checkDrift(legacy, { quests: 99, gossip: 99 })).toBeNull();
  });
});
```

Add `checkDrift` to the imports at the top of this test file:

```typescript
import { buildReports, checkDrift } from "../reports";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test`
Expected: FAIL, cannot resolve `../reports`

- [ ] **Step 3: Write the implementation**

Create `web/lib/reports.ts`:

```typescript
import type { Line, VoiceIndex } from "./types";

export interface MultiVoiceNpc {
  npcId: number;
  npcName: string;
  voices: string[];
}

export interface Reports {
  missingAudio: Line[];
  multiVoiceNpcs: MultiVoiceNpc[];
  problemTokens: Line[];
  ungeneratable: Line[];
}

/** Words a TTS engine tends to spell out rather than pronounce. */
const PROBLEM_TOKEN = /\bhm\b/i;

export function buildReports(index: VoiceIndex): Reports {
  const byNpc = new Map<number, { name: string; voices: Set<string> }>();
  for (const line of index.lines) {
    const entry = byNpc.get(line.npcId)
      ?? { name: line.npcName, voices: new Set<string>() };
    entry.voices.add(line.voice);
    byNpc.set(line.npcId, entry);
  }

  const multiVoiceNpcs: MultiVoiceNpc[] = [];
  for (const [npcId, { name, voices }] of byNpc) {
    if (voices.size > 1) {
      multiVoiceNpcs.push({ npcId, npcName: name, voices: [...voices] });
    }
  }

  return {
    missingAudio: index.lines.filter((l) => !l.hasAudio && l.generatable),
    multiVoiceNpcs,
    problemTokens: index.lines.filter((l) => PROBLEM_TOKEN.test(l.text)),
    ungeneratable: index.lines.filter((l) => !l.generatable),
  };
}

export interface AudioCounts {
  quests: number;
  gossip: number;
}

/**
 * Has the sound pack changed since the index was exported? The index is a frozen
 * snapshot, so stale `hasAudio` flags would quietly misreport gaps.
 */
export function checkDrift(index: VoiceIndex, onDisk: AudioCounts): string | null {
  const recorded = index.audioCounts;
  if (!recorded) return null; // exported before counts existed; cannot tell

  const changed = (["quests", "gossip"] as const).filter(
    (key) => recorded[key] !== onDisk[key],
  );
  if (changed.length === 0) return null;

  const detail = changed
    .map((key) => `${key}: index says ${recorded[key]}, disk has ${onDisk[key]}`)
    .join("; ");
  return `Sound pack has changed since the index was exported (${detail}). Re-run: ./.venv/bin/python cli-main.py export-index`;
}
```

Add `audioCounts` to the `VoiceIndex` interface in `web/lib/types.ts`, optional so an index
exported before this field still typechecks:

```typescript
  audioCounts?: { quests: number; gossip: number };
```

Create `web/app/api/reports/route.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { loadIndex } from "@/lib/index";
import { buildReports, checkDrift, type AudioCounts } from "@/lib/reports";

function countOnDisk(soundsDir: string): AudioCounts {
  const count = (sub: string) => {
    const directory = path.join(soundsDir, sub);
    if (!fs.existsSync(directory)) return 0;
    return fs.readdirSync(directory).filter((f) => f.endsWith(".mp3")).length;
  };
  return { quests: count("quests"), gossip: count("gossip") };
}

export function GET() {
  const index = loadIndex();
  const reports = buildReports(index);
  return NextResponse.json({
    drift: checkDrift(index, countOnDisk(index.soundsDir)),
    counts: {
      missingAudio: reports.missingAudio.length,
      multiVoiceNpcs: reports.multiVoiceNpcs.length,
      problemTokens: reports.problemTokens.length,
      ungeneratable: reports.ungeneratable.length,
    },
    ...reports,
  });
}
```

Create `web/app/reports/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { Reports } from "@/lib/reports";

type Payload = Reports & { counts: Record<string, number>; drift: string | null };

export default function ReportsPage() {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    fetch("/api/reports").then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  if (!data) return <main><p>Loading reports…</p></main>;

  return (
    <main>
      <h1>Reports</h1>

      {data.drift && <p className="error">{data.drift}</p>}

      <h2>Missing audio ({data.counts.missingAudio})</h2>
      <p>Generatable lines with no file in the pack.</p>
      <ul>
        {data.missingAudio.slice(0, 50).map((l) => (
          <li key={l.lineId}>{l.npcName} — {l.source} — {l.lineId}</li>
        ))}
      </ul>

      <h2>NPCs using more than one voice ({data.counts.multiVoiceNpcs})</h2>
      <ul>
        {data.multiVoiceNpcs.map((n) => (
          <li key={n.npcId}>{n.npcName} ({n.npcId}): {n.voices.join(", ")}</li>
        ))}
      </ul>

      <h2>Pronunciation risks ({data.counts.problemTokens})</h2>
      <p>Lines containing tokens a TTS engine tends to spell out.</p>
      <ul>
        {data.problemTokens.slice(0, 50).map((l) => (
          <li key={l.lineId}>{l.npcName}: {l.text.slice(0, 90)}</li>
        ))}
      </ul>

      <h2>Never synthesized ({data.counts.ungeneratable})</h2>
      <p>Progress text and lines with unresolved template tokens.</p>
    </main>
  );
}
```

Add a link to the reports page in `web/app/page.tsx`, under the `<h1>`:

```tsx
<p><a href="/reports">Reports</a></p>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test`
Expected: PASS, 8 passed in reports.test.ts (5 buildReports, 3 checkDrift)

- [ ] **Step 5: Verify against real data**

Open `http://localhost:3000/reports`.
Expected: "Pronunciation risks" is non-empty and includes Marshal Dughan's "Hm... I have heard of this 'Collector'". "Never synthesized" counts roughly 3,093 progress lines plus 99 invalid-char lines.

- [ ] **Step 6: Commit**

```bash
git add web/lib/reports.ts web/lib/__tests__/reports.test.ts web/app/api/reports web/app/reports web/app/page.tsx
git commit -m "Add gap and problem reports"
```

---

### Task 9: README and full-suite verification

**Files:**
- Modify: `README.md`
- Create: `web/README.md`

- [ ] **Step 1: Document the explorer in the main README**

Add a section after "Addon Install":

````markdown
## Voiceline Explorer (web app)

A local app to search, audition and triage generated lines without logging into WoW.

```bash
docker compose up -d                              # world DB, needed only to build the index
./.venv/bin/python cli-main.py export-index       # writes web/data/index.json
cd web && pnpm install && pnpm dev                # http://localhost:3000
```

Set `VOICEOVER_SOUNDS_DIR` if your sound pack is not in the default `_classic_era_` location.
Triage marks are written to `var/triage.json`.
````

- [ ] **Step 2: Run the whole suite**

```bash
./.venv/bin/python -m pytest tests/ -v
cd web && pnpm test
```
Expected: all Python tests pass; all web tests pass.

- [ ] **Step 3: Confirm the pack was never modified**

```bash
ls -la "/Applications/World of Warcraft/_classic_era_/Interface/AddOns/AI_VoiceOverData_Vanilla/generated/sound_length_table.lua"
```
Expected: mtime unchanged from before this work — the explorer is strictly read-only against the pack.

- [ ] **Step 4: Commit**

```bash
git add README.md web/README.md
git commit -m "Document the voiceline explorer"
```
