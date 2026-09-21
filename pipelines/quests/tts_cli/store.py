"""The folder a sound pack is built from: audio/{quests,gossip}/*.mp3, gitignored.

Not a record of anything. Every take lives in the site's archive, and this folder is
assembled from the live ones right before a build (scripts/audio/sounds.mjs), under the
same filenames the addon resolves, so a file here is copied into a data module unchanged.
"""
import os


DEFAULT_STORE_DIR = "audio"
SUBFOLDERS = ("quests", "gossip")
#: What counts as audio when walking a directory. The folder itself is always mp3 - the
#: masters, as ElevenLabs made them - but scripts/package-audio.sh stages a transcoded copy
#: and hands it to `build --store`, and that copy is ogg for the packs this project ships.
AUDIO_EXTENSIONS = (".mp3", ".ogg")


def _walk(directory: str, extensions=(".mp3",)) -> list:
    found = []
    for sub in SUBFOLDERS:
        path = os.path.join(directory, sub)
        if not os.path.isdir(path):
            continue
        found.extend(f"{sub}/{name}" for name in sorted(os.listdir(path))
                     if name.endswith(extensions))
    return found


def stored_files(store_dir: str) -> list:
    """Every audio file in the store, as 'subfolder/name.ext'."""
    return _walk(store_dir, AUDIO_EXTENSIONS)


def audio_extension(store_dir: str) -> str:
    """The one extension the store's audio uses, '.mp3' where there is none to find.

    A module resolves every sound through a single GetSoundPath, so it can ship one format
    and not two: a directory holding both is a half-finished transcode, and building from
    it would point half the lookup entries at files that are not there.
    """
    found = {os.path.splitext(rel)[1] for rel in stored_files(store_dir)}
    if len(found) > 1:
        raise ValueError(
            f"{store_dir} holds more than one audio format ({', '.join(sorted(found))}); "
            "a module can ship only one")
    return found.pop() if found else ".mp3"
