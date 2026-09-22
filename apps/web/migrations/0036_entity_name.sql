-- The names of things, per language: a quest's title, an NPC's, an object's or item's, a
-- zone's and a subzone's.
--
-- A name belongs to the thing rather than to any one line of text about it. Quest 33 is
-- "Wolves Across the Border" on its accept line, its progress line and its completion line,
-- and Marshal Dughan is Marshal Dughan in all nine lines he speaks. So a translation is
-- written once, here, keyed on the thing's id, and every line that names it reads it. The
-- ids are global -- the same quest, NPC and zone in every language -- and the name is the
-- language's.
--
-- `entityId` is text because the zones are not numbered things: a zone is its line id
-- ('z:1411') and a subzone its key ('s:1411:razor-hill'), both frozen by AGENTS.md. Quests,
-- creatures, gameobjects and items are their game ids.
--
-- VERSIONED LIKE EVERY OTHER TEXT HERE -- quest_line, lore_line, book_line -- with one live
-- row per (kind, entityId, lang), and the same two origins: 'extracted' came out of a dump,
-- 'edited' was written by a person. An extraction never supersedes an edit.
create table "entity_name" (
  "id"        bigserial   primary key,
  "kind"      text        not null
    check ("kind" in ('quest', 'creature', 'gameobject', 'item', 'zone', 'subzone')),
  "entityId"  text        not null,
  "lang"      text        not null,
  "version"   integer     not null,
  "isCurrent" boolean     not null default false,
  "origin"    text        not null check ("origin" in ('extracted', 'edited')),
  "name"      text        not null,
  "editedBy"  text references "user" ("id") on delete set null,
  "note"      text,
  "createdAt" timestamptz not null default now(),
  unique ("kind", "entityId", "lang", "version")
);

create unique index "entity_name_current_idx"
  on "entity_name" ("kind", "entityId", "lang") where "isCurrent";

-- ENGLISH IS KEPT IN STEP WITH THE COLUMNS IT CAME FROM, by trigger.
--
-- English names are written today by four writers in three languages -- the quests
-- importer (Python), the lore and books importers (Node), and contributions (this app) --
-- into quest_line.questTitle, quest_line_speaker.npcName, lore_line.name and
-- book_line.title, and the export that builds every English pack reads them back from
-- there. Moving all four writers and the export at once is the change most likely to
-- alter a pack by accident, so the columns stay the source for English and these triggers
-- copy each write across. Every English name is therefore in this table too, current, and
-- no writer had to change to put it there.
--
-- The English explorer does not read them from here yet, deliberately: the extract has 12
-- quests and 8 NPCs with two English names each (the duplicate-lineId defect 0032 records),
-- and one name per thing would quietly show one of them for both. Which is right is a data
-- decision, not a schema one.
create function "entity_name_set"(k text, eid text, l text, n text) returns void
language plpgsql as $$
declare
  current_name text;
begin
  if n is null or n = '' then
    return;
  end if;

  select "name" into current_name from "entity_name"
   where "kind" = k and "entityId" = eid and "lang" = l and "isCurrent";
  if current_name is not distinct from n then
    return;
  end if;

  update "entity_name" set "isCurrent" = false
   where "kind" = k and "entityId" = eid and "lang" = l and "isCurrent";
  insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
  select k, eid, l, coalesce(max("version"), 0) + 1, true, 'extracted', n
    from "entity_name" where "kind" = k and "entityId" = eid and "lang" = l;
end;
$$;

-- WHERE A THING HAS TWO ENGLISH NAMES, the one already here stands for as long as any row
-- still uses it. Without that, the importer -- which replaces every speaker row on each run
-- -- would write a new version for each of those eight NPCs every time, flipping between
-- their two names in whatever order the rows arrived.
create function "entity_name_from_quest_line"() returns trigger
language plpgsql as $$
begin
  if new."lang" = 'enUS' and new."isCurrent" and new."questId" is not null
     and not exists (
       select 1 from "entity_name" e
         join "quest_line" q on q."questTitle" = e."name"
        where e."kind" = 'quest' and e."entityId" = new."questId"::text
          and e."lang" = 'enUS' and e."isCurrent"
          and q."questId" = new."questId" and q."lang" = 'enUS' and q."isCurrent")
  then
    perform "entity_name_set"('quest', new."questId"::text, 'enUS', new."questTitle");
  end if;
  return null;
