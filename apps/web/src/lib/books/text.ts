/**
 * A page's words, and the one write that changes them.
 *
 * SERVER ONLY. book_line has been versioned since 0026 -- `origin in ('extracted','edited')`,
 * an editedBy, a note -- and until now nothing wrote an `edited` row: the only way a page's
 * text could change was a re-import from the dump. So a reported mistake in a book could be
 * read, triaged and regenerated, but not actually fixed, which made the report queue a list
 * of things nobody could act on.
 *
 * The zones equivalent (lib/zones/lore.ts) is the model, down to the optimistic version
 * check, and the differences are the two corpora's own:
 *
 *   * A page has one text, where a zone line has a full and a short.
 *   * The structural fields -- which book, which page number, what opens it -- are copied
 *     from the live row rather than accepted from the caller. Which pages exist is the
 *     extract's business (0026 says so plainly), and an API that let a text edit move a
 *     page to another book would be one bad request away from a page the addon cannot find.
 *
 * EDITING DOES NOT REGENERATE. The new text hashes differently from the take that was
 * spoken, so the page simply reads "audio outdated" and joins the worklist like any other
 * stale line. Coupling a free action to a paid one is how a typo fix ends up costing
 * credits.
 */
import "server-only";

import { db, query } from "@/lib/db";

import { BASE_LANG, type Lang } from "@/lib/lang";

export type BookVersion = {
  lineId: string;
  version: number;
  isCurrent: boolean;
  origin: "extracted" | "edited";
  text: string;
  editedBy: string | null;
  note: string | null;
  createdAt: string;
};

type Row = Omit<BookVersion, "createdAt"> & { createdAt: Date };

const COLUMNS = `"lineId", "version", "isCurrent", "origin", "text", "editedBy", "note",
                 "createdAt"`;

function toVersion(row: Row): BookVersion {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** Somebody else changed this page while the dialog was open. */
export class BookConflict extends Error {}
/** The page is not in the table, which means the corpus has not been imported. */
export class BookMissing extends Error {}

/** Every version of one page, newest first. */
export async function bookHistory(
  lineId: string,
  lang: Lang = BASE_LANG,
): Promise<BookVersion[]> {
  const rows = await query<Row>(
    `select ${COLUMNS} from "book_line"
      where "lineId" = $1 and "lang" = $2
      order by "version" desc`,
    [lineId, lang],
  );
  return rows.map(toVersion);
}

/**
 * Saves a rewritten page as a new live version.
 *
 * `expectedVersion` is optimistic concurrency rather than ceremony: the dialog holds the
 * text it loaded, and two editors on the same page would otherwise silently overwrite each
 * other with a whole page rather than a field. Sending the version the edit started from
 * turns that into a 409 the second person can see.
 */
export async function saveBookText(args: {
  lineId: string;
  text: string;
  note?: string | null;
  editedBy: string;
  expectedVersion?: number | null;
  lang?: Lang;
}): Promise<BookVersion> {
  const lang = args.lang ?? BASE_LANG;
  const client = await db().connect();
  try {
    await client.query("begin");

    const { rows: currentRows } = await client.query<Row>(
      `select ${COLUMNS} from "book_line"
        where "lineId" = $1 and "lang" = $2 and "isCurrent" for update`,
      [args.lineId, lang],
    );
    const current = currentRows[0];

    // The first translation of a page has no row of its own to copy the structure from, and
    // takes it from the English page -- where a page sits is a fact about the world, the
    // same in every language.
    let source: { lang: Lang; version: number } | null = current
      ? { lang, version: current.version }
      : null;
    if (!source && lang !== BASE_LANG) {
      const { rows: english } = await client.query<{ version: number }>(
        `select "version" from "book_line"
          where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
        [args.lineId, BASE_LANG],
      );
      if (english[0]) source = { lang: BASE_LANG, version: english[0].version };
    }
    if (!source) {
      throw new BookMissing(
        `${args.lineId} is not in book_line -- seed the table with: make books-import`,
      );
    }
    if (
      current &&
      args.expectedVersion !== undefined &&
      args.expectedVersion !== null &&
      args.expectedVersion !== current.version
    ) {
      throw new BookConflict(`this page moved to v${current.version} while you were editing it`);
    }

    const text = args.text.trim();
    if (!text) throw new Error("the text cannot be empty");

    // A save that changes nothing must not spend a version number: the history is a record
    // of what the page has said, not of who opened the dialog.
    if (current && text === current.text) {
      await client.query("commit");
      return toVersion(current);
    }

    const { rows: maxRows } = await client.query<{ version: string }>(
      `select coalesce(max("version"), 0) as "version" from "book_line"
        where "lineId" = $1 and "lang" = $2`,
      [args.lineId, lang],
    );
    const version = Number(maxRows[0].version) + 1;

    await client.query(
      `update "book_line" set "isCurrent" = false
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [args.lineId, lang],
    );

    // The structural fields ride along from the row being replaced, or from the English
    // page for a first translation. They are the extract's to set, and copying them keeps
    // this one insert rather than an insert plus a lookup.
    const { rows: inserted } = await client.query<Row>(
      `insert into "book_line"
         ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId",
          "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "material",
          "text", "generatable", "skipReason", "editedBy", "note")
       select "lineId", $2, $3, true, 'edited', "pageId", "bookId",
              "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "material",
              $4, "generatable", "skipReason", $5, $6
         from "book_line"
        where "lineId" = $1 and "lang" = $8 and "version" = $7
       returning ${COLUMNS}`,
      [
        args.lineId, lang, version, text, args.editedBy, args.note?.trim() || null,
        source.version, source.lang,
      ],
    );

    await client.query("commit");
    return toVersion(inserted[0]);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Puts an earlier version back.
 *
 * Moves the live flag rather than inserting a copy, which is what `restore` means for a
 * lore version and for a take: the history is the set of texts this page has had, and
 * restoring is a statement about which of them is right, not a new one.
 */
export async function restoreBookText(
  lineId: string,
  version: number,
  lang: Lang = BASE_LANG,
): Promise<BookVersion> {
  const client = await db().connect();
  try {
    await client.query("begin");

    const { rows } = await client.query<Row>(
      `select ${COLUMNS} from "book_line"
        where "lineId" = $1 and "lang" = $2 and "version" = $3 for update`,
      [lineId, lang, version],
    );
    if (!rows[0]) throw new BookMissing(`${lineId} has no version ${version}`);

    await client.query(
      `update "book_line" set "isCurrent" = false
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [lineId, lang],
    );
    await client.query(
      `update "book_line" set "isCurrent" = true
        where "lineId" = $1 and "lang" = $2 and "version" = $3`,
      [lineId, lang, version],
    );

    await client.query("commit");
    return toVersion({ ...rows[0], isCurrent: true });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
