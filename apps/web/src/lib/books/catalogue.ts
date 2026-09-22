// The books corpus, built from `book_line`.
//
// SERVER ONLY. The table is the corpus; the addon's Data/*.lua is an export of it, so the
// app reads the table and never the files -- reading the Lua here would show whatever was
// last exported and committed, and would let the explorer list pages it cannot save.
//
// Pure helpers still come from the pipeline (lib/books/tools.ts): normalising and hashing
// are the same operations the CLI performs, and a second implementation here is how the app
// and the generated audio start disagreeing about what is stale.

import "server-only";

import { query } from "@/lib/db";
import { loadDirtyContext, NO_DIRT, type DirtyContext } from "@/lib/generation/dirty";

import type { OwnerKind } from "./filters";
import { spokenText, textHash, fileFor } from "./tools";
import { liveTakes } from "@/lib/takes/store";

/** Re-exported from lib/lang.ts, the one definition, so the routes importing it here keep
 *  their import. */
export { BASE_LANG } from "@/lib/lang";
import { BASE_LANG, type Lang } from "@/lib/lang";

/** One voiceable page of one book. */
export type BookPage = {
  /** 'b:1381'. naming.mjs owns the format. */
  id: string;
  pageId: number;
  /** The chain's first page. Two pages share it exactly when they are one book. */
  bookId: number;
  pageNumber: number;
  pageCount: number;
  /** The owning object's or item's name. Not unique: two objects are "A Dusty Tome". */
  title: string;
  ownerKind: OwnerKind;
  ownerIds: number[];
  material: number;
  /** The page as the client shows it. */
  text: string;
  /** What is actually sent to ElevenLabs: markup gone, paragraphs flattened. */
  spoken: string;
  /** sha1 of `spoken`. Compared against a take's hash to detect staleness. */
  hash: string;
  /** Store-relative and extension-less, e.g. '1381'. */
  file: string;
  /** False for the 88 pages the game has but nothing can voice, and for a page another
   *  language has not translated. */
  generatable: boolean;
  skipReason: string | null;
  /**
   * What a language other than English has not translated yet; the English stands in on
   * the page, marked, and is never voiced. Absent in English, and where nothing is missing.
   */
  missing?: { text: boolean; title: boolean };
  /** The English page, for a translator to work from. Absent when reading English. */
  english?: string;
  /** The owner's English name, likewise. */
  englishTitle?: string;
};

/** The live take for a page, as the explorer needs it. Mirrors the zones shape. */
export type Take = {
  version: number;
  file: string;
  textHash: string;
  chars: number;
  credits: number | null;
  durationSec: number | null;
  bytes: number;
  modelId: string | null;
  voiceId: string | null;
  generatedAt: string;
  /** How many takes exist in total. 1 means there is nothing to go back to. */
  takes: number;
};

/**
 * Everything database-backed, passed into the pure search rather than fetched by it. The
 * split lib/zones/catalogue.ts makes, and the reason the filtering is testable with no
 * database.
 */
export type SearchContext = {
  takes: Map<string, Take>;
  /**
   * What the lexicon has changed lately, and what somebody has already judged fine. Carried
   * rather than resolved into a set, because the rule needs the page's text as well as its
   * take. See lib/generation/dirty.ts.
   */
  dirt: DirtyContext;
  /** lineId -> how many reports are still open. The count only; the bodies are on /reports. */
  reports: Map<string, number>;
};

export const EMPTY_CONTEXT: SearchContext = {
  takes: new Map(),
  dirt: NO_DIRT,
  reports: new Map(),
};

/**
 * The corpus is empty, so there is nothing to show.
 *
 * Worth its own type rather than an empty list: between a fresh database and the first
 * import this is the normal state, and a page that says "run the import" is a better
 * answer than one that looks like the game has no books in it.
 */
export class CorpusEmpty extends Error {
  constructor(lang: Lang = BASE_LANG) {
    super(
      lang === BASE_LANG
        ? "book_line holds no English pages -- seed it with: make books-extract && " +
            "make books-import (and check DATABASE_URL points at the database you mean)"
        : `book_line holds no ${lang} pages yet`,
    );
    this.name = "CorpusEmpty";
  }
}

/**
 * Whether a thrown thing is that, across the module boundary.
 *
 * By name rather than `instanceof`, for the reason lib/zones/catalogue.ts gives: `next dev`
 * re-evaluates modules, so a route can be handed an error built by a different evaluation
 * of this file, and the two classes are not the same constructor. The name survives.
 */
