"""Command line entry point for the voiceline production pipeline.

Three stages, only the first of which needs a database:

    extract   vmangos MySQL -> corpus/corpus.json.gz   (maintainer only, rare)
    ...       corpus + audio store -> synthesized audio (everyday)
    ...       corpus + audio store -> data module        (build the artifact)
"""
import argparse

from tts_cli.corpus import DEFAULT_CORPUS_PATH, extract, load_corpus
from tts_cli.store import DEFAULT_SOURCE_DIR, DEFAULT_STORE_DIR, import_audio
from tts_cli.init_db import download_and_extract_latest_db_dump, import_sql_files_to_database
from tts_cli.sql_queries import query_dataframe_for_all_quests_and_gossip
from tts_cli.tts_utils import TTSProcessor
from tts_cli import utils

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

subparsers.add_parser(
    "gen_lookup_tables",
    help="Generate the addon lookup tables and sound length table.") \
    .add_argument("--lang", default="enUS")

args = parser.parse_args()

if args.mode == "init-db":
    download_and_extract_latest_db_dump()
    import_sql_files_to_database()
    print("Database initialized successfully.")

elif args.mode == "extract":
    corpus = extract(args.out)
    print(f"Wrote {corpus['lineCount']} lines "
          f"and spawns for {len(corpus['spawns'])} NPCs to {args.out}")

elif args.mode == "import-audio":
    report = import_audio(args.source, args.store, load_corpus(args.corpus), progress=True)
    print(f"\nadopted        {report['adopted']}")
    print(f"already stored {report['alreadyPresent']}")
    print(f"unmatched      {len(report['unmatched'])}  (no corpus line; not imported)")
    print(f"still missing  {report['missing']}  (generatable lines with no audio)")
    for rel in report["unmatched"][:10]:
        print(f"    unmatched: {rel}")
    if len(report["unmatched"]) > 10:
        print(f"    ... and {len(report['unmatched']) - 10} more")

elif args.mode == "gen_lookup_tables":
    tts_processor = TTSProcessor()
    language_number = utils.language_code_to_language_number(args.lang)
    print(f"Selected language: {args.lang}")
    df = query_dataframe_for_all_quests_and_gossip(language_number)
    df = tts_processor.preprocess_dataframe(df)
    tts_processor.generate_lookup_tables(df)

else:
    parser.print_help()
