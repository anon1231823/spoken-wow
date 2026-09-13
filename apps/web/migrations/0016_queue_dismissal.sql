-- How much finished queue work has been waved away.
--
-- The panel shows terminal jobs for 24 hours (queue.ts's WINDOW), which is right while a run
-- is fresh and wrong once it is answered: a finished batch - especially a botched one - keeps
-- reappearing on every reload with a credit total nobody wants to read again. The X only ever
-- set React state, so it did not survive a navigation.
--
-- A watermark rather than a flag on the batch, because the panel is not about one batch: it
-- aggregates every job in the window, and a run can span several batches. Dismissing means
-- "nothing at or below this job id is news any more", which is exactly what the panel's own
-- cursor already tracks.
--
-- Global rather than per-user. This is a single-operator tool with a handful of collaborators,
-- and a batch someone has dealt with has been dealt with for everyone; a per-user column would
-- make the panel say different things to two people looking at the same queue.
--
-- One row, enforced by the primary key: `id` can only ever be true.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the previous release neither writes nor
-- reads this table, and an empty table means nothing is dismissed, which is today's behaviour.

create table "queue_dismissal" (
  "id"           boolean     primary key default true check ("id"),
  -- The highest terminal job id dismissed. Jobs above it are still news.
  "throughJobId" bigint      not null,
  "dismissedAt"  timestamptz not null default now(),
  -- Nullable and SET NULL, matching every other table here: provenance outlives the account.
  "dismissedBy"  text        references "user" ("id") on delete set null
);
