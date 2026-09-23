# Changelog — Spoken Player

## 2.2.1 — 2026-09-23

- **No more Lua error on logout or `/reload` with the Minimal Classic layout.** When its
  settings were all still at their defaults, the game dropped them while logging out, and the
  panel went on laying itself out as the UI was taken down and failed to find them. It falls
  back to the defaults now. On the WoW Forever beta this happened on every logout and reload.

## 2.2.0 — 2026-09-22

- **A second layout, and it is the one the player opens in.** **Minimal Classic** is a
  compact panel on the modern clients: a round portrait of the speaker taken from the
  client's own art, the name in gold, the line's title under it and a slim cast bar. There
  is no permanent row of buttons — click the portrait to pause or start the line again,
  click the title to skip it, right-click anywhere on the panel for playback and for the
  source's own actions.
- **The queue folds away.** A plus button beside the panel counts the lines waiting and
  opens them; scroll for more than four, click one to drop it, and the whole drawer closes
  again. A book or a zone line carries its own badge on the portrait, so it is clear which
  addon is speaking without reading the title.
- Designed and written by [shorley-gm](https://github.com/shorley-gm), who contributed it
  in [#46](https://github.com/rusty-key/spoken-wow/pull/46) along with the artwork notes
  and an offline harness that drives the real queue and UI code.
- **The original layout is one setting away.** Turn off **Minimal Classic player** under
  `/sp options` and the player looks exactly as it did in 2.1.0; the hide-portrait,
  hide-player and per-action settings apply to both. `/sp reset` resets whichever layout
  is showing.
- Not on the 1.12, 2.4.3 and 3.3.5 clients, where it is neither offered nor drawn. They
  keep the original player.

## 2.1.0 — 2026-09-21

- **Sending the game's text where Spoken has no voice.** When Spoken Quests, Spoken Zones or
  Spoken Books has nothing for what is on screen, its Contribute button opens a small box
  holding a link. Copy it, open it in a browser and press Send: the link already carries the
  text straight from your client, so there is nothing to paste. It is compressed, so a long
  book page still fits in one link.
- **Or gather them as you play.** The first time you press Contribute you can choose to send
  just that line, or to let Spoken quietly keep every line it has no voice for and send them
  all at once. They are kept in a file of their own, `SpokenContributions.lua` in your
  `SavedVariables` folder, which you upload at spoken.rusty.one/contribute whenever you like.
  Nothing leaves your game until you do. `/spoken share` shows the steps again. Gathering
  stops at the 2,000 most recent lines.
- **A new Contributions section in the settings**: **Gather missing lines in the background**
  turns gathering off, **How to send them** shows the steps, **Clear gathered lines** empties
  the file once it has been sent, and **Hide the Contribute buttons** turns every one of those
  buttons off in one place.
- **The settings scroll.** With the new rows, the minimap and addon sections ran off the
  bottom of the window on the modern clients' settings panel.
- The link box has the keyboard as soon as it opens, so copying straight away works the
  first time too.
- The zip carries a second folder, **SpokenContributions**, which holds nothing but the
  gathered lines' file. An addon manager installs it with the player; installing by hand,
  copy both folders into `AddOns`.
- Not on the 1.12, 2.4.3 and 3.3.5 clients, where contributing is off for now.

## 2.0.4 — 2026-09-18

- **The portrait is a portrait again on the Forever client.** Selecting camera 0 of the
  creature's own model is what has framed the speaker's head on every client this addon
  runs on; the Forever client accepts that call and ignores it, so the whole NPC stood in
  the box instead. It is framed with the portrait zoom there, which that client honours.

## 2.0.3 — 2026-09-18

- **The minimap button's texture is DXT5, like every other texture Spoken ships.** The
  palettized BLP the 2.0.2 button used is legal by the format's own rules, but the Classic
  beta client asserts inside its image decoder the moment it loads one and takes the game
  down. The mark is unchanged; only the encoding is.

## 2.0.2 — 2026-09-18

- **The minimap button wears the play triangle.** It carried a crest inherited from VoiceOver
  Redux that, at the size the minimap draws, was a brown smudge. The button is the one place
  every Spoken addon is reached from, and it now shows the same mark as the AddOns list — the
  gold triangle on the dark field, without the shield frame, since the minimap draws a frame
  of its own around it.

## 2.0.1 — 2026-09-18

- **A new icon in the AddOns list**: a gold play triangle on the Spoken shield. Spoken Quests
  and Spoken Zones wear the same shield with a mark of their own, so the three read as one
  family without any two of them looking like the same addon listed twice.

## 2.0.0 — 2026-09-18

The player every Spoken addon speaks through: one queue, one window, one minimap button.

- **Runs on the Forever client** (1.60.1, interface 16001 — the one whose TOC suffix is
  `_Camelot`), alongside Classic Era 1.15.9 and the 2.5.6 Anniversary client.
- **`/sp` is a short form of `/spoken`**, matching `/spq` for Spoken Quests and `/spz` for
  Spoken Zones. One scheme across the three addons.
- **Every Spoken addon carries the same version from here on.** This is the player's first
  release, so 2.0.0 is a number it never earned on its own — it is Spoken Quests', and the
  three addons ship together and are supported together. A player comparing two of them
  should not have to work out which numbering each follows.
- Extracted from VoiceOver Redux and ZoneLore, which each carried their own copy.
- One FIFO across every addon; nothing interrupts. Gossip yields to quest dialogue at the door.
- Narration held through combat no longer blocks a quest line queued behind it.
- Report is an icon in the player's top right corner rather than a button beside the line,
  and it can be switched off under Player window. The 1.12, 2.4.3 and
  3.3.5 clients, whose art does not include that icon, get a lettered button instead.
- A quest line plays with its NPC and its title shown. The portrait is resolved before the
  rows, and asking a model frame a question the current clients no longer answer abandoned
  the rest of the update, leaving a portrait over an empty band.
- `/spoken` is a command the client recognises. It never was.
- The minimap button's tooltip gets out of the way when the menu opens, instead of
  sitting over it.
- The minimap menu is the client's own on every client that has one, so it looks and
  behaves like every other addon's: entries grouped under each addon's name, a highlight
  under the cursor, closing on a second click or a click elsewhere. The 1.12, 2.4.3 and
  3.3.5 clients have no such menu, and there the player draws its own with the same
  behaviours and a background of its own. It asked for the backdrop template and never set a
  backdrop, so its entries read as text floating over the game world.
- The settings layout is shared with Spoken Quests and Spoken Zones, so the three panels
  read alike.
- The settings panel keeps one rhythm. Every row used to place itself by adding a
  hand-tuned offset, so no two sections were spaced alike; one layout owns the spacing
  now. The links to each addon's own settings have a section of their own instead of
  trailing the minimap ones.
- The settings category is "Spoken Player", and the window's settings are headed as such
  rather than by "Up next", the queue window's own title.
- The player scale slider is visible. It was built without a height, so it drew nothing
  and left a gap on the panel where the setting should have been.
- Every sound setting lives here: the channel everything speaks on, and silencing the
  game's own NPC dialogue while a line is read. Each feature addon used to carry its own
  channel control, so a player with both had two settings for one thing.
- 2.4.3 and 3.3.5 gain rows for the music-channel playback those clients need, and for the
  HD model patch. Both settings existed from the start with no way to reach them.
- Settings under Spoken Player; the frame's position, scale and lock, the minimap button and the sound channel migrate from either old addon on first login.
