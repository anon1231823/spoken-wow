import pytest

from tts_cli.voices import fetch_voice_map


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.text = "error body"

    def json(self):
        return self._payload


def _voices(*names):
    return FakeResponse({"voices": [{"name": n, "voice_id": f"id-{n}"} for n in names]})


def test_keeps_race_gender_voices():
    got = fetch_voice_map("k", http_get=lambda *a, **kw: _voices("orc-male", "human-female"))
    assert got == {"orc-male": "id-orc-male", "human-female": "id-human-female"}


def test_keeps_flavored_voices():
    """A race-gender has two or three distinct NPC voices; the flavor names which."""
    got = fetch_voice_map(
        "k", http_get=lambda *a, **kw: _voices("orc-female-shaman", "nightelf-male-warrior"))
    assert list(got) == ["orc-female-shaman", "nightelf-male-warrior"]


def test_ignores_names_with_too_many_parts():
    got = fetch_voice_map("k", http_get=lambda *a, **kw: _voices("orc-male-shady-v2", "orc-male"))
    assert list(got) == ["orc-male"]


def test_ignores_stock_library_voices():
    """Stock voices are named things like Rachel and cannot express race-gender."""
    got = fetch_voice_map("k", http_get=lambda *a, **kw: _voices("Rachel", "Adam", "orc-male"))
    assert list(got) == ["orc-male"]


def test_ignores_unknown_races_and_genders():
    got = fetch_voice_map(
        "k", http_get=lambda *a, **kw: _voices("murloc-male", "orc-neuter", "orc-male"))
    assert list(got) == ["orc-male"]


def test_accepts_the_narrator_pseudo_race():
    """Gameobjects and items map to DisplayRaceID -1, voiced by 'narrator'."""
    got = fetch_voice_map("k", http_get=lambda *a, **kw: _voices("narrator-male"))
    assert list(got) == ["narrator-male"]


def test_raises_on_a_rejected_key():
    with pytest.raises(RuntimeError, match="401"):
        fetch_voice_map("bad", http_get=lambda *a, **kw: FakeResponse({}, status=401))


def test_empty_account_gives_an_empty_map():
    assert fetch_voice_map("k", http_get=lambda *a, **kw: _voices()) == {}
