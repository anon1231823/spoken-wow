"""The corpus <-> Postgres round trip, and the seam that makes the table its source of truth.

The site edits lines, records who changed them and keeps what they used to say. None of
that could live in corpus/corpus.json.gz, so it lived in line_override instead: a patch
table keyed by file, with no history. This moves the corpus itself into Postgres beside
lore_line and book_line, and turns the committed file into an EXPORT of that table -- the
same arrangement zones has with tools/voice/manifest.json.

WHAT DOES NOT CHANGE: producing audio and building a sound pack still need no database.
tts_cli.build reads the committed file exactly as it always has,
and a clone with no Postgres can still ship a pack. That is the promise requirements.txt
makes, and the reason this is an import/export pair rather than a rewrite of the CLI.

WHY THIS IS PYTHON. The check that proves the table carries everything is that an import
followed by an export leaves corpus.json.gz byte-identical -- `git status` clean. Python
and Node do not produce identical gzip streams for the same input: the headers differ and
so does the deflate output. So the exporter has to be the same write_corpus that writes the
file today, which makes byte-identity true by construction instead of a coincidence between
two zlib builds.

THE CORPUS IS A FLAT LIST AND THIS TRANSCRIBES IT, defects included:

  * 103 lineIds name two different texts and one filename, so only the first is ever
    voiced. `variant` records which is which rather than collapsing them, because
    collapsing would change what ships for those files as a side effect of a schema choice.
  * 34 rows name a speaker that already appears for the same line, 19 identically and 15
    claiming a different voice. They are kept, because the export is what the addon build
    reads and dropping a row changes what ships.

Both are counted on every import and printed. Fixing them is a decision for whoever owns
the extract, made on purpose, in a commit that says so.
"""
import json
import os
from collections import Counter
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

from tts_cli.corpus import load_corpus, write_corpus

LANG = "enUS"

# What makes two corpus rows the same LINE rather than the same row: everything except who
# is speaking. Two rows agreeing on all of it are one line said by two NPCs; two rows
# differing anywhere in it are two lines that happen to share an id.
LINE_FIELDS = (
    "source",
    "questId",
    "questTitle",
    "playerGender",
    "text",
    "originalText",
    "fileName",
    "generatable",
    "skipReason",
)

SPEAKER_FIELDS = ("npcType", "npcId", "npcName", "race", "gender", "flavor", "voice")


def connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit(
            "DATABASE_URL is not set -- the corpus lives in Postgres now.\n"
            "Producing audio and building a pack still need no database; this command does."
        )
    return psycopg2.connect(url)


def _line_key(row):
    return tuple(row[field] for field in LINE_FIELDS)


def _variants(lines):
    """lineId -> [line payload, ...], in the order the corpus first mentions each.

    The index into that list is the `variant`, so it is stable for as long as the extract
    keeps producing the rows in the same order -- which it does, being a dataframe walked
    once.
    """
    order = {}
    for row in lines:
        seen = order.setdefault(row["lineId"], [])
        key = _line_key(row)
        if key not in seen:
            seen.append(key)
    return order


def _progress(message):
    """One line per step, as it happens: the import is a single transaction, so nothing it
    writes is visible from outside until the end, and this is the only way to see it move."""
    print(f"  {datetime.now().strftime('%H:%M:%S')} {message}", flush=True)


def _bulk(cur, what, rows, sql, template=None, page=1000):
    """execute_values in pages of `page` rows, saying how far it has got after each."""
    for start in range(0, len(rows), page):
        psycopg2.extras.execute_values(cur, sql, rows[start:start + page], template=template,
                                       page_size=page)
        _progress(f"{what}: {min(start + page, len(rows))}/{len(rows)}")
    if not rows:
        _progress(f"{what}: none")


