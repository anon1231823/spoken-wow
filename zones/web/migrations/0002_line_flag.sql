-- What a person decided about a line after listening to it.
--
-- The generator knows a clip exists and what it cost. It cannot know it sounds wrong,
-- and before this table there was nowhere to write that down. With 1353 lines and no
-- record of what has been heard, a review pass cannot be resumed -- which in practice
-- means it is never started.
--
-- ONE ROW, NOT A HISTORY, unlike voiceline_take. What matters is the current verdict;
-- nobody needs to know a line was marked bad in March and fine in April. voiceline_take
-- already records what changed in between.
--
-- 'ok' IS LOAD-BEARING. A table that only recorded problems could not answer "what have
-- I not heard yet", which is the question that makes the work finishable. A line with
-- no row is unreviewed; that is the explorer's default filter for a listening pass.
--
-- No "createdBy" and no "user" table: this runs on one laptop for one person. Adding a
-- nullable createdBy referencing a user table later is an additive migration, and a
-- column now that references nothing would be a constraint that cannot be enforced.

create table "line_flag" (
  -- Matches voiceline_take."lineId". No foreign key: a line can be flagged before it
  -- has any audio -- "this text is wrong" is a useful thing to record about a line
  -- that has never been generated.
  "lineId"    text        primary key,
  "status"    text        not null check ("status" in ('bad', 'ok')),
  "note"      text,
  "updatedAt" timestamptz not null default now()
);

-- The review queue: everything still marked bad, most recently touched first.
create index "line_flag_bad_idx" on "line_flag" ("updatedAt" desc) where "status" = 'bad';
