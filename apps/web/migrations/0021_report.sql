-- What a person said about a line, from either side of the site.
--
-- "line_report" here and "feedback" on the zones side are the same table: a claim someone
-- made about audio or text, arriving one at a time from strangers, kept forever, never
-- deduplicated -- three people independently reporting one line is the most useful signal
-- either table carries. Both are rate-limited on an "ip" column that is never read back
-- into the UI. Both have an optional name and email, because a required contact field is a
-- reason not to bother reporting at all. One triage page needs one table.
--
-- Two differences reconciled here:
--
--   "target" is nullable now. On the quests side it is the raw address the addon produced
--   ('quest/1234/accept', 'npc/5678') and is what makes an unresolvable report still a
--   report. The zones side has no equivalent -- its report page is reached with the line
--   already identified -- so its rows will carry the file path instead, and a report about
--   the project rather than a line carries neither.
--
--   The categories are the union. The zones vocabulary maps onto this one rather than
--   sitting beside it: its 'lore' is this 'wrong_text' and its 'audio' is this
--   'audio_quality', which are the same complaints under two names. 'pronunciation' and
--   'other' already agree. Mapping at import rather than keeping both spellings means the
--   triage page has one filter, not one per source.
--
-- "lineId" IS NULLABLE, and means two different things worth telling apart only by source:
-- on the quests side, an address the landing page could not resolve against the corpus; on
-- the zones side, feedback about the project itself. Both are reports with nowhere better
-- to file them, and both must survive.
--
-- NO FOREIGN KEY ON "lineId" on either side: a line is derived from a file on disk, not a
-- row, so there is nothing to reference and a lineId that stops resolving after a corpus
-- refresh is a fact rather than a constraint violation.
--
-- A REPORT IS STILL NOT A JOB. Nothing here references the queue. The write is
-- unauthenticated by design, and an unauthenticated write that could start a regeneration
-- would be an unauthenticated write that spends money.
--
-- "line_report" is left in place as the rollback, and goes in the cleanup after cutover.
--
-- Additive and forward-only per deploy/quests/bin/migrate.sh: the table is new.

create table "report" (
  "id"       bigserial   primary key,

  "source"   text        not null check ("source" in ('quests', 'zones')),
  -- Which language the reporter was reading. Worth having even on a report about the
  -- project: "the German is wrong everywhere" is a different report from the same sentence
  -- about English.
  "lang"     text        not null default 'enUS',

  -- The line this is about, or null: unresolvable (quests) or about the project (zones).
  "lineId"   text,
  -- The raw address the report came in on, or null where the source has none.
  "target"   text,

  "category" text        not null,
  "body"     text        not null,
  "status"   text        not null default 'open',

  -- Set when the reporter was signed in, and then "name"/"email" stay null: the account is
  -- the identity. SET NULL rather than cascade -- deleting an account must not delete the
  -- reports it left behind, which are about the lines, not about the person.
  "userId"   text        references "user" ("id") on delete set null,
  "name"     text,
  "email"    text,

  -- The rate limiter's key and nothing else. Never read back into the UI, never shown to a
  -- triager. Kept in the row rather than in memory so the limit survives a restart, which
  -- is exactly when a flood would otherwise get through.
  "ip"       text,

  "createdAt"  timestamptz not null default now(),
  "resolvedAt" timestamptz,
  "resolvedBy" text        references "user" ("id") on delete set null,

  constraint "report_category_check" check ("category" in
    ('pronunciation', 'wrong_voice', 'audio_quality', 'missing', 'wrong_text', 'other')),
  constraint "report_status_check" check ("status" in ('open', 'fixed', 'not_an_issue'))
);

create index "report_line_idx" on "report" ("source", "lang", "lineId");

-- The triage list reads open reports newest first, and that is its whole query.
create index "report_open_idx" on "report" ("createdAt" desc) where "status" = 'open';

-- The explorer's per-line open count. Partial, because a resolved report is never counted
-- and the resolved rows are the ones that accumulate.
create index "report_open_line_idx"
  on "report" ("source", "lang", "lineId") where "status" = 'open';

-- The rate limiter counts one IP over one hour and nothing else. Deliberately not keyed on
-- source: the limit is on a person, not on which page they are filing from.
create index "report_ip_idx" on "report" ("ip", "createdAt" desc);

insert into "report" (
  "source", "lang", "lineId", "target", "category", "body", "status",
  "userId", "name", "email", "ip", "createdAt", "resolvedAt", "resolvedBy"
)
select
  'quests', 'enUS', "lineId", "target", "category", "body", "status",
  "userId", "name", "email", "ip", "createdAt", "resolvedAt", "resolvedBy"
from "line_report"
order by "id";
