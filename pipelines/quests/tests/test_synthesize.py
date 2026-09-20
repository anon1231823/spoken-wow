import os

import pytest

from tts_cli.synthesize import build_payload, synthesize_line

LINE = {
    "lineId": "q:123:complete",
    "npcId": 240,
    "voice": "human-male",
    "fileName": "123-complete",
    "text": "Hm... I have heard of this Collector.",
    "generatable": True,
}
CFG = {
    "model_id": "eleven_v3",
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


def _ok(*args, **kwargs):
    return FakeResponse()


def test_speaks_the_normalized_text():
    assert build_payload(LINE, CFG, RULES)["text"].startswith("Hmm...")


def test_carries_model_and_settings():
    payload = build_payload(LINE, CFG, RULES)
    assert payload["model_id"] == "eleven_v3"
    assert payload["voice_settings"]["stability"] == 0.5


def test_seed_is_shared_across_one_npcs_lines():
    other = {**LINE, "lineId": "q:9:accept", "fileName": "9-accept"}
    assert build_payload(LINE, CFG, RULES)["seed"] == build_payload(other, CFG, RULES)["seed"]


def test_seed_differs_between_npcs():
    other = {**LINE, "npcId": 241}
    assert build_payload(LINE, CFG, RULES)["seed"] != build_payload(other, CFG, RULES)["seed"]


def test_seed_omitted_when_disabled():
    assert "seed" not in build_payload(LINE, {**CFG, "seed_strategy": "none"}, RULES)


def test_writes_into_the_store(tmp_path, monkeypatch):
    monkeypatch.setattr("tts_cli.synthesize._duration", lambda p: 6.6)
    result = synthesize_line(LINE, "voice-id", str(tmp_path),
                             generation_cfg=CFG, rules=RULES, http_post=_ok)
    assert result["path"] == os.path.join(str(tmp_path), "quests", "123-complete.mp3")
    assert os.path.isfile(result["path"])
    assert result["durationSec"] == 6.6


def test_reports_cost_of_the_spoken_text(tmp_path, monkeypatch):
    monkeypatch.setattr("tts_cli.synthesize._duration", lambda p: 1.0)
    result = synthesize_line(LINE, "voice-id", str(tmp_path),
                             generation_cfg=CFG, rules=RULES, http_post=_ok)
    assert result["characters"] == len(result["spokenText"])


def test_refuses_to_overwrite_without_force(tmp_path, monkeypatch):
    monkeypatch.setattr("tts_cli.synthesize._duration", lambda p: 1.0)
    synthesize_line(LINE, "v", str(tmp_path), generation_cfg=CFG, rules=RULES, http_post=_ok)
    with pytest.raises(FileExistsError):
        synthesize_line(LINE, "v", str(tmp_path), generation_cfg=CFG, rules=RULES, http_post=_ok)


def test_force_replaces_an_existing_take(tmp_path, monkeypatch):
    monkeypatch.setattr("tts_cli.synthesize._duration", lambda p: 1.0)
    synthesize_line(LINE, "v", str(tmp_path), generation_cfg=CFG, rules=RULES, http_post=_ok)
    result = synthesize_line(LINE, "v", str(tmp_path), generation_cfg=CFG, rules=RULES,
                             http_post=lambda *a, **k: FakeResponse(content=b"NEW"),
                             force=True)
    with open(result["path"], "rb") as f:
        assert f.read() == b"NEW"


def test_refuses_lines_the_generator_never_voices(tmp_path):
    line = {**LINE, "generatable": False, "skipReason": "progress"}
    with pytest.raises(ValueError, match="progress"):
        synthesize_line(line, "v", str(tmp_path), generation_cfg=CFG, rules=RULES,
                        http_post=_ok)


def test_surfaces_http_errors(tmp_path):
    with pytest.raises(RuntimeError, match="401"):
        synthesize_line(LINE, "v", str(tmp_path), generation_cfg=CFG, rules=RULES,
                        http_post=lambda *a, **k: FakeResponse(status=401))


def test_rejects_a_non_audio_response(tmp_path):
    with pytest.raises(RuntimeError, match="not audio"):
        synthesize_line(LINE, "v", str(tmp_path), generation_cfg=CFG, rules=RULES,
                        http_post=lambda *a, **k: FakeResponse(ctype="application/json"))


def test_nothing_is_written_when_the_call_fails(tmp_path):
    with pytest.raises(RuntimeError):
        synthesize_line(LINE, "v", str(tmp_path), generation_cfg=CFG, rules=RULES,
                        http_post=lambda *a, **k: FakeResponse(status=500))
    assert not os.path.exists(os.path.join(str(tmp_path), "quests", "123-complete.mp3"))
