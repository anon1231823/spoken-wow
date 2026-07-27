# Generation Control Plane Implementation Plan

> **STATUS: partly superseded.** Tasks 1-4 are done, in different files: config lives in
> `voice/generation.json` and `voice/pronunciation.json` loaded by `tts_cli/voice_config.py`,
> which also owns pronunciation and seeding (this plan split those across three modules).
> Synthesis is `tts_cli/synthesize.py`, writing straight into the audio store rather than a
> staging directory, since the store is the project's own asset rather than a WoW install.
>
> Two constraints in "Global Constraints" no longer hold: lookup tables *are* regenerated,
> because the data module is now a build output, and gossip is not fix-existing-only — no
> stance is taken on gossip either way.
>
> Task 5 (`commit`) is replaced by the `build` stage, which assembles a complete data module
> from corpus plus audio store. Tasks 6-8 — the web APIs, re-roll UI and settings editor —
> remain wanted and accurate in shape.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate individual voicelines from the explorer with tuned settings, auditioning each take before it replaces the shipped audio.

**Architecture:** Python owns synthesis and every write to the sound pack. `synthesize` renders one line to a staging directory; `commit` backs up the original, promotes the staged file, and updates `sound_length_table.lua`. Next.js orchestrates via subprocess and provides the A/B audition UI. Generation settings and the pronunciation dictionary are JSON files edited in the browser and read by Python.

**Tech Stack:** Python 3.11 (requests, mutagen, pytest), Next.js App Router + TypeScript + React.

Spec: `docs/superpowers/specs/2026-07-27-voiceline-explorer-design.md`
Prerequisite: `docs/superpowers/plans/2026-07-27-voiceline-explorer.md` must be complete.

## Global Constraints

- Python is 3.11 via `.venv` at repo root. Always `./.venv/bin/python`, never bare `python`.
- **Never write lookup tables.** The installed pack is an older data-module format (`gossip_file_lookups.lua`, no object/item tables). `commit` writes exactly two things: one mp3, and `sound_length_table.lua`. Anything else breaks the pack's TOC file list.
- **Gossip is fix-existing-only.** Gossip filenames are content hashes; today's DB yields 760 gossip lines the pack never covered, and they cannot be made reachable without regenerating the gossip lookup table, which the previous rule forbids. `commit` must refuse a gossip line whose target file does not already exist. Quest lines may be added freely — their filenames are questID-based.
- **`sound_length_table.lua` must be updated on every commit.** `DataModules:PrepareSound` (`AI_VoiceOver/DataModules.lua:437`) uses it as both the existence check and the queue timer; a stale duration cuts the line off or leaves dead air.
- **Back up before overwriting.** A bad re-roll must never destroy release-zip audio irreversibly.
- Filenames come only from `tts_cli/naming.py`. No TypeScript constructs a filename.
- ElevenLabs `seed` is documented as best-effort: *"determinism is not guaranteed."* Treat it as a strong mitigation, not a guarantee.
- **This plan cannot be exercised end-to-end until the ElevenLabs account has voices named `race-gender`.** Cloning requires the Starter plan; the account is currently free tier with 0 of 3 voice slots used. All tests here stub the HTTP call, so the code is testable regardless.
- Branch: `feat/voiceline-explorer`.

---

### Task 1: Configuration files and loader

**Files:**
- Create: `tts_cli/config/generation.json`, `tts_cli/config/pronunciation.json`, `tts_cli/config_store.py`
- Create: `tests/test_config_store.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `load_generation() -> dict`, `save_generation(cfg) -> None`, `load_pronunciation() -> dict`, `save_pronunciation(rules) -> None`, `GENERATION_PATH`, `PRONUNCIATION_PATH`.

Defaults move `voice_settings` from the current extremes (`stability: 0.28`, `similarity_boost: 0.992` in `tts_utils.py:104-107`) toward the API defaults, which is the primary fix for an NPC drifting between performers.

- [ ] **Step 1: Write the failing test**

Create `tests/test_config_store.py`:

```python
import json

import pytest

from tts_cli import config_store


def test_generation_defaults_are_sane():
    cfg = config_store.load_generation()
    assert cfg["model_id"] == "eleven_multilingual_v2"
    assert cfg["voice_settings"]["stability"] == 0.5
    assert cfg["voice_settings"]["similarity_boost"] == 0.75
    assert cfg["seed_strategy"] == "npc"


def test_pronunciation_rules_include_the_known_defect():
    rules = config_store.load_pronunciation()
    assert rules["\\bHm\\b"] == "Hmm"
    assert rules["\\bhm\\b"] == "hmm"


def test_generation_round_trips(tmp_path, monkeypatch):
    path = tmp_path / "generation.json"
    monkeypatch.setattr(config_store, "GENERATION_PATH", str(path))
    config_store.save_generation({"model_id": "x", "voice_settings": {}, "seed_strategy": "fixed"})
    assert config_store.load_generation()["model_id"] == "x"


def test_pronunciation_round_trips(tmp_path, monkeypatch):
    path = tmp_path / "pronunciation.json"
    monkeypatch.setattr(config_store, "PRONUNCIATION_PATH", str(path))
    config_store.save_pronunciation({"\\bfoo\\b": "bar"})
    assert config_store.load_pronunciation() == {"\\bfoo\\b": "bar"}


def test_rejects_invalid_regex(tmp_path, monkeypatch):
    monkeypatch.setattr(config_store, "PRONUNCIATION_PATH", str(tmp_path / "p.json"))
    with pytest.raises(ValueError, match="invalid regex"):
        config_store.save_pronunciation({"[unclosed": "x"})


