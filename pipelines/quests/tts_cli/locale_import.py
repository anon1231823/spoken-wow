"""A language's quest text, from the world database straight into Postgres.

The English corpus goes dump -> corpus.json.gz -> import-corpus, because the committed file
is what an English pack is built from. A translation has no such file and gets none: it is
read out of the dump's *_locN columns and written to quest_line (the text) and entity_name
(quest titles and NPC names) under its language, the same tables the site edits it in.

WHAT A TRANSLATED LINE IS ANCHORED TO is the English line, never anything recomputed from
the translation. Line ids and file names derive from the English text (tts_cli/naming.py),
so the English query runs beside the locale's, and a translated line is written only where
an English line with that id and that original text exists. A line the dump translates but
the corpus does not carry -- an extract newer than the import, say -- is counted and left
alone; this never creates a line id.

THE TRANSLATION IS CLEANED THE WAY THE ENGLISH IS, WITH TWO EXCEPTIONS:

  * $G male:female; is resolved by the ENGLISH row's player gender, because that is what
    splits the line id into :m and :f. A translation with a $G where the English has none
    takes the male form; one without where the English has one is the same text twice.
  * $N, $C and $R are left as they are. The English cleaner writes "adventurer" and
    "Traveler" in their place, which is English. Left in, they trip the same invalid-chars
    rule the English uses, so the line shows up as not voiceable -- for a translator to
    rewrite -- rather than being voiced with an English word in the middle of it.

PRECEDENCE is import-corpus's: unchanged text is skipped, changed text is promoted unless
somebody edited the line here, in which case the dump's version is recorded but not made
live. Names follow the same rule in entity_name. Nothing is stored for a column the dump
leaves empty, and nothing is compared with the English: a German title that happens to be
spelled like the English one is still German.
"""
import re
from collections import Counter

from tts_cli.corpus import _skip_reason
from tts_cli.naming import line_id_for_row

_GENDER = re.compile(r"\$[Gg]\s*([^:;]+?)\s*:\s*([^:;]+?)\s*;")
_DIRECTION = re.compile(r"<.*?>\s")


def clean_localized(text: str, player_gender) -> str:
    """A translated line, cleaned as the English is except where that would be English."""
    cleaned = text.replace("$b", "\n").replace("$B", "\n")
    cleaned = _DIRECTION.sub("", cleaned)
    return _GENDER.sub(r"\2" if player_gender == "f" else r"\1", cleaned)


def extracted_lines(rows) -> list:
    """The translated lines in preprocessed rows, one per (lineId, originalText).

    `rows` are the English query's rows after TTSProcessor.preprocess_dataframe, carrying
    loc_text alongside. Several speakers share most lines; they are one line here.
    """
    seen = {}
    for row in rows:
        localized = row.get("loc_text")
        if not localized:
            continue
        key = (line_id_for_row(row), row["original_text"])
        if key in seen:
            continue
        text = clean_localized(localized, row.get("player_gender"))
        reason = _skip_reason({"source": row["source"], "cleanedText": text})
        seen[key] = {
            "lineId": key[0],
            "originalText": key[1],
            "text": text,
            "localeText": localized,
            "generatable": reason is None,
            "skipReason": reason,
        }
    return list(seen.values())


def extracted_names(rows) -> dict:
    """(kind, entityId) -> the locale's name, for quests and for whoever speaks.

    First one wins where the dump is inconsistent with itself, which is the order the rows
    arrive in; the importer then keeps it for as long as it does not change.
    """
    names = {}
    for row in rows:
        if row.get("quest") and row.get("loc_title"):
            names.setdefault(("quest", str(int(row["quest"]))), row["loc_title"])
        if row.get("loc_name"):
            names.setdefault((row["type"], str(int(row["id"]))), row["loc_name"])
    return names


def decide(current, value) -> str:
    """What the import does with one line or name.

    `current` is (origin, value) for the live row, or None; `value` is what the dump says.
    'promote' writes a new live version, 'record' writes one that is not live (the line was
    edited here, and an import that could overwrite a correction is one nobody dares run),
    'skip' writes nothing.
    """
    if current is None:
        return "promote"
    origin, live = current
    if live == value:
        return "skip"
    return "record" if origin == "edited" else "promote"


