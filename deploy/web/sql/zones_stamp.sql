-- How far along a section's data is, as one comparable string. Zones.
--
-- Fed to psql on stdin, locally and over ssh, by scripts/db/check-synced.sh. A file rather
-- than a string inside a Makefile because the quoting for a query this shape -- single
-- quotes inside a shell command inside an ssh argument -- is unreadable and was got wrong
-- on the first attempt.
--
-- Two stamps, the corpus and the section's takes, each the three terms the app's own memo
-- uses (lib/zones/catalogue.ts): an edit or a new take inserts a row so the highest id
-- moves, a delete moves the count, and a restore moves the live flag between rows that
-- already exist -- which only the sum of live ids notices.
select (select coalesce(max("id"), 0) || ':' || count(*) || ':'
               || coalesce(sum("id") filter (where "isCurrent"), 0)
          from "lore_line")
       || ' / takes ' ||
       (select coalesce(max("id"), 0) || ':' || count(*) || ':'
               || coalesce(sum("id") filter (where "isCurrent"), 0)
          from "take" where "source" = 'zones');
