"""Find corpus quests a 1.12 server would never hand out.

The extraction takes whatever the dump holds. vmangos does not: every table it loads a quest
through is gated on the patch the server runs, so the corpus is a superset of the game.
This asks the world DB the same three questions vmangos asks - is there a definition at this
patch, is there a questgiver relation at this patch, does any of those questgivers spawn -
and reports the corpus lines that hang off a quest failing one of them.
tts_cli/reachability.py holds the rules and the reasoning; this is the plumbing.

**A report, not an action.** Nothing is ignored, nothing is deleted. A finding is a lead to
read: the `no-spawn` ones especially, because vmangos spawn data has gaps of its own and an
NPC missing from it is sometimes a hole in the dump rather than a hole in the game. Ignore
the ones you agree with in the explorer, where the decision carries a reason and an author.

docs/unreachable-quest-candidates.md answers the same question from Questie's hand-curated
blacklist. Two sources that disagree are worth more than either alone.

Needs the world DB, so `pip install -r requirements-extract.txt` and:

    docker compose up -d mysql
    python cli-main.py init-db          # if the dump is not imported yet
    python3 tools/scan_unreachable_quests.py
    python3 tools/scan_unreachable_quests.py --patch 8 --json /tmp/found.json
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tts_cli.corpus import DEFAULT_CORPUS_PATH, load_corpus  # noqa: E402
from tts_cli.ignores import DEFAULT_IGNORED_PATH, load_ignored  # noqa: E402
from tts_cli.reachability import DEFAULT_PATCH, findings  # noqa: E402

parser = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--patch", type=int, default=DEFAULT_PATCH,
                    help="What sWorld.GetWowPatch() returns; 10 is 1.12 (default)")
parser.add_argument("--corpus", default=str(ROOT / DEFAULT_CORPUS_PATH))
parser.add_argument("--ignored", default=str(ROOT / DEFAULT_IGNORED_PATH))
parser.add_argument("--json", type=Path,
                    help="Also write the findings here, for a diff between two dumps")
args = parser.parse_args()

# Imported late and by name: it pulls in PyMySQL, which the everyday install does not have,
# and the error worth printing is "install the extract requirements" rather than a traceback.
try:
    from tts_cli.sql_queries import query_quest_reachability
except ImportError as exc:
    raise SystemExit(f"{exc}\n\nThis tool needs the world DB: "
                     "pip install -r requirements-extract.txt")

corpus = load_corpus(args.corpus)
# Already-ignored lines are not news. They are reported as a count so the tool still says
# what it decided not to tell you.
ignored = load_ignored(args.ignored)

facts = query_quest_reachability(args.patch)
found = findings(corpus, facts, args.patch)

fresh = []
silenced = 0
for finding in found:
    if all(line_id in ignored for line_id in finding["lineIds"]):
        silenced += 1
        continue
    fresh.append(finding)

print(f"corpus quests: {len({l['questId'] for l in corpus['lines'] if l['questId']})}, "
      f"world DB quests: {len(facts)}, patch: {args.patch}")
print(f"unreachable: {len(found)}  ({silenced} already ignored)\n")

for finding in fresh:
    title = finding["questTitle"] or "(no title)"
    print(f"{finding['questId']:>6}  {title[:44]:<44}  {finding['reason']:<14} "
          f"{finding['confidence']:<8} {len(finding['lineIds'])} lines")
    print(f"        {finding['explanation']}")
    print(f"        {', '.join(finding['lineIds'])}")

if not fresh:
    print("nothing new. Every unreachable quest the world DB knows of is already ignored.")

if args.json:
    args.json.write_text(json.dumps(
        {"patch": args.patch, "findings": found}, indent=2, ensure_ascii=False) + "\n")
    print(f"\nwrote {args.json}")
