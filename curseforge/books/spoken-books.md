---
project: 0
slug: spoken-books
name: Spoken Books
summary: Books, letters and notes read aloud. Open a book and it narrates — following you as you turn the pages, stopping when you close it. 1,191 pages across 404 books, from a one-line gravestone to a twenty-page journal.
categories:
  - Miscellaneous
  - Roleplay
  - Audio & Video
license: MIT
addonReadme: addons/SpokenBooks/README.md
---

**Every book in the world, read aloud.** One of the Spoken addons, narrating through the [Spoken Player](https://www.curseforge.com/wow/addons/spoken-player) it shares with Spoken Quests and Spoken Zones — your addon manager installs it alongside.

Open a book and it starts reading. Turn the page and it follows you. Close it and it stops. Letters and notes in your bags work the same way, and so do plaques and gravestones out in the world.

## What it reads

**1,191 pages across 404 books** — every readable object and item in vanilla Azeroth. The tablets in a dungeon, the ledgers in a town hall, the note on a corpse, the tombstone you walked past a hundred times and never clicked.

Some are one line. *Jitters' Completed Journal* is twenty pages, and it reads straight through while you turn them.

- **Whole books, in order** — opening the first page queues the rest, so you can read along rather than pressing play once a page. `/spb whole` turns that off if you would rather it narrated only what is in front of you.
- **It follows your page turns** — turn to a page it is already going to read and nothing restarts; jump somewhere else and it picks up from there.
- **Your mail is never read.** The game shows letters and books in the same frame, so the addon checks: anything with a sender, or anything opened from your mailbox, stays silent. Your post is yours.
- **Autoplay, on by default** — opening a book is already a deliberate act. `/spb autoplay` if you disagree.

## Narration needs the sound pack

The voice audio is a large download, so it ships separately as **[Spoken Books Audio](https://www.curseforge.com/wow/addons/spoken-books-audio)** (~465 MB). Unlike Spoken Zones, this addon has nothing to show you without it — the game already puts the words on your screen — so install both.

Without the pack it loads, stays quiet, and `/spb status` tells you what is missing rather than leaving you guessing.

## Honest limits

- **88 pages are silent, and always will be.** The game leaves some empty, fills others in as you read them ("Greetings, $N"), and a few are maintenance placeholders. They are in the list, labelled, rather than quietly missing.
- **The text is vanilla text.** On WoW: Forever, a book whose words were rewritten or added since won't be recognised — the addon stays quiet rather than reading you the old version. If you find one, say so; that is how the gap gets measured.
- **Some names are still coming out wrong.** With this many pages, some readings land flat. Reports decide what gets regenerated first.

## Commands

`/spokenbooks`, or `/spb` for short.

```
/spb read        read the page in front of you, whatever autoplay says
/spb stop        stop reading
/spb autoplay    read a book as soon as it opens (on by default)
/spb whole       read the whole book, or only the page on screen
/spb status      what is known, what is narrated, which pack is doing it
```

## Clients

Classic Era, the Anniversary client, and WoW: Forever. The game's book window is the same on all three, so this is one addon rather than three.
