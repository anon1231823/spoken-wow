-- The same language dimension for the audio, and for the same reason: a line is
-- narrated once per language, so "one current take per line" becomes "one current
-- take per line per language".
--
-- The take's "file" stays store-relative and language-free -- '1411/razor-hill'
-- in every language. One sound pack addon ships one language, so the language is
-- the pack folder ("ZoneLoreAudioDE") rather than a path segment inside it, and
-- the 1353 English files, the audio-history/ tree and the content-addressed
-- transcode cache all keep the paths they already have.
--
-- Nothing has been generated in any language but English. This migration only
-- makes it possible to record that it was.

alter table "voiceline_take" add column "lang" text not null default 'enUS';

alter table "voiceline_take" drop constraint "voiceline_take_lineId_version_key";
alter table "voiceline_take" add constraint "voiceline_take_lineId_lang_version_key"
  unique ("lineId", "lang", "version");

drop index "voiceline_take_current_idx";
create unique index "voiceline_take_current_idx"
  on "voiceline_take" ("lineId", "lang") where "isCurrent";
