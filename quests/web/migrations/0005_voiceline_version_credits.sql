-- What each take actually cost, from ElevenLabs' `character-cost` response header.
--
-- Separate from "characters" because they are not the same number and the difference is
-- large: ElevenLabs bills round(characters * rate), where the rate belongs to the plan, not
-- the request. Measured at 0.55 on the account this was built against, and half that for the
-- flash and turbo models - so a 310-character line cost 170 credits.
--
-- Recording it makes two things possible that a hardcoded rate would not: an honest total
-- after a batch, and an estimate before one that is calibrated from this account's own
-- history rather than from a constant that goes stale when a plan changes.
--
-- Nullable, because the header is not guaranteed. A take generated without one is honestly
-- unpriced rather than priced by guesswork.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the previous release ignores this
-- column entirely.

alter table "voiceline_version" add column "credits" integer;

-- The calibration query reads recent generated takes for one model.
create index "voiceline_version_credits_idx"
  on "voiceline_version" ("modelId", "createdAt" desc)
  where "credits" is not null;
