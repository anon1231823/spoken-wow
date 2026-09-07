"""Render corpus lines into the audio store.

Reads text and voice from the committed corpus, so this stage needs no database. The HTTP
call is injected to keep it testable without an ElevenLabs account.
"""
import os

import mutagen.mp3
import requests

from tts_cli.store import store_path
from tts_cli.voice_config import apply_pronunciation, seed_for

API_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"


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


def synthesize_line(line: dict, voice_id: str, store_dir: str,
                    generation_cfg: dict = None, rules: dict = None,
                    http_post=requests.post, force: bool = False) -> dict:
    """Synthesize one line into the store.

    Refuses to overwrite unless forced: audio already in the store cost real money, and a
    re-roll is not always an improvement.
    """
    if not line.get("generatable", True):
        raise ValueError(
            f'{line["lineId"]} is never voiced ({line.get("skipReason")})')

    from tts_cli.env_vars import ELEVENLABS_API_KEY
    from tts_cli.voice_config import load_generation, load_pronunciation

    generation_cfg = load_generation() if generation_cfg is None else generation_cfg
    rules = load_pronunciation() if rules is None else rules

    path = store_path(store_dir, line)
    if os.path.isfile(path) and not force:
        raise FileExistsError(f"{path} already exists; pass force to replace it")

    payload = build_payload(line, generation_cfg, rules)
    response = http_post(API_URL.format(voice_id=voice_id), json=payload,
                         headers={"xi-api-key": ELEVENLABS_API_KEY})

    if response.status_code != 200:
        raise RuntimeError(
            f"ElevenLabs returned {response.status_code}: {response.text[:200]}")
    if response.headers.get("Content-Type") != "audio/mpeg":
        raise RuntimeError(
            f'response was not audio (Content-Type {response.headers.get("Content-Type")})')

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(response.content)

    return {
        "lineId": line["lineId"],
        "path": path,
        "durationSec": _duration(path),
        "characters": len(payload["text"]),
        "seed": payload.get("seed"),
        "spokenText": payload["text"],
    }