def import_corpus(path, verbose=True):
    """corpus.json.gz -> quest_line, quest_line_speaker, quest_spawn.

    Rerunnable by construction, and the rule for a line that already exists is the one
    pipelines/books/tools/lib/promote.mjs states: unchanged text is skipped, changed text
    is promoted UNLESS somebody has edited it here, in which case the extract's version is
    recorded but not promoted. An import that could overwrite a correction is an import
    nobody dares run, and an import nobody runs means the corpus stops tracking the dump.

    Speakers and spawns are replaced wholesale rather than promoted: who speaks a line and
    where they stand are facts about the dump, not versions of anything, and 0026 makes the
    same argument for a book page's structure.
    """
    corpus = load_corpus(path)
    lines = corpus["lines"]
    variants = _variants(lines)

    counts = Counter()
    conn = connect()
    try:
        with conn, conn.cursor() as cur:
            # The extract's own timestamp, kept so the export can reproduce it. Without it
            # every export would differ from the file it replaced in exactly one field.
            cur.execute(
                """insert into "quest_corpus_meta" ("id", "schemaVersion", "generatedAt")
                   values (true, %s, %s)
                   on conflict ("id") do update set
                     "schemaVersion" = excluded."schemaVersion",
                     "generatedAt" = excluded."generatedAt" """,
                (corpus["schemaVersion"], corpus["generatedAt"]),
            )

            # Everything the decisions need, in two reads. The import used to ask per line --
            # its live version, then its highest number -- which is three round trips for each
            # of fourteen thousand lines: seconds against a local database, and over an ssh
            # tunnel to production, most of an hour. Now it reads once, decides in memory and
            # writes in bulk, so its time no longer depends on the distance to the database.
            _progress("reading what quest_line holds")
            cur.execute(
                """select "lineId", "variant", "origin", "text", "originalText"
                     from "quest_line" where "lang" = %s and "isCurrent" """,
                (LANG,),
            )
            live = {(r[0], r[1]): r[2:] for r in cur.fetchall()}
            cur.execute(
                """select "lineId", "variant", max("version") from "quest_line"
                    where "lang" = %s group by 1, 2""",
                (LANG,),
            )
            highest = {(r[0], r[1]): r[2] for r in cur.fetchall()}

            unchanged, retire, inserts = [], [], []
            for line_id, payloads in variants.items():
                for variant, payload in enumerate(payloads):
                    row = dict(zip(LINE_FIELDS, payload))
                    current = live.get((line_id, variant))

                    if current is None:
                        action = "promote"
                    elif current[1] == row["text"] and current[2] == row["originalText"]:
                        action = "skip"
                    else:
                        action = "record" if current[0] == "edited" else "promote"
                    counts[action] += 1

                    structure = (
                        row["source"], row["questId"], row["questTitle"],
                        row["playerGender"], row["fileName"], row["generatable"],
                        row["skipReason"],
                    )
                    if action == "skip":
                        # The structural fields still move: an edit changes what is said,
                        # never which quest it belongs to or what file it is written to.
                        unchanged.append((line_id, variant) + structure)
                        continue
                    if action == "promote" and current is not None:
                        retire.append((line_id, variant))
                    inserts.append(
                        (line_id, variant, LANG, highest.get((line_id, variant), 0) + 1,
                         action == "promote", row["source"], row["questId"],
                         row["questTitle"], row["playerGender"], row["fileName"],
                         row["text"], row["originalText"], row["generatable"],
                         row["skipReason"])
                    )

            _bulk(cur, "quest_line: structure of unchanged lines", unchanged,
                  """update "quest_line" q
                        set "source" = v.source, "questId" = v.qid, "questTitle" = v.title,
                            "playerGender" = v.gender, "fileName" = v.file,
                            "generatable" = v.gen, "skipReason" = v.skip
                       from (values %s)
                         as v(lid, var, source, qid, title, gender, file, gen, skip)
                      where q."lineId" = v.lid and q."variant" = v.var
                        and q."lang" = '""" + LANG + """' and q."isCurrent" """,
                  "(%s, %s::smallint, %s, %s::integer, %s, %s, %s, %s::boolean, %s)")
            # Before the inserts: the new live version would otherwise collide with the old
            # one on quest_line_current_idx.
            _bulk(cur, "quest_line: retired versions", retire,
                  """update "quest_line" q set "isCurrent" = false
                       from (values %s) as v(lid, var)
                      where q."lineId" = v.lid and q."variant" = v.var
                        and q."lang" = '""" + LANG + """' and q."isCurrent" """,
                  "(%s, %s::smallint)")
            _bulk(cur, "quest_line: new versions", inserts,
                  """insert into "quest_line"
                       ("lineId", "variant", "lang", "version", "isCurrent", "origin",
                        "source", "questId", "questTitle", "playerGender", "fileName",
                        "text", "originalText", "generatable", "skipReason")
                     values %s""",
                  "(%s, %s, %s, %s, %s, 'extracted', %s, %s, %s, %s, %s, %s, %s, %s, %s)")

            # Speakers, wholesale. `ord` is the row's place in the corpus's own list, which
            # is what lets the export reproduce the file rather than a reordering of it.
            #
            # Except a player's: a speaker row with a contributionId was written when a
            # moderator accepted a contribution (apps/web migration 0034), is not the
            # extract's, and would otherwise vanish -- line and all -- on the next import.
            # Those rows take an `ord` from 1,000,000 up, so the extract's 0..n never meets them.
            cur.execute(
                """delete from "quest_line_speaker"
                    where "lang" = %s and "contributionId" is null""",
                (LANG,),
            )
            speaker_rows = []
            for ord_, row in enumerate(lines):
                variant = variants[row["lineId"]].index(_line_key(row))
                speaker_rows.append(
                    (row["lineId"], variant, LANG, ord_)
                    + tuple(row[field] for field in SPEAKER_FIELDS)
                )
            _bulk(cur, "quest_line_speaker", speaker_rows,
                  """insert into "quest_line_speaker"
                       ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName",
                        "race", "gender", "flavor", "voice")
                     values %s""")

            cur.execute("""delete from "quest_spawn" """)
            spawn_rows = []
            for key, spawns in corpus["spawns"].items():
                npc_type, npc_id = key.split(":")
                for spawn in spawns:
                    spawn_rows.append(
                        (npc_type, int(npc_id), spawn["map"], spawn["x"], spawn["y"])
                    )
            if spawn_rows:
                # No on-conflict clause: nine of these points are listed twice in the dump
                # and both copies are kept, for the reason the duplicate speakers are.
                _bulk(cur, "quest_spawn", spawn_rows,
                      """insert into "quest_spawn" ("npcType", "npcId", "map", "x", "y")
                         values %s""")
            _progress("committing")
    finally:
        conn.close()

    if verbose:
        collisions = sum(1 for payloads in variants.values() if len(payloads) > 1)
        duplicates = len(lines) - len({
            (row["lineId"], _line_key(row)) + tuple(row[field] for field in SPEAKER_FIELDS)
            for row in lines
        })
        print(
            f"{len(lines)} rows: {counts['promote']} promoted, "
            f"{counts['record']} recorded without promoting (edited here), "
            f"{counts['skip']} unchanged"
        )
        print(f"{len(speaker_rows)} speakers, {len(spawn_rows)} spawn points")
        print(
            f"defects carried over unchanged: {collisions} lineIds naming two different "
            f"lines, {duplicates} duplicate rows"
        )
    return counts


