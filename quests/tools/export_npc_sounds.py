"""
Convert NPCSounds.dbc into the SQL asset the extraction pipeline loads.

NPCSounds is the table that says which voice set an NPC speaks with. A creature's display
info carries an NPCSoundID; that row points at four SoundEntries whose names are the
ground truth for the voice - `DwarfFemaleMaternalNPCGreetings`, `OrcFemaleShamanNPCPissed`.
Without it, every NPC of a race and gender is indistinguishable, which is why this project
had one voice per race-gender rather than one per actual Blizzard voice.

The .dbc itself is not committed, matching CreatureDisplayInfo and CreatureDisplayInfoExtra
next to the output: the generated .sql is the artefact the pipeline reads, and it is small
enough (149 rows) that regenerating it is a curiosity rather than a chore.

A 1.12 copy of the file lives at:
    https://raw.githubusercontent.com/andrewmunro/Vanilla/master/dbc/NPCSounds.dbc

Usage:
    python tools/export_npc_sounds.py NPCSounds.dbc
    python tools/export_npc_sounds.py NPCSounds.dbc --out assets/sql/exported/NPCSounds.sql
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "assets" / "sql" / "exported" / "NPCSounds.sql"

HEADER = struct.Struct("<4siiii")

# ID plus four SoundEntries references, in the client's own order (NPCSOUND_HELLO,
# _GOODBYE, _PISSED, _ACK). Only the greeting is used downstream - it is populated for
# every row that names a voice - but all four are exported because dropping data on the way
# into a committed asset is how you end up regenerating it later.
FIELDS = ["ID", "SoundGreeting", "SoundFarewell", "SoundPissed", "SoundAck"]
RECORD = struct.Struct(f"<{len(FIELDS)}i")


def read_dbc(path: Path) -> list[tuple[int, ...]]:
    data = path.read_bytes()
    magic, records, fields, record_size, _ = HEADER.unpack_from(data)
    if magic != b"WDBC":
        raise ValueError(f"{path} is not a DBC file (magic {magic!r})")
    if fields != len(FIELDS) or record_size != RECORD.size:
        raise ValueError(
            f"{path} has {fields} fields of {record_size} bytes; "
            f"expected {len(FIELDS)} of {RECORD.size}. Wrong table, or a build this "
            f"script does not know."
        )
    return [RECORD.unpack_from(data, HEADER.size + i * record_size) for i in range(records)]


def to_sql(rows: list[tuple[int, ...]]) -> str:
    columns = ", ".join(f"`{name}` INT NOT NULL DEFAULT '0'" for name in FIELDS)
    lines = [
        "DROP TABLE IF EXISTS `db_NPCSounds`; ",
        f"CREATE TABLE `db_NPCSounds` ( {columns}, PRIMARY KEY (`ID`)) "
        "ENGINE=MyISAM DEFAULT CHARSET=utf8; ",
    ]
    lines += [
        f"INSERT INTO `db_NPCSounds` VALUES ({','.join(str(v) for v in row)}); "
        for row in rows
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dbc", type=Path, help="path to NPCSounds.dbc")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    rows = read_dbc(args.dbc)
    args.out.write_text(to_sql(rows), encoding="utf-8")
    print(f"{len(rows)} rows -> {args.out}")


if __name__ == "__main__":
    main()
