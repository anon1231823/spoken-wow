-- How far along the quest corpus is, as one comparable string.
--
-- Fed to psql on stdin, locally and over ssh, by `make quests-check-synced`. A file rather
-- than a string inside the Makefile for the reason export_ignores.sql gave before it: the
-- quoting for a query this shape -- single quotes inside a shell command inside an ssh
-- argument -- is unreadable, unreviewable, and was got wrong on the first attempt.
--
-- The same three terms the app's own memo uses (lib/quests/catalogue.ts), because they
-- catch the three ways the table moves: an edit inserts a version so the highest id moves,
-- an import can delete so the count moves, and a restore moves the live flag between rows
-- that already exist -- which only the sum of live ids notices.
select coalesce(max("id"), 0) || ':' || count(*) || ':'
       || coalesce(sum("id") filter (where "isCurrent"), 0)
  from "quest_line";
