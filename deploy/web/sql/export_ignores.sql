-- The ignore list as the document corpus/ignored.json holds.
--
-- Fed to psql on the droplet over ssh stdin by `make pull-ignores`. A file rather than a
-- string inside the Makefile because the quoting for a query this shape - single quotes
-- inside a shell command inside an ssh argument - is unreadable and unreviewable.
--
-- Sorted by "lineId" and carrying no author: the export is read by the Python CLI and by
-- rsync, which want a stable diff and have no use for an account. Provenance stays in the
-- table, which is the authority.
select jsonb_pretty(jsonb_build_object(
  'version', 1,
  'exportedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'ignored', coalesce((
    select jsonb_agg(jsonb_build_object('lineId', "lineId", 'reason', "reason")
                     order by "lineId")
    from "line_ignore"), '[]'::jsonb)
));