def export_corpus(path, check=False, verbose=True):
    """quest_line + quest_line_speaker + quest_spawn -> corpus.json.gz.

    Written with the same write_corpus the extract uses, so the file the addon build reads
    is produced by exactly one piece of code whichever way it was made. With `check` it
    compares instead of writing, which is what CI runs: if an import followed by an export
    does not reproduce the file byte for byte, the table is not carrying everything the
    build needs, and that is worth failing a build over.
    """
    conn = connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """select "schemaVersion", "generatedAt" from "quest_corpus_meta"
                    where "id" """
            )
            meta = cur.fetchone()
            if meta is None:
                raise SystemExit(
                    "quest_line has not been seeded -- run: make quests-import-corpus"
                )

            # Ordered by the corpus's own row order, which is what `ord` records.
            cur.execute(
                """select s."npcType", s."npcId", s."npcName", s."race", s."gender",
                          s."flavor", s."voice",
                          l."lineId", l."source", l."questId", l."questTitle",
                          l."playerGender", l."text", l."originalText", l."fileName",
                          l."generatable", l."skipReason"
                     from "quest_line_speaker" s
                     join "quest_line" l
                       on l."lineId" = s."lineId" and l."variant" = s."variant"
                      and l."lang" = s."lang" and l."isCurrent"
                    where s."lang" = %s
                    order by s."ord" """,
                (LANG,),
            )
            rows = cur.fetchall()

            cur.execute(
                """select "npcType", "npcId", "map", "x", "y" from "quest_spawn"
                    order by "id" """
            )
            spawn_rows = cur.fetchall()
    finally:
        conn.close()

    # The key order is the one tts_cli.corpus.build_corpus writes. It is load-bearing here
    # and nowhere else: json.dumps preserves insertion order, and a different order is a
    # different file even when it is the same data.
    lines = [
        {
            "lineId": line_id,
            "source": source,
            "questId": quest_id,
            "questTitle": quest_title,
            "npcId": npc_id,
            "npcName": npc_name,
            "npcType": npc_type,
            "race": race,
            "gender": gender,
            "flavor": flavor,
            "voice": voice,
            "playerGender": player_gender,
            "text": text,
            "originalText": original_text,
            "fileName": file_name,
            "generatable": generatable,
            "skipReason": skip_reason,
        }
        for (npc_type, npc_id, npc_name, race, gender, flavor, voice, line_id, source,
             quest_id, quest_title, player_gender, text, original_text, file_name,
             generatable, skip_reason) in rows
    ]

    spawns = {}
    for npc_type, npc_id, map_id, x, y in spawn_rows:
        spawns.setdefault(f"{npc_type}:{npc_id}", []).append(
            {"map": map_id, "x": x, "y": y}
        )

    corpus = {
        "schemaVersion": meta[0],
        "generatedAt": meta[1],
        "lineCount": len(lines),
        "lines": lines,
        "spawns": spawns,
    }

    if check:
        existing = load_corpus(path)
        same = json.dumps(existing, sort_keys=False) == json.dumps(corpus, sort_keys=False)
        if verbose:
            print("identical" if same else "DIFFERENT from the committed corpus")
        return same

    write_corpus(path, corpus)
    if verbose:
        print(f"wrote {path}: {len(lines)} lines, {len(spawns)} spawn keys")
    return True


