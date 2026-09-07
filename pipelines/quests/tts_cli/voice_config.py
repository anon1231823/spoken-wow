"""How a line is voiced: generation settings, pronunciation rules, and seeding.

Kept as JSON under voice/ rather than as Python literals so the settings can be tuned
without touching code and reviewed as a diff.

This module is where both shipped defects are addressed:

  Same NPC, several voices. There is one clone per race-gender pair, so an NPC always
  uses the same voice; what varied was the sampling. The old call sent stability 0.28 and
  similarity_boost 0.992 with no model and no seed, making every line an independent draw
  at near-maximum latitude. Defaults now sit near the API's own, and the seed is derived
  from the NPC so all of that NPC's lines draw the same way.

  Mispronunciation. Nothing normalized text for speech, so "Hm" was read as the letters
  H and M. Rules here are applied to the spoken text only.
"""
import json
import os
import re
import zlib

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GENERATION_PATH = os.path.join(_HERE, "voice", "generation.json")
PRONUNCIATION_PATH = os.path.join(_HERE, "voice", "pronunciation.json")

#: ElevenLabs accepts a seed in [0, 4294967295]. Determinism is documented as best
#: effort, so this is a strong mitigation for voice drift rather than a guarantee.
ELEVENLABS_SEED_MAX = 4294967295

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


def apply_pronunciation(text: str, rules: dict) -> str:
    """Normalize text for speech. Applied to the spoken string only.

    Filenames derive from original_text, so nothing here can change which file is
    written - that separation is what makes pronunciation fixes safe to apply to audio
    that has already shipped.
    """
    for pattern, replacement in rules.items():
        text = re.sub(pattern, replacement, text)
    return text


def seed_for(npc_id: int, strategy: str):
    """A seed that is stable per NPC, so their lines sound like one performer."""
    if strategy == "none":
        return None
    if strategy == "npc":
        return zlib.crc32(str(npc_id).encode()) % (ELEVENLABS_SEED_MAX + 1)
    raise ValueError(f"unknown seed strategy {strategy!r}")
