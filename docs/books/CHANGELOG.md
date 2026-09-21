# Changelog

Notable changes to Spoken Books and its sound pack. Both are versioned together: a pack is
built from the same corpus export the addon ships, so installing one release of each is the
only combination that is tested.

## 2.1.0 — 2026-09-21

- **A page nobody has narrated can be sent in.** On a book, letter or plaque the addon does
  not know, the Play button reads **Contribute**: pressing it hands you a link carrying the
  page's own text, copied off your screen. Mail is never sent this way. Hide it with **Hide
  the Contribute buttons** in the Spoken Player settings.
- **Or gather as you play**: with gathering on (see Spoken Player 2.1.0), every page Spoken has
  no voice for is kept for you to send in one go. Mail is never kept either.
- **The sound pack moves to 2.1.0 with it.** Two pages are narrated again: page 3 of *Old
  Hatreds - The Colonization of Kalimdor* and page 4 of *The Feast of Winter Veil*. Their
  words are unchanged, and every other page is the same recording as in 2.0.0.

## 2.0.0 — 2026-09-18

First release. Books, letters, notes and plaques read aloud.

Numbered 2.0.0 rather than 1.0.0 to sit with the rest of the family: Spoken Player, Spoken
Quests and Spoken Zones are all on 2.x, and a books addon at 1.0.0 beside them reads as the
older thing rather than the newer one. There is no 1.x of this addon and never was.

- **1103 narrated pages**, across 404 books — everything in the game that opens a page of
  text and has words a voice can read.
- Opening a book **queues it whole**, so a long journal reads on while you turn pages.
  Turning to a page that is already queued changes nothing; turning elsewhere picks the
  narration up from there.
- Works on **Era, the Anniversary realms and the Forever beta**. A page is matched on the
  words the client is showing rather than on an id, so books that Forever carries unchanged
  from vanilla play with no extra work.
- **Mail is never read aloud**, including a returned letter that has no sender.
- A **settings panel** and a **Play button** on the book window, with `/spb` for the
  clients whose Settings API the panel cannot use. Autoplay, whole-book and read-once are
  the three switches.
- **Read-once is per character.** Settings are how you like the addon to behave; having
  read something is a thing a character did, so an alt walking into the same library hears
  it fresh.
- Every clip carries a **Report** button, which opens an address you can copy out to say
  what was wrong with it.

Narration plays through **Spoken Player**, which addon managers install with this addon.
**Spoken Books Audio** is the narration itself and is a separate download.
