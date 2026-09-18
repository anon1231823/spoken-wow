-- A fourth origin for lore text: none of it yet.
--
-- The zones corpus has only ever held places somebody had already written about, because
-- the only way a row got here was a wiki scrape. A client sweep asks the opposite question
-- -- which places does the game have? -- and its answer includes places no wiki page
-- covers: 123 subzones and five zones that the Camelot beta client added and nobody has
-- described. They are corpus rows with an empty "full" and "short", waiting for somebody to
-- write them in the explorer.
--
-- A value rather than a note, for the reason 'scraped-rewritten' is one: "where did these
-- words come from" and "are there any words yet" are both questions the export, the voice
-- pipeline and the editor have to ask, and a row whose text is empty must never be mistaken
-- for a scrape that came back blank. Promoting a 'discovered' row means writing it, which
-- makes it 'edited' like any other hand-written line.
--
-- Additive and forward-only: existing rows keep their origin, and nothing reads this value
-- until tools/lore/export.mjs learns to skip empty text (it must, or validate.mjs fails the
-- addon build on an entry with no prose).

alter table "lore_line" drop constraint "lore_line_origin_check";

alter table "lore_line" add constraint "lore_line_origin_check"
  check ("origin" in ('scraped', 'edited', 'scraped-rewritten', 'translated', 'discovered'));
