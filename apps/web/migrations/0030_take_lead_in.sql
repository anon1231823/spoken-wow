-- The throat clear the narrator performs and the file does not keep.
--
-- ElevenLabs voices ramp up: the first second or two of a clip is audibly worse than the
-- rest. On a book that is a drop in quality at the top of every page. The documented remedy
-- is previous_text, and eleven_v3 -- the model everything here generates with -- rejects it:
-- "Providing previous_text or next_text is not yet supported with the 'eleven_v3' model."
--
-- So the request carries "[clears throat] [long pause] " in front of the text, the model
-- spends its settling on the throat clear, and the gap after it is found and cut before the
-- audio is stored. See lib/generation/leadin.ts for the measurements behind the thresholds.
--
-- TWO COLUMNS, NOT ONE, because "we did not ask" and "we asked and it did not work" are
-- different facts and only the second is worth chasing:
--
--   "leadIn"     a lead-in was sent. False for every take made before this, and for any
--                model that would read the brackets aloud instead of performing them.
--   "leadInSec"  how much was cut. NULL with "leadIn" true is the case to find: the model
--                ignored the tag, or ffmpeg was not there, and the take was stored as it
--                arrived - ramp-up, throat clear and all.
--
-- Deliberately not backfilled. Existing takes were made without a lead-in, and false is
-- what the column says about them.
alter table "take" add column "leadIn"    boolean not null default false;
alter table "take" add column "leadInSec" numeric;

-- The takes worth re-rolling: asked for a trim, did not get one.
create index "take_lead_in_failed_idx" on "take" ("createdAt" desc)
 where "leadIn" and "leadInSec" is null;
