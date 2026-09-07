-- Drop `say` from the stored entries.
--
-- It was a human respelling shown beside the IPA - "NOME-reh-gan" - from when the editor had
-- no way to hear an entry. The preview buttons replaced it: hearing a name settles what a
-- respelling could only hint at, and `note` covers anything else worth writing down.
--
-- validateEntry already drops it on the way in, so the next save would strip it anyway. Doing
-- it here means the row stops carrying dead data at a known moment rather than whenever
-- somebody next happens to press Save, and a fresh database seeded from 0008 - whose snapshot
-- still has the field - lands in the same state as an existing one.
--
-- Order is preserved explicitly. jsonb_agg over jsonb_array_elements does not promise input
-- order, and the entries are a list the editor displays and the dictionary is built from.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the previous release reads `say` off
-- entries that no longer have it and renders an empty column, which is not a failure.

update "pronunciation_lexicon"
   set "entries" = (
     select coalesce(jsonb_agg(entry - 'say' order by ord), '[]'::jsonb)
       from jsonb_array_elements("entries") with ordinality as t(entry, ord)
   )
 where "id";
