-- A third origin for lore text: written by a model from the wiki article.
--
-- Migration 0005 drew one line, between text the scraper read off warcraft.wiki.gg
-- and text a person wrote here, because that was the only distinction that decided
-- anything: a scrape may take back a scraped line and may not take back an edited
-- one.
--
-- tools/rewrite-lore.mjs adds a third kind. It reads the *whole* article rather than
-- the lead, and has Claude rewrite it as in-world history -- which fixes what the
-- lead-only scrape got wrong (missing pre-WoW lore, fourth-wall asides, facts in
-- encyclopedic rather than narrative order) but means the words in the row are no
-- longer words a human being wrote on the wiki.
--
-- That matters twice. First for promotion: a rewrite must survive a later
-- `node tools/scrape.mjs`, or re-reading the wiki would silently undo hours of
-- work, so recordScrape promotes only over 'scraped' and this value sits outside
-- that set. Second for provenance: the text is still derived from a CC BY-SA 4.0
-- article and keeps its "source", but anyone auditing the corpus should be able to
-- ask which lines a model wrote, and a boolean buried in "note" is not an answer.

alter table "lore_line" drop constraint "lore_line_origin_check";

alter table "lore_line" add constraint "lore_line_origin_check"
  check ("origin" in ('scraped', 'edited', 'scraped-rewritten'));
