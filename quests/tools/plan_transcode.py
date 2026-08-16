"""What scripts/package-audio.sh should do with each file in the audio store.

One line per clip: `md5<TAB>kbps<TAB>action<TAB>relative path`, where the action is
`encode` or `copy`.

WHY THIS EXISTS RATHER THAN A LINE OF SHELL. Two thirds of the store is the sound pack this
project inherited, already 64 kbps CBR mono, and LAME's -q:a 6 lands on roughly the same
bitrate: re-encoding one of those makes a file that is no smaller and audibly worse, because
it is a second lossy pass over the first. Only the takes this pipeline made, at 128 kbps, have
anything to give. Telling the two apart means reading each file's bitrate, which is mutagen's
job and not ffmpeg's, and the md5 is free once the file is open anyway.

The threshold is a bitrate rather than a list of filenames because the store is not
homogeneous and will not stay so: a re-generated line replaces an inherited one at whatever
the current model produces, and that file should start being transcoded the day it lands.

Ignored lines are dropped here (tts_cli/ignores.py), so the expensive stage never sees a file
the module would leave out anyway.
"""
import argparse
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mutagen.mp3  # noqa: E402

from tts_cli.ignores import DEFAULT_IGNORED_PATH, ignored_files  # noqa: E402
from tts_cli.corpus import DEFAULT_CORPUS_PATH, load_corpus  # noqa: E402
from tts_cli.ignores import load_ignored  # noqa: E402
from tts_cli.store import SUBFOLDERS  # noqa: E402

#: Above this, in kbps, a clip is worth transcoding. Chosen just over the 64 kbps of the
#: inherited pack, which -q:a 6 cannot beat, and well under the 128 kbps of everything the
#: web app and the CLI generate today.
DEFAULT_THRESHOLD = 80

parser = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--store", default="audio")
parser.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
parser.add_argument("--ignored", default=DEFAULT_IGNORED_PATH)
parser.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD,
                    help="kbps above which a clip is transcoded (default: 80)")
args = parser.parse_args()

skip = set(ignored_files(load_corpus(args.corpus), load_ignored(args.ignored)))

encode = copy = 0
for sub in SUBFOLDERS:
    directory = os.path.join(args.store, sub)
    if not os.path.isdir(directory):
        continue
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".mp3"):
            continue
        rel = f"{sub}/{name}"
        if rel in skip:
            continue

        path = os.path.join(directory, name)
        with open(path, "rb") as f:
            digest = hashlib.md5(f.read()).hexdigest()
        kbps = round(mutagen.mp3.MP3(path).info.bitrate / 1000)

        action = "encode" if kbps > args.threshold else "copy"
        encode += action == "encode"
        copy += action == "copy"
        print(f"{digest}\t{kbps}\t{action}\t{rel}")

print(f"{encode} to encode, {copy} already at or below {args.threshold} kbps",
      file=sys.stderr)
