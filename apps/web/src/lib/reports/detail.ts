/**
 * One line of any of the three corpora, as the triage table shows it.
 *
 * CLIENT-SAFE ON PURPOSE, like lib/zones/filters.ts: the expanded row runs in the browser,
 * and every module that can answer "what is this line?" on the server reaches the corpus,
 * the database or the filesystem. Types cross freely; runtime code does not, so the three
 * ResultLine shapes are narrowed here from what the search endpoints already return.
 *
 * The three agree on nothing - quests has `lineId`, `audioPath` and `hasAudio`, zones and
 * books have `id`, `file` and a `state` - so the reading is done once, here, rather than in
 * a row that would silently render an empty panel if it reached for the wrong pair.
 */
import type { ResultLine as BookLine } from "@/lib/books/search";
import type { ResultLine as QuestLine } from "@/lib/search";
import type { ResultLine as ZoneLine } from "@/lib/zones/search";

import { targetForLine } from "./line-target";
import type { Source } from "@/lib/sections";

/** Whichever shape the section's search endpoint answered with. */
export type SourceLine = QuestLine | ZoneLine | BookLine;

export type LineDetail = {
  /** What the line is called: the quest, the subzone, the book. */
  heading: string;
  /** Where it sits, and for quests what picked its voice. */
  context: string;
  text: string;
  /** The audio route, or null where there is no take to play. */
  audioSrc: string | null;
  /** The id this section's regenerate endpoint takes. */
  lineId: string;
};

/**
 * The address a report about this line travels on, or null where the line has none.
 *
 * One per section, because the three address lines by different frozen rules and each one
 * is what its /r/ landing page already resolves: a quests address is the one the addon
 * builds out of a quest id or a unit GUID, a zones address is the line's own audio path --
 * which is what /zones/r/{mapID}/{slug} is -- and a books address is the page id and
 * nothing else, because that is all the addon has to build a link from.
 *
 * Only quests can answer null. Its addresses are built from what a client can see, and a
 * line neither a quest nor a gossip address can name would arrive in triage unresolvable.
 */
export function reportTargetOf(source: Source, line: SourceLine): string | null {
  if (source === "quests") return targetForLine(line as QuestLine);
  if (source === "zones") return (line as ZoneLine).file;
  return String((line as BookLine).pageId);
}

/** The section's search, narrowed to the one line a report is about. */
export function searchPath(source: Source, lineId: string): string {
  return `/api/${source}/search?${new URLSearchParams({ line: lineId, limit: "1" })}`;
}

export function regeneratePath(source: Source): string {
  return `/api/${source}/regenerate`;
}

/**
 * `version` is the take a regeneration wrote in this session, appended as a cache buster.
 * A regenerated line keeps its path - the addon resolves sounds by filename, so it cannot
 * change - and without this the browser replays the take that was just overwritten.
 */
export function detailOf(source: Source, line: SourceLine, version?: number): LineDetail {
  if (source === "quests") return questDetail(line as QuestLine, version);
  if (source === "zones") return zoneDetail(line as ZoneLine, version);
  return bookDetail(line as BookLine, version);
}

function audio(source: Source, path: string, version: number | undefined): string {
  return `/api/${source}/audio/${path}${version === undefined ? "" : `?v=${version}`}`;
}

function questDetail(line: QuestLine, version?: number): LineDetail {
  // Race, gender and flavor rather than the voice alone: "wrong voice for this character"
  // is a complaint about that triple, and the voice is what it currently resolves to.
  const who = [line.race, line.gender, line.flavor].filter(Boolean).join(" ");

  return {
    heading: line.questTitle ?? line.npcName,
    context: [line.npcName, who, line.voice].filter(Boolean).join(" · "),
    // The override when there is one: it is what the next take will say, and a panel that
    // showed the corpus text would report a rewrite as having changed nothing.
    text: line.override ?? line.text,
    audioSrc: line.hasAudio ? audio("quests", line.audioPath, version) : null,
    lineId: line.lineId,
  };
}

function zoneDetail(line: ZoneLine, version?: number): LineDetail {
  return {
    heading: line.name,
    context: line.zoneName,
    text: line.text,
    audioSrc: line.state === "missing" ? null : audio("zones", `${line.file}.mp3`, version),
    lineId: line.id,
  };
}

function bookDetail(line: BookLine, version?: number): LineDetail {
  return {
    heading: line.title,
    context: `page ${line.pageNumber} of ${line.pageCount}`,
    text: line.text,
    audioSrc: line.state === "missing" ? null : audio("books", `${line.file}.mp3`, version),
    lineId: line.id,
  };
}
