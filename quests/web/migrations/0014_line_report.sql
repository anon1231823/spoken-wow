-- What a player heard and thought was wrong.
--
-- The counterpart to line_issue (0011), and deliberately not the same table. A line_issue is
-- a machine's finding about corpus text, keyed on (category, item) and rebuilt wholesale by
-- every scan. A line_report is a human's claim about audio, arrives one at a time from
-- strangers, and must survive forever once written.
--
-- KEYED ON NOTHING THE ADDON RESOLVED. "target" holds the raw address the addon produced -
-- 'quest/1234/accept' or 'npc/5678'. The client builds it from a quest id and an event, or
-- from a unit GUID, never from soundData: when the data module fails to load there is no
-- soundData at all, and that is exactly the failure most worth reporting. "lineId" is filled
-- in only if the landing page could resolve the address against the corpus, and stays null
-- otherwise, because an unresolvable report is still a report.
--
-- NO FOREIGN KEY ON "lineId". The corpus is a file on disk, not a table, so there is nothing
-- to reference. A line id that stops resolving after a corpus refresh is a fact worth keeping
-- rather than a constraint violation.
--
-- NO DEDUPLICATION, ANYWHERE. Three people independently reporting one line is the single
-- most useful signal this table can carry, and a unique constraint would destroy it.
--
-- "ip" IS THE RATE LIMITER'S KEY AND NOTHING ELSE. Never read back into the UI, never shown
-- to a triager. It exists so that ten reports an hour is enforceable across a pm2 restart,
-- which is the moment a flood would otherwise get through.
--
-- A REPORT IS NOT A JOB. Nothing here references regeneration_job or regeneration_batch. A
-- regeneration spends ElevenLabs credits, so an unauthenticated write that could start one
-- would be an unauthenticated write that spends money. A collaborator reads the report and
-- queues the file through the existing flow.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the table is new, so the previous
-- release runs against this schema untouched.

create table "line_report" (
  "id"         bigserial   primary key,
  -- The corpus line the landing page resolved, or null when it resolved none.
  "lineId"     text,
  -- The raw address the addon produced, e.g. 'quest/1234/accept' or 'npc/5678'.
  "target"     text        not null,
  "category"   text        not null,
  "body"       text        not null,
  "status"     text        not null default 'open',
  -- Nullable and SET NULL, matching every other table here: provenance outlives the account.
  "userId"     text        references "user" ("id") on delete set null,
  -- Optional on purpose: a required contact field is a reason not to bother reporting at all.
  "name"       text,
  "email"      text,
  "ip"         text,
  "createdAt"  timestamptz not null default now(),
  "resolvedAt" timestamptz,
  "resolvedBy" text        references "user" ("id") on delete set null,
  constraint "line_report_category_check" check ("category" in
    ('pronunciation', 'wrong_voice', 'audio_quality', 'missing', 'wrong_text', 'other')),
  constraint "line_report_status_check" check ("status" in ('open', 'fixed', 'not_an_issue'))
);

create index "line_report_line_idx" on "line_report" ("lineId");

-- The triage list reads open reports newest first, and that is its whole query.
create index "line_report_open_idx" on "line_report" ("createdAt" desc) where "status" = 'open';

-- The rate limiter counts one IP over one hour and nothing else.
create index "line_report_ip_idx" on "line_report" ("ip", "createdAt" desc);