def export_ignores(path, check=False, verbose=True):
    """line_ignore -> corpus/ignored.json.

    The same shape deploy/web/sql/export_ignores.sql produced, and the reason that file and
    a `require-droplet` Makefile target can go: the ignore list used to be exported over ssh
    from the droplet, because the droplet's database was the only one that had it. The
    corpus lives in Postgres now and `make quests-sync` brings the rows home, so this is a
    local read like every other export here.

    Sorted by lineId and carrying no author: the file is read by the Python CLI and by
    rsync, which want a stable diff and have no use for an account. Provenance stays in the
    table, which is the authority.

    `exportedAt` moves on every run by design -- unlike the corpus, nothing compares this
    file byte for byte, and the timestamp is what tells you how old a committed list is.
    """
    conn = connect()
    try:
        with conn, conn.cursor() as cur:
            # The English pack's list: ignored everywhere, or in English. Another language's
            # decision is its own and does not reach this pack. A line ignored at both levels
            # is listed once, with the global reason.
            cur.execute(
                """select distinct on ("lineId") "lineId", "reason" from "line_ignore"
                    where "lang" is null or "lang" = 'enUS'
                    order by "lineId", "lang" nulls first"""
            )
            ignored = [{"lineId": line_id, "reason": reason} for line_id, reason in cur.fetchall()]
    finally:
        conn.close()

    if check:
        existing = json.load(open(path)) if os.path.isfile(path) else {"ignored": []}
        same = existing.get("ignored") == ignored
        if verbose:
            print("identical" if same else "DIFFERENT from the committed list")
        return same

    # Key order and indentation match what jsonb_pretty produced, so replacing the SQL
    # export with this one does not rewrite the committed file from top to bottom for no
    # reason. The diff of a real change stays readable, which is the point of committing it.
    document = {
        "ignored": ignored,
        "version": 1,
        "exportedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as out:
        json.dump(document, out, ensure_ascii=False, indent=4)
        out.write("\n")

    if verbose:
        print(f"wrote {path}: {len(ignored)} ignored lines")
    return True
