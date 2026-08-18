"""Command line entry point for the voiceline production pipeline.

Only `extract` needs a database:

    init-db       download and import the vmangos dump      maintainer, rare
    extract       world DB -> corpus/corpus.json.gz         maintainer, rare
    import-audio  an existing sound pack -> audio/          once
    synthesize    corpus + voice config -> audio/           everyday
    build         corpus + audio/ -> dist/<module>          per release
    install       dist/<module> -> WoW AddOns               per release
"""
import argparse

from tqdm import tqdm

from tts_cli.build import (DEFAULT_ADDONS_DIR, DEFAULT_DIST_DIR,
                           DEFAULT_MODULE_NAME, build_module, install_module)
from tts_cli.corpus import DEFAULT_CORPUS_PATH, load_corpus
from tts_cli.env_vars import ELEVENLABS_API_KEY
from tts_cli.ignores import DEFAULT_IGNORED_PATH, ignored_files, load_ignored
from tts_cli.select import estimate, select_lines, unique_by_file
from tts_cli.store import DEFAULT_SOURCE_DIR, DEFAULT_STORE_DIR, import_audio
from tts_cli.synthesize import synthesize_line
from tts_cli.voice_config import apply_pronunciation, load_pronunciation
from tts_cli.voices import fetch_voice_map

# init-db, extract and gen_lookup_tables are imported inside their branches: they pull in
# pandas and PyMySQL, which the everyday path deliberately does not install.

parser = argparse.ArgumentParser(description="Voiceline production pipeline for WoW dialog")
subparsers = parser.add_subparsers(dest="mode", help="Available modes")

subparsers.add_parser(
    "init-db",
    help="Download the vmangos dump and import it. Needed only before 'extract'.")
subparsers.add_parser(
    "extract",
    help="Query the world DB and write the committed corpus. The only stage needing MySQL.") \
    .add_argument("--out", default=DEFAULT_CORPUS_PATH)
imp = subparsers.add_parser(
    "import-audio",
    help="Copy existing mp3s into the project's audio store.")
imp.add_argument("--source", default=DEFAULT_SOURCE_DIR,
                 help="Sound pack to import from (default: the _classic_era_ install).")
imp.add_argument("--store", default=DEFAULT_STORE_DIR)
imp.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
imp.add_argument("--ignored", default=DEFAULT_IGNORED_PATH)

syn = subparsers.add_parser(
    "synthesize",
    help="Render selected corpus lines into the audio store.")
syn.add_argument("--line-id")
syn.add_argument("--npc", help="NPC id or name substring")
syn.add_argument("--quest", help="Quest id or title substring")
syn.add_argument("--voice", help="e.g. human-male")
syn.add_argument("--missing", action="store_true",
                 help="Only lines with no audio in the store")
syn.add_argument("--area", nargs=5, type=float, metavar=("MAP", "X1", "X2", "Y1", "Y2"),
                 help="Only NPCs spawned in this world-coordinate box")
syn.add_argument("--force", action="store_true", help="Replace audio already in the store")
syn.add_argument("--limit", type=int)
syn.add_argument("--dry-run", action="store_true",
                 help="Report what would be generated and what it would cost")
syn.add_argument("--store", default=DEFAULT_STORE_DIR)
syn.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
syn.add_argument("--ignored", default=DEFAULT_IGNORED_PATH)

bld = subparsers.add_parser(
    "build",
    help="Assemble the addon data module from the corpus and the audio store.")
bld.add_argument("--store", default=DEFAULT_STORE_DIR)
bld.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
bld.add_argument("--dist", default=DEFAULT_DIST_DIR)
bld.add_argument("--module", default=DEFAULT_MODULE_NAME)
bld.add_argument("--version", default="1.0.1")
bld.add_argument("--ignored", default=DEFAULT_IGNORED_PATH)

ins = subparsers.add_parser(
    "install", help="Copy the built module into a WoW AddOns folder.")
ins.add_argument("--addons", default=DEFAULT_ADDONS_DIR)
ins.add_argument("--dist", default=DEFAULT_DIST_DIR)
ins.add_argument("--module", default=DEFAULT_MODULE_NAME)
ins.add_argument("--force", action="store_true",
                 help="Replace an existing install, moving it aside first")

ign = subparsers.add_parser(
    "ignored-files",
    help="Print store-relative mp3s whose every corpus line is ignored (rsync exclusions).")
ign.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
ign.add_argument("--ignored", default=DEFAULT_IGNORED_PATH)

subparsers.add_parser(
    "gen_lookup_tables",
    help="Generate the addon lookup tables and sound length table.") \
    .add_argument("--lang", default="enUS")

args = parser.parse_args()

