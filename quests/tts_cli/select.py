"""Choosing which corpus lines to work on.

Replaces the old interactive flow, which made you drag a rectangle over a map image to
filter NPCs by world coordinates. Selection is now a filter over committed data - by NPC,
quest, voice, or spawn area - and area selection still works because the corpus carries
spawn positions.
"""
from tts_cli.corpus import lines_in_area
from tts_cli.store import missing_lines


def select_lines(corpus: dict, store_dir: str, npc=None, quest=None, voice=None,
                 line_id=None, missing=False, area=None, ignored=()) -> list:
    """Filters combine with AND. `area` is (map_id, x_range, y_range).

    Ignored lines are dropped before any filter, including an explicit --line-id: a line
    somebody decided never to voice should not be selectable by naming it.
    """
    lines = [l for l in corpus["lines"] if l["lineId"] not in ignored]

    if line_id:
        lines = [l for l in lines if l["lineId"] == line_id]
    if missing:
        wanted = {l["lineId"] for l in missing_lines(store_dir, corpus, ignored)}
        lines = [l for l in lines if l["lineId"] in wanted]
    if area:
        in_area = {l["lineId"] for l in lines_in_area(corpus, *area)}
        lines = [l for l in lines if l["lineId"] in in_area]
    if npc:
        if str(npc).isdigit():
            lines = [l for l in lines if l["npcId"] == int(npc)]
        else:
            lines = [l for l in lines if npc.lower() in l["npcName"].lower()]
    if quest:
        if str(quest).isdigit():
            lines = [l for l in lines if l["questId"] == int(quest)]
        else:
            lines = [l for l in lines
                     if l["questTitle"] and quest.lower() in l["questTitle"].lower()]
    if voice:
        lines = [l for l in lines if l["voice"] == voice]

    return lines


def unique_by_file(lines: list) -> list:
    """One line per output file.

    Identical gossip text from two NPCs of the same race and gender hashes to a single
    file, so synthesizing per line would pay for the same audio twice.
    """
    seen, out = set(), []
    for line in lines:
        if line["fileName"] in seen:
            continue
        seen.add(line["fileName"])
        out.append(line)
    return out


def estimate(lines: list) -> dict:
    """What synthesizing this selection would cost."""
    files = unique_by_file(lines)
    return {
        "lines": len(lines),
        "files": len(files),
        "characters": sum(len(l["text"]) for l in files),
        "voices": sorted({l["voice"] for l in files}),
    }
