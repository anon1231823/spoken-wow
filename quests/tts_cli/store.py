"""The audio store: every mp3 this project has produced.

Lives at audio/{quests,gossip}/*.mp3, gitignored. This is the project's most expensive
asset - roughly 2.26M ElevenLabs characters for the quest lines alone - and until now it
existed only inside a WoW install folder, where a game reinstall would destroy it.

The store is addressed by the same filenames the addon resolves, derived through
tts_cli.naming, so a file here can be copied into a data module unchanged.
"""
import os
import shutil

from tqdm import tqdm

from tts_cli.naming import subfolder_from_line_id

DEFAULT_STORE_DIR = "audio"
# The pack this project imported its inherited audio from, which is upstream's and keeps
# upstream's name: import-audio reads what is already installed, and what was installed in
# 2024 is not called VoiceOverReduxAudio.
DEFAULT_SOURCE_DIR = ("/Applications/World of Warcraft/_classic_era_/Interface/AddOns"
                      "/AI_VoiceOverData_Vanilla/generated/sounds")
SUBFOLDERS = ("quests", "gossip")


def store_path(store_dir: str, line: dict) -> str:
    """Where a corpus line's audio lives in the store."""
    return os.path.join(store_dir, subfolder_from_line_id(line["lineId"]),
                        line["fileName"] + ".mp3")


def _relative_paths_for(corpus: dict) -> dict:
    """Map 'quests/5-accept.mp3' -> the corpus line that owns it."""
    owners = {}
    for line in corpus["lines"]:
        rel = f'{subfolder_from_line_id(line["lineId"])}/{line["fileName"]}.mp3'
        owners.setdefault(rel, line)
    return owners


def _walk(directory: str) -> list:
    found = []
    for sub in SUBFOLDERS:
        path = os.path.join(directory, sub)
        if not os.path.isdir(path):
            continue
        found.extend(f"{sub}/{name}" for name in sorted(os.listdir(path))
                     if name.endswith(".mp3"))
    return found


def stored_files(store_dir: str) -> list:
    """Every mp3 in the store, as 'subfolder/name.mp3'."""
    return _walk(store_dir)


def unmatched_files(directory: str, corpus: dict) -> list:
    """Files with no corpus line.

    These are lines whose text drifted out of vmangos since the audio was made. The addon
    resolves sounds through a lookup table built from the corpus, so it can never reach
    them - they are dead weight, listed so they can be pruned deliberately.
    """
    owners = _relative_paths_for(corpus)
    return [rel for rel in _walk(directory) if rel not in owners]


def missing_lines(store_dir: str, corpus: dict, ignored=()) -> list:
    """Generatable corpus lines with no audio in the store - the real gaps.

    Lines the generator never voices (progress text, unresolved template tokens) are not
    gaps and are excluded. Neither are ignored lines: a line somebody decided never to voice
    is a closed question, and counting it as missing would reopen it on every report.
    """
    present = set(_walk(store_dir))
    return [
        line for line in corpus["lines"]
        if line["generatable"]
        and line["lineId"] not in ignored
        and f'{subfolder_from_line_id(line["lineId"])}/{line["fileName"]}.mp3' not in present
    ]


def import_audio(source_dir: str, store_dir: str, corpus: dict, progress: bool = False,
                 ignored=()) -> dict:
    """Copy existing audio into the store, keeping only what the corpus can address.

    Ignored lines narrow the report's missing count only. An mp3 that already exists is
    still adopted: importing is how audio nobody can reproduce gets into the store, and
    deciding not to voice a line is not a reason to drop the take that already exists.
    """
    if not os.path.isdir(source_dir):
        raise FileNotFoundError(f"no audio source directory at {source_dir}")

    owners = _relative_paths_for(corpus)
    incoming = _walk(source_dir)

    adopted = already = 0
    unmatched = []

    for sub in SUBFOLDERS:
        os.makedirs(os.path.join(store_dir, sub), exist_ok=True)

    iterator = tqdm(incoming, unit="file", desc="Importing audio") if progress else incoming
    for rel in iterator:
        if rel not in owners:
            unmatched.append(rel)
            continue
        target = os.path.join(store_dir, rel)
        if os.path.isfile(target):
            already += 1
            continue
        shutil.copy2(os.path.join(source_dir, rel), target)
        adopted += 1

    return {
        "adopted": adopted,
        "alreadyPresent": already,
        "unmatched": unmatched,
        "missing": len(missing_lines(store_dir, corpus, ignored)),
    }
