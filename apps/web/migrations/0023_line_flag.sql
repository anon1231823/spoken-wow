-- What a person decided about a zone line after listening to it.
--
-- The generator knows a clip exists and what it cost. It cannot know it sounds wrong, and
-- without this there is nowhere to write that down. With 1353 lines and no record of what
-- has been heard, a review pass cannot be resumed -- which in practice means it is never
-- started.
--
-- ONE ROW, NOT A HISTORY, unlike a take. What matters is the current verdict; nobody needs
-- to know a line was marked bad in March and fine in April, and the take table already
-- records what changed in between.
--
-- 'ok' IS LOAD-BEARING. A table that only recorded problems could not answer "what have I
-- not heard yet", which is the question that makes the work finishable. A line with no row
-- is unreviewed, and that is the explorer's default filter for a listening pass.
--
-- NOT THE SAME THING AS A REPORT, and deliberately not folded into one. A flag is one row
-- per line written by a collaborator: a verdict, and the regeneration worklist. A report is
-- many rows per line written by anyone including a stranger: a claim, which nobody acts on
-- until a triager says so. Folding them would mean either letting a passer-by write the
-- worklist or throwing away what a passer-by has to say.
--
-- Quests has no equivalent and needs none: its worklist is the corpus scan's findings
-- (line_issue) plus what the search can already tell you about staleness and gaps. So this
-- carries no "source" column -- it is a zones table, and a lineId here is always 'z:' or
-- 's:'. A quests flag, if one is ever wanted, would be a different set of verdicts about a
-- different kind of defect, and giving it a column now would be guessing at both.
--
-- Additive and forward-only per deploy/web/bin/migrate.sh: the table is new.

create table "line_flag" (
  -- Matches the take table's "lineId". No foreign key: a line can be flagged before it has
  -- any audio -- "this text is wrong" is a useful thing to record about a line that has
  -- never been generated.
  "lineId"    text        not null,
  "lang"      text        not null default 'enUS',
  "status"    text        not null check ("status" in ('bad', 'ok')),
  "note"      text,
  "updatedAt" timestamptz not null default now(),

  -- One verdict per line per language. An editor marking a German line bad must not put the
  -- English one on the worklist.
  primary key ("lineId", "lang")
);

-- The review queue: everything still marked bad, most recently touched first.
create index "line_flag_bad_idx" on "line_flag" ("updatedAt" desc) where "status" = 'bad';