export function isCorpusEmpty(error: unknown): boolean {
  return error instanceof Error && error.name === "CorpusEmpty";
}

type Memo = { stamp: string; value: Promise<BookPage[]> };

/** One memo per language, so a site switching between two does not rebuild on every request. */
const globalForBooks = globalThis as unknown as { booksCatalogue?: Map<string, Memo> };

/**
 * What the corpus's rows are, as one comparable value.
 *
 * Validated rather than invalidated, exactly as the zones catalogue is and for the same
 * reason: this app runs two pm2 workers, so a memo one worker drops after a save is a memo
 * the other keeps serving. The three terms catch the three ways the table moves -- an edit
 * inserts a version so the highest id moves, an import can delete so the count moves, and a
 * restore moves the live flag between existing rows, which only the sum of current ids sees.
 */
async function stampOf(lang: Lang): Promise<string> {
  const rows = await query<{ stamp: string }>(
    `select coalesce(max("id"), 0) || ':' || count(*) || ':'
             || coalesce(sum("id") filter (where "isCurrent"), 0) as "stamp"
       from "book_line" where "lang" = $1`,
    [lang],
  );
  const own = rows[0]?.stamp ?? "0:0:0";
  if (lang === BASE_LANG) return own;

  // Another language is read over the English pages and names their owners in entity_name,
  // so its memo moves with either of those as well as with its own text.
  const names = await query<{ stamp: string }>(
    `select coalesce(max("id"), 0) || ':' || count(*) || ':'
             || coalesce(sum("id") filter (where "isCurrent"), 0) as "stamp"
       from "entity_name" where "lang" = $1 and "kind" in ('item', 'gameobject')`,
    [lang],
  );
  return `${await stampOf(BASE_LANG)}|${own}|${names[0]?.stamp ?? ""}`;
}

/**
 * Another language's pages: every English page, with this language's text and titles where
 * it has them. The English pages are the skeleton because they are what exists -- which
 * pages there are, in which books, owned by what, voiced into which file -- and none of that
 * differs by language. Where the language has not written a page, the English stands in,
 * marked `missing`, and the page is not generatable: a rendering, never a row.
 *
 * A title is the owner's name, so it comes from entity_name under the first owner, the one
 * a page is filed under.
 */
async function buildTranslated(lang: Lang): Promise<BookPage[]> {
  const [english, own, names] = await Promise.all([
    catalogue(BASE_LANG),
    query<{ lineId: string; text: string; generatable: boolean; skipReason: string | null }>(
      `select "lineId", "text", "generatable", "skipReason" from "book_line"
        where "lang" = $1 and "isCurrent"`,
      [lang],
    ),
    query<{ kind: string; entityId: string; name: string }>(
      `select "kind", "entityId", "name" from "entity_name"
        where "lang" = $1 and "kind" in ('item', 'gameobject') and "isCurrent"`,
      [lang],
    ),
  ]);
  const texts = new Map(own.map((row) => [row.lineId, row]));
  const titles = new Map(names.map((row) => [`${row.kind}:${row.entityId}`, row.name]));

  return english.map((page) => {
    const text = texts.get(page.id);
    const owner = `${page.ownerKind === "object" ? "gameobject" : "item"}:${page.ownerIds[0]}`;
    const title = titles.get(owner);
    const spoken = text ? spokenText(text.text) : "";
    return {
      ...page,
      title: title ?? page.title,
      text: text ? text.text : page.text,
      spoken,
      hash: textHash(text ? text.text : ""),
      generatable: text ? text.generatable : false,
      skipReason: text ? text.skipReason : "untranslated",
      english: page.text,
      englishTitle: page.title,
      ...(!text || title === undefined
        ? { missing: { text: !text, title: title === undefined } }
        : {}),
    };
  });
}