def test_rejects_out_of_range_stability(tmp_path, monkeypatch):
    monkeypatch.setattr(config_store, "GENERATION_PATH", str(tmp_path / "g.json"))
    with pytest.raises(ValueError, match="stability"):
        config_store.save_generation(
            {"model_id": "m", "voice_settings": {"stability": 5}, "seed_strategy": "npc"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/python -m pytest tests/test_config_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts_cli.config_store'`

- [ ] **Step 3: Write the config files**

Create `tts_cli/config/generation.json`:

```json
{
  "model_id": "eleven_multilingual_v2",
  "voice_settings": {
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0,
    "use_speaker_boost": true
  },
  "seed_strategy": "npc"
}
```

Create `tts_cli/config/pronunciation.json`:

```json
{
  "\\bHm\\b": "Hmm",
  "\\bhm\\b": "hmm"
}
```

- [ ] **Step 4: Write the loader**

Create `tts_cli/config_store.py`:

```python
"""Read and write the JSON config the web UI edits and the generator consumes.

Kept as data rather than Python literals so settings can be tuned from the browser and
reviewed as a diff.
"""
import json
import os
import re

_HERE = os.path.dirname(os.path.abspath(__file__))
GENERATION_PATH = os.path.join(_HERE, "config", "generation.json")
PRONUNCIATION_PATH = os.path.join(_HERE, "config", "pronunciation.json")

_UNIT_INTERVAL = ("stability", "similarity_boost", "style")


def _read(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _write(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def load_generation() -> dict:
    return _read(GENERATION_PATH)


def save_generation(cfg: dict) -> None:
    settings = cfg.get("voice_settings", {})
    for key in _UNIT_INTERVAL:
        if key in settings and not 0 <= settings[key] <= 1:
            raise ValueError(f"{key} must be between 0 and 1, got {settings[key]}")
    _write(GENERATION_PATH, cfg)


def load_pronunciation() -> dict:
    return _read(PRONUNCIATION_PATH)


def save_pronunciation(rules: dict) -> None:
    for pattern in rules:
        try:
            re.compile(pattern)
        except re.error as exc:
            raise ValueError(f"invalid regex {pattern!r}: {exc}") from exc
    _write(PRONUNCIATION_PATH, rules)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./.venv/bin/python -m pytest tests/test_config_store.py -v`
Expected: PASS, 6 passed

- [ ] **Step 6: Commit**

```bash
git add tts_cli/config tts_cli/config_store.py tests/test_config_store.py
git commit -m "Add generation and pronunciation config as editable data files"
```

---

### Task 2: Pronunciation application and the filename safety property

**Files:**
- Create: `tts_cli/speech_text.py`
- Create: `tests/test_speech_text.py`

**Interfaces:**
- Consumes: `load_pronunciation` (Task 1), `tts_cli.naming` (explorer plan Task 1).
- Produces: `apply_pronunciation(text: str, rules: dict) -> str`.

The critical test here asserts the safety property the whole design rests on: pronunciation edits change *what is spoken* and can never change *which file is written*, because filenames derive from `original_text` while speech derives from `cleanedText`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_speech_text.py`:

```python
from tts_cli.naming import filename_for_row
from tts_cli.speech_text import apply_pronunciation

RULES = {r"\bHm\b": "Hmm", r"\bhm\b": "hmm"}


def test_fixes_standalone_hm():
    assert apply_pronunciation("Hm... I see.", RULES) == "Hmm... I see."


def test_fixes_lowercase_hm():
    assert apply_pronunciation("Well, hm, maybe.", RULES) == "Well, hmm, maybe."


def test_leaves_hm_inside_a_word_alone():
    assert apply_pronunciation("Chromie waits.", RULES) == "Chromie waits."


def test_applies_multiple_rules():
    rules = {r"\bThrall\b": "Thrawl", r"\bHm\b": "Hmm"}
    assert apply_pronunciation("Hm, Thrall speaks.", rules) == "Hmm, Thrawl speaks."


def test_no_rules_is_identity():
    assert apply_pronunciation("unchanged", {}) == "unchanged"


def test_pronunciation_never_changes_the_filename():
    """The safety property: names come from original_text, speech from cleanedText."""
    row = {
        "quest": "",
        "source": "gossip",
        "player_gender": None,
        # hash is precomputed from original_text upstream and is not recomputed here
        "templateText_race_gender_hash": "abc123",
    }
    before = filename_for_row(row)
    spoken = apply_pronunciation("Hm... hello", RULES)
    assert spoken != "Hm... hello"          # speech did change
    assert filename_for_row(row) == before  # filename did not
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/python -m pytest tests/test_speech_text.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts_cli.speech_text'`

- [ ] **Step 3: Write the implementation**

Create `tts_cli/speech_text.py`:

```python
"""Normalize text for speech.

Applied to cleanedText only, immediately before synthesis. Filenames derive from
original_text, so nothing here can change which file gets written - that separation is
what makes pronunciation fixes safe to apply to an already-shipped sound pack.
"""
import re


def apply_pronunciation(text: str, rules: dict) -> str:
    """Apply regex substitutions in insertion order."""
    for pattern, replacement in rules.items():
        text = re.sub(pattern, replacement, text)
    return text
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/bin/python -m pytest tests/test_speech_text.py -v`
Expected: PASS, 6 passed

- [ ] **Step 5: Commit**

```bash
git add tts_cli/speech_text.py tests/test_speech_text.py
git commit -m "Add pronunciation normalization with filename safety test"
```

---

### Task 3: Deterministic per-NPC seed

**Files:**
- Create: `tts_cli/seed.py`
- Create: `tests/test_seed.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `seed_for(npc_id: int, strategy: str) -> int | None`.

An NPC drifting between performers is the primary defect. One voice clone serves every NPC of a given `race-gender`, so the fix is to stop sampling independently per line: derive the seed from the NPC id so all of that NPC's lines draw the same way.

- [ ] **Step 1: Write the failing test**

Create `tests/test_seed.py`:

```python
import pytest

from tts_cli.seed import ELEVENLABS_SEED_MAX, seed_for


def test_same_npc_gives_the_same_seed():
    assert seed_for(240, "npc") == seed_for(240, "npc")


def test_different_npcs_give_different_seeds():
    assert seed_for(240, "npc") != seed_for(241, "npc")


@pytest.mark.parametrize("npc_id", [0, 1, 240, 99999, 2**31])
def test_seed_is_within_the_api_range(npc_id):
    seed = seed_for(npc_id, "npc")
    assert 0 <= seed <= ELEVENLABS_SEED_MAX


def test_none_strategy_disables_seeding():
    assert seed_for(240, "none") is None


def test_unknown_strategy_is_rejected():
    with pytest.raises(ValueError, match="unknown seed strategy"):
        seed_for(240, "wat")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/python -m pytest tests/test_seed.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts_cli.seed'`

- [ ] **Step 3: Write the implementation**

Create `tts_cli/seed.py`:

```python
"""Deterministic seeds so one NPC sounds like one performer across all their lines.

There is a single voice clone per race-gender pair, so what makes an NPC drift between
performers is independent sampling per request. Deriving the seed from the NPC id makes
every line for that NPC draw the same way.

ElevenLabs documents seed as best effort - "determinism is not guaranteed" - so this is a
strong mitigation, not a promise.
"""
import zlib

ELEVENLABS_SEED_MAX = 4294967295


def seed_for(npc_id: int, strategy: str):
    if strategy == "none":
        return None
    if strategy == "npc":
        return zlib.crc32(str(npc_id).encode()) % (ELEVENLABS_SEED_MAX + 1)
    raise ValueError(f"unknown seed strategy {strategy!r}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/bin/python -m pytest tests/test_seed.py -v`
Expected: PASS, 9 passed

- [ ] **Step 5: Commit**

```bash
git add tts_cli/seed.py tests/test_seed.py
git commit -m "Add deterministic per-NPC seed derivation"
```

---

### Task 4: Synthesize one line to staging

**Files:**
- Create: `tts_cli/synthesize.py`
- Create: `tests/test_synthesize.py`
- Modify: `cli-main.py`

**Interfaces:**
- Consumes: `load_generation`, `load_pronunciation` (Task 1); `apply_pronunciation` (Task 2); `seed_for` (Task 3); `ELEVENLABS_API_KEY` from `tts_cli/env_vars.py`; index entries from `web/data/index.json`.
- Produces: `build_payload(line, generation_cfg, rules) -> dict`, `synthesize_line(line, voice_id, staging_dir, http_post=requests.post) -> dict` returning `{"path", "durationSec", "characters", "seed", "spokenText"}`, `staged_path(staging_dir, line_id) -> str`. CLI: `synthesize --line-id ID [--staging-dir DIR]` printing JSON to stdout.

`http_post` is injected so tests never touch the network.

- [ ] **Step 1: Write the failing test**

Create `tests/test_synthesize.py`:

```python
import json
import os

import pytest

from tts_cli.synthesize import build_payload, staged_path, synthesize_line

LINE = {
    "lineId": "q:123:complete",
    "npcId": 240,
    "voice": "human-male",
    "text": "Hm... I have heard of this Collector.",
}
CFG = {
    "model_id": "eleven_multilingual_v2",
    "voice_settings": {"stability": 0.5, "similarity_boost": 0.75,
                       "style": 0, "use_speaker_boost": True},
    "seed_strategy": "npc",
}
RULES = {r"\bHm\b": "Hmm"}


class FakeResponse:
    def __init__(self, status=200, content=b"ID3fake", ctype="audio/mpeg"):
        self.status_code = status
        self.content = content
        self.headers = {"Content-Type": ctype}
        self.text = "error body"


def test_payload_speaks_the_normalized_text():
    payload = build_payload(LINE, CFG, RULES)
    assert payload["text"].startswith("Hmm...")


def test_payload_carries_model_and_settings():
    payload = build_payload(LINE, CFG, RULES)
    assert payload["model_id"] == "eleven_multilingual_v2"
    assert payload["voice_settings"]["stability"] == 0.5


def test_payload_seed_is_stable_for_one_npc():
    a = build_payload(LINE, CFG, RULES)["seed"]
    b = build_payload({**LINE, "lineId": "q:9:accept"}, CFG, RULES)["seed"]
    assert a == b  # same npcId, so same seed


def test_seed_omitted_when_strategy_is_none():
    payload = build_payload(LINE, {**CFG, "seed_strategy": "none"}, RULES)
    assert "seed" not in payload


def test_writes_the_staged_file(tmp_path, monkeypatch):
    monkeypatch.setattr("tts_cli.synthesize._duration", lambda path: 6.6)
    result = synthesize_line(LINE, "voice-id", str(tmp_path),
                             http_post=lambda *a, **k: FakeResponse())
    assert os.path.isfile(result["path"])
    assert result["durationSec"] == 6.6


def test_reports_character_cost_of_the_spoken_text(tmp_path, monkeypatch):
    monkeypatch.setattr("tts_cli.synthesize._duration", lambda path: 1.0)
    result = synthesize_line(LINE, "voice-id", str(tmp_path),
                             http_post=lambda *a, **k: FakeResponse())
    assert result["characters"] == len(result["spokenText"])


def test_raises_on_http_error(tmp_path):
    with pytest.raises(RuntimeError, match="401"):
        synthesize_line(LINE, "voice-id", str(tmp_path),
                        http_post=lambda *a, **k: FakeResponse(status=401))


def test_raises_when_response_is_not_audio(tmp_path):
    with pytest.raises(RuntimeError, match="not audio"):
        synthesize_line(LINE, "voice-id", str(tmp_path),
                        http_post=lambda *a, **k: FakeResponse(ctype="application/json"))


def test_staged_path_is_filename_safe():
    assert staged_path("/tmp", "q:123:complete").endswith("q_123_complete.mp3")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/python -m pytest tests/test_synthesize.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts_cli.synthesize'`

- [ ] **Step 3: Write the implementation**

Create `tts_cli/synthesize.py`:

```python
"""Render one line to a staging directory. Nothing here touches the sound pack."""
import os

import mutagen.mp3
import requests

from tts_cli.seed import seed_for
from tts_cli.speech_text import apply_pronunciation

API_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"


def staged_path(staging_dir: str, line_id: str) -> str:
    """':' is not filename-safe, so staged files use underscores."""
    return os.path.join(staging_dir, line_id.replace(":", "_") + ".mp3")


def build_payload(line: dict, generation_cfg: dict, rules: dict) -> dict:
    payload = {
        "text": apply_pronunciation(line["text"], rules),
        "model_id": generation_cfg["model_id"],
        "voice_settings": generation_cfg["voice_settings"],
    }
    seed = seed_for(line["npcId"], generation_cfg["seed_strategy"])
    if seed is not None:
        payload["seed"] = seed
    return payload


def _duration(path: str) -> float:
    return round(mutagen.mp3.MP3(path).info.length, 3)


def synthesize_line(line: dict, voice_id: str, staging_dir: str,
                    generation_cfg: dict = None, rules: dict = None,
                    http_post=requests.post) -> dict:
    from tts_cli.config_store import load_generation, load_pronunciation
    from tts_cli.env_vars import ELEVENLABS_API_KEY

    generation_cfg = generation_cfg if generation_cfg is not None else load_generation()
    rules = rules if rules is not None else load_pronunciation()

    payload = build_payload(line, generation_cfg, rules)
    response = http_post(
        API_URL.format(voice_id=voice_id),
        json=payload,
        headers={"xi-api-key": ELEVENLABS_API_KEY},
    )

    if response.status_code != 200:
        raise RuntimeError(f"ElevenLabs returned {response.status_code}: {response.text[:200]}")
    if response.headers.get("Content-Type") != "audio/mpeg":
        raise RuntimeError(
            f"response was not audio (Content-Type {response.headers.get('Content-Type')})")

    os.makedirs(staging_dir, exist_ok=True)
    path = staged_path(staging_dir, line["lineId"])
    with open(path, "wb") as f:
        f.write(response.content)

    return {
        "path": path,
        "durationSec": _duration(path),
        "characters": len(payload["text"]),
        "seed": payload.get("seed"),
        "spokenText": payload["text"],
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/bin/python -m pytest tests/test_synthesize.py -v`
Expected: PASS, 9 passed

- [ ] **Step 5: Add the CLI subcommand**

In `cli-main.py` subparsers:

```python
syn = subparsers.add_parser("synthesize", help="Render one line to the staging directory.")
syn.add_argument("--line-id", required=True)
syn.add_argument("--staging-dir", default="var/staging")
```

And in the dispatch chain:

```python
elif args.mode == "synthesize":
    import json as _json
    from tts_cli.index_export import DEFAULT_INDEX_PATH
    from tts_cli.synthesize import synthesize_line
    from tts_cli.tts_utils import TTSProcessor

    with open(DEFAULT_INDEX_PATH, encoding="utf-8") as f:
        lines = {l["lineId"]: l for l in _json.load(f)["lines"]}
    line = lines[args.line_id]

    voice_map = TTSProcessor().get_voice_map()
    if line["voice"] not in voice_map:
        raise SystemExit(_json.dumps({"error": f"no ElevenLabs voice named {line['voice']}"}))

    print(_json.dumps(synthesize_line(line, voice_map[line["voice"]], args.staging_dir)))
```

- [ ] **Step 6: Commit**

```bash
git add tts_cli/synthesize.py tests/test_synthesize.py cli-main.py
git commit -m "Add synthesize command rendering one line to staging"
```

---

### Task 5: Commit a staged line into the sound pack

**Files:**
- Create: `tts_cli/commit.py`
- Create: `tests/test_commit.py`
- Modify: `cli-main.py`

**Interfaces:**
- Consumes: `tts_cli.naming` (explorer plan Task 1), `staged_path` (Task 4).
- Produces: `update_length_entry(lua_path, file_name, duration) -> None`, `commit_line(line, staging_dir, sounds_dir, lua_path, backup_dir) -> dict` returning `{"backup", "target", "durationSec"}`.

This is the only code in the project that writes to the installed pack. It performs backup → move → length-table update, in that order, so a failure at any step leaves the original recoverable.

The length table is edited in place rather than rebuilt. `write_sound_length_table_lua` re-reads all ~9,500 mp3s with mutagen, which is far too slow for a per-line action.

- [ ] **Step 1: Write the failing test**

Create `tests/test_commit.py`:

```python
import os

import pytest

from tts_cli.commit import commit_line, update_length_entry

LUA = """if not VoiceOver or not VoiceOver.DataModules then return end
AI_VoiceOverData_Vanilla.SoundLengthLookupByFileName = {
    ["123-complete"] = 6.6,
    ["5-accept"] = 12.0,
}
"""

QUEST_LINE = {"lineId": "q:123:complete", "fileName": "123-complete"}
GOSSIP_LINE = {"lineId": "g:abc123", "fileName": "abc123"}


def _pack(tmp_path, with_gossip=False):
    sounds = tmp_path / "sounds"
    (sounds / "quests").mkdir(parents=True)
    (sounds / "gossip").mkdir(parents=True)
    (sounds / "quests" / "123-complete.mp3").write_bytes(b"OLD")
    if with_gossip:
        (sounds / "gossip" / "abc123.mp3").write_bytes(b"OLD")
    lua = tmp_path / "sound_length_table.lua"
    lua.write_text(LUA, encoding="utf-8")
    staging = tmp_path / "staging"
    staging.mkdir()
    return str(sounds), str(lua), str(staging)


def test_updates_an_existing_length_entry(tmp_path):
    lua = tmp_path / "t.lua"
    lua.write_text(LUA, encoding="utf-8")
    update_length_entry(str(lua), "123-complete", 7.25)
    assert '["123-complete"] = 7.25,' in lua.read_text()
    assert '["5-accept"] = 12.0,' in lua.read_text()


def test_inserts_a_new_length_entry(tmp_path):
    lua = tmp_path / "t.lua"
    lua.write_text(LUA, encoding="utf-8")
    update_length_entry(str(lua), "999-accept", 3.5)
    assert '["999-accept"] = 3.5,' in lua.read_text()
    assert '["123-complete"] = 6.6,' in lua.read_text()


def test_backs_up_before_overwriting(tmp_path, monkeypatch):
    sounds, lua, staging = _pack(tmp_path)
    monkeypatch.setattr("tts_cli.commit._duration", lambda p: 7.25)
    (tmp_path / "staging" / "q_123_complete.mp3").write_bytes(b"NEW")

    result = commit_line(QUEST_LINE, staging, sounds, lua, str(tmp_path / "backup"))

    assert open(result["backup"], "rb").read() == b"OLD"
    assert open(result["target"], "rb").read() == b"NEW"


def test_writes_the_new_duration(tmp_path, monkeypatch):
    sounds, lua, staging = _pack(tmp_path)
    monkeypatch.setattr("tts_cli.commit._duration", lambda p: 7.25)
    (tmp_path / "staging" / "q_123_complete.mp3").write_bytes(b"NEW")

    commit_line(QUEST_LINE, staging, sounds, lua, str(tmp_path / "backup"))
    assert '["123-complete"] = 7.25,' in open(lua, encoding="utf-8").read()


def test_new_quest_lines_need_no_backup(tmp_path, monkeypatch):
    sounds, lua, staging = _pack(tmp_path)
    monkeypatch.setattr("tts_cli.commit._duration", lambda p: 2.0)
    (tmp_path / "staging" / "q_999_accept.mp3").write_bytes(b"NEW")

    result = commit_line({"lineId": "q:999:accept", "fileName": "999-accept"},
                         staging, sounds, lua, str(tmp_path / "backup"))
    assert result["backup"] is None
    assert os.path.isfile(result["target"])


def test_refuses_gossip_that_does_not_already_exist(tmp_path, monkeypatch):
    sounds, lua, staging = _pack(tmp_path, with_gossip=False)
    (tmp_path / "staging" / "g_abc123.mp3").write_bytes(b"NEW")

    with pytest.raises(RuntimeError, match="gossip"):
        commit_line(GOSSIP_LINE, staging, sounds, lua, str(tmp_path / "backup"))


def test_allows_gossip_that_already_exists(tmp_path, monkeypatch):
    sounds, lua, staging = _pack(tmp_path, with_gossip=True)
    monkeypatch.setattr("tts_cli.commit._duration", lambda p: 4.0)
    (tmp_path / "staging" / "g_abc123.mp3").write_bytes(b"NEW")

    result = commit_line(GOSSIP_LINE, staging, sounds, lua, str(tmp_path / "backup"))
    assert open(result["target"], "rb").read() == b"NEW"


def test_missing_staged_file_is_an_error(tmp_path):
    sounds, lua, staging = _pack(tmp_path)
    with pytest.raises(FileNotFoundError):
        commit_line(QUEST_LINE, staging, sounds, lua, str(tmp_path / "backup"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/python -m pytest tests/test_commit.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts_cli.commit'`

- [ ] **Step 3: Write the implementation**

Create `tts_cli/commit.py`:

```python
"""Promote a staged line into the installed sound pack.

The only code in this project that writes to the pack. Two files change and no others:
one mp3, and sound_length_table.lua. Lookup tables must never be rewritten - the installed
pack is an older data-module format and regenerating them would break its TOC file list.
"""
import os
import re
import shutil
from datetime import datetime

import mutagen.mp3

from tts_cli.naming import subfolder_from_line_id
from tts_cli.synthesize import staged_path


def _duration(path: str) -> float:
    return round(mutagen.mp3.MP3(path).info.length, 3)


def update_length_entry(lua_path: str, file_name: str, duration: float) -> None:
    """Replace or insert one entry in SoundLengthLookupByFileName.

    Edited in place rather than rebuilt: a full rebuild re-reads every mp3 in the pack
    with mutagen, which is far too slow to run per line.
    """
    with open(lua_path, encoding="utf-8") as f:
        source = f.read()

    entry = f'    ["{file_name}"] = {duration},'
    pattern = re.compile(rf'^\s*\["{re.escape(file_name)}"\]\s*=\s*[^,]+,\s*$', re.MULTILINE)

    if pattern.search(source):
        source = pattern.sub(entry, source, count=1)
    else:
        closing = source.rindex("}")
        source = source[:closing] + entry + "\n" + source[closing:]

    with open(lua_path, "w", encoding="utf-8") as f:
        f.write(source)


def commit_line(line: dict, staging_dir: str, sounds_dir: str, lua_path: str,
                backup_dir: str) -> dict:
    staged = staged_path(staging_dir, line["lineId"])
    if not os.path.isfile(staged):
        raise FileNotFoundError(f"no staged audio at {staged}")

    subfolder = subfolder_from_line_id(line["lineId"])
    target = os.path.join(sounds_dir, subfolder, line["fileName"] + ".mp3")
    exists = os.path.isfile(target)

    # Gossip filenames are content hashes resolved through the pack's gossip lookup table.
    # Since that table must never be regenerated, a gossip file that is not already present
    # could never be found by the addon.
    if subfolder == "gossip" and not exists:
        raise RuntimeError(
            f"refusing to add gossip file {line['fileName']}.mp3: it is not in the pack, "
            "and it would be unreachable without regenerating the gossip lookup table")

    backup = None
    if exists:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = os.path.join(backup_dir, stamp, subfolder, line["fileName"] + ".mp3")
        os.makedirs(os.path.dirname(backup), exist_ok=True)
        shutil.copy2(target, backup)

    os.makedirs(os.path.dirname(target), exist_ok=True)
    shutil.move(staged, target)

    duration = _duration(target)
    update_length_entry(lua_path, line["fileName"], duration)

    return {"backup": backup, "target": target, "durationSec": duration}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/bin/python -m pytest tests/test_commit.py -v`
Expected: PASS, 8 passed

- [ ] **Step 5: Add the CLI subcommand**

In `cli-main.py` subparsers:

```python
cmt = subparsers.add_parser("commit-line", help="Promote a staged line into the sound pack.")
cmt.add_argument("--line-id", required=True)
cmt.add_argument("--staging-dir", default="var/staging")
cmt.add_argument("--backup-dir", default="var/backup")
```

And in the dispatch chain:

```python
elif args.mode == "commit-line":
    import json as _json
    import os as _os
    from tts_cli.commit import commit_line
    from tts_cli.index_export import DEFAULT_INDEX_PATH, sounds_dir

    with open(DEFAULT_INDEX_PATH, encoding="utf-8") as f:
        lines = {l["lineId"]: l for l in _json.load(f)["lines"]}
    lua = _os.path.join(_os.path.dirname(sounds_dir()), "sound_length_table.lua")
    print(_json.dumps(commit_line(lines[args.line_id], args.staging_dir,
                                  sounds_dir(), lua, args.backup_dir)))
```

- [ ] **Step 6: Commit**

```bash
git add tts_cli/commit.py tests/test_commit.py cli-main.py
git commit -m "Add commit-line writing staged audio into the pack with backup"
```

---

### Task 6: Generation APIs

**Files:**
- Create: `web/lib/python.ts`, `web/app/api/generate/route.ts`, `web/app/api/commit/route.ts`, `web/app/api/discard/route.ts`
- Create: `web/lib/__tests__/python.test.ts`

**Interfaces:**
- Consumes: `loadIndex` (explorer Task 4), `stagedFileName` (explorer Task 5), the `synthesize` and `commit-line` CLI commands (Tasks 4-5).
- Produces: `runPython(args: string[]): Promise<unknown>`. `POST /api/generate {lineId}`, `POST /api/commit {lineId}`, `POST /api/discard {lineId}`.

- [ ] **Step 1: Write the failing test**

Create `web/lib/__tests__/python.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parsePythonOutput } from "../python";

describe("parsePythonOutput", () => {
  it("parses the last line as JSON", () => {
    expect(parsePythonOutput('warning: noise\n{"durationSec": 6.6}\n'))
      .toEqual({ durationSec: 6.6 });
  });

  it("ignores trailing whitespace", () => {
    expect(parsePythonOutput('{"ok": true}\n\n  \n')).toEqual({ ok: true });
  });

  it("throws with the raw output when nothing parses", () => {
    expect(() => parsePythonOutput("Traceback: boom")).toThrow(/Traceback: boom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test`
Expected: FAIL, cannot resolve `../python`

- [ ] **Step 3: Write the implementation**

Create `web/lib/python.ts`:

```typescript
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const REPO_ROOT = process.env.VOICEOVER_REPO_ROOT ?? path.join(process.cwd(), "..");
const PYTHON = path.join(REPO_ROOT, ".venv", "bin", "python");

/** Python commands print JSON on the last non-empty line; anything before it is noise. */
export function parsePythonOutput(stdout: string): unknown {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.at(-1);
  if (last) {
    try {
      return JSON.parse(last);
    } catch {
      // fall through
    }
  }
  throw new Error(`could not parse python output: ${stdout.trim()}`);
}

export async function runPython(args: string[]): Promise<unknown> {
  const { stdout } = await run(PYTHON, ["cli-main.py", ...args], {
    cwd: REPO_ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
  return parsePythonOutput(stdout);
}
```

Create `web/app/api/generate/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { loadIndex } from "@/lib/index";
import { runPython } from "@/lib/python";

export async function POST(request: Request) {
  const { lineId } = (await request.json()) as { lineId?: string };
  if (!lineId) return NextResponse.json({ error: "lineId is required" }, { status: 400 });

  const line = loadIndex().lines.find((l) => l.lineId === lineId);
  if (!line) return NextResponse.json({ error: "unknown lineId" }, { status: 404 });
  if (!line.generatable) {
    return NextResponse.json(
      { error: `line is not generatable (${line.skipReason})` },
      { status: 422 },
    );
  }

  try {
    return NextResponse.json(await runPython(["synthesize", "--line-id", lineId]));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
```

Create `web/app/api/commit/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { runPython } from "@/lib/python";

export async function POST(request: Request) {
  const { lineId } = (await request.json()) as { lineId?: string };
  if (!lineId) return NextResponse.json({ error: "lineId is required" }, { status: 400 });

  try {
    return NextResponse.json(await runPython(["commit-line", "--line-id", lineId]));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
```

Create `web/app/api/discard/route.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { stagedFileName } from "@/lib/audio";

const STAGING_DIR = process.env.VOICEOVER_STAGING_DIR
  ?? path.join(process.cwd(), "..", "var", "staging");

export async function POST(request: Request) {
  const { lineId } = (await request.json()) as { lineId?: string };
  if (!lineId) return NextResponse.json({ error: "lineId is required" }, { status: 400 });

  const staged = path.join(STAGING_DIR, stagedFileName(lineId));
  if (fs.existsSync(staged)) fs.unlinkSync(staged);
  return NextResponse.json({ discarded: lineId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test`
Expected: PASS, 3 passed in python.test.ts

- [ ] **Step 5: Verify error handling without voice clones**

With the current free-tier account (no `race-gender` voices):
```bash
curl -s -X POST localhost:3000/api/generate -H 'content-type: application/json' \
  -d '{"lineId":"q:123:complete"}'
```
Expected: HTTP 502 with an error mentioning `no ElevenLabs voice named human-male`. This is the correct failure — it proves the path is wired without needing a paid account.

Non-generatable lines are rejected before spending anything:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/generate \
  -H 'content-type: application/json' -d '{"lineId":"q:7:progress"}'
```
Expected: `422`

- [ ] **Step 6: Commit**

```bash
git add web/lib/python.ts web/lib/__tests__/python.test.ts web/app/api/generate web/app/api/commit web/app/api/discard
git commit -m "Add generate, commit and discard APIs"
```

---

### Task 7: Re-roll UI with A/B audition

**Files:**
- Create: `web/components/RerollPanel.tsx`
- Modify: `web/components/LineRow.tsx`
- Create: `web/components/__tests__/RerollPanel.test.tsx`

**Interfaces:**
- Consumes: `POST /api/generate`, `/api/commit`, `/api/discard` (Task 6); `GET /api/audio/{lineId}?variant=staged` (explorer Task 5).
- Produces: UI only.

Flow: Re-roll → staged take appears with its duration and character cost → play current and new back to back → Accept or Discard. Nothing reaches the pack until Accept.

- [ ] **Step 1: Write the failing test**

Create `web/components/__tests__/RerollPanel.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RerollPanel from "../RerollPanel";

const LINE_ID = "q:123:complete";

beforeEach(() => {
  vi.restoreAllMocks();
  global.Audio = vi.fn(() => ({ play: vi.fn() })) as never;
});

const mockFetch = (body: unknown, ok = true) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok, json: () => Promise.resolve(body),
  }));

