import pytest

from tts_cli import voice_config
from tts_cli.naming import filename_for_row
from tts_cli.voice_config import (ELEVENLABS_SEED_MAX, apply_pronunciation,
                                  seed_for)

RULES = {r"\bHm\b": "Hmm", r"\bhm\b": "hmm"}


def test_generation_defaults_favour_consistency():
    """The shipped settings were stability 0.28 / similarity 0.992, which maximised
    per-call variance and made one NPC drift between performers."""
    cfg = voice_config.load_generation()
    assert cfg["model_id"] == "eleven_multilingual_v2"
    assert cfg["voice_settings"]["stability"] == 0.5
    assert cfg["voice_settings"]["similarity_boost"] == 0.75
    assert cfg["seed_strategy"] == "npc"


def test_shipped_pronunciation_covers_the_known_defect():
    rules = voice_config.load_pronunciation()
    assert rules[r"\bHm\b"] == "Hmm"


def test_generation_round_trips(tmp_path, monkeypatch):
    monkeypatch.setattr(voice_config, "GENERATION_PATH", str(tmp_path / "g.json"))
    voice_config.save_generation(
        {"model_id": "x", "voice_settings": {}, "seed_strategy": "npc"})
    assert voice_config.load_generation()["model_id"] == "x"


def test_pronunciation_round_trips(tmp_path, monkeypatch):
    monkeypatch.setattr(voice_config, "PRONUNCIATION_PATH", str(tmp_path / "p.json"))
    voice_config.save_pronunciation({r"\bfoo\b": "bar"})
    assert voice_config.load_pronunciation() == {r"\bfoo\b": "bar"}


def test_rejects_invalid_regex(tmp_path, monkeypatch):
    monkeypatch.setattr(voice_config, "PRONUNCIATION_PATH", str(tmp_path / "p.json"))
    with pytest.raises(ValueError, match="invalid regex"):
        voice_config.save_pronunciation({"[unclosed": "x"})


def test_rejects_out_of_range_stability(tmp_path, monkeypatch):
    monkeypatch.setattr(voice_config, "GENERATION_PATH", str(tmp_path / "g.json"))
    with pytest.raises(ValueError, match="stability"):
        voice_config.save_generation(
            {"model_id": "m", "voice_settings": {"stability": 5}, "seed_strategy": "npc"})


def test_fixes_standalone_hm():
    assert apply_pronunciation("Hm... I see.", RULES) == "Hmm... I see."


def test_leaves_hm_inside_a_word_alone():
    assert apply_pronunciation("Chromie waits.", RULES) == "Chromie waits."


def test_no_rules_is_identity():
    assert apply_pronunciation("unchanged", {}) == "unchanged"


def test_pronunciation_never_changes_a_filename():
    """The safety property the whole design rests on: filenames derive from
    original_text, speech derives from cleanedText. Pronunciation edits therefore
    change what is said without changing which file is written."""
    row = {"quest": "", "source": "gossip", "player_gender": None,
           "templateText_race_gender_hash": "abc123"}
    before = filename_for_row(row)
    spoken = apply_pronunciation("Hm... hello", RULES)

    assert spoken != "Hm... hello"          # speech changed
    assert filename_for_row(row) == before  # filename did not


def test_same_npc_gets_the_same_seed():
    assert seed_for(240, "npc") == seed_for(240, "npc")


def test_different_npcs_get_different_seeds():
    assert seed_for(240, "npc") != seed_for(241, "npc")


@pytest.mark.parametrize("npc_id", [0, 1, 240, 99999, 2 ** 31])
def test_seed_stays_in_the_api_range(npc_id):
    assert 0 <= seed_for(npc_id, "npc") <= ELEVENLABS_SEED_MAX


def test_seeding_can_be_disabled():
    assert seed_for(240, "none") is None


def test_unknown_seed_strategy_is_rejected():
    with pytest.raises(ValueError, match="unknown seed strategy"):
        seed_for(240, "wat")
