"""Find corpus quests a 1.12 server would never hand out.

The extraction takes whatever the dump holds. vmangos does not: every table it loads a quest
through is gated on the patch the server runs, so the corpus is a superset of the game.
This asks the world DB the same three questions vmangos asks - is there a definition at this
patch, is there a questgiver relation at this patch, does any of those questgivers spawn -
and reports the corpus lines that hang off a quest failing one of them. Gossip is asked the
same way, of the speaker rather than the quest: an NPC who stands nowhere says nothing.
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
from tts_cli.reachability import DEFAULT_PATCH, findings, npc_findings  # noqa: E402

parser = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--patch", type=int, default=DEFAULT_PATCH,
                    help="What sWorld.GetWowPatch() returns; 10 is 1.12 (default)")
parser.add_argument("--corpus", default=str(ROOT / DEFAULT_CORPUS_PATH))
parser.add_argument("--ignored", default=str(ROOT / DEFAULT_IGNORED_PATH))
parser.add_argument("--json", type=Path,
                    help="Also write the findings here, for a diff between two dumps")
parser.add_argument("--gossip", action="store_true",
                    help="Also report NPCs whose gossip nobody can reach")
args = parser.parse_args()

# Imported late and by name: it pulls in PyMySQL, which the everyday install does not have,
# and the error worth printing is "install the extract requirements" rather than a traceback.
try:
    from tts_cli.sql_queries import query_npc_reachability, query_quest_reachability
except ImportError as exc:
    raise SystemExit(f"{exc}\n\nThis tool needs the world DB: "
                     "pip install -r requirements-extract.txt")

corpus = load_corpus(args.corpus)
# Already-ignored lines are not news. They are reported as a count so the tool still says
# what it decided not to tell you.
ignored = load_ignored(args.ignored)

facts = query_quest_reachability(args.patch)
found = findings(corpus, facts, args.patch)
speakers = npc_findings(corpus, query_npc_reachability(args.patch), args.patch) \
    if args.gossip else []


def unignored(all_findings):
    """The findings still worth reading, and how many were already decided."""
    fresh = [f for f in all_findings
             if not all(line_id in ignored for line_id in f["lineIds"])]
    return fresh, len(all_findings) - len(fresh)


fresh, silenced = unignored(found)
fresh_speakers, silenced_speakers = unignored(speakers)

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

if args.gossip:
    print(f"\ngossip: {len(speakers)} speakers nobody can reach "
          f"({silenced_speakers} already ignored)\n")
    for finding in fresh_speakers:
        # Line ids rather than the lines themselves: a chatty NPC has dozens, and the point
        # of the report is which NPC to go and look at.
        print(f"{finding['npcType']:>10} {finding['npcId']:<7} {finding['npcName'][:36]:<36} "
              f"{finding['reason']:<13} {finding['confidence']:<8} "
              f"{len(finding['lineIds'])} lines")
        print(f"        {finding['explanation']}")
else:
    print("\n(--gossip also reports NPCs whose gossip nobody can reach)")

if args.json:
    args.json.write_text(json.dumps(
        {"patch": args.patch, "findings": found, "speakers": speakers},
        indent=2, ensure_ascii=False) + "\n")
    print(f"\nwrote {args.json}")
