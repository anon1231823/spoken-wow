"""Command line entry point for the voiceline production pipeline.

Audio is not made here: every take is cut by the site and archived there. What is left is
the corpus, and building a pack from audio/ once `make quests-sounds` has assembled it:

    init-db       download and import the vmangos dump      maintainer, rare
    extract       world DB -> corpus/corpus.json.gz         maintainer, rare
    import-corpus corpus/corpus.json.gz -> Postgres         after an extract
    export-corpus Postgres -> corpus/corpus.json.gz         before a build
    build         corpus + audio/ -> dist/<module>          per release
    install       dist/<module> -> WoW AddOns               per release
"""
import argparse

from tts_cli.build import (DEFAULT_ADDONS_DIR, DEFAULT_DIST_DIR,
                           DEFAULT_MODULE_NAME, build_module, install_module)
from tts_cli.corpus import DEFAULT_CORPUS_PATH, load_corpus
from tts_cli.factions import (DEFAULT_FACTIONS_PATH, PACKS, load_sides, pack_stems,
                              pack_title)
from tts_cli.ignores import DEFAULT_IGNORED_PATH, load_ignored
from tts_cli.store import DEFAULT_STORE_DIR

# init-db and extract are imported inside their branches: they pull in
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
subparsers.add_parser(
    "import-corpus",
    help="corpus.json.gz -> Postgres. Needed by a maintainer, not to produce audio.") \
    .add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
ign = subparsers.add_parser(
    "export-ignores",
    help="line_ignore -> corpus/ignored.json, which build reads.")
ign.add_argument("--ignored", default=DEFAULT_IGNORED_PATH)
ign.add_argument("--check", action="store_true",
                 help="Compare instead of writing; exits 1 if they differ.")

subparsers.add_parser(
    "fold-overrides",
    help="line_override rows -> edited versions of their lines. Run once after import-corpus.")
exp = subparsers.add_parser(
    "export-corpus",
    help="Postgres -> corpus.json.gz. The committed file is an export of the table.")
exp.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
exp.add_argument("--check", action="store_true",
                 help="Compare instead of writing; exits 1 if they differ.")

bld = subparsers.add_parser(
    "build",
    help="Assemble the addon data module from the corpus and audio/ (make quests-sounds).")
bld.add_argument("--store", default=DEFAULT_STORE_DIR)
bld.add_argument("--corpus", default=DEFAULT_CORPUS_PATH)
bld.add_argument("--dist", default=DEFAULT_DIST_DIR)
bld.add_argument("--module", default=DEFAULT_MODULE_NAME)
bld.add_argument("--version", default="1.0.1")
bld.add_argument("--ignored", default=DEFAULT_IGNORED_PATH)
bld.add_argument("--pack", default="all", choices=PACKS,
                 help="which slice of the audio to ship (default: all)")
bld.add_argument("--factions", default=DEFAULT_FACTIONS_PATH)
bld.add_argument("--module-title", default=None,
                 help="TOC title; defaults to one naming the pack")

ins = subparsers.add_parser(
    "install", help="Copy the built module into a WoW AddOns folder.")
ins.add_argument("--addons", default=DEFAULT_ADDONS_DIR)
ins.add_argument("--dist", default=DEFAULT_DIST_DIR)
ins.add_argument("--module", default=DEFAULT_MODULE_NAME)
ins.add_argument("--force", action="store_true",
                 help="Replace an existing install, moving it aside first")

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

elif args.mode == "import-corpus":
    # Imported here rather than at the top, the way extract is: psycopg2 is in
    # requirements-extract.txt, and the everyday path deliberately installs no database
    # client at all.
    from tts_cli.corpus_db import import_corpus
    import_corpus(args.corpus)

elif args.mode == "export-ignores":
    from tts_cli.corpus_db import export_ignores
    if not export_ignores(args.ignored, check=args.check) and args.check:
        raise SystemExit(1)

elif args.mode == "fold-overrides":
    from tts_cli.corpus_db import fold_overrides
    fold_overrides()

elif args.mode == "export-corpus":
    from tts_cli.corpus_db import export_corpus
    same = export_corpus(args.corpus, check=args.check)
    if args.check and not same:
        # Worth failing a build over: the file the addon build reads no longer matches what
        # the table would produce, so the table is not carrying everything it needs to.
        raise SystemExit(1)

elif args.mode == "build":
    corpus = load_corpus(args.corpus)
    # None for the whole store rather than the 'all' stem set, so a store file the corpus
    # cannot address still ships in the complete pack the way it always has.
    include = None if args.pack == "all" else \
        pack_stems(corpus, load_sides(args.factions), args.pack)
    report = build_module(corpus, args.store, args.dist,
                          args.module, args.version, progress=True,
                          ignored=load_ignored(args.ignored), include=include,
                          title=args.module_title or pack_title(args.pack))
    print(f"\nbuilt {report['moduleDir']}")
    print(f"  audio files {report['audioFiles']} ({report['audioFormat']}, pack: {args.pack})")
    for name, rows in sorted(report["tableRows"].items()):
        print(f"  {name:<32} {rows:>6} entries")

elif args.mode == "install":
    import os as _os
    report = install_module(_os.path.join(args.dist, args.module), args.addons, args.force)
    print(f"installed {report['target']}")
    if report["replaced"]:
        print(f"previous install moved to {report['replaced']}")

else:
    parser.print_help()