end;
$$;

create function "entity_name_from_speaker"() returns trigger
language plpgsql as $$
begin
  if new."lang" = 'enUS'
     and not exists (
       select 1 from "entity_name" e
         join "quest_line_speaker" s on s."npcName" = e."name"
        where e."kind" = new."npcType" and e."entityId" = new."npcId"::text
          and e."lang" = 'enUS' and e."isCurrent"
          and s."npcType" = new."npcType" and s."npcId" = new."npcId" and s."lang" = 'enUS')
  then
    perform "entity_name_set"(new."npcType", new."npcId"::text, 'enUS', new."npcName");
  end if;
  return null;
end;
$$;

create function "entity_name_from_lore_line"() returns trigger
language plpgsql as $$
begin
  if new."lang" = 'enUS' and new."isCurrent" then
    perform "entity_name_set"(new."kind", new."lineId", 'enUS', new."name");
  end if;
  return null;
end;
$$;

-- A page's title is its owner's name, and every owner of the page is named by it.
-- book_line calls a gameobject an 'object'.
create function "entity_name_from_book_line"() returns trigger
language plpgsql as $$
declare
  owner integer;
begin
  if new."lang" = 'enUS' and new."isCurrent" then
    foreach owner in array new."ownerIds" loop
      perform "entity_name_set"(
        case new."ownerKind" when 'object' then 'gameobject' else 'item' end,
        owner::text, 'enUS', new."title");
    end loop;
  end if;
  return null;
end;
$$;

-- What the quest trigger's "is the current title still used" asks, once per imported row;
-- without it an import of seventeen thousand lines is seventeen thousand scans.
create index "quest_line_quest_idx" on "quest_line" ("questId") where "isCurrent";

create trigger "entity_name_quest_line"
  after insert or update of "isCurrent", "questTitle" on "quest_line"
  for each row execute function "entity_name_from_quest_line"();

create trigger "entity_name_speaker"
  after insert or update of "npcName" on "quest_line_speaker"
  for each row execute function "entity_name_from_speaker"();

create trigger "entity_name_lore_line"
  after insert or update of "isCurrent", "name" on "lore_line"
  for each row execute function "entity_name_from_lore_line"();

create trigger "entity_name_book_line"
  after insert or update of "isCurrent", "title" on "book_line"
  for each row execute function "entity_name_from_book_line"();

-- What is there already. Where the extract gives a thing two names, the one on the most
-- lines wins here, then the alphabetically first -- a choice only this table sees, since
-- the English explorer and the export still read the columns.
insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
select distinct on (kind, eid) kind, eid, 'enUS', 1, true, 'extracted', name
  from (
    select 'quest' as kind, "questId"::text as eid, "questTitle" as name, count(*) as n
      from "quest_line"
     where "lang" = 'enUS' and "isCurrent" and "questId" is not null
       and coalesce("questTitle", '') <> ''
     group by 1, 2, 3
    union all
    select "npcType", "npcId"::text, "npcName", count(*)
      from "quest_line_speaker"
     where "lang" = 'enUS' and "npcName" <> ''
     group by 1, 2, 3
    union all
    select "kind", "lineId", "name", 1
      from "lore_line"
     where "lang" = 'enUS' and "isCurrent" and "name" <> ''
    union all
    select case "ownerKind" when 'object' then 'gameobject' else 'item' end,
           owner::text, "title", count(*)
      from "book_line", unnest("ownerIds") as owner
     where "lang" = 'enUS' and "isCurrent" and "title" <> ''
     group by 1, 2, 3
  ) as named
 order by kind, eid, n desc, name;

-- What a client in the line's language actually shows, which is what the addon matches a
-- quest's or a greeting's text against. Null for English -- there it is originalText -- and
-- for a language no client runs in. The line's text is what is SPOKEN, and can differ.
alter table "quest_line" add column "localeText" text;
