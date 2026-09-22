-- EU English contributions, filed as English.
--
-- The addons send the client's GetLocale(), and an EU English client reports enGB. Since the
-- contributions page lists one language's rows, an enGB row matched no page; intake now stores
-- it as enUS (lib/lang.ts clientLang), and the rows it stored before that are moved here.
--
-- `dedup` is left as it was: it only has to stop the same player sending the same line twice,
-- and a later enGB send of one of these hashes as enUS and simply counts as a new row.
update "contribution" set "locale" = 'enUS' where "locale" = 'enGB';