describe("RerollPanel", () => {
  it("offers a re-roll button before anything is staged", () => {
    render(<RerollPanel lineId={LINE_ID} generatable onCommitted={vi.fn()} />);
    expect(screen.getByRole("button", { name: /re-roll/i })).toBeTruthy();
  });

  it("disables re-roll for lines that cannot be generated", () => {
    render(<RerollPanel lineId={LINE_ID} generatable={false} onCommitted={vi.fn()} />);
    expect(screen.getByRole("button", { name: /re-roll/i })).toHaveProperty("disabled", true);
  });

  it("shows duration and character cost after staging", async () => {
    mockFetch({ durationSec: 7.25, characters: 132 });
    render(<RerollPanel lineId={LINE_ID} generatable onCommitted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /re-roll/i }));
    await waitFor(() => expect(screen.getByText(/7.25s/)).toBeTruthy());
    expect(screen.getByText(/132 characters/)).toBeTruthy();
  });

  it("reveals accept and discard once a take is staged", async () => {
    mockFetch({ durationSec: 1, characters: 1 });
    render(<RerollPanel lineId={LINE_ID} generatable onCommitted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /re-roll/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /accept/i })).toBeTruthy());
    expect(screen.getByRole("button", { name: /discard/i })).toBeTruthy();
  });

  it("surfaces an API error instead of pretending it worked", async () => {
    mockFetch({ error: "no ElevenLabs voice named human-male" }, false);
    render(<RerollPanel lineId={LINE_ID} generatable onCommitted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /re-roll/i }));
    await waitFor(() =>
      expect(screen.getByText(/no ElevenLabs voice named human-male/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test`
Expected: FAIL, cannot resolve `../RerollPanel`

- [ ] **Step 3: Write the component**

Create `web/components/RerollPanel.tsx`:

```tsx
"use client";

import { useState } from "react";

interface Staged {
  durationSec: number;
  characters: number;
}

const post = async (url: string, lineId: string) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lineId }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "request failed");
  return body;
};

