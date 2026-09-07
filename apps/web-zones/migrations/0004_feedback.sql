-- What a visitor said about a line, or about the project.
--
-- SEPARATE FROM line_flag, NOT A STATUS ON IT. The two tables look similar and are not
-- the same thing:
--
--   line_flag  one row per line, written by an editor, is the regeneration worklist.
--              A verdict. Other people act on it, which is why it is editor-and-up.
--   feedback   many rows per line, written by anyone including a guest, is a report.
--              A claim someone made. Nobody acts on it until a triager says so.
--
-- Folding reports into line_flag would mean either letting a passer-by write the
-- worklist, or throwing away everything a passer-by has to say. It also cannot hold
-- more than one, and "three people independently reported this line" is the single
-- most useful signal here.
--
-- lineId IS NULLABLE, unlike everywhere else in this schema. A null lineId is feedback
-- about ZoneLore itself -- the addon crashed, the site is unusable on a phone, the
-- voice is wrong for the whole project -- which has nowhere else to go and would
-- otherwise be filed against whichever line happened to be on screen.
--
-- ONE MUTABLE ROW, like line_flag and unlike voiceline_take. What matters is whether a
-- report is still open. A resolved report can be reopened, which clears resolvedAt and
-- resolvedBy: a mis-clicked "fixed" must be undoable where it was made, which is the
-- same argument api/flags makes for clearing a flag.

create table "feedback" (
  "id"        bigserial   primary key,

  -- Same format as voiceline_take."lineId": 'z:1411', 's:1411:razor hill'. No foreign
  -- key, for line_flag's reason -- a line is derived from committed Lua, not a row --
  -- so the API validates it against the catalogue instead. Null means "not about a line".
  "lineId"    text,

  -- Asked for up front rather than inferred from the prose, because it is what decides
  -- who looks: 'pronunciation' is a lexicon rule, 'audio' is a re-roll, 'lore' is the
  -- scraper or an override. Four values and an 'other' escape hatch, so nobody is stuck
  -- classifying their own complaint before they can make it.
  "category"  text        not null check ("category" in ('lore', 'audio', 'pronunciation', 'other')),
  "body"      text        not null,

  "status"    text        not null default 'open'
                          check ("status" in ('open', 'not_an_issue', 'fixed')),

  -- Set when the reporter was signed in, and then "name"/"email" stay null: the account
  -- is the identity and there is no point letting someone type a different one.
  -- ON DELETE SET NULL rather than cascade -- deleting an account must not silently
  -- delete the reports it left behind, which are about the lines, not about the person.
  "userId"    text        references "user" ("id") on delete set null,

  -- Anonymous reports only, and only when offered. Submitting with neither is fine and
  -- is expected to be the common case; a required contact field is a reason not to
  -- bother reporting at all.
  "name"      text,
  "email"     text,

  -- The rate limiter's key, and nothing else. Never read back into the UI, never shown
  -- to a triager. Kept in the row rather than an in-memory map so the limit survives a
  -- pm2 restart, which is exactly when a flood would otherwise get through.
  "ip"        text,

  "createdAt"  timestamptz not null default now(),
  "resolvedAt" timestamptz,
  "resolvedBy" text        references "user" ("id") on delete set null
);

-- The /feedback page's only ordering.
create index "feedback_created_idx" on "feedback" ("createdAt" desc);

-- The explorer's per-line open count, and the "unresolved feedback" filter behind it.
-- Partial, because a resolved report is never counted and the resolved rows are the
-- ones that accumulate.
create index "feedback_open_line_idx" on "feedback" ("lineId") where "status" = 'open';

-- The rate limiter's lookup: one count per submission, over a one hour window.
create index "feedback_ip_idx" on "feedback" ("ip", "createdAt" desc);