def import_locale(conn, lang: str, lines: list, names: dict) -> Counter:
    """Write a language's lines and names. Returns what happened, counted."""
    counts = Counter()
    with conn, conn.cursor() as cur:
        cur.execute(
            """select "lineId", "variant", "originalText", "source", "questId", "fileName",
                      "playerGender"
                 from "quest_line" where "lang" = 'enUS' and "isCurrent" """
        )
        english = {(r[0], r[2]): (r[1],) + r[3:] for r in cur.fetchall()}

        cur.execute(
            """select "lineId", "variant", "origin", "text", "localeText"
                 from "quest_line" where "lang" = %s and "isCurrent" """,
            (lang,),
        )
        live = {(r[0], r[1]): (r[2], (r[3], r[4])) for r in cur.fetchall()}
        cur.execute(
            """select "lineId", "variant", max("version") from "quest_line"
                where "lang" = %s group by 1, 2""",
            (lang,),
        )
        highest = {(r[0], r[1]): r[2] for r in cur.fetchall()}

        for line in lines:
            anchor = english.get((line["lineId"], line["originalText"]))
            if anchor is None:
                counts["lines without an English line"] += 1
                continue
            variant, source, quest_id, file_name, player_gender = anchor
            key = (line["lineId"], variant)
            action = decide(live.get(key), (line["text"], line["localeText"]))
            counts[f"lines {action}"] += 1
            if action == "skip":
                continue
            # Only a line that has a live row has one to retire: on a first import that is none.
            if action == "promote" and key in live:
                cur.execute(
                    """update "quest_line" set "isCurrent" = false
                        where "lineId" = %s and "variant" = %s and "lang" = %s
                          and "isCurrent" """,
                    (line["lineId"], variant, lang),
                )
            cur.execute(
                """insert into "quest_line"
                     ("lineId", "variant", "lang", "version", "isCurrent", "origin",
                      "source", "questId", "playerGender", "fileName", "text",
                      "originalText", "localeText", "generatable", "skipReason")
                   values (%s, %s, %s, %s, %s, 'extracted', %s, %s, %s, %s, %s, %s, %s,
                           %s, %s)""",
                (line["lineId"], variant, lang, highest.get(key, 0) + 1,
                 action == "promote", source, quest_id, player_gender, file_name,
                 line["text"], line["originalText"], line["localeText"],
                 line["generatable"], line["skipReason"]),
            )
            highest[key] = highest.get(key, 0) + 1

        cur.execute(
            """select "kind", "entityId", "origin", "name" from "entity_name"
                where "lang" = %s and "isCurrent" """,
            (lang,),
        )
        live_names = {(r[0], r[1]): (r[2], r[3]) for r in cur.fetchall()}
        cur.execute(
            """select "kind", "entityId", max("version") from "entity_name"
                where "lang" = %s group by 1, 2""",
            (lang,),
        )
        highest_names = {(r[0], r[1]): r[2] for r in cur.fetchall()}

        for (kind, entity_id), name in names.items():
            key = (kind, entity_id)
            action = decide(live_names.get(key), name)
            counts[f"names {action}"] += 1
            if action == "skip":
                continue
            if action == "promote" and key in live_names:
                cur.execute(
                    """update "entity_name" set "isCurrent" = false
                        where "kind" = %s and "entityId" = %s and "lang" = %s
                          and "isCurrent" """,
                    (kind, entity_id, lang),
                )
            cur.execute(
                """insert into "entity_name"
                     ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
                   values (%s, %s, %s, %s, %s, 'extracted', %s)""",
                (kind, entity_id, lang, highest_names.get(key, 0) + 1,
                 action == "promote", name),
            )
    return counts


def extract_and_import(lang: str) -> Counter:
    """The dump's `lang` columns -> Postgres. Needs MySQL and DATABASE_URL."""
    from tts_cli.corpus_db import connect
    from tts_cli.sql_queries import query_dataframe_for_all_quests_and_gossip
    from tts_cli.tts_utils import TTSProcessor
    from tts_cli.utils import language_code_to_language_number

    df = query_dataframe_for_all_quests_and_gossip(
        language_code_to_language_number(lang), raw=True)
    rows = TTSProcessor.preprocess_dataframe(TTSProcessor.__new__(TTSProcessor), df)
    records = rows.to_dict("records")
    conn = connect()
    try:
        return import_locale(conn, lang, extracted_lines(records), extracted_names(records))
    finally:
        conn.close()
