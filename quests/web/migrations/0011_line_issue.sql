-- What the hiccup scan found, and what we decided about it.
--
-- tools/scan_corpus_hiccups.py reads the corpus and writes corpus/hiccups.json.gz: 3,716
-- findings - uncovered names, stage directions read aloud, raw binary, $N substitution
-- damage, Blizzard's own typos - over 16,752 finding-line pairs. This is where they land so
-- the explorer can mark a row and someone can say "fixed" or "not a problem" and be believed
-- next time.
--
-- The detections are derived data and the artifact is their source of truth; the verdict
-- columns are the only thing here that a person authored. Everything about the load is
-- arranged around that split.
--
-- WHY (category, item) IS THE IDENTITY. A finding has no stable id of its own - the scan
-- rebuilds the list from scratch every run, and row order moves as counts move. The pair
-- that survives a re-scan is what the finding is *about*: the category it fell into and the
-- token or fragment it concerns. Upserting on that pair is what lets a reload refresh
-- severity, counts and affected lines while leaving a verdict recorded weeks ago alone.
--
-- WHY "scanAt" RATHER THAN DELETING. A name that gets a lexicon entry stops being detected,
-- and the honest thing is not to delete its row - that would throw away the verdict and the
-- note explaining the decision, and the finding would come back as new if the entry were
-- ever removed. Instead every load stamps the rows it saw, and anything carrying an older
-- stamp is simply no longer detected: hidden by default, still there, still explaining
-- itself. The lexicon is not consulted by the scan at all for the same reason - see the
-- module docstring in tools/scan_corpus_hiccups.py.
--
-- WHY THE LINES ARE A SEPARATE TABLE. A finding touches between one and 480 lines. In an
-- array column that is unindexable for the query the explorer actually asks, which is the
-- other direction: given this line, what is wrong with it.
--
-- Both tables start EMPTY. Loading is an action (/issues -> "Reload scan"), not a migration:
-- 16,752 join rows as SQL literals is not a file anyone can review, and a reload has to be
-- repeatable in a way a migration recorded once is not.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the tables are new, so the previous
-- release runs against this schema untouched.

create table "line_issue" (
  "id"          bigserial   primary key,
  -- 'name-apostrophe', 'roleplay-asterisk', 'bug-source-typo', … Deliberately not an enum:
  -- the scan grows categories faster than a migration can follow, and an unknown category
  -- should show up in the UI as itself rather than fail the load.
  "category"    text        not null,
  -- The token, or the offending fragment for line-level findings.
  "item"        text        not null,
  -- 1 will mispronounce or read out junk, 2 likely wrong, 3 long tail.
  "severity"    smallint    not null check ("severity" between 1 and 3),
  "note"        text        not null,
  -- Times the finding occurs, which is not the number of lines: one line can hold six.
  "occurrences" integer     not null,
  -- Every casing and possessive the source spells it with. Load-bearing for names: rules go
  -- up case-sensitively, so Dor'Danil and Dor'danil each need their own lexicon entry.
  "variants"    text,
  -- The lowercased base a name finding is about, for matching against lexicon graphemes.
  -- Null for line-level findings, which no lexicon entry can ever resolve.
  "grapheme"    text,

  "verdict"     text        not null default 'open'
                  check ("verdict" in ('open', 'fixed', 'dismissed')),
  "verdictNote" text,
  -- Nullable and SET NULL, matching voiceline_version: who decided outlives the account.
  "verdictBy"   text        references "user" ("id") on delete set null,
  "verdictAt"   timestamptz,

  -- Which load last saw this finding. Older than the newest load means the scan no longer
  -- detects it.
  "scanAt"      timestamptz not null,

  unique ("category", "item")
);

create table "line_issue_line" (
  "issueId" bigint not null references "line_issue" ("id") on delete cascade,
  "lineId"  text   not null,
  primary key ("issueId", "lineId")
);

-- "given this line, what is wrong with it" - the explorer's question, asked for every row on
-- every page. The primary key already serves the other direction.
create index "line_issue_line_line_idx" on "line_issue_line" ("lineId");

-- The review queue's default sort, and the reload's "which rows are current" filter.
create index "line_issue_open_idx" on "line_issue" ("scanAt", "severity", "occurrences" desc)
  where "verdict" = 'open';
