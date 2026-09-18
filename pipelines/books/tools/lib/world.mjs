// The vmangos world database, read once.
//
// PATCH IS NOT OPTIONAL. gameobject_template and item_template hold a row per content
// patch, and the server serves max(patch) <= the patch it runs (vmangos ObjectMgr.cpp:8143
// and :3820). Selected without it, an object comes back under several names at once and
// the extract emits a book titled whatever it was called in 1.2.
//
// page_text has no patch column, which is why it is selected plainly below -- a difference
// worth seeing in the SQL rather than assuming in either direction.

/** The patch a 1.12 server serves. Matches tts_cli/sql_queries.py's default. */
export const PATCH = 10;

/** GAMEOBJECT_TYPE_TEXT. data0 is the first page_text entry. */
const GO_TYPE_TEXT = 9;

export async function readWorld(connection, patch = PATCH) {
  const [pageRows] = await connection.query(
    "SELECT `entry`, `text`, `next_page` FROM `page_text`",
  );

  const [objectRows] = await connection.query(
    `SELECT t1.entry AS id, t1.name AS name, t1.data0 AS firstPage
       FROM gameobject_template t1
      WHERE t1.type = ?
        AND t1.data0 > 0
        AND t1.patch = (SELECT MAX(t2.patch) FROM gameobject_template t2
                         WHERE t2.entry = t1.entry AND t2.patch <= ?)`,
    [GO_TYPE_TEXT, patch],
  );

  const [itemRows] = await connection.query(
    `SELECT t1.entry AS id, t1.name AS name, t1.page_text AS firstPage,
            t1.page_material AS material
       FROM item_template t1
      WHERE t1.page_text > 0
        AND t1.patch = (SELECT MAX(t2.patch) FROM item_template t2
                         WHERE t2.entry = t1.entry AND t2.patch <= ?)`,
    [patch],
  );

  return {
    pages: pageRows.map((row) => ({
      entry: row.entry,
      text: row.text,
      nextPage: row.next_page,
    })),
    owners: [
      // A GameObject's material is chosen by its display, not carried on the template, so
      // object books record 0 and the site reads that as parchment.
      ...objectRows.map((row) => ({
        kind: "object",
        id: row.id,
        name: row.name,
        firstPage: row.firstPage,
        material: 0,
      })),
      ...itemRows.map((row) => ({
        kind: "item",
        id: row.id,
        name: row.name,
        firstPage: row.firstPage,
        material: row.material,
      })),
    ],
  };
}