if args.mode == "init-db":
    from tts_cli.init_db import (download_and_extract_latest_db_dump,
                                 import_sql_files_to_database)
    download_and_extract_latest_db_dump()
    import_sql_files_to_database()
    print("Database initialized successfully.")

elif args.mode == "extract":
    from tts_cli.corpus import extract
    corpus = extract(args.out)
    print(f"Wrote {corpus['lineCount']} lines "
          f"and spawns for {len(corpus['spawns'])} NPCs to {args.out}")

elif args.mode == "import-audio":
    report = import_audio(args.source, args.store, load_corpus(args.corpus), progress=True,
                          ignored=load_ignored(args.ignored))
    print(f"\nadopted        {report['adopted']}")
    print(f"already stored {report['alreadyPresent']}")
    print(f"unmatched      {len(report['unmatched'])}  (no corpus line; not imported)")
    print(f"still missing  {report['missing']}  (generatable lines with no audio)")
    for rel in report["unmatched"][:10]:
        print(f"    unmatched: {rel}")
    if len(report["unmatched"]) > 10:
        print(f"    ... and {len(report['unmatched']) - 10} more")

elif args.mode == "synthesize":
    corpus = load_corpus(args.corpus)
    ignored = load_ignored(args.ignored)
    area = (int(args.area[0]), (args.area[1], args.area[2]), (args.area[3], args.area[4])) \
        if args.area else None
    selected = select_lines(corpus, args.store, npc=args.npc, quest=args.quest,
                            voice=args.voice, line_id=args.line_id,
                            missing=args.missing, area=area, ignored=ignored)
    targets = unique_by_file([l for l in selected if l["generatable"]])
    if args.limit:
        targets = targets[:args.limit]

    est = estimate(targets)
    print(f"selected {len(selected)} lines -> {est['files']} files, "
          f"{est['characters']:,} characters")
    print(f"voices needed: {', '.join(est['voices']) or 'none'}")

    if args.dry_run or not targets:
        # Show what will actually be spoken, after pronunciation rules - that is the
        # thing worth eyeballing before spending characters.
        rules = load_pronunciation()
        for line in targets[:10]:
            spoken = apply_pronunciation(line["text"], rules)
            flag = "*" if spoken != line["text"] else " "
            print(f"  {flag} {line['lineId']:<26} {line['voice']:<14} {spoken[:52]}")
        if len(targets) > 10:
            print(f"    ... and {len(targets) - 10} more")
        if any(apply_pronunciation(l["text"], rules) != l["text"] for l in targets):
            print("  (* = pronunciation rules changed the spoken text)")
        raise SystemExit(0)

    voice_map = fetch_voice_map(ELEVENLABS_API_KEY)
    unavailable = sorted(set(est["voices"]) - set(voice_map))
    if unavailable:
        raise SystemExit(
            f"missing ElevenLabs voices: {', '.join(unavailable)}\n"
            "Voice clones must be named race-gender (e.g. orc-male); "
            "cloning requires a paid plan.")

    done = failed = 0
    for line in tqdm(targets, unit="line", desc="Synthesizing"):
        try:
            synthesize_line(line, voice_map[line["voice"]], args.store, force=args.force)
            done += 1
        except FileExistsError:
            pass
        except Exception as exc:
            failed += 1
            print(f"\n  {line['lineId']}: {exc}")
    print(f"\nsynthesized {done}, failed {failed}")

elif args.mode == "build":
    report = build_module(load_corpus(args.corpus), args.store, args.dist,
                          args.module, args.version, progress=True,
                          ignored=load_ignored(args.ignored))
    print(f"\nbuilt {report['moduleDir']}")
    print(f"  audio files {report['audioFiles']}")
    for name, rows in sorted(report["tableRows"].items()):
        print(f"  {name:<32} {rows:>6} entries")

elif args.mode == "ignored-files":
    # One path per line and nothing else: this is read by `make push`/`make pull` as an
    # rsync --exclude-from file, which takes one pattern per line.
    for rel in ignored_files(load_corpus(args.corpus), load_ignored(args.ignored)):
        print(rel)

elif args.mode == "install":
    import os as _os
    report = install_module(_os.path.join(args.dist, args.module), args.addons, args.force)
    print(f"installed {report['target']}")
    if report["replaced"]:
        print(f"previous install moved to {report['replaced']}")

elif args.mode == "gen_lookup_tables":
    from tts_cli import utils
    from tts_cli.sql_queries import query_dataframe_for_all_quests_and_gossip
    from tts_cli.tts_utils import TTSProcessor

    tts_processor = TTSProcessor()
    language_number = utils.language_code_to_language_number(args.lang)
    print(f"Selected language: {args.lang}")
    df = query_dataframe_for_all_quests_and_gossip(language_number)
    df = tts_processor.preprocess_dataframe(df)
    tts_processor.generate_lookup_tables(df)

else:
    parser.print_help()
