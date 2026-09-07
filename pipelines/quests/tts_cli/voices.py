"""Which ElevenLabs voices are usable for this project.

Lifted out of TTSProcessor so the everyday path never imports pandas. The pipeline uses one
clone per race-gender-flavor, named e.g. 'orc-male-shady'; stock library voices are ignored
because their names cannot express that mapping.
"""
import requests

from tts_cli.consts import GENDER_DICT, RACE_DICT

VOICES_URL = "https://api.elevenlabs.io/v1/voices"


def fetch_voice_map(api_key: str, http_get=requests.get) -> dict:
    """Map 'race-gender[-flavor]' -> voice id for voices this project can use."""
    response = http_get(VOICES_URL, headers={"xi-api-key": api_key})
    if response.status_code != 200:
        raise RuntimeError(
            f"could not list ElevenLabs voices ({response.status_code}): "
            f"{response.text[:200]}")

    races = set(RACE_DICT.values())
    genders = set(GENDER_DICT.values())

    # The flavor is optional: narrator-male is a pseudo-race for gameobjects and has no NPC
    # voice sets to choose between, and neither do models from later expansions.
    voice_map = {}
    for voice in response.json()["voices"]:
        parts = voice["name"].split("-")
        if len(parts) in (2, 3) and parts[0] in races and parts[1] in genders:
            voice_map[voice["name"]] = voice["voice_id"]
    return voice_map