async function build(lang: Lang): Promise<BookPage[]> {
  if (lang !== BASE_LANG) return buildTranslated(lang);
  const rows = await query<{
    lineId: string;
    pageId: number;
    bookId: number;
    pageNumber: number;
    pageCount: number;
    title: string;
    ownerKind: OwnerKind;
    ownerIds: number[];
    material: number;
    text: string;
    generatable: boolean;
    skipReason: string | null;
  }>(
    `select "lineId", "pageId", "bookId", "pageNumber", "pageCount", "title",
            "ownerKind", "ownerIds", "material", "text", "generatable", "skipReason"
       from "book_line"
      where "lang" = $1 and "isCurrent"
      order by "bookId", "pageNumber"`,
    [lang],
  );
  if (rows.length === 0) throw new CorpusEmpty(lang);

  return rows.map((row) => {
    const spoken = spokenText(row.text);
    return {
      id: row.lineId,
      pageId: row.pageId,
      bookId: row.bookId,
      pageNumber: row.pageNumber,
      pageCount: row.pageCount,
      title: row.title,
      ownerKind: row.ownerKind,
      ownerIds: row.ownerIds,
      material: row.material,
      text: row.text,
      spoken,
      hash: textHash(row.text),
      file: fileFor(row.pageId),
      generatable: row.generatable,
      skipReason: row.skipReason,
    };
  });
}

export async function catalogue(lang: Lang = BASE_LANG): Promise<BookPage[]> {
  const stamp = await stampOf(lang);
  const memo = (globalForBooks.booksCatalogue ??= new Map());
  const existing = memo.get(lang);
  if (existing && existing.stamp === stamp) return existing.value;

  const value = build(lang);
  memo.set(lang, { stamp, value });
  return value;
}

export async function loadContext(lang: Lang = BASE_LANG): Promise<SearchContext> {
  const [takeRows, reportRows, dirt] = await Promise.all([
    liveTakes("books", lang),
    // Grouped in the database rather than counted here: resolved rows are the ones that
    // accumulate, and there is no reason to carry them across to drop them. `lineId is not
    // null` excludes a report about the project, which belongs to no line.
    query<{ lineId: string; open: number }>(
      `select "lineId", count(*)::int as "open"
         from "report"
        where "source" = 'books' and "status" = 'open' and "lineId" is not null
          and "lang" = $1
        group by "lineId"`,
      [lang],
    ),
    loadDirtyContext("books", lang),
  ]);

  return {
    takes: new Map(
      takeRows.map((row) => [
        row.lineId,
        {
          version: row.version,
          file: row.file,
          textHash: row.spokenHash ?? "",
          chars: row.characters ?? 0,
          credits: row.credits,
          durationSec: row.durationSec,
          bytes: row.bytes,
          modelId: row.modelId,
          voiceId: row.voiceId,
          generatedAt: row.createdAt.toISOString(),
          takes: row.takes,
        },
      ]),
    ),
    reports: new Map(reportRows.map((row) => [row.lineId, row.open])),
    dirt,
  };
}

/**
 * Whether a lineId names a page that exists.
 *
 * `report` has no foreign key onto `book_line`, so this is what stands between a typo and a
 * row nothing will ever show or clean up. Every route accepting a lineId from outside calls it.
 */
export async function isKnownLine(lineId: string, lang: Lang = BASE_LANG): Promise<boolean> {
  return (await catalogue(lang)).some((page) => page.id === lineId);
}

/**
 * One page, by the id the game and the addon know it as.
 *
 * What /books/r/{pageId} resolves, and what the report endpoint checks an address against.
 * The addon can only name a page by this number -- `b:{pageTextID}` is frozen, which is what
 * lets it build a report link with no per-page table to ship.
 *
 * Off the memoised catalogue rather than a query of its own, as isKnownLine above is: the
 * corpus is 1,191 rows, it is already in memory for every other page on this section, and a
 * second query would be a second thing to keep in step with `isCurrent`.
 */
export async function pageById(
  pageId: number,
  lang: Lang = BASE_LANG,
): Promise<BookPage | undefined> {
  if (!Number.isInteger(pageId)) return undefined;
  return (await catalogue(lang)).find((page) => page.pageId === pageId);
}

/** The book dropdown's options, derived from the corpus rather than hardcoded. */
export type BookFacet = { bookId: number; title: string; pages: number; ownerKind: OwnerKind };

export async function bookFacets(lang: Lang = BASE_LANG): Promise<BookFacet[]> {
  const pages = await catalogue(lang);
  const books = new Map<number, BookFacet>();

  for (const page of pages) {
    const existing = books.get(page.bookId);
    if (existing) {
      existing.pages++;
    } else {
      books.set(page.bookId, {
        bookId: page.bookId,
        title: page.title,
        pages: 1,
        ownerKind: page.ownerKind,
      });
    }
  }

  // By title, then by id: 381 distinct titles cover 404 books, so a stable tiebreak is
  // what keeps two "A Dusty Tome" entries from swapping places between requests.
  return [...books.values()].sort(
    (a, b) => a.title.localeCompare(b.title) || a.bookId - b.bookId,
  );
}
