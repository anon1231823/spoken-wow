"""Single source of truth for voiceline file naming and identity.

Filenames are load-bearing: the addon resolves a sound by looking its filename up in
SoundLengthLookupByFileName, so a name that differs by one character silently plays
nothing. Every filename in this project is derived here and nowhere else.

    quest lines   {questID}-{accept|complete}      optional m-/f- prefix
    gossip lines  md5(original_text+race+gender)   optional m-/f- prefix

lineId is a stable handle used by the corpus, the audio store and the web app. It is
deliberately not the filename, so references survive a naming change.

    q:{questID}:{source}[:{m|f}]
    g:{hash}[:{m|f}]
"""


def filename_for_row(row) -> str:
    """Filename (without extension) the generator would produce for a dataframe row."""
    base = f'{row["quest"]}-{row["source"]}' if row["quest"] else row["templateText_race_gender_hash"]
    if row["player_gender"]:
        base = f'{row["player_gender"]}-{base}'
    return base


def line_id_for_row(row) -> str:
    """Stable identity for a dataframe row."""
    if row["quest"]:
        parts = ["q", str(row["quest"]), row["source"]]
    else:
        parts = ["g", row["templateText_race_gender_hash"]]
    if row["player_gender"]:
        parts.append(row["player_gender"])
    return ":".join(parts)


def filename_from_line_id(line_id: str) -> str:
    """Inverse of line_id_for_row, as far as the filename is concerned."""
    kind, *rest = line_id.split(":")
    if kind == "q":
        quest, source, *gender = rest
        base = f"{quest}-{source}"
    elif kind == "g":
        hash_, *gender = rest
        base = hash_
    else:
        raise ValueError(f"unknown lineId kind {kind!r} in {line_id!r}")
    if gender:
        base = f"{gender[0]}-{base}"
    return base


def gossip_hash_from_line_id(line_id: str) -> str:
    """The bare text hash for a gossip line, without any m-/f- prefix.

    Gossip lookup tables store the unprefixed hash: the addon adds the player's gender
    prefix at resolve time (DataModules:AddPlayerGenderToFilename) and falls back to the
    bare name, so storing a prefixed hash would make the line unreachable for the other
    gender.
    """
    kind, *rest = line_id.split(":")
    if kind != "g":
        raise ValueError(f"{line_id!r} is not a gossip line")
    return rest[0]


def subfolder_from_line_id(line_id: str) -> str:
    """Which sounds/ subdirectory a line lives in."""
    kind = line_id.split(":", 1)[0]
    if kind == "q":
        return "quests"
    if kind == "g":
        return "gossip"
    raise ValueError(f"unknown lineId kind {kind!r} in {line_id!r}")