export default function RerollPanel({
  lineId,
  generatable,
  onCommitted,
}: {
  lineId: string;
  generatable: boolean;
  onCommitted: () => void;
}) {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reroll = () =>
    act(async () => setStaged((await post("/api/generate", lineId)) as Staged));

  const accept = () =>
    act(async () => {
      await post("/api/commit", lineId);
      setStaged(null);
      onCommitted();
    });

  const discard = () =>
    act(async () => {
      await post("/api/discard", lineId);
      setStaged(null);
    });

  const playStaged = () => {
    void new Audio(
      `/api/audio/${encodeURIComponent(lineId)}?variant=staged&t=${Date.now()}`,
    ).play();
  };

  return (
    <div className="reroll">
      <button type="button" onClick={reroll} disabled={!generatable || busy}>
        {busy ? "Working…" : "Re-roll"}
      </button>

      {staged && (
        <>
          <span>
            new take: {staged.durationSec}s · {staged.characters} characters
          </span>
          <button type="button" onClick={playStaged}>Play new</button>
          <button type="button" onClick={accept} disabled={busy}>Accept</button>
          <button type="button" onClick={discard} disabled={busy}>Discard</button>
        </>
      )}

      {error && <span className="error">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into LineRow**

In `web/components/LineRow.tsx`, add `onChanged` to the props and render the panel inside `.line-actions`, after `TriagePicker`:

```tsx
<RerollPanel
  lineId={line.lineId}
  generatable={line.generatable}
  onCommitted={onChanged}
/>
```

Import it at the top: `import RerollPanel from "./RerollPanel";`

`LineRow` and `LineList` already declare and thread an optional `onChanged?: () => void` — the
explorer plan added it for exactly this, so no signature changes are needed and the existing
`LineRow.test.tsx` keeps passing.

The one change outside this component: in `web/app/page.tsx`, pass `onChanged` to `LineList` as a
callback that re-runs the current search, so a committed take's new duration is reflected. Extract
the existing search effect body into a `runSearch` function and call it from both the effect and
`onChanged`:

```tsx
const runSearch = useCallback(() => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "" && value !== false) {
      params.set(key, String(value));
    }
  }
  fetch(`/api/search?${params}`)
    .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(b.error))))
    .then((data: SearchResult) => { setResult(data); setError(null); })
    .catch((message: string) => setError(message));
}, [query]);

useEffect(() => {
  const timer = setTimeout(runSearch, 200);
  return () => clearTimeout(timer);
}, [runSearch]);
```

Then render `<LineList lines={lines} triage={triage} onMark={mark} onChanged={runSearch} />`.

Note: a committed take changes the file on disk, but `hasAudio`/`durationSec` come from the frozen
index, so the duration shown updates only after re-running `export-index`. The drift banner on the
Reports page is what surfaces this.

Append to `web/app/globals.css`:

```css
.reroll { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; font-size: .85rem; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && pnpm test`
Expected: PASS, 5 passed in RerollPanel.test.tsx

- [ ] **Step 6: Commit**

```bash
git add web/components/RerollPanel.tsx web/components/LineRow.tsx web/components/LineList.tsx web/components/__tests__/RerollPanel.test.tsx web/app/page.tsx web/app/globals.css
git commit -m "Add re-roll panel with staged audition and accept or discard"
```

---

### Task 8: Settings and pronunciation editors

**Files:**
- Create: `web/app/api/config/route.ts`, `web/app/settings/page.tsx`
- Modify: `cli-main.py`

**Interfaces:**
- Consumes: `load_generation`, `save_generation`, `load_pronunciation`, `save_pronunciation` (Task 1); `runPython` (Task 6).
- Produces: `GET /api/config`, `PUT /api/config {generation, pronunciation}`.

- [ ] **Step 1: Add the Python config subcommands**

In `cli-main.py` subparsers:

```python
cfg = subparsers.add_parser("config", help="Read or write generation config as JSON.")
cfg.add_argument("--write", action="store_true", help="Read new config from stdin.")
```

And in the dispatch chain:

```python
elif args.mode == "config":
    import json as _json
    import sys as _sys
    from tts_cli.config_store import (load_generation, load_pronunciation,
                                      save_generation, save_pronunciation)
    if args.write:
        incoming = _json.load(_sys.stdin)
        save_generation(incoming["generation"])
        save_pronunciation(incoming["pronunciation"])
    print(_json.dumps({"generation": load_generation(),
                       "pronunciation": load_pronunciation()}))
```

- [ ] **Step 2: Verify the round trip on the command line**

```bash
./.venv/bin/python cli-main.py config
```
Expected: JSON containing `eleven_multilingual_v2` and the two `Hm` rules.

```bash
echo '{"generation":{"model_id":"eleven_multilingual_v2","voice_settings":{"stability":0.6,"similarity_boost":0.75,"style":0,"use_speaker_boost":true},"seed_strategy":"npc"},"pronunciation":{"\\bHm\\b":"Hmm","\\bhm\\b":"hmm"}}' \
  | ./.venv/bin/python cli-main.py config --write
git diff tts_cli/config/generation.json
```
Expected: stability changed to 0.6, shown as a clean diff. Restore with `git checkout tts_cli/config/generation.json`.

- [ ] **Step 3: Add the config API**

Create `web/app/api/config/route.ts`:

```typescript
import { execFile } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";
import { parsePythonOutput, runPython } from "@/lib/python";

const REPO_ROOT = process.env.VOICEOVER_REPO_ROOT ?? path.join(process.cwd(), "..");
const PYTHON = path.join(REPO_ROOT, ".venv", "bin", "python");

export async function GET() {
  try {
    return NextResponse.json(await runPython(["config"]));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  const body = await request.text();
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        PYTHON,
        ["cli-main.py", "config", "--write"],
        { cwd: REPO_ROOT },
        (error, out, err) => (error ? reject(new Error(err || error.message)) : resolve(out)),
      );
      child.stdin?.end(body);
    });
    return NextResponse.json(parsePythonOutput(stdout));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 4: Add the settings page**

Create `web/app/settings/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

interface Config {
  generation: {
    model_id: string;
    voice_settings: Record<string, number | boolean>;
    seed_strategy: string;
  };
  pronunciation: Record<string, string>;
}

export default function SettingsPage() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: Config) => setText(JSON.stringify(cfg, null, 2)))
      .catch((e: Error) => setStatus(e.message));
  }, []);

  const save = () => {
    setStatus("Saving…");
    fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: text,
    })
      .then((r) => r.json().then((b) => (r.ok ? b : Promise.reject(new Error(b.error)))))
      .then((cfg: Config) => {
        setText(JSON.stringify(cfg, null, 2));
        setStatus("Saved.");
      })
      .catch((e: Error) => setStatus(e.message));
  };

  return (
    <main>
      <h1>Generation settings</h1>
      <p>
        Pronunciation keys are regular expressions applied to the spoken text only. They
        cannot change which file is written.
      </p>
      <textarea
        aria-label="configuration"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={28}
        style={{ width: "100%", fontFamily: "monospace" }}
      />
      <p>
        <button type="button" onClick={save}>Save</button>
        {status && <span> {status}</span>}
      </p>
    </main>
  );
}
```

Add a link in `web/app/page.tsx` next to the Reports link:

```tsx
<p><a href="/reports">Reports</a> · <a href="/settings">Settings</a></p>
```

- [ ] **Step 5: Verify in the browser**

Open `http://localhost:3000/settings`. Change `stability` to `0.6`, click Save, confirm "Saved." and that `git diff tts_cli/config/generation.json` shows the change. Then enter an invalid regex such as `[unclosed` as a pronunciation key and save — expect the error text to appear and the file to be unchanged.

- [ ] **Step 6: Commit**

```bash
git add cli-main.py web/app/api/config web/app/settings web/app/page.tsx
git commit -m "Add settings and pronunciation editor"
```

---

### Task 9: Full-suite verification and documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the whole suite**

```bash
./.venv/bin/python -m pytest tests/ -v
cd web && pnpm test
```
Expected: all Python tests pass (naming, index export, audit, config, speech text, seed, synthesize, commit); all web tests pass.

- [ ] **Step 2: Confirm the pack is untouched by a full browse-and-flag session**

```bash
md5 "/Applications/World of Warcraft/_classic_era_/Interface/AddOns/AI_VoiceOverData_Vanilla/generated/sound_length_table.lua"
```
Expected: unchanged from before, since nothing was accepted. Only `commit` may alter it.

- [ ] **Step 3: Document the generation loop**

Append to the "Voiceline Explorer" section of `README.md`:

````markdown
### Regenerating lines

Requires ElevenLabs voices named `race-gender` (e.g. `orc-male`); cloning needs the Starter
plan or above. Tune settings and pronunciation at `/settings`.

Re-roll stages a new take without touching the sound pack. Play it against the current one,
then Accept or Discard. Accept backs the original up to `var/backup/<timestamp>/` before
overwriting, and updates `sound_length_table.lua` — the addon reads durations from that
table, not from disk, so a stale entry cuts the line off.

Gossip lines can only be *replaced*, never added: their filenames are content hashes
resolved through the pack's gossip lookup table, which must not be regenerated.
````

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document the regeneration loop"
```
